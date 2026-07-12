import type { TTSAdapter, TTSRequest, Voice } from './types.js';

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

/**
 * gpt-4o-mini-tts で利用可能な組み込みボイス（2026-07 時点、公式ドキュメントで確認）。
 * OpenAI にはボイス一覧 API が無くプロバイダー固定のため静的に保持する。
 */
export const OPENAI_TTS_VOICES: Voice[] = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova',
  'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
].map((id) => ({ id, label: id }));

/**
 * OpenAI TTS アダプター。
 * POST /v1/audio/speech に対して chunked transfer で mp3 を受け取り、
 * Uint8Array チャンクとして逐次 yield する。
 *
 * factory 呼び出し時点ではクライアント生成・ネットワーク接続・例外送出を行わず、
 * synthesize() 内で遅延実行する（クレデンシャル無しでも app 起動が通る前提を守る）。
 * @param env - 環境変数（OPENAI_API_KEY を参照）
 */
export function createOpenAiTts(env: Record<string, string | undefined>): TTSAdapter {
  return {
    // OpenAI は一覧 API を持たないため、プロバイダー固定の組み込みボイスを返す。
    async listVoices(): Promise<Voice[]> {
      return OPENAI_TTS_VOICES;
    },

    async *synthesize(req: TTSRequest): AsyncIterable<Uint8Array> {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('openai tts: OPENAI_API_KEY is not set');
      }

      const body = {
        model: req.model,
        voice: req.voice,
        input: req.text,
        response_format: 'mp3',
        ...req.params,
      };

      const res = await fetch(OPENAI_SPEECH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `openai tts: request failed with status ${res.status} ${res.statusText}${
            detail ? `: ${detail}` : ''
          }`,
        );
      }

      if (!res.body) {
        throw new Error('openai tts: response body is empty');
      }

      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            yield value;
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
