/**
 * The CodeMirror language support of each viewer mode, loaded on demand
 * (issue #154). Every pack is a dynamic `import()`, so opening a YAML file
 * never downloads the nginx or Dockerfile modes. JSON uses the Lezer grammar;
 * the rest are the small stream modes of `@codemirror/legacy-modes`, plus a
 * minimal Markdown mode below (the full `@codemirror/lang-markdown` pulls in
 * the HTML, CSS and JavaScript languages, far more than a read-only viewer
 * needs).
 */
import { StreamLanguage, type StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import type { FileLanguage } from './language';

/** A minimal Markdown mode: headings, fences, quotes, lists, emphasis, code and links. */
export const markdownStream: StreamParser<{ fence: boolean }> = {
  name: 'markdown',
  startState: () => ({ fence: false }),
  token(stream, state) {
    if (stream.sol()) {
      if (stream.match(/^\s*(```|~~~)/)) {
        state.fence = !state.fence;
        stream.skipToEnd();
        return 'meta';
      }
      if (state.fence) {
        stream.skipToEnd();
        return 'monospace';
      }
      if (stream.match(/^#{1,6}\s.*/)) return 'heading';
      if (stream.match(/^\s*>.*/)) return 'quote';
      if (stream.match(/^\s*([-*+]|\d+[.)])\s/)) return 'list';
      if (stream.match(/^\s*([-*_]\s*){3,}$/)) return 'contentSeparator';
    }
    if (state.fence) {
      stream.skipToEnd();
      return 'monospace';
    }
    if (stream.match(/^`[^`]*`/)) return 'monospace';
    if (stream.match(/^(\*\*|__)(?=\S)[^*_]+?\1/)) return 'strong';
    if (stream.match(/^(\*|_)(?=\S)[^*_]+?\1/)) return 'emphasis';
    if (stream.match(/^\[[^\]]*\]\([^)]*\)/)) return 'link';
    stream.next();
    stream.eatWhile(/[^`*_[\\]/);
    return null;
  },
};

async function legacy(load: () => Promise<StreamParser<unknown>>): Promise<Extension> {
  return StreamLanguage.define(await load());
}

/** The language extension of a mode; `[]` for plain text and logs (logs get their own highlighter). */
export async function loadLanguage(language: FileLanguage): Promise<Extension> {
  switch (language) {
    case 'json':
      return (await import('@codemirror/lang-json')).json();
    case 'markdown':
      return StreamLanguage.define(markdownStream);
    case 'yaml':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/yaml')).yaml);
    case 'xml':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/xml')).xml);
    case 'shell':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/shell')).shell);
    case 'ini':
    case 'env':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/properties')).properties);
    case 'toml':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/toml')).toml);
    case 'dockerfile':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile);
    case 'nginx':
      return legacy(async () => (await import('@codemirror/legacy-modes/mode/nginx')).nginx);
    case 'log':
    case 'plain':
      return [];
  }
}
