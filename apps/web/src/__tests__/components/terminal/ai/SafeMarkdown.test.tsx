import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeMarkdown, parseMarkdownBlocks } from '../../../../components/terminal/ai/SafeMarkdown';

describe('SafeMarkdown (#58)', () => {
  it('renders headings, lists, inline code and fenced code', () => {
    render(
      <SafeMarkdown markdown={'## What happened\nIt **failed** at `make`.\n\n- one\n- two\n\n```\nls -la\n```'} />,
    );
    expect(screen.getByRole('heading', { name: 'What happened' })).toBeInTheDocument();
    expect(screen.getByText('failed').tagName).toBe('STRONG');
    expect(screen.getByText('make').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('ls -la').tagName).toBe('PRE');
  });

  it('never interprets HTML from the model: it is shown as text', () => {
    const { container } = render(
      <SafeMarkdown markdown={'<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[link](javascript:alert(1))'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps an unterminated fence as code', () => {
    expect(parseMarkdownBlocks('```\nabc')).toEqual([{ kind: 'code', text: 'abc' }]);
  });
});
