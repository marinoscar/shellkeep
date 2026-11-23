import { Module } from '@nestjs/common';
import { StorageProvidersModule } from './providers/storage-providers.module';
import { ObjectProcessingModule } from './processing/object-processing.module';
import { ObjectsController } from './objects/objects.controller';
import { ObjectsService } from './objects/objects.service';
import { StorageCleanupTask } from './tasks/storage-cleanup.task';
import { StorageExpiryTask } from './tasks/storage-expiry.task';

@Module({
  imports: [
    StorageProvidersModule,
    ObjectProcessingModule,
  ],
  controllers: [ObjectsController],
  providers: [ObjectsService, StorageCleanupTask, StorageExpiryTask],
  exports: [ObjectsService],
})
export class StorageModule {}
