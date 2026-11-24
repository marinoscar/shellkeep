// =============================================================================
// The AI slice's composition (issue #55)
// =============================================================================
//
// `AiModule.forRoot` mounts the platform AI slice: `GET /api/ai/config`,
// `/api/ai/keys` (a user's own provider keys), the responses, embeddings, images,
// audio, realtime and runs routes, `/api/ai/features`, `/api/ai/usage`,
// `/api/admin/ai/*` (the deployment policy, the model catalogue, deployment and
// organization keys, usage), the `ai.*` job types and the kill switch.
//
// No environment variable: keys, models and limits are runtime configuration (the
// `ai` settings namespace and the credential stores).
//
// ORDER: `app-registrations/ai.ts` registers ShellKeep's AI features, and the
// registry freezes when the application bootstraps, so it is imported HERE at
// module load, after the settings registry. A feature module imports this
// `AiModule` (the same dynamic-module object), never `PlatformAiModule` and never a
// second `forRoot()`.
// =============================================================================

import { AiModule as PlatformAiModule } from '@marinoscar/platform-api/ai';

import '../settings/registry';
import '../../app-registrations/ai';
import { AiHostModule } from './ai-host.module';

export const AiModule = PlatformAiModule.forRoot({ imports: [AiHostModule] });
