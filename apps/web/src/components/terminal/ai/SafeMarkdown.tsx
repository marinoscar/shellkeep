import { Fragment, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

/**
 * A small, safe Markdown renderer for a model's answer (issue #59). It builds React elements only:
 * the text is never parsed as HTML and never reaches `dangerouslySetInnerHTML`, so a `<script>` or
 * an `<img onerror>` in an answer shows as literal text. Supports headings, bullet and numbered lists,
 * fenced code, `inline code`, **bold** and paragraphs. Links are not rendered as links.
 */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push(<Fragment key={key++}>{text.slice(last, index)}</Fragment>);
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
    last = index + token.length;
  }
  if (last < text.length) out.push(<Fragment key={`tail-${key}`}>{text.slice(last)}</Fragment>);
  return out;
}

export function SafeMarkdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trimStart().startsWith('```')) code.push(lines[i++] as string);
      i++;
      blocks.push(
        <Box
          key={key++}
          component="pre"
          sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          {code.join('\n')}
        </Box>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = (heading[1] as string).length;
      blocks.push(
        <Typography key={key++} variant={level <= 2 ? 'subtitle1' : 'subtitle2'} component="h3" sx={{ fontWeight: 600 }}>
          {renderInline(heading[2] as string)}
        </Typography>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i] as string)) {
        items.push((lines[i++] as string).replace(/^\s*([-*]|\d+\.)\s+/, ''));
      }
      blocks.push(
        <Box key={key++} component={ordered ? 'ol' : 'ul'} sx={{ m: 0, pl: 2.5 }}>
          {items.map((item, n) => (
            <Typography key={n} component="li" variant="body2">
              {renderInline(item)}
            </Typography>
          ))}
        </Box>,
      );
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() !== '' &&
      !/^(#{1,6}\s|\s*([-*]|\d+\.)\s|\s*```)/.test(lines[i] as string)
    ) {
      paragraph.push(lines[i++] as string);
    }
    blocks.push(
      <Typography key={key++} variant="body2">
        {renderInline(paragraph.join(' '))}
      </Typography>,
    );
  }
  return <Box sx={{ display: 'grid', gap: 1 }}>{blocks}</Box>;
}
