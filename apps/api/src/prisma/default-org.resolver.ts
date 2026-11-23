import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Resolves the id of the default organization.
 *
 * PLATFORM-ADOPTION-SHIM(#50): the storage module's `ObjectsService` (whose
 * platform model requires `org_id`) still stamps new storage objects with the
 * default organization, because its controller does not carry the request's
 * organization yet. The domain (server profiles, terminal sessions) takes the
 * organization from the request since #47 (`@CurrentOrg()`). #50 replaces the
 * storage module with the storage slice and deletes this class. See
 * docs/platform-adoption/local-exceptions.md.
 *
 * The id is read once and cached for the life of the process: the default
 * organization is never replaced. A failed lookup is not cached.
 */
@Injectable()
export class DefaultOrgResolver {
  private cached: string | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async resolve(): Promise<string> {
    if (this.cached) return this.cached;
    if (!this.pending) {
      this.pending = this.load().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async load(): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    if (!org) {
      throw new InternalServerErrorException(
        'No default organization exists; run the database migrations',
      );
    }
    this.cached = org.id;
    return org.id;
  }
}
