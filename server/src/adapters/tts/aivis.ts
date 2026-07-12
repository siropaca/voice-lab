import type { TTSAdapter } from './types.js';

/**
 * Aivis Cloud TTS アダプター（スタブ）。Task 7 で合成エンドポイントの chunked mp3 を流す実装に差し替える。
 */
export function createAivisTts(_env: Record<string, string | undefined>): TTSAdapter {
  return {
    // eslint-disable-next-line require-yield
    async *synthesize() {
      throw new Error('aivis tts: not implemented yet');
    },
  };
}
