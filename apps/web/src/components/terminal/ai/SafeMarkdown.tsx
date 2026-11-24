import { Fragment, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/**
 * A small markdown renderer for model output (issue #58): headings, paragraphs, bullet and
 * numbered lists, fenced code, `code` and **bold**. The platform ships no markdown component and
 * the web app has no markdown dependency, so this builds React elements directly: raw HTML in the
 * text is shown as text (React escapes it), links are never made, images never load.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdownBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i] as string)) body.push(lines[i++] as string);
      i++; // the closing fence (or the end)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] as string).length, text: heading[2] as string });
      i++;
      continue;
    }
    const listPattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
    if (listPattern) {
      const items: string[] = [];
      while (i < lines.length && listPattern.test(lines[i] as string)) {
        items.push((listPattern.exec(lines[i] as string) as RegExpExecArray)[1] as string);
        i++;
      }
      blocks.push({ kind: 'list', ordered: listPattern === NUMBERED, items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() !== '' &&
      !/^\s*```/.test(lines[i] as string) &&
      !HEADING.test(lines[i] as string) &&
      !BULLET.test(lines[i] as string) &&
      !NUMBERED.test(lines[i] as string)
    ) {
      para.push(lines[i++] as string);
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push(<Fragment key={key++}>{text.slice(last, at)}</Fragment>);
    const token = match[0];
    if (token.startsWith('`')) {
      out.push(
        <Box component="code" key={key++} sx={{ fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 }}>
          {token.slice(1, -1)}
        </Box>,
      );
    } else {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}

export function SafeMarkdown({ markdown }: { markdown: string }) {
  return (
    <Box sx={{ display: 'grid', gap: 1, minWidth: 0, wordBreak: 'break-word' }} data-testid="safe-markdown">
      {parseMarkdownBlocks(markdown).map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <Typography key={index} variant="subtitle2" component="h3" sx={{ mt: index === 0 ? 0 : 0.5 }}>
                {renderInline(block.text)}
              </Typography>
            );
          case 'code':
            return (
              <Box
                key={index}
                component="pre"
                sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowX: 'auto' }}
              >
                {block.text}
              </Box>
            );
          case 'list':
            return (
              <Box key={index} component={block.ordered ? 'ol' : 'ul'} sx={{ m: 0, pl: 2.5 }}>
                {block.items.map((item, n) => (
                  <Typography key={n} component="li" variant="body2">
                    {renderInline(item)}
                  </Typography>
                ))}
              </Box>
            );
          default:
            return (
              <Typography key={index} variant="body2">
                {renderInline(block.text)}
              </Typography>
            );
        }
      })}
    </Box>
  );
}
