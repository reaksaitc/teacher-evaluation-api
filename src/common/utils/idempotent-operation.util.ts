import { BadRequestException, ConflictException } from '@nestjs/common';
import { throwKnownDatabaseConstraint } from './database-constraint.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  reviewFingerprint,
  reviewJson,
} from '../../reviewed-workflows/reviewed-operation.store';
import { inSerializableTransaction } from './serializable-transaction.util';
import { assertDepartmentScope } from './department-scope.util';

/** Receipt and domain changes commit together; successful receipts do not expire. */
export async function idempotentOperation<T>(
  db: PrismaService,
  actorId: bigint,
  operation: string,
  key: string | undefined,
  input: unknown,
  mutate: (tx: PrismaService) => Promise<T>,
): Promise<T> {
  if (key !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(key))
    throw new BadRequestException(
      'idempotency_key must contain 8–128 letters, digits, underscores or hyphens',
    );
  return inSerializableTransaction(
    db,
    async (tx) => {
      const authorizationScope = actorId
        ? (await assertDepartmentScope(tx, actorId)).map(String).sort()
        : [];
      if (!key) return mutate(tx);
      const where = {
        actor_id_operation_idempotency_key: {
          actor_id: actorId,
          operation,
          idempotency_key: key,
        },
      };
      const receipt = await tx.operation_receipts.findUnique({ where });
      const fingerprint = reviewFingerprint({ input, authorizationScope });
      if (receipt) {
        if (receipt.request_fingerprint !== fingerprint)
          throw new ConflictException({
            code: 'IDEMPOTENCY_INPUT_MISMATCH',
            message:
              'This key belongs to different input or administrator department access',
          });
        return receipt.result_json as T;
      }
      const result = await mutate(tx);
      await tx.operation_receipts.create({
        data: {
          actor_id: actorId,
          operation,
          idempotency_key: key,
          request_fingerprint: fingerprint,
          result_json: reviewJson(result),
        },
      });
      return result;
    },
    (error) => {
      throwKnownDatabaseConstraint(error);
      if (error.code === 'P2002')
        throw new ConflictException({
          code: 'CONCURRENT_CREATE_CONFLICT',
          message:
            'Creation conflicted. Retry the same input and idempotency key.',
        });
      throw error;
    },
  );
}
