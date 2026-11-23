import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DefaultOrgResolver } from './default-org.resolver';

@Global()
@Module({
  providers: [PrismaService, DefaultOrgResolver],
  exports: [PrismaService, DefaultOrgResolver],
})
export class PrismaModule {}
