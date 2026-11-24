// A small extension table: enough for the viewer to pick a language and a preview. Anything
// else is `application/octet-stream`; whether a file is text is decided by its bytes, not this.

const TABLE: Record<string, string> = {
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', toml: 'application/toml',
  xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css', csv: 'text/csv',
  js: 'text/javascript', mjs: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript',
  py: 'text/x-python', rb: 'text/x-ruby', go: 'text/x-go', rs: 'text/x-rust', java: 'text/x-java',
  c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', sh: 'application/x-sh', bash: 'application/x-sh',
  conf: 'text/plain', ini: 'text/plain', env: 'text/plain', sql: 'application/sql',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf',
  zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar',
  bz2: 'application/x-bzip2', xz: 'application/x-xz', '7z': 'application/x-7z-compressed',
};

export const DEFAULT_MIME = 'application/octet-stream';

/** The MIME type guessed from the file name's extension. */
export function guessMime(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 && !name.startsWith('.')) return DEFAULT_MIME;
  const ext = name.slice(dot + 1).toLowerCase();
  return TABLE[ext] ?? DEFAULT_MIME;
}
