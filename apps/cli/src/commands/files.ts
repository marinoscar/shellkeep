import type { CliCommandRegistration } from '@marinoscar/platform-cli/core';

import { registerFilesArchive } from './files-archive.js';
import { registerFilesCat } from './files-cat.js';
import { registerFilesGet } from './files-get.js';
import { type FilesDeps, defaultFilesDeps } from './files-http.js';
import { registerFilesLs } from './files-ls.js';
import { registerFilesPut } from './files-put.js';

/**
 * The `files` group: `ls`, `cat`, `get`, `put` and `archive` (issue #159), over the files API
 * (SFTP on the server; the same access as opening a terminal on it).
 *
 * @param deps - the API, streaming and clock seams; omit them to run for real.
 */
export function filesCommand(deps?: FilesDeps): CliCommandRegistration {
  return (program) => {
    const resolved = deps ?? defaultFilesDeps();
    const group = program.command('files').description('Files on your servers, over SFTP');
    registerFilesLs(group, resolved);
    registerFilesCat(group, resolved);
    registerFilesGet(group, resolved);
    registerFilesPut(group, resolved);
    registerFilesArchive(group, resolved);
  };
}
