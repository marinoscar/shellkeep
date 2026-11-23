import type { TestingModuleBuilder } from '@nestjs/testing';
import { JwtAuthGuard, PermissionsGuard, RolesGuard } from '@marinoscar/platform-api/identity';

const allow = { canActivate: () => true };

/**
 * Lets a controller UNIT spec instantiate a controller that uses `@Auth(...)`
 * without the identity slice: the three guards `@Auth` composes are replaced by
 * ones that always pass. The controller's own behaviour is what such a spec
 * tests; who may call it is proved by the integration specs (`test/**` with
 * `createTestApp`, which run the real guards over the seeded catalog).
 */
export function withoutAuthGuards(builder: TestingModuleBuilder): TestingModuleBuilder {
  return builder
    .overrideGuard(JwtAuthGuard)
    .useValue(allow)
    .overrideGuard(RolesGuard)
    .useValue(allow)
    .overrideGuard(PermissionsGuard)
    .useValue(allow);
}
