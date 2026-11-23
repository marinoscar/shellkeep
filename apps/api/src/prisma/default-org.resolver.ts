import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Resolves the id of the default organization.
 *
 * PLATFORM-ADOPTION-SHIM(#47): ShellKeep is single-organization until the
 * identity slice is adopted. Rows of the domain tables (server_profiles,
 * terminal_sessions) and of storage objects must carry an org_id, so every
 * create stamps the default organization that platform migration 0023 creates.
 * #47 deletes this class and takes the organization from the request
 * (`@CurrentOrg()` / `resolveOrgId`). See docs/platform-adoption/local-exceptions.md.
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
