import type { TTSAdapter } from './types.js';

/**
 * ElevenLabs TTS アダプター（スタブ）。Task 6 で /stream の chunked mp3 を流す実装に差し替える。
 */
export function createElevenLabsTts(_env: Record<string, string | undefined>): TTSAdapter {
  return {
    // eslint-disable-next-line require-yield
    async *synthesize() {
      throw new Error('elevenlabs tts: not implemented yet');
    },
  };
}
