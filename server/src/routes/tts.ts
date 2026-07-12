import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { TtsStreamLine } from '@voice-lab/shared';
import { MODELS } from '../registry.js';
import type { TTSAdapterResolver } from '../adapters/tts/types.js';
import { newRunId, type History } from '../history.js';

/**
 * TTS 合成ルート。選択モデルのアダプターに委譲し、NDJSON でチャンクとメトリクスを流す。
 * 成功時は音声と record を履歴へ保存し、失敗時は error 付き record を保存する。
 */
export function ttsRoute(resolve: TTSAdapterResolver, history: History) {
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
      const collected: Uint8Array[] = [];
      try {
        const adapter = resolve(entry.provider);
        for await (const chunk of adapter.synthesize({ text, model: entry.model, voice, params })) {
          if (ttfb === null) ttfb = performance.now() - start;
          bytes += chunk.byteLength;
          collected.push(chunk);
          await write({ type: 'chunk', b64: Buffer.from(chunk).toString('base64') });
        }
        const serverTotalMs = Math.round(performance.now() - start);
        await write({
          type: 'metrics',
          serverTtfbMs: Math.round(ttfb ?? performance.now() - start),
          serverTotalMs,
          bytes,
        });
        const id = newRunId();
        await history.saveAudio(`${id}.mp3`, Buffer.concat(collected));
        await history.appendRun({
          id,
          kind: 'tts',
          at: new Date().toISOString(),
          modelKey,
          text,
          voice,
          params,
          serverTtfbMs: Math.round(ttfb ?? 0),
          serverTotalMs,
          bytes,
          audioFile: `${id}.mp3`,
        });
        await write({ type: 'end' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await write({ type: 'error', message });
        try {
          await history.appendRun({
            id: newRunId(),
            kind: 'tts',
            at: new Date().toISOString(),
            modelKey,
            text,
            voice,
            params,
            error: message,
          });
        } catch {
          /* 履歴保存失敗は握りつぶす（レスポンスは既に返している） */
        }
      }
    });
  });

  return route;
}
