/** A stand-in xterm that records what is written (the log drawer's tests). */
import { vi } from 'vitest';

export const terminals: { written: string[]; reset: ReturnType<typeof vi.fn> }[] = [];

export const xtermModule = {
  Terminal: vi.fn(function (this: Record<string, unknown>) {
    const record = { written: [] as string[], reset: vi.fn() };
    this.open = vi.fn();
    this.write = vi.fn((text: string) => record.written.push(text));
    this.loadAddon = vi.fn();
    this.dispose = vi.fn();
    this.reset = vi.fn(() => {
      record.written.length = 0;
    });
    this.scrollToBottom = vi.fn();
    terminals.push(record);
  }),
};
export const searchModule = {
  SearchAddon: vi.fn(function (this: Record<string, unknown>) {
    this.findNext = vi.fn();
    this.findPrevious = vi.fn();
  }),
};
export const fitModule = {
  FitAddon: vi.fn(function (this: Record<string, unknown>) {
    this.fit = vi.fn();
  }),
};
