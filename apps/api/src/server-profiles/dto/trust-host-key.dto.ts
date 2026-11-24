import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { FINGERPRINT_PATTERN } from '../../ssh/host-key';

export const trustHostKeySchema = z.object({
  /** The `SHA256:...` fingerprint the user verified. */
  fingerprint: z.string().regex(FINGERPRINT_PATTERN, 'Expected an OpenSSH SHA256 fingerprint'),
  /** Required to REPLACE a different trusted key: the profile hostname, typed. */
  confirmHostname: z.string().min(1).max(255).optional(),
});

export class TrustHostKeyDto extends createZodDto(trustHostKeySchema) {}
