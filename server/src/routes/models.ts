import { Hono } from 'hono';
import { MODELS, filterAvailable } from '../registry.js';

/**
 * モデル一覧ルートを作る。
 */
export function modelsRoute(env: Record<string, string | undefined>) {
  const route = new Hono();
  route.get('/', (c) => c.json(filterAvailable(MODELS, env)));
  return route;
}
