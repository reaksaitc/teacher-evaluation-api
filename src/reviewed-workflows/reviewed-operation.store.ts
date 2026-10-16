import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { inSerializableTransaction } from '../common/utils/serializable-transaction.util';
import { assertDepartmentScope } from '../common/utils/department-scope.util';

export type ReviewedOperationKind =
  | 'CREATE_ASSIGNMENTS'
  | 'BULK_EVALUATIONS'
  | 'ENROLL_GROUP'
  | 'CREATE_EVALUATION'
  | 'REASSIGN_ENROLLMENT'
  | 'BULK_GROUP_PLACEMENT'
  | 'OPEN_ASSIGNED_VERSION'
  | 'APPLY_LATEST_VERSION';

/** Stable JSON, independent of object insertion order and BigInt.toJSON patches. */
export function reviewJson(value: unknown): Prisma.InputJsonValue {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => reviewJson(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, item === null ? null : reviewJson(item)]),
    );
  }
  return value as Prisma.InputJsonValue;
}

export function reviewFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(reviewJson(value)))
    .digest('hex');
}

type ReviewState<T extends Record<string, unknown> = Record<string, unknown>> =
  {
    input: unknown;
    snapshot: unknown;
    output: T;
  };
type ResolveReview<
  T extends Record<string, unknown> = Record<string, unknown>,
> = (db: PrismaService) => Promise<ReviewState<T>>;

export function requireReviewAtCutover(): void {
  if (process.env.REQUIRE_REVIEWED_CONFIRMATION === 'true') {
    throw new BadRequestException({
      code: 'REVIEW_REQUIRED',
      message: 'Preview this operation and supply review_id before confirming.',
    });
  }
}

/** A finite set of reviewed administrative operations, bound to one transaction. */
export class ReviewedOperationStore {
  constructor(private readonly prisma: PrismaService) {}

  private async assertAdmin(db: PrismaService, actorId: bigint) {
    if (!actorId) throw new UnauthorizedException();
    const actor = await db.users.findUnique({
      where: { id: actorId },
      select: { role: true, status: true },
    });
    if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'ADMIN') {
      throw new ForbiddenException('An ACTIVE administrator is required.');
    }
  }

  private async authorizationScope(
    db: PrismaService,
    kind: ReviewedOperationKind,
    actorId: bigint,
  ) {
    if (
      !['CREATE_ASSIGNMENTS', 'BULK_EVALUATIONS', 'CREATE_EVALUATION'].includes(
        kind,
      )
    )
      return undefined;
    return (await assertDepartmentScope(db, actorId)).map(String).sort();
  }

  async preview<T extends Record<string, unknown>>(
    kind: ReviewedOperationKind,
    resource: string,
    actorId: bigint,
    resolve: ResolveReview<T>,
  ) {
    return inSerializableTransaction(this.prisma, async (db) => {
      await this.assertAdmin(db, actorId);
      const state = await resolve(db);
      const authorizationScope = await this.authorizationScope(
        db,
        kind,
        actorId,
      );
      const expiresAt = new Date(Date.now() + 15 * 60_000);
      const review = await db.reviewed_operations.create({
        data: {
          operation_kind: kind,
          resource_key: resource,
          actor_id: actorId,
          request_json: reviewJson(
            authorizationScope === undefined
              ? state.input
              : { input: state.input, authorization_scope: authorizationScope },
          ),
          request_fingerprint: reviewFingerprint(state.input),
          snapshot_fingerprint: reviewFingerprint(state.snapshot),
          expires_at: expiresAt,
        },
      });
      return {
        ...state.output,
        review_id: review.id,
        expires_at: expiresAt.toISOString(),
      };
    });
  }

  async confirm(
    kind: ReviewedOperationKind,
    resource: string,
    actorId: bigint,
    reviewId: string,
    input: unknown,
    resolve: ResolveReview,
    mutate: (db: PrismaService) => Promise<unknown>,
  ): Promise<Record<string, unknown>> {
    if (!reviewId)
      throw new BadRequestException({
        code: 'REVIEW_REQUIRED',
        message: 'review_id is required.',
      });
    return inSerializableTransaction(this.prisma, async (db) => {
      await this.assertAdmin(db, actorId);
      const review = await db.reviewed_operations.findUnique({
        where: { id: reviewId },
      });
      // Avoid disclosing another administrator's stored review or context.
      if (!review || review.actor_id !== actorId)
        throw new NotFoundException('Review not found');
      if (review.operation_kind !== kind || review.resource_key !== resource) {
        throw new ConflictException({
          code: 'REVIEW_OPERATION_MISMATCH',
          message: 'Review belongs to a different operation.',
        });
      }
      if (review.request_fingerprint !== reviewFingerprint(input)) {
        throw new ConflictException({
          code: 'REVIEW_INPUT_MISMATCH',
          message: 'Confirmation differs from the reviewed input.',
        });
      }
      const authorizationScope = await this.authorizationScope(
        db,
        kind,
        actorId,
      );
      const capturedScope = (
        review.request_json as { authorization_scope?: string[] }
      )?.authorization_scope;
      if (
        authorizationScope !== undefined &&
        capturedScope !== undefined &&
        reviewFingerprint(authorizationScope) !==
          reviewFingerprint(capturedScope)
      ) {
        throw new ForbiddenException({
          code: 'REVIEW_SCOPE_CHANGED',
          message:
            'Administrator department access changed. This review or receipt cannot be replayed with different access.',
        });
      }
      if (review.completed_at) {
        return {
          ...(review.result_json as Record<string, unknown>),
          review_id: review.id,
          already_applied: true,
        };
      }
      if (review.expires_at.getTime() <= Date.now()) {
        throw new ConflictException({
          code: 'REVIEW_EXPIRED',
          message: 'Review expired. Preview again.',
        });
      }
      let state: ReviewState;
      try {
        state = await resolve(db);
      } catch (error) {
        if (
          error instanceof ConflictException &&
          ['EVALUATION_EXISTS', 'ASSIGNMENT_EXISTS'].includes(
            (error.getResponse() as { code?: string }).code ?? '',
          )
        )
          throw error;
        if (
          error instanceof BadRequestException ||
          error instanceof NotFoundException ||
          error instanceof ConflictException
        ) {
          throw new ConflictException({
            code: 'REVIEW_STALE',
            message: 'Reviewed state changed. Preview again.',
          });
        }
        throw error;
      }
      if (review.snapshot_fingerprint !== reviewFingerprint(state.snapshot)) {
        throw new ConflictException({
          code: 'REVIEW_STALE',
          message: 'Reviewed context or impact changed. Preview again.',
        });
      }
      const result = reviewJson(await mutate(db));
      const saved = await db.reviewed_operations.updateMany({
        where: { id: review.id, completed_at: null },
        data: { completed_at: new Date(), result_json: result },
      });
      if (saved.count !== 1)
        throw new ConflictException(
          'The reviewed operation conflicted. Retry the same review.',
        );
      return {
        ...(result as Record<string, unknown>),
        review_id: review.id,
        already_applied: false,
      };
    });
  }
}
