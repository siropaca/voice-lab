import { describe, expect, it } from 'vitest';
import type { SttServerMessage } from '@voice-lab/shared';
import { SttFanout } from '../src/stt-fanout.js';
import type { STTAdapter } from '../src/adapters/stt/types.js';

/** onPartial/onFinal を外から叩けるフェイク */
function fakeAdapter() {
  const handlers: any[] = [];
  const adapter: STTAdapter = {
    startSession(opts) {
      handlers.push(opts);
      return { sendAudio: () => {}, close: () => {} };
    },
  };
  return { adapter, handlers };
}

const entries = [
  { key: 'a/1', provider: 'a', model: '1' },
  { key: 'b/1', provider: 'b', model: '1' },
] as any[];

describe('SttFanout', () => {
  it('イベントを modelKey 付きで emit し、summary に集計する', async () => {
    const { adapter, handlers } = fakeAdapter();
    const messages: SttServerMessage[] = [];
    let now = 0;
    const fanout = new SttFanout(entries, () => adapter, (m) => messages.push(m), () => now);

    handlers[0].onPartial('こん');
    now = 100;
    handlers[0].onFinal('こんにちは');
    handlers[1].onFinal('今日は');
    now = 500;
    await fanout.stop(0);

    expect(messages.filter((m) => m.type === 'partial')).toHaveLength(1);
    const summary = messages.at(-1) as Extract<SttServerMessage, { type: 'summary' }>;
    expect(summary.models['a/1']).toEqual({ partials: 1, finals: 1, finalDelayMs: 0, transcript: 'こんにちは' });
    expect(summary.stoppedAt).toBe(500);
  });

  it('stop 後に届いた final は finalDelayMs に反映される', async () => {
    const { adapter, handlers } = fakeAdapter();
    const messages: SttServerMessage[] = [];
    let now = 0;
    const fanout = new SttFanout(entries.slice(0, 1), () => adapter, (m) => messages.push(m), () => now);
    now = 1000;
    const stopping = fanout.stop(50); // grace 50ms
    now = 1200;
    handlers[0].onFinal('遅れて確定');
    await stopping;
    const summary = messages.at(-1) as Extract<SttServerMessage, { type: 'summary' }>;
    expect(summary.models['a/1'].finalDelayMs).toBe(200);
  });

  it('アダプター生成の失敗は error として emit し他モデルは生きる', () => {
    const { adapter } = fakeAdapter();
    const messages: SttServerMessage[] = [];
    const resolve = (p: string) => {
      if (p === 'a') throw new Error('no key');
      return adapter;
    };
    const fanout = new SttFanout(entries, resolve, (m) => messages.push(m), () => 0);
    expect(messages.some((m) => m.type === 'error' && m.modelKey === 'a/1')).toBe(true);
    fanout.sendAudio(new Uint8Array(2)); // b/1 に配信されても例外にならない
  });
});
