// =============================================================================
// The file a `file_upload` step sends (issue #62)
// =============================================================================
//
// A step names a storage object (#50) by id. The initiator must be able to read it (the storage slice's
// own owner scope: a missing or foreign object is a 404 here), it must be `ready`, and it must not exceed
// the upload cap. The bytes stream from the storage provider's signed download URL; nothing is buffered
// whole.
// =============================================================================

import { Readable } from 'node:stream';

import { Injectable } from '@nestjs/common';
import { ObjectsService } from '@marinoscar/platform-api/storage';

export interface RunFile {
  name: string;
  size: number;
  stream: Readable;
}

export class RunFileError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'FILE_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'RunFileError';
  }
}

@Injectable()
export class RunFileSource {
  constructor(private readonly objects: ObjectsService) {}

  async open(orgId: string, userId: string, objectId: string, maxBytes: number): Promise<RunFile> {
    let meta;
    try {
      meta = await this.objects.getById(objectId, userId, orgId);
    } catch {
      throw new RunFileError('FORBIDDEN', 'The file is not available to the person who started the run');
    }
    if (meta.status !== 'ready') throw new RunFileError('FORBIDDEN', 'The file is not ready');
    const size = Number(meta.size);
    if (!Number.isFinite(size) || size > maxBytes) throw new RunFileError('FILE_TOO_LARGE', 'The file is larger than the upload limit');
    const { url } = await this.objects.getDownloadUrl(objectId, userId, orgId, 900);
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new RunFileError('FORBIDDEN', 'The file could not be read from storage');
    return { name: meta.name, size, stream: Readable.fromWeb(response.body as never) };
  }
}
