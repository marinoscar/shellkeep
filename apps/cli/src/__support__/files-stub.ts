import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { type FilesDeps, filesDepsFor } from '../commands/files-http.js';

// A stub HTTP server for the `files` command tests. Not part of the build (tsconfig.build.json).
//
// The commands run against a real socket, so streaming, headers and the body of an upload are
// the real thing; only the API's answers are scripted.

/** One request the stub received. */
export interface Seen {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

/** What a handler answers. */
export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** Sent as `{ data: json }`. */
  json?: unknown;
  /** Sent as the API's error body. */
  error?: { code: string; message: string; details?: unknown };
  body?: string | Buffer;
  /** Declare this Content-Length but send only `body` (a truncated transfer). */
  declareLength?: number;
}

export type Handler = (seen: Seen) => Reply | undefined | Promise<Reply | undefined>;

export interface Stub {
  url: string;
  seen: Seen[];
  close(): Promise<void>;
}

/** Starts a stub that answers every request through `handler` (404 when it answers nothing). */
export async function startStub(handler: Handler): Promise<Stub> {
  const seen: Seen[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const parsed = new URL(req.url ?? '/', 'http://stub');
        const entry: Seen = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          path: parsed.pathname,
          query: parsed.searchParams,
          headers: req.headers,
          body: Buffer.concat(chunks),
        };
        seen.push(entry);
        const reply = (await handler(entry)) ?? { status: 404, error: { code: 'NOT_FOUND', message: 'not found' } };
        const status = reply.status ?? 200;
        if (reply.error !== undefined) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(reply.error));
        } else if (reply.json !== undefined) {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ data: reply.json }));
        } else {
          const body = reply.body ?? '';
          res.writeHead(status, { 'content-length': String(reply.declareLength ?? Buffer.byteLength(body)), ...(reply.headers ?? {}) });
          if (reply.declareLength !== undefined) {
            res.write(body);
            setTimeout(() => res.destroy(), 20);
          } else {
            res.end(body);
          }
        }
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** The deps over a stub, capturing both streams, with an instant `sleep`. */
export function stubDeps(
  stub: Stub,
  options: { cwd: string; isTty?: boolean; token?: string },
): { deps: FilesDeps; out: () => string; err: () => string; sleeps: number[] } {
  let out = '';
  let err = '';
  const sleeps: number[] = [];
  let clock = 0;
  const deps = filesDepsFor(() => ({ baseUrl: `${stub.url}/api`, token: options.token ?? 'test-token' }), {
    stdout: { write: (text) => ((out += text), true) },
    stderr: { write: (text) => ((err += text), true) },
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    now: () => (clock += 1000),
    cwd: () => options.cwd,
    isTty: options.isTty === true,
  });
  return { deps, out: () => out, err: () => err, sleeps };
}
