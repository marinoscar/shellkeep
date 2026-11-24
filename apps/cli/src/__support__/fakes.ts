import { EventEmitter } from 'node:events';

import type { ApiClient } from '@marinoscar/platform-cli/api-client';
import { Command } from 'commander';

import type { CommandDeps } from '../commands/deps.js';
import type { BridgeSocket, ProcessEvents, TtyInput, TtyOutput } from '../terminal/bridge.js';

// Test doubles shared by the CLI's tests. Not part of the build (tsconfig.build.json).

/** One recorded API call. */
export interface Call {
  method: string;
  path: string;
  options?: unknown;
}

type Responder = (call: Call) => unknown;

/** An `ApiClient` that answers from a function and records what it was asked. */
export function fakeClient(respond: Responder): { client: ApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const handle = async (method: string, path: string, options?: unknown): Promise<unknown> => {
    const call: Call = { method, path, options };
    calls.push(call);
    const result = respond(call);
    if (result instanceof Error) throw result;
    return result;
  };
  const client = {
    get: (path: string, options?: unknown) => handle('GET', path, options),
    post: (path: string, _body?: unknown, options?: unknown) => handle('POST', path, options),
  } as unknown as ApiClient;
  return { client, calls };
}

/** Command deps over a fake client, capturing both streams. */
export function fakeDeps(respond: Responder): { deps: CommandDeps; calls: Call[]; out: () => string; err: () => string } {
  const { client, calls } = fakeClient(respond);
  let out = '';
  let err = '';
  return {
    calls,
    out: () => out,
    err: () => err,
    deps: {
      client: () => client,
      stdout: { write: (text) => ((out += text), true) },
      stderr: { write: (text) => ((err += text), true) },
    },
  };
}

/** A program with exitOverride, so a thrown error reaches the test. */
export function programWith(register: (program: Command) => void): Command {
  const program = new Command().name('shellkeep').exitOverride();
  program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
  register(program);
  return program;
}

/** A terminal input: a TTY by default, records raw-mode changes, feeds `data`. */
export class FakeStdin extends EventEmitter implements TtyInput {
  isTTY: boolean | undefined = true;
  raw: boolean[] = [];
  paused = true;
  setRawMode(mode: boolean): this {
    this.raw.push(mode);
    return this;
  }
  resume(): this {
    this.paused = false;
    return this;
  }
  pause(): this {
    this.paused = true;
    return this;
  }
  type(text: string | Buffer): void {
    this.emit('data', Buffer.isBuffer(text) ? text : Buffer.from(text));
  }
}

/** A terminal output that records what was written. */
export class FakeStdout implements TtyOutput {
  columns: number | undefined = 100;
  rows: number | undefined = 30;
  chunks: Buffer[] = [];
  write(data: Buffer | string): boolean {
    this.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return true;
  }
  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

/** Signals and exit as an emitter the test can fire. */
export class FakeProcess extends EventEmitter implements ProcessEvents {
  listenersOf(event: string): number {
    return this.listenerCount(event);
  }
}

/** A scripted socket: the test plays the server. */
export class FakeSocket extends EventEmitter implements BridgeSocket {
  readyState = 1;
  sent: Array<{ data: string | Buffer; binary: boolean }> = [];
  closed = false;
  send(data: string | Buffer, options?: { binary?: boolean }): void {
    this.sent.push({ data, binary: options?.binary === true });
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
  /** The text frames the client sent, parsed. */
  frames(): Array<Record<string, unknown>> {
    return this.sent.filter((entry) => !entry.binary).map((entry) => JSON.parse(String(entry.data)) as Record<string, unknown>);
  }
  /** The binary frames the client sent, concatenated. */
  binary(): Buffer {
    return Buffer.concat(this.sent.filter((entry) => entry.binary).map((entry) => entry.data as Buffer));
  }
  serverText(frame: Record<string, unknown>): void {
    this.emit('message', Buffer.from(JSON.stringify(frame)), false);
  }
  serverBinary(data: Buffer | string): void {
    this.emit('message', Buffer.from(data), true);
  }
}
