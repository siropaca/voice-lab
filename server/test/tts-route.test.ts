import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ttsRoute } from '../src/routes/tts.js';
import type { TTSAdapter } from '../src/adapters/tts/types.js';

const fake: TTSAdapter = {
  async *synthesize() {
    yield new Uint8Array([1, 2]);
    yield new Uint8Array([3]);
  },
};

const failing: TTSAdapter = {
  // eslint-disable-next-line require-yield
  async *synthesize() {
    throw new Error('boom');
  },
};

/** NDJSON レスポンスを行オブジェクト配列にする */
async function readLines(res: Response) {
  const text = await res.text();
  return text.trim().split('\n').map((l) => JSON.parse(l));
}

function appWith(adapter: TTSAdapter) {
  const app = new Hono();
  app.route('/api/tts', ttsRoute(() => adapter));
  return app;
}

const body = JSON.stringify({ modelKey: 'openai/gpt-4o-mini-tts', text: 'こんにちは', voice: 'alloy', params: {} });
const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body };

describe('POST /api/tts', () => {
  it('chunk → metrics → end の順で NDJSON を返す', async () => {
    const res = await appWith(fake).request('/api/tts', post);
    const lines = await readLines(res);
    expect(lines.map((l) => l.type)).toEqual(['chunk', 'chunk', 'metrics', 'end']);
    expect(lines[0].b64).toBe(Buffer.from([1, 2]).toString('base64'));
    expect(lines[2].bytes).toBe(3);
    expect(lines[2].serverTtfbMs).toBeGreaterThanOrEqual(0);
  });

  it('アダプターの例外は error 行になる', async () => {
    const res = await appWith(failing).request('/api/tts', post);
    const lines = await readLines(res);
    expect(lines.at(-1).type).toBe('error');
    expect(lines.at(-1).message).toContain('boom');
  });

  it('未知の modelKey は 404', async () => {
    const res = await appWith(fake).request('/api/tts', {
      ...post, body: JSON.stringify({ modelKey: 'nope/x', text: 'a', voice: 'v', params: {} }),
    });
    expect(res.status).toBe(404);
  });
});
