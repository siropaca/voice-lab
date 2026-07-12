import type { TTSAdapter, TTSRequest, Voice } from './types.js';

/** Aivis Cloud API の音声合成エンドポイント（2026-07 時点、公式 OpenAPI で確認）。 */
const AIVIS_SYNTHESIZE_URL = 'https://api.aivis-project.com/v1/tts/synthesize';

/** AivisHub のモデル検索（公開・認証不要）。人気順で公式+コミュニティを取得する。 */
const AIVIS_SEARCH_URL = 'https://api.aivis-project.com/v1/aivm-models/search?sort=download&limit=30';

/**
 * aivm-models/search のレスポンスから合成用のモデル一覧を組み立てる。
 * voice には合成時に model_uuid として渡す UUID を入れる。
 * @param json 検索 API レスポンス（未検証の unknown）
 * @returns ボイス（＝モデル）一覧
 */
export function parseAivisModels(json: unknown): Voice[] {
  const list = (json as { aivm_models?: unknown } | null)?.aivm_models;
  if (!Array.isArray(list)) return [];
  return list
    .filter((m): m is { aivm_model_uuid: string; name?: string } => Boolean(m) && typeof m.aivm_model_uuid === 'string')
    .map((m) => ({ id: m.aivm_model_uuid, label: typeof m.name === 'string' && m.name ? m.name : m.aivm_model_uuid }));
}

/**
 * Aivis Cloud API がリクエストボディで受け付ける合成パラメータの許可リスト。
 * registry の params（speaking_rate / emotional_intensity）を含め、公式スキーマに存在する
 * フィールドのみを req.params から通す（未知フィールドで 422 になるのを防ぐ）。
 */
const ALLOWED_PARAM_KEYS = [
  'use_ssml',
  'speaking_rate',
  'emotional_intensity',
  'tempo_dynamics',
  'pitch',
  'volume',
  'leading_silence_seconds',
  'trailing_silence_seconds',
] as const;

/**
 * req.params から Aivis がサポートするフィールドだけを抽出する。
 * @param params 呼び出し側から渡された任意パラメータ
 * @returns 公式スキーマに存在するキーのみを含むオブジェクト
 */
function pickSupportedParams(params: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of ALLOWED_PARAM_KEYS) {
    if (params[key] !== undefined) {
      picked[key] = params[key];
    }
  }
  return picked;
}

/**
 * Aivis Cloud TTS アダプターを生成する。
 *
 * 注意: この factory ではクライアント生成・ネットワーク接続・認証情報の検証を行わない。
 * API キーの参照と HTTP リクエストは synthesize() 内で遅延実行する（クレデンシャル無しでも
 * アプリ起動が通る前提を守るため）。
 *
 * @param env 環境変数（AIVIS_API_KEY を参照）
 * @returns TTSAdapter
 */
export function createAivisTts(env: Record<string, string | undefined>): TTSAdapter {
  return {
    // AivisHub の公開検索 API（認証不要）から人気モデルを取得して選択肢にする。
    async listVoices(): Promise<Voice[]> {
      const res = await fetch(AIVIS_SEARCH_URL);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`aivis models: request failed (${res.status})${detail ? `: ${detail}` : ''}`);
      }
      return parseAivisModels(await res.json());
    },

    /**
     * テキストを Aivis Cloud API で音声合成し、mp3 バイトチャンクをストリーミングで yield する。
     * req.voice に AivisHub のモデル UUID を指定する。
     */
    async *synthesize(req: TTSRequest): AsyncIterable<Uint8Array> {
      const apiKey = env.AIVIS_API_KEY;
      if (!apiKey) {
        throw new Error('aivis tts: AIVIS_API_KEY が設定されていません');
      }

      const body = {
        ...pickSupportedParams(req.params),
        model_uuid: req.voice,
        text: req.text,
        output_format: 'mp3' as const,
      };

      const res = await fetch(AIVIS_SYNTHESIZE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(
          `aivis tts: 合成リクエストが失敗しました (status=${res.status}${detail ? `, body=${detail}` : ''})`,
        );
      }

      // Aivis Cloud API は output_format=mp3 のとき audio/mpeg を chunked で返す。
      // 生成された音声を逐次読み出してそのまま mp3 バイトチャンクとして流す。
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
