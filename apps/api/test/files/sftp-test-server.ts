// =============================================================================
// An SFTP server over a real directory, for the files API specs (issue #153)
// =============================================================================
//
// An in-process `ssh2` Server on 127.0.0.1 (an ephemeral port) that accepts one password and
// serves the SFTP subsystem from the real file system under `root` (the login home), or refuses
// the subsystem (`sftpEnabled: false`). It records what a spec needs to prove: the bytes read
// and the handles still open (a client abort must close the handle).
// =============================================================================

import { type Stats, closeSync, constants as fsc, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { join, resolve } from 'node:path';
import { Server, utils } from 'ssh2';

import { fingerprintOf } from '../../src/ssh/host-key';
import { generateHostKey } from '../terminal/scripted-ssh-server';

const { STATUS_CODE } = utils.sftp;

export interface SftpTestServer {
  readonly port: number;
  readonly fingerprint: string;
  readonly username: string;
  readonly password: string;
  readonly stats: { bytesRead: number; bytesWritten: number; writeOpens: number; openHandles: number; connections: number; sftpRequests: number };
  /** Delay every READ by this many ms (lets a spec abort mid-stream). */
  readDelayMs: number;
  /** Delay every WRITE by this many ms (lets a spec abort mid-upload). */
  writeDelayMs: number;
  close(): Promise<void>;
}

const attrsOf = (st: Stats) => ({
  mode: st.mode,
  uid: st.uid,
  gid: st.gid,
  size: st.size,
  atime: Math.floor(st.atimeMs / 1000),
  mtime: Math.floor(st.mtimeMs / 1000),
});

export async function startSftpTestServer(options: { root: string; sftpEnabled?: boolean }): Promise<SftpTestServer> {
  const username = 'files-user';
  const password = 'FAKE-PASSWORD-sftp-1234';
  const { keys, parsed } = generateHostKey();
  const home = realpathSync(options.root);
  const stats = { bytesRead: 0, bytesWritten: 0, writeOpens: 0, openHandles: 0, connections: 0, sftpRequests: 0 };
  const state = { readDelayMs: 0, writeDelayMs: 0 };
  const sockets = new Set<Socket>();
  const absolute = (p: string): string => (p === '.' || p === '' ? home : resolve(home, p));

  const server = new Server({ hostKeys: [keys.private] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) ctx.accept();
      else ctx.reject(['password']);
    });
    client.on('error', () => undefined);
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp, rejectSftp) => {
          if (options.sftpEnabled === false) return rejectSftp();
          const sftp = acceptSftp();
          const handles = new Map<string, { fd?: number; dir?: string; done?: boolean }>();
          let next = 0;
          const newHandle = (entry: { fd?: number; dir?: string }): Buffer => {
            const id = `h${next++}`;
            handles.set(id, entry);
            stats.openHandles += 1;
            return Buffer.from(id);
          };
          const fail = (reqid: number, error: unknown): void => {
            const code = (error as NodeJS.ErrnoException)?.code;
            sftp.status(reqid, code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : code === 'EACCES' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE);
          };
          const guarded = (name: string, fn: (...args: any[]) => void) =>
            sftp.on(name as never, ((reqid: number, ...rest: unknown[]) => {
              stats.sftpRequests += 1;
              try {
                fn(reqid, ...rest);
              } catch (error) {
                fail(reqid, error);
              }
            }) as never);

          guarded('REALPATH', (reqid, path: string) => {
            const real = realpathSync(absolute(path));
            sftp.name(reqid, [{ filename: real, longname: real, attrs: {} as never }]);
          });
          guarded('STAT', (reqid, path: string) => sftp.attrs(reqid, attrsOf(statSync(absolute(path)))));
          guarded('LSTAT', (reqid, path: string) => sftp.attrs(reqid, attrsOf(lstatSync(absolute(path)))));
          guarded('READLINK', (reqid, path: string) => {
            const target = readlinkSync(absolute(path));
            sftp.name(reqid, [{ filename: target, longname: target, attrs: {} as never }]);
          });
          guarded('OPENDIR', (reqid, path: string) => {
            const dir = absolute(path);
            readdirSync(dir);
            sftp.handle(reqid, newHandle({ dir }));
          });
          guarded('READDIR', (reqid, handle: Buffer) => {
            const entry = handles.get(handle.toString());
            if (!entry?.dir || entry.done) return void sftp.status(reqid, STATUS_CODE.EOF);
            entry.done = true;
            const names = readdirSync(entry.dir).map((filename) => ({
              filename,
              longname: filename,
              attrs: attrsOf(lstatSync(join(entry.dir as string, filename))) as never,
            }));
            sftp.name(reqid, names);
          });
          guarded('OPEN', (reqid, path: string, pflags: number) => {
            const { OPEN_MODE } = utils.sftp;
            let flags = pflags & OPEN_MODE.WRITE ? fsc.O_WRONLY : fsc.O_RDONLY;
            if (pflags & OPEN_MODE.CREAT) flags |= fsc.O_CREAT;
            if (pflags & OPEN_MODE.TRUNC) flags |= fsc.O_TRUNC;
            if (pflags & OPEN_MODE.EXCL) flags |= fsc.O_EXCL;
            const fd = openSync(absolute(path), flags, 0o644);
            if (pflags & OPEN_MODE.WRITE) stats.writeOpens += 1;
            sftp.handle(reqid, newHandle({ fd }));
          });
          guarded('WRITE', (reqid, handle: Buffer, offset: number, data: Buffer) => {
            const entry = handles.get(handle.toString());
            if (entry?.fd === undefined) return void sftp.status(reqid, STATUS_CODE.FAILURE);
            const reply = (): void => {
              try {
                writeSync(entry.fd as number, data, 0, data.length, offset);
                stats.bytesWritten += data.length;
                sftp.status(reqid, STATUS_CODE.OK);
              } catch (error) {
                fail(reqid, error);
              }
            };
            if (state.writeDelayMs > 0) setTimeout(reply, state.writeDelayMs);
            else reply();
          });
          // Like OpenSSH's standard RENAME: it never replaces an existing target.
          guarded('RENAME', (reqid, from: string, to: string) => {
            if (existsSync(absolute(to))) return void sftp.status(reqid, STATUS_CODE.FAILURE);
            renameSync(absolute(from), absolute(to));
            sftp.status(reqid, STATUS_CODE.OK);
          });
          guarded('REMOVE', (reqid, path: string) => {
            unlinkSync(absolute(path));
            sftp.status(reqid, STATUS_CODE.OK);
          });
          guarded('FSETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          guarded('SETSTAT', (reqid) => sftp.status(reqid, STATUS_CODE.OK));
          guarded('FSTAT', (reqid, handle: Buffer) => {
            const entry = handles.get(handle.toString());
            if (entry?.fd === undefined) return void sftp.status(reqid, STATUS_CODE.FAILURE);
            sftp.attrs(reqid, attrsOf(fstatSync(entry.fd)));
          });
          guarded('READ', (reqid, handle: Buffer, offset: number, length: number) => {
            const entry = handles.get(handle.toString());
            if (entry?.fd === undefined) return void sftp.status(reqid, STATUS_CODE.FAILURE);
            const buffer = Buffer.alloc(length);
            const n = readSync(entry.fd, buffer, 0, length, offset);
            if (n === 0) return void sftp.status(reqid, STATUS_CODE.EOF);
            stats.bytesRead += n;
            const reply = (): void => void sftp.data(reqid, buffer.subarray(0, n));
            if (state.readDelayMs > 0) setTimeout(reply, state.readDelayMs);
            else reply();
          });
          guarded('CLOSE', (reqid, handle: Buffer) => {
            const entry = handles.get(handle.toString());
            if (entry) {
              if (entry.fd !== undefined) closeSync(entry.fd);
              handles.delete(handle.toString());
              stats.openHandles -= 1;
            }
            sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('end', () => {
            for (const entry of handles.values()) {
              if (entry.fd !== undefined) closeSync(entry.fd);
              stats.openHandles -= 1;
            }
            handles.clear();
          });
        });
      });
    });
  });
  server.on('connection', (raw) => {
    const socket = raw as unknown as Socket;
    stats.connections += 1;
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

  const result: SftpTestServer = {
    port: (server.address() as AddressInfo).port,
    fingerprint: fingerprintOf(parsed.getPublicSSH()),
    username,
    password,
    stats,
    get readDelayMs() {
      return state.readDelayMs;
    },
    set readDelayMs(value: number) {
      state.readDelayMs = value;
    },
    get writeDelayMs() {
      return state.writeDelayMs;
    },
    set writeDelayMs(value: number) {
      state.writeDelayMs = value;
    },
    close: () =>
      new Promise<void>((done) => {
        for (const socket of sockets) (socket as unknown as { destroy?: () => void }).destroy?.();
        server.close(() => done());
      }),
  };
  return result;
}
