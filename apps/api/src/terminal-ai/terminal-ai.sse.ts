// Shared by the terminal AI routes (#57 assist, #58 explain): the SSE write loop and the model
// stream reader. Nothing here sees terminal text beyond relaying frames the services built.

import { AI_SSE_HEADERS, AiError } from '@marinoscar/platform-api/ai';
import type { FastifyReply } from 'fastify';

export const sseFrameText = (frame: { type: string }): string =>
  `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`;

/**
 * Opens the stream for `open()` and writes its frames. Every pre-stream failure rejects out of
 * `open()` before any header is written, so the global filter answers it as plain JSON.
 */
export async function streamFrames<F extends { type: string }>(
  reply: FastifyReply,
  open: (signal: AbortSignal) => Promise<AsyncIterable<F>>,
): Promise<void> {
  const controller = new AbortController();
  const res = reply.raw;
  const onClose = () => {
    if (!res.writableFinished) controller.abort(new Error('Client disconnected'));
  };
  res.on('close', onClose);

  let frames: AsyncIterable<F>;
  try {
    frames = await open(controller.signal);
  } catch (err) {
    res.off('close', onClose);
    throw err;
  }

  const inherited: Record<string, number | string | string[] | undefined> = { ...reply.getHeaders() };
  delete inherited['content-length'];
  delete inherited['content-type'];
  reply.hijack();
  res.writeHead(200, { ...inherited, ...AI_SSE_HEADERS });
  res.flushHeaders();
  try {
    for await (const frame of frames) {
      if (res.destroyed || controller.signal.aborted) break;
      res.write(sseFrameText(frame));
    }
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded) res.end();
  }
}

export type ModelStreamPart =
  | { type: 'delta'; text: string }
  | { type: 'error'; code: string }
  | { type: 'complete'; text: string };

/**
 * Relays a model event stream as `delta` parts and ends with exactly one `complete` (the whole
 * text) or `error` part. The text is never logged here.
 */
export async function* readModelStream(events: AsyncIterable<unknown>): AsyncGenerator<ModelStreamPart> {
  let text = '';
  let completedText: string | null = null;
  try {
    for await (const raw of events) {
      const event = raw as { type: string; delta?: string; code?: string; response?: { outputText?: string } };
      if (event.type === 'output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        yield { type: 'delta', text: event.delta };
      } else if (event.type === 'response.completed') {
        completedText = event.response?.outputText ?? null;
      } else if (event.type === 'error') {
        yield { type: 'error', code: event.code ?? 'AI_PROVIDER_UNAVAILABLE' };
        return;
      }
    }
  } catch (err) {
    yield { type: 'error', code: AiError.wrap(err).code };
    return;
  }
  yield { type: 'complete', text: text !== '' ? text : (completedText ?? '') };
}
