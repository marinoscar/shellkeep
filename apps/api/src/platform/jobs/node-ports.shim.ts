import { Injectable } from '@nestjs/common';
import type { Job } from '@marinoscar/platform-api/jobs';
import { NodeJobInputError, type NodeJobInputObject, type NodeJobInputs, type NodeObjectStore } from '@marinoscar/platform-api/nodes';

/**
 * The nodes data plane's object store: signed GET and PUT URLs for a held job's bytes.
 *
 * PLATFORM-ADOPTION-SHIM(#50): ShellKeep registers no node-eligible job type (every
 * job it has is server-only, and SSH credentials are never brokered to a node), so
 * no node ever holds a job with bytes to move and this is never reached. It refuses
 * rather than minting a URL from ShellKeep's own S3 module. #50 binds the storage
 * slice's `nodeObjectStoreBinding`. See docs/platform-adoption/local-exceptions.md.
 */
@Injectable()
export class NoNodeObjectStore implements NodeObjectStore {
  async getSignedDownloadUrl(): Promise<string> {
    throw new Error('ShellKeep has no node-eligible job type; no node object store is bound');
  }

  async getSignedPutUrl(): Promise<string> {
    throw new Error('ShellKeep has no node-eligible job type; no node object store is bound');
  }
}

/**
 * Which stored object a node-held job reads.
 *
 * PLATFORM-ADOPTION-SHIM(#50): as {@link NoNodeObjectStore}; answers the data plane's
 * named "no input" failure (a 422). #50 binds the storage slice's input resolver.
 */
@Injectable()
export class NoNodeJobInputs implements NodeJobInputs {
  async resolve(job: Job): Promise<NodeJobInputObject> {
    throw new NodeJobInputError(
      'missing_subject_id',
      'ShellKeep jobs read no stored input object',
      job.id,
      job.subjectId ?? null,
    );
  }
}
