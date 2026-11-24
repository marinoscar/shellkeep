import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SafeMarkdown } from '../../../../components/terminal/ai/SafeMarkdown';

describe('SafeMarkdown (#59)', () => {
  it('renders headings, lists, code and bold as elements', () => {
    render(
      <SafeMarkdown
        source={['## What was done', 'Ran **two** commands with `ls`.', '', '- first', '- second', '', '```', 'echo hi', '```'].join('\n')}
      />,
    );
    expect(screen.getByRole('heading', { name: 'What was done' })).toBeInTheDocument();
    expect(screen.getByText('two').tagName).toBe('STRONG');
    expect(screen.getByText('ls').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('echo hi').tagName).toBe('PRE');
  });

  it('shows HTML in an answer as literal text and creates no element from it', () => {
    const { container } = render(<SafeMarkdown source={'<img src=x onerror=alert(1)> and <script>alert(2)</script>'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(container).toHaveTextContent('<script>alert(2)</script>');
  });

  it('does not turn a Markdown link into a link', () => {
    const { container } = render(<SafeMarkdown source={'[click](javascript:alert(1))'} />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('terminates on odd input', () => {
    render(<SafeMarkdown source={['#', '-', '1.5 apples', '```', 'unclosed'].join('\n')} />);
    expect(screen.getByText(/apples/)).toBeInTheDocument();
  });
});
