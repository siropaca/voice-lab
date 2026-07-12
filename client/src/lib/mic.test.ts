import { describe, expect, it } from 'vitest';
import { micAudioConstraints } from './mic';

describe('micAudioConstraints', () => {
  it('deviceId 未指定なら OS 既定に追従する仮想 default デバイスを ideal 指定する', () => {
    expect(micAudioConstraints()).toEqual({
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      deviceId: { ideal: 'default' },
    });
  });

  it('deviceId 指定時はそのデバイスを exact 指定する', () => {
    expect(micAudioConstraints('abc123').deviceId).toEqual({ exact: 'abc123' });
  });
});
