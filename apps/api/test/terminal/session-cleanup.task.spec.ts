import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { JobsService } from '@marinoscar/platform-api/jobs';

import { PrismaService } from '../../src/prisma/prisma.service';
import { TERMINAL_SESSION_REAP_TYPE } from '../../src/terminal/jobs/session-reap.handler';
import { SessionCleanupTask } from '../../src/terminal/tasks/session-cleanup.task';

describe('SessionCleanupTask (enqueue-only cron, #49)', () => {
  let task: SessionCleanupTask;
  let jobs: { enqueue: jest.Mock };
  let prisma: { job: { findFirst: jest.Mock }; terminalSession: Record<string, jest.Mock> };

  beforeEach(async () => {
    jobs = { enqueue: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    prisma = {
      job: { findFirst: jest.fn().mockResolvedValue(null) },
      terminalSession: { updateMany: jest.fn(), updateManyAndReturn: jest.fn(), deleteMany: jest.fn() },
    };
    const module = await Test.createTestingModule({
      providers: [
        SessionCleanupTask,
        { provide: JobsService, useValue: jobs },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    task = module.get(SessionCleanupTask);
  });

  it('keeps its five-minute schedule', () => {
    const cron = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', SessionCleanupTask.prototype.handleCleanup);
    expect(cron.cronTime).toBe('0 */5 * * * *');
  });

  it('enqueues one system terminal.session.reap job and touches no session', async () => {
    await task.handleCleanup();

    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: TERMINAL_SESSION_REAP_TYPE, orgId: null }),
    );
    expect(TERMINAL_SESSION_REAP_TYPE).toBe('terminal.session.reap');
    for (const method of Object.values(prisma.terminalSession)) expect(method).not.toHaveBeenCalled();
  });

  it.each(['pending', 'running'])('does not enqueue a second job while one is %s', async (status) => {
    prisma.job.findFirst.mockResolvedValue({ id: 'job-0', status });

    await task.handleCleanup();

    expect(prisma.job.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: TERMINAL_SESSION_REAP_TYPE, status: { in: ['pending', 'running'] } } }),
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('never throws when the queue is unavailable', async () => {
    jobs.enqueue.mockRejectedValue(new Error('db down'));

    await expect(task.handleCleanup()).resolves.toBeUndefined();
  });
});
