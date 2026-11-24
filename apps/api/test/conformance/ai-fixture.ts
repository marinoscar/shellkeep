// =============================================================================
// How ShellKeep builds itself for the AI conformance suites (issue #55)
// =============================================================================
//
// The AI suites (kill switch, RBAC matrix, secret egress, key policy, jobs
// server-only) live in `@marinoscar/platform-api/ai/testing`; they cannot build
// this app. This object is the whole of what they ask of it, assembled from the
// helpers every other integration spec here uses: `createTestApp` (the full
// `AppModule` over a mocked Prisma client), `createMockTestUser`, the OpenAPI
// document builder and the SEEDED role permissions (`prisma/catalog/permissions.json`).
//
// The suites name three roles: `admin`, `contributor` and `viewer`. ShellKeep's
// `admin` is a SYSTEM role that comes with an `org_admin` membership (the mock user
// graph mirrors production), so its permissions are the union of the two.
// =============================================================================

import type { AiConformanceFixture } from '@marinoscar/platform-api/ai/testing';

import { createOpenApiDocument } from '../../src/openapi/document';
import { catalogPermissionsOf, MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { createMockTestUser } from '../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { RunbookAgentHandler } from '../../src/runbooks/ai/runbook-agent.handler';
import { SessionSummarizeHandler } from '../../src/terminal-ai/jobs/session-summarize.handler';
import { createAiHttpTestApp } from '../ai/ai-http.helper';

export const aiConformanceFixture: AiConformanceFixture = {
  createAiApp: (options) => createAiHttpTestApp(options),
  createContext: (options) => createTestApp({ useMockDatabase: true, overrideProviders: options?.overrideProviders }),
  closeContext: (context) => closeTestApp(context as TestContext),
  createUser: (context, options) =>
    createMockTestUser(context as TestContext, options as Parameters<typeof createMockTestUser>[1]),
  openApiDocument: (app) => createOpenApiDocument(app as never) as never,
  defaultOrgId: MOCK_DEFAULT_ORG_ID,
  rolePermissions: {
    admin: [...new Set([...catalogPermissionsOf('admin'), ...catalogPermissionsOf('org_admin')])],
    contributor: catalogPermissionsOf('contributor'),
    viewer: catalogPermissionsOf('viewer'),
  },
};

/**
 * The fixture of the `ai-kill-switch` suite. That suite keeps a hard-coded payload table of the
 * platform's own `ai.*` job types and fails on any other it finds, with no extension point for an app's
 * type. So its app boots without ShellKeep's `ai.session.summarize` and `ai.runbook.agent` handlers (each
 * provider is replaced by an inert object, which registers nothing); the handlers' own kill-switch proofs, zero
 * provider calls and no pane read or SSH connection with AI off, are
 * `test/terminal-ai/session-summary.integration.spec.ts` and `test/runbooks/runbook-ai.db.spec.ts`. Every other
 * suite, `ai-jobs-server-only` included, boots the full app and sees both types.
 */
export const aiKillSwitchFixture: AiConformanceFixture = {
  ...aiConformanceFixture,
  createAiApp: (options) =>
    createAiHttpTestApp(options, {
      overrideProviders: [
        { provide: SessionSummarizeHandler, useValue: {} },
        { provide: RunbookAgentHandler, useValue: {} },
      ],
    }),
};
