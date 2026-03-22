import { Test, TestingModule } from '@nestjs/testing';
import { StorageCleanupTask } from './storage-cleanup.task';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER } from '../providers';

describe('StorageCleanupTask', () => {
  let task: StorageCleanupTask;
  let prisma: PrismaService;
  let storageProvider: { abortMultipartUpload: jest.Mock };

  beforeEach(async () => {
    storageProvider = {
      abortMultipartUpload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageCleanupTask,
        {
          provide: PrismaService,
          useValue: {
            storageObject: {
              findMany: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: STORAGE_PROVIDER,
          useValue: storageProvider,
        },
      ],
    }).compile();

    task = module.get<StorageCleanupTask>(StorageCleanupTask);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleCleanup', () => {
    it('should query for pending and uploading objects older than 24 hours', async () => {
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue([]);

      const beforeTime = Date.now();
      await task.handleCleanup();
      const afterTime = Date.now();

      expect(prisma.storageObject.findMany).toHaveBeenCalledTimes(1);

      const findCall = (prisma.storageObject.findMany as jest.Mock).mock
        .calls[0][0];

      expect(findCall.where.status).toEqual({ in: ['pending', 'uploading'] });

      const cutoffTime = findCall.where.createdAt.lt.getTime();
      const twentyFourHoursMs = 24 * 60 * 60 * 1000;
      expect(cutoffTime).toBeGreaterThanOrEqual(
        beforeTime - twentyFourHoursMs - 100,
      );
      expect(cutoffTime).toBeLessThanOrEqual(afterTime - twentyFourHoursMs + 100);
    });

    it('should select only id, storageKey, and s3UploadId fields', async () => {
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue([]);

      await task.handleCleanup();

      const findCall = (prisma.storageObject.findMany as jest.Mock).mock
        .calls[0][0];

      expect(findCall.select).toEqual({
        id: true,
        storageKey: true,
        s3UploadId: true,
      });
    });

    it('should log and return early when there are no stale uploads', async () => {
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue([]);

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(logSpy).toHaveBeenCalledWith('No stale uploads to clean up');
      expect(prisma.storageObject.delete).not.toHaveBeenCalled();
      expect(storageProvider.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('should delete each stale upload record from the database', async () => {
      const staleUploads = [
        { id: 'obj-1', storageKey: 'key/file-1.jpg', s3UploadId: null },
        { id: 'obj-2', storageKey: 'key/file-2.jpg', s3UploadId: null },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      (prisma.storageObject.delete as jest.Mock).mockResolvedValue({});

      await task.handleCleanup();

      expect(prisma.storageObject.delete).toHaveBeenCalledTimes(2);
      expect(prisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: 'obj-1' },
      });
      expect(prisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: 'obj-2' },
      });
    });

    it('should call abortMultipartUpload for uploads that have an s3UploadId', async () => {
      const staleUploads = [
        {
          id: 'obj-1',
          storageKey: 'key/file-1.jpg',
          s3UploadId: 'multipart-upload-id-abc',
        },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      (prisma.storageObject.delete as jest.Mock).mockResolvedValue({});
      storageProvider.abortMultipartUpload.mockResolvedValue(undefined);

      await task.handleCleanup();

      expect(storageProvider.abortMultipartUpload).toHaveBeenCalledTimes(1);
      expect(storageProvider.abortMultipartUpload).toHaveBeenCalledWith(
        'key/file-1.jpg',
        'multipart-upload-id-abc',
      );
    });

    it('should not call abortMultipartUpload for uploads without an s3UploadId', async () => {
      const staleUploads = [
        { id: 'obj-1', storageKey: 'key/file-1.jpg', s3UploadId: null },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      (prisma.storageObject.delete as jest.Mock).mockResolvedValue({});

      await task.handleCleanup();

      expect(storageProvider.abortMultipartUpload).not.toHaveBeenCalled();
      expect(prisma.storageObject.delete).toHaveBeenCalledTimes(1);
    });

    it('should log the count of successfully removed and failed records', async () => {
      const staleUploads = [
        { id: 'obj-1', storageKey: 'key/file-1.jpg', s3UploadId: null },
        { id: 'obj-2', storageKey: 'key/file-2.jpg', s3UploadId: null },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      (prisma.storageObject.delete as jest.Mock).mockResolvedValue({});

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Storage cleanup completed: 2 removed, 0 failed',
      );
    });

    it('should increment errorCount and log error when deleting an individual upload fails', async () => {
      const staleUploads = [
        { id: 'obj-1', storageKey: 'key/file-1.jpg', s3UploadId: null },
        { id: 'obj-2', storageKey: 'key/file-2.jpg', s3UploadId: null },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      (prisma.storageObject.delete as jest.Mock)
        .mockResolvedValueOnce({}) // obj-1 succeeds
        .mockRejectedValueOnce(new Error('FK constraint violation')); // obj-2 fails

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn((task as any).logger, 'error')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Storage cleanup completed: 1 removed, 1 failed',
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('obj-2'),
      );
    });

    it('should increment errorCount and log error when aborting a multipart upload fails', async () => {
      const staleUploads = [
        {
          id: 'obj-1',
          storageKey: 'key/file-1.jpg',
          s3UploadId: 'upload-abc',
        },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      storageProvider.abortMultipartUpload.mockRejectedValue(
        new Error('S3 abort failed'),
      );

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn((task as any).logger, 'error')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(logSpy).toHaveBeenCalledWith(
        'Storage cleanup completed: 0 removed, 1 failed',
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('obj-1'),
      );
      // Database delete should not be called if abort threw
      expect(prisma.storageObject.delete).not.toHaveBeenCalled();
    });

    it('should log an error and not rethrow when the outer findMany query fails', async () => {
      (prisma.storageObject.findMany as jest.Mock).mockRejectedValue(
        new Error('Database unavailable'),
      );

      const errorSpy = jest
        .spyOn((task as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(task.handleCleanup()).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Storage cleanup task failed'),
      );
    });

    it('should process all uploads independently, continuing after a per-record failure', async () => {
      const staleUploads = [
        { id: 'obj-1', storageKey: 'key/file-1.jpg', s3UploadId: null },
        { id: 'obj-2', storageKey: 'key/file-2.jpg', s3UploadId: null },
        { id: 'obj-3', storageKey: 'key/file-3.jpg', s3UploadId: null },
      ];
      (prisma.storageObject.findMany as jest.Mock).mockResolvedValue(staleUploads);
      (prisma.storageObject.delete as jest.Mock)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Transient error'))
        .mockResolvedValueOnce({});

      const logSpy = jest
        .spyOn((task as any).logger, 'log')
        .mockImplementation(() => undefined);

      await task.handleCleanup();

      expect(prisma.storageObject.delete).toHaveBeenCalledTimes(3);
      expect(logSpy).toHaveBeenCalledWith(
        'Storage cleanup completed: 2 removed, 1 failed',
      );
    });
  });
});
