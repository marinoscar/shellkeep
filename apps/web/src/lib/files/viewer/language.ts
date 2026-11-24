/**
 * Which editor mode a remote file opens in (issue #154, epic #151).
 *
 * Picked from the file NAME only (extension first, then well-known names), so
 * the choice is instant and never costs a request. An optional first line lets
 * a shebang (`#!/bin/bash`) pick shell for an extensionless script.
 */

/** Every mode the viewer knows. `plain` is the fallback. */
export type FileLanguage =
  | 'markdown'
  | 'json'
  | 'yaml'
  | 'xml'
  | 'shell'
  | 'ini'
  | 'toml'
  | 'dockerfile'
  | 'nginx'
  | 'env'
  | 'log'
  | 'plain';

/** The label the toolbar shows for each mode. */
export const FILE_LANGUAGE_LABELS: Record<FileLanguage, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  xml: 'XML',
  shell: 'Shell',
  ini: 'INI / config',
  toml: 'TOML',
  dockerfile: 'Dockerfile',
  nginx: 'nginx',
  env: 'Environment',
  log: 'Log',
  plain: 'Plain text',
};

const BY_EXTENSION: Record<string, FileLanguage> = {
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  json: 'json',
  webmanifest: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  xsd: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  svg: 'xml',
  plist: 'xml',
  rss: 'xml',
  atom: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ksh: 'shell',
  ini: 'ini',
  cfg: 'ini',
  cnf: 'ini',
  conf: 'ini',
  properties: 'ini',
  service: 'ini',
  timer: 'ini',
  socket: 'ini',
  desktop: 'ini',
  toml: 'toml',
  dockerfile: 'dockerfile',
  nginx: 'nginx',
  env: 'env',
  log: 'log',
};

/** Dotfiles and other well-known names, matched whole (lower case). */
const BY_NAME: Record<string, FileLanguage> = {
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.bash_login': 'shell',
  '.bash_logout': 'shell',
  '.bash_aliases': 'shell',
  '.profile': 'shell',
  '.zshrc': 'shell',
  '.zshenv': 'shell',
  '.zprofile': 'shell',
  '.zlogin': 'shell',
  '.zlogout': 'shell',
  '.kshrc': 'shell',
  '.envrc': 'shell',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  '.npmrc': 'ini',
  '.pypirc': 'ini',
  '.my.cnf': 'ini',
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  'nginx.conf': 'nginx',
  '.env': 'env',
};

/** The last path segment. */
export function fileBaseName(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** Whether the name is a log: `.log`, `*.log.N`, or a name containing `log` or `journal`. */
export function isLogName(name: string): boolean {
  const lower = name.toLowerCase();
  return /\.log(\.\d+)?$/.test(lower) || lower.includes('log') || lower.includes('journal');
}

/**
 * The mode for a path. Order: the whole name, the `.env` family, Dockerfile
 * variants, nginx (`*.conf` under an `nginx` directory), `*.log.N`, the
 * extension, a shell shebang, a name containing `log`, plain text.
 */
export function pickLanguage(path: string, firstLine?: string): FileLanguage {
  const name = fileBaseName(path).toLowerCase();
  const byName = BY_NAME[name];
  if (byName) return byName;
  if (name.startsWith('.env.') || name.endsWith('.env')) return 'env';
  if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile') || name.startsWith('containerfile.')) {
    return 'dockerfile';
  }
  if (name.endsWith('.conf') && /(^|\/)nginx(\/|$)/.test(path.toLowerCase())) return 'nginx';
  if (/\.log\.\d+$/.test(name)) return 'log';
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const byExtension = BY_EXTENSION[name.slice(dot + 1)];
    if (byExtension) return byExtension;
  }
  if (firstLine && /^#!.*\b(ba|z|k|da)?sh\b/.test(firstLine)) return 'shell';
  if (dot <= 0 && isLogName(name)) return 'log';
  if (dot > 0 && isLogName(name.slice(0, dot))) return 'log';
  return 'plain';
}

/** The image types the viewer previews (SVG only ever as an `<img>`). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

/** Whether the path names an image the viewer can preview. */
export function isImagePath(path: string): boolean {
  const name = fileBaseName(path).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1));
}
