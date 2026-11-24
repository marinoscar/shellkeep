/**
 * The Markdown preview of the file viewer (issue #154): `marked` to HTML, then
 * DOMPurify. Loaded only when the preview is turned on (`import()`).
 *
 * A remote file is untrusted: raw HTML in the source is shown as text (the
 * `html` renderer escapes it), the result is sanitized again, images are
 * dropped (a remote `<img>` would leak the viewer's address to any host the
 * file names) and links open in a new tab without an opener or referrer.
 */
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Raw HTML (block or inline) is displayed, never parsed.
    html({ text }) {
      return escapeHtml(text);
    },
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

let hooked = false;
function ensureLinkHook(): void {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/** The sanitized HTML of a Markdown source. */
export function renderMarkdown(source: string): string {
  ensureLinkHook();
  const html = marked.parse(source, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'srcset'],
  });
}
