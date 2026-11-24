import { describe, it, expect } from 'vitest';
import { ApiError } from '@marinoscar/platform-web/core';
import {
  breadcrumbsOf,
  entryKind,
  fileIconKind,
  joinRemotePath,
  listingErrorMessage,
  parentRemotePath,
  remoteBaseName,
  revealOf,
  sizeBadge,
  visibleEntries,
} from '../../lib/files/browser';
import type { RemoteDirEntry } from '../../services/files-api';

const MB = 1024 * 1024;

function entry(name: string, extra: Partial<RemoteDirEntry> = {}): RemoteDirEntry {
  return {
    name,
    type: 'file',
    size: 0,
    mtime: '2026-11-01T00:00:00.000Z',
    mode: '0644',
    symlinkTarget: null,
    targetType: null,
    ...extra,
  };
}

describe('file browser paths (#156)', () => {
  it('joins, takes the parent and the base name', () => {
    expect(joinRemotePath('/', 'etc')).toBe('/etc');
    expect(joinRemotePath('/var/log', 'app.log')).toBe('/var/log/app.log');
    expect(parentRemotePath('/var/log')).toBe('/var');
    expect(parentRemotePath('/var')).toBe('/');
    expect(parentRemotePath('/')).toBe('/');
    expect(remoteBaseName('/var/log/app.log')).toBe('app.log');
  });

  it('reveals a file in its folder and a folder as itself', () => {
    expect(revealOf('/srv/app/logs/error.log', 'file')).toEqual({ dir: '/srv/app/logs', select: 'error.log' });
    expect(revealOf('/etc', 'file')).toEqual({ dir: '/', select: 'etc' });
    expect(revealOf('/srv/app/logs', 'dir')).toEqual({ dir: '/srv/app/logs' });
    expect(revealOf('build.log', 'file')).toEqual({ dir: '.', select: 'build.log' });
    expect(revealOf('out/build.log', 'file')).toEqual({ dir: 'out', select: 'build.log' });
  });

  it('splits a path into breadcrumbs with absolute paths', () => {
    expect(breadcrumbsOf('/var/log/nginx')).toEqual([
      { label: '/', path: '/' },
      { label: 'var', path: '/var' },
      { label: 'log', path: '/var/log' },
      { label: 'nginx', path: '/var/log/nginx' },
    ]);
    expect(breadcrumbsOf('/')).toEqual([{ label: '/', path: '/' }]);
  });
});

describe('visibleEntries (#156)', () => {
  const entries = [
    entry('b.txt', { size: 10, mtime: '2026-11-03T00:00:00.000Z' }),
    entry('.env', { size: 5 }),
    entry('src', { type: 'dir', size: 4096 }),
    entry('A.log', { size: 300, mtime: '2026-11-02T00:00:00.000Z' }),
    entry('link', { type: 'symlink', targetType: 'dir' }),
  ];

  it('hides dotfiles unless asked and keeps folders first', () => {
    const names = (list: RemoteDirEntry[]) => list.map((e) => e.name);
    expect(names(visibleEntries(entries, { showHidden: false, filter: '', sort: { key: 'name', direction: 'asc' } }))).toEqual([
      'link',
      'src',
      'A.log',
      'b.txt',
    ]);
    expect(
      names(visibleEntries(entries, { showHidden: true, filter: '', sort: { key: 'name', direction: 'asc' } })),
    ).toContain('.env');
  });

  it('filters by a case-insensitive substring and sorts by size and time', () => {
    const names = (list: RemoteDirEntry[]) => list.map((e) => e.name);
    expect(names(visibleEntries(entries, { showHidden: false, filter: 'LOG', sort: { key: 'name', direction: 'asc' } }))).toEqual([
      'A.log',
    ]);
    expect(
      names(visibleEntries(entries, { showHidden: false, filter: '', sort: { key: 'size', direction: 'desc' } })).slice(2),
    ).toEqual(['A.log', 'b.txt']);
    expect(
      names(visibleEntries(entries, { showHidden: false, filter: '', sort: { key: 'mtime', direction: 'asc' } })).slice(2),
    ).toEqual(['A.log', 'b.txt']);
  });
});

describe('row kinds, badges and errors (#156)', () => {
  it('treats a symlink as its target, a broken one as a file', () => {
    expect(entryKind(entry('l', { type: 'symlink', targetType: 'dir' }))).toBe('dir');
    expect(entryKind(entry('l', { type: 'symlink', targetType: null }))).toBe('file');
    expect(fileIconKind(entry('l', { type: 'symlink', targetType: null }))).toBe('link-broken');
    expect(fileIconKind(entry('l', { type: 'symlink', targetType: 'dir' }))).toBe('folder-link');
    expect(fileIconKind(entry('photo.PNG'))).toBe('image');
    expect(fileIconKind(entry('app.log.1'))).toBe('log');
    expect(fileIconKind(entry('main.ts'))).toBe('code');
    expect(fileIconKind(entry('config.yaml'))).toBe('text');
    expect(fileIconKind(entry('backup.tar'))).toBe('archive');
  });

  it('badges past the full-view and paged caps', () => {
    expect(sizeBadge(2 * MB)).toBeNull();
    expect(sizeBadge(2 * MB + 1)).toBe('large');
    expect(sizeBadge(200 * MB + 1)).toBe('download-only');
  });

  it('explains the files API errors', () => {
    expect(listingErrorMessage(new ApiError('x', 502, 'SFTP_UNAVAILABLE'))).toMatch(/does not offer SFTP/);
    expect(listingErrorMessage(new ApiError('x', 403, 'FILE_PERMISSION_DENIED'))).toMatch(/Permission denied/);
    expect(listingErrorMessage(new ApiError('x', 404, 'FILE_NOT_FOUND'))).toMatch(/does not exist/);
    expect(listingErrorMessage(new Error('boom'))).toBe('boom');
  });
});
