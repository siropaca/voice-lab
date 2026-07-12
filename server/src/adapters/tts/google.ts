import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { protos } from '@google-cloud/text-to-speech';
import type { TTSAdapter, TTSRequest, Voice } from './types.js';

/**
 * voices.list（ja-JP）のレスポンスをモデルごとのボイス一覧へ整形する。
 *
 * - chirp3-hd: `ja-JP-Chirp3-HD-<Name>` のフルネームを id に、末尾の Name を label にする。
 * - gemini:   Chirp3-HD と同一の天体名ファミリーを使うため、同じ ja-JP Chirp3-HD の
 *             一覧から短縮名（Name）を導出して id/label にする（Gemini TTS は短名指定）。
 *
 * ja-JP で実際に提供されているボイスだけが返るため、提供状況の変化に自動追従する。
 * @param apiVoices voices.list の voices 配列（name フィールドのみ参照）
 * @param model ModelEntry.model（'chirp3-hd' / 'gemini-2.5-flash-tts'）
 */
export function parseGoogleVoices(
  apiVoices: ReadonlyArray<{ name?: string | null }>,
  model: string,
): Voice[] {
  const chirpNames = apiVoices
    .map((v) => v.name)
    .filter((n): n is string => typeof n === 'string' && /Chirp3-HD/i.test(n));

  if (model === 'chirp3-hd') {
    return chirpNames.map((name) => ({ id: name, label: name.split('-').pop() ?? name }));
  }
  // gemini（および将来の短名指定モデル）: 天体名の短縮形を使う。
  return chirpNames.map((name) => {
    const short = name.split('-').pop() ?? name;
    return { id: short, label: short };
  });
}

/**
 * Google Cloud TTS アダプター。
 *
 * v1 は synthesizeSpeech（非ストリーミング）で Gemini 2.5 Flash TTS / Chirp 3 HD の
 * 両モデルをカバーし、生成した MP3 を単一チャンクとして yield する。
 *
 * クライアントは factory ではなく synthesize 内で遅延生成し、クレデンシャル無しでも
 * app 起動が通るようにする（認証は Application Default Credentials を利用）。
 *
 * @param env - 環境変数（GOOGLE_CLOUD_PROJECT を projectId として使用）
 */
export function createGoogleTts(env: Record<string, string | undefined>): TTSAdapter {
  // クライアントは factory 時点では生成せず、最初の呼び出し時に遅延生成して
  // キャッシュする（毎回 new すると gRPC チャネルがリークするため）。
  let client: TextToSpeechClient | undefined;
  const getClient = (): TextToSpeechClient => {
    if (client == null) {
      client = new TextToSpeechClient({ projectId: env.GOOGLE_CLOUD_PROJECT });
    }
    return client;
  };

  return {
    // ja-JP で現在利用可能なボイスを voices.list から取得する。
    async listVoices(model: string): Promise<Voice[]> {
      const [response] = await getClient().listVoices({ languageCode: 'ja-JP' });
      return parseGoogleVoices(response.voices ?? [], model);
    },

    async *synthesize(req: TTSRequest): AsyncIterable<Uint8Array> {
      const activeClient = getClient();

      // Chirp 3 HD はモデルが voice 名（ja-JP-Chirp3-HD-*）に内包されるため modelName 不要。
      // Gemini TTS は voice.name が Kore/Puck 等の短名なので modelName でモデルを指定する。
      const voice: protos.google.cloud.texttospeech.v1.IVoiceSelectionParams =
        req.model === 'chirp3-hd'
          ? { languageCode: 'ja-JP', name: req.voice }
          : { languageCode: 'ja-JP', name: req.voice, modelName: req.model };

      const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
        input: { text: req.text },
        voice,
        audioConfig: { audioEncoding: 'MP3' },
      };

      const [response] = await activeClient.synthesizeSpeech(request);
      const audio = response.audioContent;
      if (audio == null) {
        throw new Error('google tts: empty audioContent in response');
      }

      // audioContent は Buffer/Uint8Array（gRPC）または base64 文字列で返り得るため正規化する。
      const chunk =
        typeof audio === 'string' ? new Uint8Array(Buffer.from(audio, 'base64')) : new Uint8Array(audio);
      yield chunk;
    },
  };
}
