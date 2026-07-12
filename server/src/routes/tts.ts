import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { TtsStreamLine } from '@voice-lab/shared';
import { MODELS } from '../registry.js';
import type { TTSAdapterResolver } from '../adapters/tts/types.js';

/**
 * TTS 合成ルート。選択モデルのアダプターに委譲し、NDJSON でチャンクとメトリクスを流す。
 */
export function ttsRoute(resolve: TTSAdapterResolver) {
  const route = new Hono();

  route.post('/', async (c) => {
    const { modelKey, text, voice, params } = await c.req.json();
    const entry = MODELS.find((m) => m.key === modelKey && m.kind === 'tts');
    if (!entry) return c.json({ message: `unknown model: ${modelKey}` }, 404);

    return stream(c, async (s) => {
      const write = (line: TtsStreamLine) => s.write(JSON.stringify(line) + '\n');
      const start = performance.now();
      let ttfb: number | null = null;
      let bytes = 0;
      try {
        const adapter = resolve(entry.provider);
        for await (const chunk of adapter.synthesize({ text, model: entry.model, voice, params })) {
          if (ttfb === null) ttfb = performance.now() - start;
          bytes += chunk.byteLength;
          await write({ type: 'chunk', b64: Buffer.from(chunk).toString('base64') });
        }
        await write({
          type: 'metrics',
          serverTtfbMs: Math.round(ttfb ?? performance.now() - start),
          serverTotalMs: Math.round(performance.now() - start),
          bytes,
        });
        await write({ type: 'end' });
      } catch (err) {
        await write({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  return route;
}
