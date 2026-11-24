// =============================================================================
// NODE_JOB_INPUTS: which stored object a node-held job reads (issue #50)
// =============================================================================
//
// The job's organization first (`resolveJobOrgId`: the payload's `orgId`, or the
// default organization in `single` mode), then `resolveStorageObjectInput` on a
// client scoped to that organization: `storage_objects` forces row-level
// security. The slice's three named failures become the nodes slice's
// `NodeJobInputError`, which the data plane answers with a 422.
//
// ShellKeep registers no node-eligible job type today (every job is server-only;
// an SSH credential is never brokered to a node), so a node never holds a job
// with bytes to move and this is not reached in production. It is the real
// binding all the same, so a future node-eligible type needs no new port.
// =============================================================================

import { Injectable } from '@nestjs/common';
import { forOrg } from '@marinoscar/platform-api/core';
import { resolveJobOrgId } from '@marinoscar/platform-api/identity';
import type { Job } from '@marinoscar/platform-api/jobs';
import { NodeJobInputError, type NodeJobInputObject, type NodeJobInputs } from '@marinoscar/platform-api/nodes';
import {
  JobInputResolutionError,
  resolveStorageObjectInput,
  type StorageObjectReader,
} from '@marinoscar/platform-api/storage';

import { PrismaService } from '../../prisma/prisma.service';

/** ShellKeep's {@link NodeJobInputs}: storage objects, read in the job's organization. */
@Injectable()
export class NodeJobInputsAdapter implements NodeJobInputs {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(job: Job): Promise<NodeJobInputObject> {
    const orgId = await resolveJobOrgId(this.prisma, job);
    try {
      return await resolveStorageObjectInput(forOrg(this.prisma, orgId) as unknown as StorageObjectReader, job);
    } catch (error) {
      if (error instanceof JobInputResolutionError) {
        throw new NodeJobInputError(error.reason, error.message, error.jobId, error.subjectId);
      }
      throw error;
    }
  }
}
