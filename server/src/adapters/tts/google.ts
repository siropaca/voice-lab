import type { TTSAdapter } from './types.js';

/**
 * Google Cloud TTS アダプター（スタブ）。Task 8 で synthesizeSpeech の音声を 1 チャンクで返す実装に差し替える。
 * 外部クライアントはコンストラクタで生成せず、実装時に synthesize 内で生成する。
 */
export function createGoogleTts(_env: Record<string, string | undefined>): TTSAdapter {
  return {
    // eslint-disable-next-line require-yield
    async *synthesize() {
      throw new Error('google tts: not implemented yet');
    },
  };
}
