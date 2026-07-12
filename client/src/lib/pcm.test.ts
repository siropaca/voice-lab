import { describe, expect, it } from 'vitest';
import { downsample, floatTo16BitPcm } from './pcm';

describe('floatTo16BitPcm', () => {
  it('-1..1 を int16 範囲へ変換し、範囲外はクランプする', () => {
    const out = floatTo16BitPcm(new Float32Array([0, 1, -1, 2, -2]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});

describe('downsample', () => {
  it('48kHz→16kHz で長さが 1/3 になる', () => {
    const out = downsample(new Float32Array(4800), 48000, 16000);
    expect(out.length).toBe(1600);
  });
  it('同一レートはそのまま返す', () => {
    const src = new Float32Array([0.1, 0.2]);
    expect(downsample(src, 16000, 16000)).toBe(src);
  });
});
