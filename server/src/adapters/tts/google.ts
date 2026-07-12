import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import type { protos } from '@google-cloud/text-to-speech';
import type { TTSAdapter, TTSRequest } from './types.js';

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
  // クライアントは factory 時点では生成せず、最初の synthesize 呼び出し時に
  // 遅延生成してキャッシュする（毎回 new すると gRPC チャネルがリークするため）。
  let client: TextToSpeechClient | undefined;

  return {
    async *synthesize(req: TTSRequest): AsyncIterable<Uint8Array> {
      if (client == null) {
        client = new TextToSpeechClient({ projectId: env.GOOGLE_CLOUD_PROJECT });
      }

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

      const [response] = await client.synthesizeSpeech(request);
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
