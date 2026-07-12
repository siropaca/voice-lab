import type { STTAdapter } from './types.js';

/**
 * OpenAI Realtime STT アダプター（スタブ）。Task 13 で Realtime transcription セッションに差し替える。
 */
export function createOpenAiRealtimeStt(_env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ onError }) {
      onError(new Error('openai realtime stt: not implemented yet'));
      return {
        sendAudio() {},
        close() {},
      };
    },
  };
}
