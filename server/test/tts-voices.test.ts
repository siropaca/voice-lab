import { describe, expect, it } from 'vitest';
import { parseGoogleVoices } from '../src/adapters/tts/google.js';
import { parseElevenLabsVoices } from '../src/adapters/tts/elevenlabs.js';
import { parseAivisModels } from '../src/adapters/tts/aivis.js';
import { OPENAI_TTS_VOICES, openAiVoicesFor } from '../src/adapters/tts/openai.js';

describe('parseGoogleVoices', () => {
  const apiVoices = [
    { name: 'ja-JP-Chirp3-HD-Aoede', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Chirp3-HD-Leda', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Standard-A', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Wavenet-B', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Neural2-C', languageCodes: ['ja-JP'] },
    { name: null },
  ];

  it('chirp3-hd はフルボイス名を id に、末尾を label にする（他系統は除外）', () => {
    expect(parseGoogleVoices(apiVoices, 'chirp3-hd')).toEqual([
      { id: 'ja-JP-Chirp3-HD-Aoede', label: 'Aoede' },
      { id: 'ja-JP-Chirp3-HD-Leda', label: 'Leda' },
    ]);
  });

  it('neural2 / wavenet / standard は各系統のフルネームだけ抽出する', () => {
    expect(parseGoogleVoices(apiVoices, 'neural2')).toEqual([{ id: 'ja-JP-Neural2-C', label: 'Neural2-C' }]);
    expect(parseGoogleVoices(apiVoices, 'wavenet')).toEqual([{ id: 'ja-JP-Wavenet-B', label: 'Wavenet-B' }]);
    expect(parseGoogleVoices(apiVoices, 'standard')).toEqual([{ id: 'ja-JP-Standard-A', label: 'Standard-A' }]);
  });

  it('gemini は Chirp3-HD 天体名ファミリーから短縮名を id/label にする', () => {
    expect(parseGoogleVoices(apiVoices, 'gemini-2.5-flash-tts')).toEqual([
      { id: 'Aoede', label: 'Aoede' },
      { id: 'Leda', label: 'Leda' },
    ]);
  });

  it('空配列でも落ちない', () => {
    expect(parseGoogleVoices([], 'chirp3-hd')).toEqual([]);
  });
});

describe('parseAivisModels', () => {
  it('aivm_models[].aivm_model_uuid / name を抽出する', () => {
    const json = { aivm_models: [{ aivm_model_uuid: 'u1', name: 'コハク' }, { aivm_model_uuid: 'u2' }] };
    expect(parseAivisModels(json)).toEqual([{ id: 'u1', label: 'コハク' }, { id: 'u2', label: 'u2' }]);
  });
  it('配列でなければ空', () => {
    expect(parseAivisModels({})).toEqual([]);
  });
});

describe('openAiVoicesFor', () => {
  it('tts-1 / tts-1-hd は 9 ボイス（marin/cedar 非対応）', () => {
    for (const model of ['tts-1', 'tts-1-hd']) {
      const ids = openAiVoicesFor(model).map((v) => v.id);
      expect(ids.length).toBe(9);
      expect(ids).not.toContain('marin');
      expect(ids).not.toContain('cedar');
      expect(ids).not.toContain('ballad');
    }
  });
  it('gpt-4o-mini-tts は 13 ボイス', () => {
    expect(openAiVoicesFor('gpt-4o-mini-tts').map((v) => v.id).length).toBe(13);
  });
});

describe('parseElevenLabsVoices', () => {
  it('voices[].voice_id/name を抽出する', () => {
    const json = {
      voices: [
        { voice_id: 'v1', name: 'Sarah' },
        { voice_id: 'v2', name: 'Charlotte' },
      ],
    };
    expect(parseElevenLabsVoices(json)).toEqual([
      { id: 'v1', label: 'Sarah' },
      { id: 'v2', label: 'Charlotte' },
    ]);
  });

  it('name 欠落時は voice_id を label に使う', () => {
    expect(parseElevenLabsVoices({ voices: [{ voice_id: 'v3' }] })).toEqual([{ id: 'v3', label: 'v3' }]);
  });

  it('voices が配列でなければ空配列', () => {
    expect(parseElevenLabsVoices({})).toEqual([]);
    expect(parseElevenLabsVoices(null)).toEqual([]);
  });
});

describe('OPENAI_TTS_VOICES', () => {
  it('公式の全ボイスを含む（marin/cedar を含む 13 種）', () => {
    const ids = OPENAI_TTS_VOICES.map((v) => v.id);
    expect(ids).toContain('alloy');
    expect(ids).toContain('marin');
    expect(ids).toContain('cedar');
    expect(ids.length).toBe(13);
  });
});
