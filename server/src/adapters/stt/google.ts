import type { STTAdapter } from './types.js';

/**
 * Google Cloud STT アダプター（スタブ）。Task 15 で Speech-to-Text v2 ストリーミングに差し替える。
 * 外部クライアントはコンストラクタで生成せず、実装時に startSession 内で生成する。
 */
export function createGoogleStt(_env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ onError }) {
      onError(new Error('google stt: not implemented yet'));
      return {
        sendAudio() {},
        close() {},
      };
    },
  };
}
