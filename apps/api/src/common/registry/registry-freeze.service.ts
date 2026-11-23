import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { freezeDefinedRegistries, listDefinedRegistries } from './define-registry';

/**
 * Freezes every registry made with `defineRegistry` once the Nest application
 * has bootstrapped, so no request path can add an entry.
 */
@Injectable()
export class RegistryFreezeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegistryFreezeService.name);

  onApplicationBootstrap(): void {
    freezeDefinedRegistries();
    const summary = listDefinedRegistries()
      .map((r) => `${r.name}(${r.size})`)
      .join(', ');
    this.logger.debug(`Froze static registries: ${summary || '(none)'}`);
  }
}
