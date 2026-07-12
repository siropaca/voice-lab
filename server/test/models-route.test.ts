import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/models', () => {
  it('env にあるキーのモデルだけ available で返す', async () => {
    const { app } = createApp({ OPENAI_API_KEY: 'x' });
    const res = await app.request('/api/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available.every((m: any) => m.requiredEnv.includes('OPENAI_API_KEY'))).toBe(true);
    expect(body.unavailable.length).toBeGreaterThan(0);
  });
});
