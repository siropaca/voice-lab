import { describe, expect, it } from 'vitest';
import { parseGoogleVoices } from '../src/adapters/tts/google.js';
import { parseElevenLabsVoices } from '../src/adapters/tts/elevenlabs.js';
import { OPENAI_TTS_VOICES } from '../src/adapters/tts/openai.js';

describe('parseGoogleVoices', () => {
  const apiVoices = [
    { name: 'ja-JP-Chirp3-HD-Aoede', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Chirp3-HD-Leda', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Standard-A', languageCodes: ['ja-JP'] },
    { name: 'ja-JP-Wavenet-B', languageCodes: ['ja-JP'] },
    { name: null },
  ];

  it('chirp3-hd はフルボイス名を id に、末尾を label にする（Chirp3-HD 以外は除外）', () => {
    expect(parseGoogleVoices(apiVoices, 'chirp3-hd')).toEqual([
      { id: 'ja-JP-Chirp3-HD-Aoede', label: 'Aoede' },
      { id: 'ja-JP-Chirp3-HD-Leda', label: 'Leda' },
    ]);
  });

  it('gemini は同じ天体名ファミリーから短縮名を id/label にする', () => {
    expect(parseGoogleVoices(apiVoices, 'gemini-2.5-flash-tts')).toEqual([
      { id: 'Aoede', label: 'Aoede' },
      { id: 'Leda', label: 'Leda' },
    ]);
  });

  it('空配列でも落ちない', () => {
    expect(parseGoogleVoices([], 'chirp3-hd')).toEqual([]);
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
