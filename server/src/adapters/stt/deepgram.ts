import type { STTAdapter } from './types.js';

/**
 * Deepgram STT アダプター（スタブ）。Task 12 で v1(nova)/v2(flux) の WS ストリーミングに差し替える。
 */
export function createDeepgramStt(_env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ onError }) {
      onError(new Error('deepgram stt: not implemented yet'));
      return {
        sendAudio() {},
        close() {},
      };
    },
  };
}
