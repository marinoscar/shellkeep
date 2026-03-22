import { Test, TestingModule } from '@nestjs/testing';
import { StorageExpiryTask } from './storage-expiry.task';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER, StorageProvider } from '../providers';
import {
  createMockPrismaService,
  MockPrismaService,
} from '../../../test/mocks/prisma.mock';

describe('StorageExpiryTask', () => {
  let task: StorageExpiryTask;
  let mockPrisma: MockPrismaService;
  let mockStorageProvider: jest.Mocked<StorageProvider>;

  beforeEach(async () => {
    mockPrisma = createMockPrismaService();

    mockStorageProvider = {
      upload: jest.fn(),
      initMultipartUpload: jest.fn(),
      getSignedUploadUrl: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      download: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      delete: jest.fn(),
      getMetadata: jest.fn(),
      setMetadata: jest.fn(),
      exists: jest.fn(),
      getBucket: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageExpiryTask,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
      ],
    }).compile();

    task = module.get<StorageExpiryTask>(StorageExpiryTask);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleExpiry', () => {
    it('should return early when no expired objects are found', async () => {
      mockPrisma.storageObject.findMany.mockResolvedValue([]);

      await task.handleExpiry();

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
      expect(mockStorageProvider.abortMultipartUpload).not.toHaveBeenCalled();
      expect(mockPrisma.storageObject.delete).not.toHaveBeenCalled();
    });

    it('should delete S3 object via storageProvider.delete() for objects with a storageKey', async () => {
      const expiredObject = {
        id: 'obj-1',
        storageKey: 'uploads/file-1.txt',
        s3UploadId: null,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([expiredObject] as any);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockStorageProvider.delete).toHaveBeenCalledTimes(1);
      expect(mockStorageProvider.delete).toHaveBeenCalledWith('uploads/file-1.txt');
    });

    it('should not call storageProvider.delete() for objects without a storageKey', async () => {
      const expiredObject = {
        id: 'obj-2',
        storageKey: null,
        s3UploadId: null,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([expiredObject] as any);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockStorageProvider.delete).not.toHaveBeenCalled();
    });

    it('should abort multipart upload before S3 delete for objects with s3UploadId', async () => {
      const expiredObject = {
        id: 'obj-3',
        storageKey: 'uploads/multipart-file.bin',
        s3UploadId: 'upload-abc-123',
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([expiredObject] as any);
      mockStorageProvider.abortMultipartUpload.mockResolvedValue(undefined);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockStorageProvider.abortMultipartUpload).toHaveBeenCalledTimes(1);
      expect(mockStorageProvider.abortMultipartUpload).toHaveBeenCalledWith(
        'uploads/multipart-file.bin',
        'upload-abc-123',
      );
    });

    it('should call abortMultipartUpload before delete when both s3UploadId and storageKey are present', async () => {
      const abortOrder: string[] = [];

      const expiredObject = {
        id: 'obj-4',
        storageKey: 'uploads/multipart-file.bin',
        s3UploadId: 'upload-xyz-999',
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([expiredObject] as any);
      mockStorageProvider.abortMultipartUpload.mockImplementation(async () => {
        abortOrder.push('abort');
      });
      mockStorageProvider.delete.mockImplementation(async () => {
        abortOrder.push('delete');
      });
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(abortOrder).toEqual(['abort', 'delete']);
    });

    it('should delete DB record after S3 cleanup', async () => {
      const expiredObject = {
        id: 'obj-5',
        storageKey: 'uploads/some-file.jpg',
        s3UploadId: null,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([expiredObject] as any);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockPrisma.storageObject.delete).toHaveBeenCalledTimes(1);
      expect(mockPrisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: 'obj-5' },
      });
    });

    it('should delete DB record even when storageKey is null', async () => {
      const expiredObject = {
        id: 'obj-6',
        storageKey: null,
        s3UploadId: null,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([expiredObject] as any);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockPrisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: 'obj-6' },
      });
    });

    it('should continue processing remaining objects when one fails', async () => {
      const failingObject = {
        id: 'obj-fail',
        storageKey: 'uploads/bad-file.jpg',
        s3UploadId: null,
      };
      const successObject = {
        id: 'obj-ok',
        storageKey: 'uploads/good-file.jpg',
        s3UploadId: null,
      };

      mockPrisma.storageObject.findMany.mockResolvedValue([
        failingObject,
        successObject,
      ] as any);

      mockStorageProvider.delete
        .mockRejectedValueOnce(new Error('S3 error'))
        .mockResolvedValueOnce(undefined);

      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockStorageProvider.delete).toHaveBeenCalledTimes(2);
      // Only the successful object should have its DB record deleted
      expect(mockPrisma.storageObject.delete).toHaveBeenCalledTimes(1);
      expect(mockPrisma.storageObject.delete).toHaveBeenCalledWith({
        where: { id: 'obj-ok' },
      });
    });

    it('should query objects with createdAt older than 24 hours and no status filter', async () => {
      const now = new Date('2024-06-15T12:00:00Z');
      jest.useFakeTimers();
      jest.setSystemTime(now);

      mockPrisma.storageObject.findMany.mockResolvedValue([]);

      await task.handleExpiry();

      const expectedExpiry = new Date('2024-06-14T12:00:00Z');

      expect(mockPrisma.storageObject.findMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: expectedExpiry },
        },
        select: {
          id: true,
          storageKey: true,
          s3UploadId: true,
        },
      });

      jest.useRealTimers();
    });

    it('should process multiple expired objects independently', async () => {
      const objects = [
        { id: 'obj-a', storageKey: 'uploads/a.txt', s3UploadId: null },
        { id: 'obj-b', storageKey: 'uploads/b.txt', s3UploadId: 'upload-b' },
        { id: 'obj-c', storageKey: null, s3UploadId: null },
      ];

      mockPrisma.storageObject.findMany.mockResolvedValue(objects as any);
      mockStorageProvider.abortMultipartUpload.mockResolvedValue(undefined);
      mockStorageProvider.delete.mockResolvedValue(undefined);
      mockPrisma.storageObject.delete.mockResolvedValue({} as any);

      await task.handleExpiry();

      expect(mockStorageProvider.abortMultipartUpload).toHaveBeenCalledTimes(1);
      expect(mockStorageProvider.abortMultipartUpload).toHaveBeenCalledWith(
        'uploads/b.txt',
        'upload-b',
      );
      expect(mockStorageProvider.delete).toHaveBeenCalledTimes(2);
      expect(mockPrisma.storageObject.delete).toHaveBeenCalledTimes(3);
    });

    it('should not throw when the findMany query fails', async () => {
      mockPrisma.storageObject.findMany.mockRejectedValue(
        new Error('Database connection error'),
      );

      await expect(task.handleExpiry()).resolves.not.toThrow();
    });
  });
});
