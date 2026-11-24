// =============================================================================
// TELEMETRY_AI adapter: the assistant, reported as disabled (issue #53)
// =============================================================================
//
// PLATFORM-ADOPTION-SHIM(#55): ShellKeep has no AI platform yet, so the telemetry
// assistant has nothing to call. This adapter answers the port honestly:
// `assertEnabled()` throws the platform's 403 `AI_DISABLED` (the very error
// `TelemetryAiEnabledGuard` surfaces while AI is off), so every assistant route
// refuses and the rest of the slice (explorer, dashboard, status, Doctor) is
// unaffected. #55 adopts the AI slice and replaces this with an adapter over
// `AiService.forUser(...).runTools`.
//
// No key, prompt or model call exists here to leak.
// =============================================================================

import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  TelemetryAiError,
  TelemetryAiPort,
  TelemetryAiSession,
  TelemetryAiTool,
  TelemetryAiToolDefinition,
} from '@marinoscar/platform-api/telemetry';
import type { z } from 'zod';

const AI_DISABLED_MESSAGE = 'AI is not available in this deployment';

@Injectable()
export class TelemetryAiAdapter implements TelemetryAiPort {
  forUser(_userId: string): TelemetryAiSession {
    return {
      runTools: () => Promise.reject(new ForbiddenException({ code: 'AI_DISABLED', message: AI_DISABLED_MESSAGE })),
    };
  }

  defineTool<P extends z.ZodType, R>(definition: TelemetryAiToolDefinition<P, R>): TelemetryAiTool {
    // Opaque to the slice and never run: the loop that would hand it back is refused above.
    return definition as unknown as TelemetryAiTool;
  }

  isAiError(_error: unknown): _error is TelemetryAiError {
    return false;
  }

  assertEnabled(): Promise<void> {
    return Promise.reject(new ForbiddenException({ code: 'AI_DISABLED', message: AI_DISABLED_MESSAGE }));
  }
}
