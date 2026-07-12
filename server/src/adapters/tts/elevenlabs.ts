import type { TTSAdapter, TTSRequest } from './types.js';

/** ElevenLabs TTS のベース URL（voice_id を付けて使う）。 */
const TTS_BASE_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

/** レジストリの audioFormat（mp3）に合わせた出力フォーマット。 */
const OUTPUT_FORMAT = 'mp3_44100_128';

/**
 * ストリーミング非対応（品質重視・一括生成）のモデル。
 * これらは `/stream` ではなく通常エンドポイントへ投げる。
 */
const NON_STREAMING_MODELS = new Set<string>(['eleven_v3']);

/**
 * params から数値パラメータを取り出す。数値でなければ undefined を返す。
 * @param params リクエストパラメータ
 * @param key 取り出すキー
 * @returns 数値、または undefined
 */
function pickNumberParam(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * ElevenLabs TTS アダプターを生成する。
 * factory 呼び出し時点では外部クライアントの生成やネットワーク接続を行わず、
 * synthesize() 内で遅延実行する（クレデンシャル無しでも app 起動が通る前提）。
 * @param env 環境変数（ELEVENLABS_API_KEY を参照）
 * @returns TTSAdapter
 */
export function createElevenLabsTts(env: Record<string, string | undefined>): TTSAdapter {
  return {
    async *synthesize(req: TTSRequest): AsyncIterable<Uint8Array> {
      const apiKey = env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new Error('elevenlabs tts: ELEVENLABS_API_KEY is not set');
      }
      if (!req.voice) {
        throw new Error('elevenlabs tts: voice (voice_id) is required');
      }

      const isStreaming = !NON_STREAMING_MODELS.has(req.model);
      const path = `${TTS_BASE_URL}/${encodeURIComponent(req.voice)}${isStreaming ? '/stream' : ''}`;
      const url = `${path}?output_format=${OUTPUT_FORMAT}`;

      // voice_settings は指定されたものだけ送る（未指定なら API 側デフォルトに委ねる）。
      const voiceSettings: Record<string, number> = {};
      const stability = pickNumberParam(req.params, 'stability');
      if (stability !== undefined) {
        voiceSettings.stability = stability;
      }
      const similarityBoost = pickNumberParam(req.params, 'similarity_boost');
      if (similarityBoost !== undefined) {
        voiceSettings.similarity_boost = similarityBoost;
      }

      const body: Record<string, unknown> = {
        text: req.text,
        model_id: req.model,
      };
      if (Object.keys(voiceSettings).length > 0) {
        body.voice_settings = voiceSettings;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `elevenlabs tts: request failed (${res.status} ${res.statusText})${detail ? `: ${detail}` : ''}`,
        );
      }

      // res.body（web ReadableStream）を読み進め、mp3 バイトチャンクを yield する。
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value && value.byteLength > 0) {
            yield value;
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}
