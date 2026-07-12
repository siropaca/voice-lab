import { describe, expect, it } from 'vitest';
import type { ModelEntry } from '@voice-lab/shared';
import { MODELS, filterAvailable } from '../src/registry.js';

const stub = (over: Partial<ModelEntry>): ModelEntry => ({
  key: 'p/m', kind: 'tts', provider: 'p', providerLabel: 'P', model: 'm',
  label: 'M', requiredEnv: ['KEY_A'], streaming: true, ...over,
});

describe('filterAvailable', () => {
  it('必要な env が全て揃っているモデルだけ available になる', () => {
    const models = [
      stub({ key: 'a/1', requiredEnv: ['KEY_A'] }),
      stub({ key: 'b/1', requiredEnv: ['KEY_B'] }),
      stub({ key: 'c/1', requiredEnv: ['KEY_A', 'KEY_B'] }),
    ];
    const res = filterAvailable(models, { KEY_A: 'x' });
    expect(res.available.map((m) => m.key)).toEqual(['a/1']);
    expect(res.unavailable.map((u) => u.missingEnv)).toEqual([['KEY_B'], ['KEY_B']]);
  });

  it('空文字の env は未設定として扱う', () => {
    const res = filterAvailable([stub({})], { KEY_A: '' });
    expect(res.available).toHaveLength(0);
  });
});

describe('MODELS', () => {
  it('key が全モデルで一意', () => {
    const keys = MODELS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('初期セット: TTS 4プロバイダー / STT 4プロバイダーが登録されている', () => {
    const providers = (kind: string) => new Set(MODELS.filter((m) => m.kind === kind).map((m) => m.provider));
    expect(providers('tts')).toEqual(new Set(['openai', 'elevenlabs', 'google', 'aivis']));
    expect(providers('stt')).toEqual(new Set(['openai', 'elevenlabs', 'deepgram', 'google']));
  });
});
