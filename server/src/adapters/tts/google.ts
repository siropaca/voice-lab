import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { protos } from '@google-cloud/text-to-speech';
import type { TTSAdapter, TTSRequest, Voice } from './types.js';

/** Chirp 3 HD streaming 合成（streamingSynthesize）の内部モデル ID。 */
const CHIRP3_STREAMING_MODEL = 'chirp3-hd-streaming';
/** streaming 合成の出力サンプルレート（PCM16 mono）。MP3 は streaming 非対応のため PCM を使う。 */
const STREAMING_SAMPLE_RATE = 24000;

/** フルネーム系モデル（voice 名に系統が内包される）の voices.list 抽出フィルタ。 */
const GOOGLE_VOICE_FILTER: Record<string, RegExp> = {
  'chirp3-hd': /Chirp3-HD/i,
  [CHIRP3_STREAMING_MODEL]: /Chirp3-HD/i,
  neural2: /Neural2/i,
  wavenet: /Wavenet/i,
  standard: /Standard/i,
};

/**
 * voices.list（ja-JP）のレスポンスをモデルごとのボイス一覧へ整形する。
 *
 * - chirp3-hd / neural2 / wavenet / standard: `ja-JP-<系統>-<Name>` のフルネームを id に、
 *   末尾の Name を label にする（合成時は voice 名だけで系統が決まる）。
 * - gemini*: Chirp3-HD と同一の天体名ファミリーを使うため、同じ ja-JP Chirp3-HD の
 *   一覧から短縮名（Name）を導出して id/label にする（Gemini TTS は短名 + modelName 指定）。
 *
 * ja-JP で実際に提供されているボイスだけが返るため、提供状況の変化に自動追従する。
 * @param apiVoices voices.list の voices 配列（name フィールドのみ参照）
 * @param model ModelEntry.model
 */
export function parseGoogleVoices(
  apiVoices: ReadonlyArray<{ name?: string | null }>,
  model: string,
): Voice[] {
  const names = apiVoices.map((v) => v.name).filter((n): n is string => typeof n === 'string');

  // gemini 系は Chirp3-HD の天体名ファミリーから短縮名を導出する。
  if (model.startsWith('gemini')) {
    return names
      .filter((n) => /Chirp3-HD/i.test(n))
      .map((name) => {
        const short = name.split('-').pop() ?? name;
        return { id: short, label: short };
      });
  }

  const re = GOOGLE_VOICE_FILTER[model] ?? /Chirp3-HD/i;
  // ラベルは locale 接頭辞を剥がす。Chirp3-HD は天体名だけ（例 Aoede）、
  // Neural2/Wavenet/Standard は系統名付き（例 Neural2-B）で識別できるようにする。
  return names
    .filter((n) => re.test(n))
    .map((name) => ({ id: name, label: name.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/^Chirp3-HD-/, '') }));
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

      // Chirp 3 HD の streaming 合成: streamingSynthesize（gRPC 双方向）で PCM を逐次取得する。
      // MP3 は streaming 非対応（実測で INVALID_ARGUMENT）のため PCM16/24kHz を返す。
      if (req.model === CHIRP3_STREAMING_MODEL) {
        const stream = activeClient.streamingSynthesize();
        stream.write({
          streamingConfig: {
            voice: { languageCode: 'ja-JP', name: req.voice },
            streamingAudioConfig: { audioEncoding: 'PCM', sampleRateHertz: STREAMING_SAMPLE_RATE },
          },
        });
        stream.write({ input: { text: req.text } });
        stream.end();
        for await (const response of stream as AsyncIterable<protos.google.cloud.texttospeech.v1.IStreamingSynthesizeResponse>) {
          const audio = response.audioContent;
          if (audio == null) continue;
          yield typeof audio === 'string' ? new Uint8Array(Buffer.from(audio, 'base64')) : new Uint8Array(audio);
        }
        return;
      }

      // フルネーム voice（ja-JP-Chirp3-HD-* / -Neural2-* / -Wavenet-* / -Standard-* 等）は
      // 系統が名前に内包されるため modelName 不要。Gemini TTS は Kore/Puck 等の短名なので
      // modelName でモデルを指定する。
      const isFullName = /^[a-z]{2}-[A-Z]{2}-/.test(req.voice);
      const voice: protos.google.cloud.texttospeech.v1.IVoiceSelectionParams = isFullName
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
