// =============================================================================
// The raw body of a file upload (issue #157)
// =============================================================================
//
// `POST /api/server-profiles/:id/files/upload` takes `application/octet-stream` and must read it
// as a STREAM (a file is never buffered). Fastify has no parser for that type, so this registers
// one that hands the request through unread, for the upload route only; on any other route it
// answers the 415 Fastify would have answered. The route enforces the size while streaming
// (`files.uploadMaxBytes`), which is a stronger bound than `bodyLimit` (that only governs
// buffering parsers).
// =============================================================================

import { UnsupportedMediaTypeException } from '@nestjs/common';

/** The route as Fastify names it (`routeOptions.url`), under any global prefix. */
const UPLOAD_ROUTE = /\/server-profiles\/:id\/files\/upload$/;

interface ParserHost {
  addContentTypeParser(
    contentType: string,
    parser: (request: { routeOptions?: { url?: string } }, payload: unknown, done: (error: Error | null, body?: unknown) => void) => void,
  ): void;
}

/** Call once from the bootstrap (and a test app) on the Fastify instance, before `init()` / `listen()`. */
export function registerFileUploadBodyParser(instance: unknown): void {
  (instance as ParserHost).addContentTypeParser('application/octet-stream', (request, payload, done) => {
    if (UPLOAD_ROUTE.test(request.routeOptions?.url ?? '')) {
      done(null, payload);
      return;
    }
    const error = new UnsupportedMediaTypeException('Unsupported Media Type: application/octet-stream') as Error & { statusCode?: number; code?: string };
    error.statusCode = 415;
    error.code = 'FST_ERR_CTP_INVALID_MEDIA_TYPE';
    done(error, undefined);
  });
}
