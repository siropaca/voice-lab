import { describe, expect, it } from 'vitest';
import type { ModelsResponse } from '@voice-lab/shared';
import { filterModelsByMode } from './ttsMode';

const models: ModelsResponse = {
  available: [
    { key: 'a/stream', kind: 'tts', provider: 'a', providerLabel: 'A', model: 'm', label: 'S', requiredEnv: [], streaming: true },
    { key: 'b/batch', kind: 'tts', provider: 'b', providerLabel: 'B', model: 'm', label: 'B', requiredEnv: [], streaming: false },
    { key: 'c/stt', kind: 'stt', provider: 'c', providerLabel: 'C', model: 'm', label: 'T', requiredEnv: [], streaming: true },
  ],
  unavailable: [
    { key: 'd/stream', kind: 'tts', label: 'D S', streaming: true, missingEnv: ['K'] },
    { key: 'e/batch', kind: 'tts', label: 'E B', streaming: false, missingEnv: ['K'] },
    { key: 'f/stt', kind: 'stt', label: 'F T', streaming: true, missingEnv: ['K'] },
  ],
};

describe('filterModelsByMode', () => {
  it('streaming モードは streaming な TTS だけ（STT・batch は除外）', () => {
    const r = filterModelsByMode(models, 'streaming');
    expect(r.available.map((m) => m.key)).toEqual(['a/stream']);
    expect(r.unavailable.map((m) => m.key)).toEqual(['d/stream']);
  });

  it('batch モードは非 streaming な TTS だけ', () => {
    const r = filterModelsByMode(models, 'batch');
    expect(r.available.map((m) => m.key)).toEqual(['b/batch']);
    expect(r.unavailable.map((m) => m.key)).toEqual(['e/batch']);
  });
});
