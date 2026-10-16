import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AlignmentWorkflowsController } from './alignment-workflows.controller';
import { AssignmentCreationService } from './assignment-creation.service';
import { BulkEvaluationsService } from './bulk-evaluations.service';
import { PrismaService } from '../prisma/prisma.service';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BulkEvaluationsDto } from './dto/alignment-workflows.dto';

describe('Alignment workflow controller contracts', () => {
  const db = {} as PrismaService,
    controller = new AlignmentWorkflowsController(db),
    actor = { id: 71n };
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('requires authentication and role guards on every route', () =>
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AlignmentWorkflowsController),
    ).toHaveLength(2));
  it('requires an idempotency key for new-year setup and existing-year recovery', () => {
    expect(() => controller.setup({ name: '2027' }, actor)).toThrow(
      'idempotency_key',
    );
    expect(() => controller.finish(1n, { name: '2027' }, actor)).toThrow(
      'idempotency_key',
    );
  });
  it('takes the assignment preview actor from the authenticated session', async () => {
    const spy = jest
      .spyOn(AssignmentCreationService.prototype, 'preview')
      .mockResolvedValue({
        items: [],
        can_confirm: true,
        review_id: 'test',
        expires_at: 'test',
      });
    await controller.assignmentPreview({ rows: [] }, actor);
    expect(spy).toHaveBeenCalledWith({ rows: [] }, 71n);
  });
  it('takes the bulk preview actor from the authenticated session', async () => {
    const spy = jest
      .spyOn(BulkEvaluationsService.prototype, 'preview')
      .mockResolvedValue({
        items: [],
        can_confirm: false,
        review_id: 'test',
        expires_at: 'test',
      });
    await controller.bulkPreview({ evaluations: [] }, actor);
    expect(spy).toHaveBeenCalledWith({ evaluations: [] }, 71n);
  });
  it('rejects empty and oversized bulk requests before service writes', async () => {
    expect(
      (await validate(plainToInstance(BulkEvaluationsDto, { evaluations: [] })))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(BulkEvaluationsDto, {
            evaluations: Array.from({ length: 51 }, () => ({})),
          }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
