// Maps a host-key refusal onto the HTTP error envelope (`{ code, message, details }`).

import { ConflictException } from '@nestjs/common';

import { HostKeyError } from './host-key.error';

export function hostKeyErrorToHttp(error: HostKeyError, serverProfileId?: string): ConflictException {
  return new ConflictException({
    code: error.code,
    message: error.message,
    details: {
      presented: error.presented,
      expected: error.expected ?? null,
      serverProfileId: serverProfileId ?? error.serverProfileId ?? null,
    },
  });
}
