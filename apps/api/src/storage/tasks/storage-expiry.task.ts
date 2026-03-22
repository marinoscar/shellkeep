import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { STORAGE_PROVIDER, StorageProvider } from '../providers';
import { Inject } from '@nestjs/common';

@Injectable()
export class StorageExpiryTask {
  private readonly logger = new Logger(StorageExpiryTask.name);

  // Expire all storage objects older than 24 hours regardless of status
  private readonly EXPIRY_AGE_HOURS = 24;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: StorageProvider,
  ) {}

  // Runs daily at 9:00 AM UTC (3:00 AM CST)
  @Cron('0 9 * * *')
  async handleExpiry(): Promise<void> {
    this.logger.log('Starting storage expiry task');

    try {
      const expiryBefore = new Date();
      expiryBefore.setHours(expiryBefore.getHours() - this.EXPIRY_AGE_HOURS);

      // Find ALL objects older than threshold regardless of status
      const expiredObjects = await this.prisma.storageObject.findMany({
        where: {
          createdAt: { lt: expiryBefore },
        },
        select: {
          id: true,
          storageKey: true,
          s3UploadId: true,
        },
      });

      if (expiredObjects.length === 0) {
        this.logger.log('No expired storage objects to remove');
        return;
      }

      this.logger.log(
        `Found ${expiredObjects.length} expired storage objects to remove`,
      );

      let successCount = 0;
      let errorCount = 0;

      for (const object of expiredObjects) {
        try {
          // Abort S3 multipart upload if in progress
          if (object.s3UploadId) {
            await this.storageProvider.abortMultipartUpload(
              object.storageKey,
              object.s3UploadId,
            );
          }

          // Delete from S3 if a storage key exists
          if (object.storageKey) {
            await this.storageProvider.delete(object.storageKey);
          }

          // Delete from database (chunks cascade delete)
          await this.prisma.storageObject.delete({
            where: { id: object.id },
          });

          successCount++;
          this.logger.debug(`Deleted expired storage object: ${object.id}`);
        } catch (error) {
          errorCount++;
          this.logger.error(
            `Failed to delete expired storage object ${object.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }

      this.logger.log(
        `Storage expiry completed: ${successCount} removed, ${errorCount} failed`,
      );
    } catch (error) {
      this.logger.error(
        `Storage expiry task failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
