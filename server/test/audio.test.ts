import { describe, expect, it } from 'vitest';
import { pcm16ToWav, resamplePcm16 } from '../src/audio.js';

describe('resamplePcm16', () => {
  it('16k→24k で長さが 1.5 倍になる', () => {
    expect(resamplePcm16(new Int16Array(1600), 16000, 24000).length).toBe(2400);
  });
  it('一定値の信号は値が保存される', () => {
    const out = resamplePcm16(new Int16Array(100).fill(1000), 16000, 24000);
    expect(out.every((v) => v === 1000)).toBe(true);
  });
  it('同一レートはそのまま返す', () => {
    const src = new Int16Array([1, 2, 3]);
    expect(resamplePcm16(src, 16000, 16000)).toBe(src);
  });
});

describe('pcm16ToWav', () => {
  it('44 バイトヘッダー + データ長になり RIFF マジックを持つ', () => {
    const wav = pcm16ToWav(new Int16Array(8), 16000);
    expect(wav.length).toBe(44 + 16);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
  });
});
