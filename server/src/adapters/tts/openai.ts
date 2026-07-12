import type { TTSAdapter } from './types.js';

/**
 * OpenAI TTS アダプター（スタブ）。Task 5 で /v1/audio/speech の chunked mp3 を流す実装に差し替える。
 */
export function createOpenAiTts(_env: Record<string, string | undefined>): TTSAdapter {
  return {
    // eslint-disable-next-line require-yield
    async *synthesize() {
      throw new Error('openai tts: not implemented yet');
    },
  };
}
