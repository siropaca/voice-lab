import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { History } from '../history.js';

/**
 * 履歴一覧と保存音声の配信。
 */
export function historyRoute(history: History) {
  const route = new Hono();
  route.get('/', async (c) => c.json(await history.listRuns()));
  route.get('/audio/:file', async (c) => {
    const file = c.req.param('file');
    if (file.includes('/') || file.includes('..')) return c.text('bad request', 400);
    const data = await readFile(join(history.audioDir, file)).catch(() => null);
    if (!data) return c.text('not found', 404);
    const type = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
    return c.body(data, 200, { 'content-type': type });
  });
  return route;
}
