import type { TTSAdapter, TTSRequest, Voice } from './types.js';

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';

/**
 * gpt-4o-mini-tts で利用可能な全 13 ボイス（2026-07 時点、公式ドキュメントで確認）。
 * OpenAI にはボイス一覧 API が無くプロバイダー固定のため静的に保持する。
 */
export const OPENAI_TTS_VOICES: Voice[] = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova',
  'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar',
].map((id) => ({ id, label: id }));

/**
 * tts-1 / tts-1-hd が対応する 9 ボイス（ballad / verse / marin / cedar 非対応）。
 */
export const OPENAI_TTS1_VOICES: Voice[] = [
  'alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer',
].map((id) => ({ id, label: id }));

/** モデルが対応するボイス集合を返す（tts-1 系は 9、gpt-4o-mini-tts は 13）。 */
export function openAiVoicesFor(model: string): Voice[] {
  return model === 'tts-1' || model === 'tts-1-hd' ? OPENAI_TTS1_VOICES : OPENAI_TTS_VOICES;
}

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
    // OpenAI は一覧 API を持たないため、モデル別の組み込みボイス集合を返す。
    async listVoices(model: string): Promise<Voice[]> {
      return openAiVoicesFor(model);
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
