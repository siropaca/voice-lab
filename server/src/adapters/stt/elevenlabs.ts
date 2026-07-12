import type { STTAdapter } from './types.js';

/**
 * ElevenLabs Scribe v2 Realtime STT アダプター（スタブ）。Task 14 で WS ストリーミングに差し替える。
 */
export function createElevenLabsStt(_env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ onError }) {
      onError(new Error('elevenlabs stt: not implemented yet'));
      return {
        sendAudio() {},
        close() {},
      };
    },
  };
}
