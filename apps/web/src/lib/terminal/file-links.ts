/**
 * File references in terminal output (issue #155, epic #151): which parts of
 * a line look like a path the user may want to open, download or copy.
 *
 * Pure and linear: a line is cut into tokens with ONE single-class regex, URL
 * spans are masked with a literal-scheme regex, and each token is classified
 * with plain string checks. No pattern here backtracks over its input, so a
 * long adversarial line costs time proportional to its length.
 *
 * Detected: absolute paths (`/var/log/x.log`), `~/` paths, `./` and `../`
 * paths, bare relative paths that contain a `/` or end in a known extension
 * (`src/app.ts`, `config.yaml`), each optionally followed by `:line` or
 * `:line:col` (compiler, grep and stack-trace output) or `(line,col)`.
 * Excluded: URLs and anything inside one, email addresses and `user@host:`
 * remotes, pure numbers, dates and version strings (`1.2.3`), flags.
 */

/** One file reference found in a line. */
export interface FileReference {
  /** The path as printed, without the `:line:col` suffix. */
  path: string;
  /** 1-based line, when printed. */
  line?: number;
  /** 1-based column, when printed with a line. */
  col?: number;
  /** Index of the first character of the link text in the line. */
  start: number;
  /** Index just past the link text (it includes `:line:col`). */
  end: number;
}

/** Longest token considered; anything longer is not a path anyone printed to click. */
export const MAX_TOKEN_LENGTH = 1024;
/** At most this many references per line, so one hovered line never fans out. */
export const MAX_REFERENCES_PER_LINE = 8;

/**
 * Extensions that make a bare name (no `/`) a file reference. Deliberately no
 * top-level domains that are not also file types, so `example.com` stays text.
 */
const KNOWN_EXTENSIONS = new Set(
  (
    'log txt md markdown rst adoc json jsonc json5 ndjson yaml yml toml ini conf cfg cnf env properties ' +
    'xml html htm css scss sass less js mjs cjs jsx ts tsx mts cts vue svelte py pyi rb go rs java kt kts ' +
    'c h cc cpp cxx hpp hh cs php pl pm lua sh bash zsh fish ps1 bat cmd sql prisma graphql gql proto ' +
    'csv tsv lock gradle swift scala dart ex exs erl hs ml tf tfvars hcl nix service timer socket mount ' +
    'pem key crt cer csr pub out err pid patch diff gz tgz zip tar bz2 xz zst 7z jar war deb rpm apk ' +
    'png jpg jpeg gif svg webp ico bmp pdf dockerfile mk cmake vim tmpl tpl j2 bak orig swp sqlite db'
  ).split(' '),
);

/** Names without an extension that are files more often than words. */
const KNOWN_NAMES = new Set([
  'Dockerfile',
  'Makefile',
  'Jenkinsfile',
  'Procfile',
  'Gemfile',
  'Vagrantfile',
  'Containerfile',
  'Caddyfile',
  '.env',
  '.bashrc',
  '.bash_profile',
  '.zshrc',
  '.profile',
  '.vimrc',
  '.gitignore',
  '.gitconfig',
  '.npmrc',
  '.tmux.conf',
]);

/** Splits a line at whitespace, quotes, brackets and shell punctuation. One class: linear. */
const TOKEN = /[^\s"'`<>()[\]{}|;,=]+/g;
/** URL spans; the scheme is a literal alternative, so a failed start costs O(1). */
const URL_SPAN = /(?:https?|ftps?|sftp|ssh|git|wss?|file|mailto):\/\/[^\s"'`<>]*/gi;
/** Characters a sentence or a list puts after a path. */
const TRAILING_PUNCTUATION = new Set(['.', ',', ':', ';', '!', '?', ')', ']', '}', '"', "'", '`']);
/** Numbers, dates, times, versions and IP addresses: never a file. */
const NUMERIC_LIKE = /^v?[\d.:/_-]+$/;

/** Mask URL spans with spaces so no token can come from inside one. Indices are kept. */
function maskUrls(line: string): string {
  if (!line.includes('://')) return line;
  return line.replace(URL_SPAN, (match) => ' '.repeat(match.length));
}

function isDigits(text: string): boolean {
  if (text.length === 0 || text.length > 9) return false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/** Splits a trailing `:line` or `:line:col` off a token. */
function splitLineSuffix(token: string): { path: string; line?: number; col?: number } {
  const last = token.lastIndexOf(':');
  if (last <= 0) return { path: token };
  const tail = token.slice(last + 1);
  if (!isDigits(tail)) return { path: token };
  const before = token.slice(0, last);
  const prev = before.lastIndexOf(':');
  if (prev > 0 && isDigits(before.slice(prev + 1))) {
    return { path: before.slice(0, prev), line: Number(before.slice(prev + 1)), col: Number(tail) };
  }
  return { path: before, line: Number(tail) };
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function hasWordCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 95 ||
      code > 127
    ) {
      return true;
    }
  }
  return false;
}

/** An email address or an scp-style `user@host:` remote: `@` before any `/`. */
function looksLikeEmailOrRemote(path: string): boolean {
  const at = path.indexOf('@');
  if (at < 0) return false;
  const slash = path.indexOf('/');
  return slash < 0 || at < slash;
}

/** Whether a printed path (suffix removed) is a file reference worth linking. */
export function isFileLikePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_TOKEN_LENGTH) return false;
  if (path.startsWith('-')) return false;
  if (path.includes('://') || looksLikeEmailOrRemote(path)) return false;
  if (!hasWordCharacter(path)) return false;
  if (path.startsWith('//')) return false;

  if (path.startsWith('/')) return path.length > 1;
  if (path.startsWith('~/')) return path.length > 2;
  if (path.startsWith('./')) return path.length > 2;
  if (path.startsWith('../')) return path.length > 3;

  // A bare relative path: never a number, a date, a version or an address.
  if (NUMERIC_LIKE.test(path)) return false;
  if (path.includes(':')) return false;
  // `src/app.ts`, `logs/`: whether it exists is the server's answer (stat).
  if (path.includes('/')) return true;
  if (KNOWN_NAMES.has(path)) return true;
  const ext = extensionOf(path);
  return ext !== null && KNOWN_EXTENSIONS.has(ext);
}

/** Removes the punctuation a sentence puts after a path. */
function trimTrailing(token: string): string {
  let end = token.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(token[end - 1])) end -= 1;
  return token.slice(0, end);
}

/** `(12,5)` right after a path (TypeScript and MSVC output). */
function parenthesisedPosition(line: string, from: number): { line: number; col?: number; length: number } | null {
  if (line[from] !== '(') return null;
  const close = line.indexOf(')', from);
  if (close < 0 || close - from > 20) return null;
  const inside = line.slice(from + 1, close);
  const comma = inside.indexOf(',');
  const row = comma < 0 ? inside : inside.slice(0, comma);
  const col = comma < 0 ? '' : inside.slice(comma + 1);
  if (!isDigits(row) || (comma >= 0 && !isDigits(col))) return null;
  return { line: Number(row), ...(comma >= 0 ? { col: Number(col) } : {}), length: close - from + 1 };
}

/**
 * Every file reference in `line`, in order, at most `MAX_REFERENCES_PER_LINE`.
 * Linear in the length of the line.
 */
export function findFileReferences(line: string, limit = MAX_REFERENCES_PER_LINE): FileReference[] {
  const found: FileReference[] = [];
  if (!line || limit <= 0) return found;
  const masked = maskUrls(line);
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(masked)) !== null) {
    const raw = match[0];
    if (raw.length > MAX_TOKEN_LENGTH) continue;
    const text = trimTrailing(raw);
    if (!text) continue;
    const { path, line: row, col } = splitLineSuffix(text);
    if (!isFileLikePath(path)) continue;
    const start = match.index;
    let end = start + text.length;
    let position: { line?: number; col?: number } = row !== undefined ? { line: row, ...(col !== undefined ? { col } : {}) } : {};
    if (row === undefined && end === start + raw.length) {
      const paren = parenthesisedPosition(line, end);
      if (paren) {
        position = { line: paren.line, ...(paren.col !== undefined ? { col: paren.col } : {}) };
        end += paren.length;
      }
    }
    if (position.line !== undefined && position.line < 1) position = {};
    found.push({ path, ...position, start, end });
    if (found.length >= limit) break;
  }
  return found;
}
