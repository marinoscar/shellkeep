import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ObjectsController } from './objects.controller';
import { ObjectsService } from './objects.service';

describe('ObjectsController', () => {
  let controller: ObjectsController;
  let mockObjectsService: jest.Mocked<ObjectsService>;

  const userId = 'user-uuid';
  const objectId = 'object-uuid';

  const mockObjectResponse = {
    id: objectId,
    name: 'test-file.jpg',
    mimeType: 'image/jpeg',
    size: 12345,
    status: 'ready',
    userId,
    createdAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    mockObjectsService = {
      list: jest.fn(),
      getById: jest.fn(),
      getDownloadUrl: jest.fn(),
      delete: jest.fn(),
      updateMetadata: jest.fn(),
      initUpload: jest.fn(),
      getUploadStatus: jest.fn(),
      completeUpload: jest.fn(),
      abortUpload: jest.fn(),
      simpleUpload: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ObjectsController],
      providers: [
        { provide: ObjectsService, useValue: mockObjectsService },
      ],
    }).compile();

    controller = module.get<ObjectsController>(ObjectsController);
  });

  describe('list', () => {
    it('should return paginated objects wrapped in data envelope', async () => {
      const query = { page: 1, pageSize: 20 } as any;
      const serviceResult = {
        items: [mockObjectResponse],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockObjectsService.list.mockResolvedValue(serviceResult as any);

      const result = await controller.list(query, userId);

      expect(result).toEqual({ data: serviceResult });
      expect(mockObjectsService.list).toHaveBeenCalledWith(query, userId);
    });

    it('should propagate service errors', async () => {
      mockObjectsService.list.mockRejectedValue(new Error('DB error'));

      await expect(controller.list({} as any, userId)).rejects.toThrow('DB error');
    });
  });

  describe('getById', () => {
    it('should return a single object wrapped in data envelope', async () => {
      mockObjectsService.getById.mockResolvedValue(mockObjectResponse as any);

      const result = await controller.getById(objectId, userId);

      expect(result).toEqual({ data: mockObjectResponse });
      expect(mockObjectsService.getById).toHaveBeenCalledWith(objectId, userId);
    });

    it('should propagate NotFoundException when object does not exist', async () => {
      mockObjectsService.getById.mockRejectedValue(new NotFoundException('Object not found'));

      await expect(controller.getById('missing-uuid', userId)).rejects.toThrow(NotFoundException);
    });

    it('should propagate ForbiddenException when user does not own object', async () => {
      mockObjectsService.getById.mockRejectedValue(
        new ForbiddenException('Access denied'),
      );

      await expect(controller.getById(objectId, 'other-user-uuid')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('getDownloadUrl', () => {
    it('should return download url wrapped in data envelope', async () => {
      const downloadResult = { url: 'https://storage.example.com/signed-url', expiresAt: '...' };
      mockObjectsService.getDownloadUrl.mockResolvedValue(downloadResult as any);

      const result = await controller.getDownloadUrl(objectId, 3600, userId);

      expect(result).toEqual({ data: downloadResult });
      expect(mockObjectsService.getDownloadUrl).toHaveBeenCalledWith(objectId, userId, 3600);
    });

    it('should pass undefined expiresIn when not provided', async () => {
      mockObjectsService.getDownloadUrl.mockResolvedValue({ url: 'https://...' } as any);

      await controller.getDownloadUrl(objectId, undefined, userId);

      expect(mockObjectsService.getDownloadUrl).toHaveBeenCalledWith(objectId, userId, undefined);
    });

    it('should propagate BadRequestException when object is not ready', async () => {
      mockObjectsService.getDownloadUrl.mockRejectedValue(
        new BadRequestException('Object is not ready for download'),
      );

      await expect(controller.getDownloadUrl(objectId, undefined, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('deleteObject', () => {
    it('should delete the object and return void', async () => {
      mockObjectsService.delete.mockResolvedValue(undefined);

      const result = await controller.deleteObject(objectId, userId);

      expect(result).toBeUndefined();
      expect(mockObjectsService.delete).toHaveBeenCalledWith(objectId, userId);
    });

    it('should propagate NotFoundException when object does not exist', async () => {
      mockObjectsService.delete.mockRejectedValue(new NotFoundException('Object not found'));

      await expect(controller.deleteObject('missing-uuid', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateMetadata', () => {
    it('should update metadata and return updated object wrapped in data envelope', async () => {
      const dto = { metadata: { description: 'Profile photo' } } as any;
      mockObjectsService.updateMetadata.mockResolvedValue(mockObjectResponse as any);

      const result = await controller.updateMetadata(objectId, dto, userId);

      expect(result).toEqual({ data: mockObjectResponse });
      expect(mockObjectsService.updateMetadata).toHaveBeenCalledWith(objectId, dto, userId);
    });

    it('should propagate NotFoundException when object does not exist', async () => {
      mockObjectsService.updateMetadata.mockRejectedValue(
        new NotFoundException('Object not found'),
      );

      await expect(
        controller.updateMetadata('missing-uuid', {} as any, userId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('initUpload', () => {
    it('should initialize upload and return result wrapped in data envelope', async () => {
      const dto = { name: 'large-file.zip', mimeType: 'application/zip', size: 52428800 } as any;
      const initResult = {
        objectId,
        uploadId: 'upload-uuid',
        parts: [{ partNumber: 1, uploadUrl: 'https://...' }],
      };
      mockObjectsService.initUpload.mockResolvedValue(initResult as any);

      const result = await controller.initUpload(dto, userId);

      expect(result).toEqual({ data: initResult });
      expect(mockObjectsService.initUpload).toHaveBeenCalledWith(dto, userId);
    });

    it('should propagate service errors', async () => {
      mockObjectsService.initUpload.mockRejectedValue(new Error('Storage error'));

      await expect(controller.initUpload({} as any, userId)).rejects.toThrow('Storage error');
    });
  });

  describe('getUploadStatus', () => {
    it('should return upload status wrapped in data envelope', async () => {
      const statusResult = {
        objectId,
        status: 'uploading',
        uploadedParts: 2,
        totalParts: 5,
      };
      mockObjectsService.getUploadStatus.mockResolvedValue(statusResult as any);

      const result = await controller.getUploadStatus(objectId, userId);

      expect(result).toEqual({ data: statusResult });
      expect(mockObjectsService.getUploadStatus).toHaveBeenCalledWith(objectId, userId);
    });

    it('should propagate NotFoundException when upload does not exist', async () => {
      mockObjectsService.getUploadStatus.mockRejectedValue(
        new NotFoundException('Upload not found'),
      );

      await expect(controller.getUploadStatus('missing-uuid', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('completeUpload', () => {
    it('should complete the upload and return the finalized object wrapped in data envelope', async () => {
      const dto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      } as any;
      mockObjectsService.completeUpload.mockResolvedValue(mockObjectResponse as any);

      const result = await controller.completeUpload(objectId, dto, userId);

      expect(result).toEqual({ data: mockObjectResponse });
      expect(mockObjectsService.completeUpload).toHaveBeenCalledWith(objectId, dto, userId);
    });

    it('should propagate service errors', async () => {
      mockObjectsService.completeUpload.mockRejectedValue(new Error('Assembly failed'));

      await expect(controller.completeUpload(objectId, {} as any, userId)).rejects.toThrow(
        'Assembly failed',
      );
    });
  });

  describe('abortUpload', () => {
    it('should abort the upload and return void', async () => {
      mockObjectsService.abortUpload.mockResolvedValue(undefined);

      const result = await controller.abortUpload(objectId, userId);

      expect(result).toBeUndefined();
      expect(mockObjectsService.abortUpload).toHaveBeenCalledWith(objectId, userId);
    });

    it('should propagate service errors', async () => {
      mockObjectsService.abortUpload.mockRejectedValue(new Error('Abort failed'));

      await expect(controller.abortUpload(objectId, userId)).rejects.toThrow('Abort failed');
    });
  });

  describe('simpleUpload', () => {
    it('should upload a file and return result wrapped in data envelope', async () => {
      mockObjectsService.simpleUpload.mockResolvedValue(mockObjectResponse as any);

      const mockFileData = {
        filename: 'photo.jpg',
        mimetype: 'image/jpeg',
        file: {} as NodeJS.ReadableStream,
      };
      const mockReq = {
        file: jest.fn().mockResolvedValue(mockFileData),
      } as any;

      const result = await controller.simpleUpload(mockReq, userId);

      expect(result).toEqual({ data: mockObjectResponse });
      expect(mockObjectsService.simpleUpload).toHaveBeenCalledWith(
        {
          filename: 'photo.jpg',
          mimetype: 'image/jpeg',
          file: mockFileData.file,
        },
        userId,
      );
    });

    it('should throw BadRequestException when no file provided', async () => {
      const mockReq = {
        file: jest.fn().mockResolvedValue(undefined),
      } as any;

      await expect(controller.simpleUpload(mockReq, userId)).rejects.toThrow(BadRequestException);
      expect(mockObjectsService.simpleUpload).not.toHaveBeenCalled();
    });

    it('should propagate service errors', async () => {
      mockObjectsService.simpleUpload.mockRejectedValue(new Error('Upload failed'));

      const mockFileData = {
        filename: 'photo.jpg',
        mimetype: 'image/jpeg',
        file: {} as NodeJS.ReadableStream,
      };
      const mockReq = {
        file: jest.fn().mockResolvedValue(mockFileData),
      } as any;

      await expect(controller.simpleUpload(mockReq, userId)).rejects.toThrow('Upload failed');
    });
  });
});
