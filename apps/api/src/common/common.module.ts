import { Module } from '@nestjs/common';
import { RegistryFreezeService } from './registry/registry-freeze.service';

@Module({
  providers: [RegistryFreezeService],
})
export class CommonModule {}
