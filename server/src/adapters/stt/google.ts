import speech, { protos } from '@google-cloud/speech';
import type { v2 as SpeechV2 } from '@google-cloud/speech';
import type { STTAdapter, SttSession } from './types.js';

type StreamingResponse = protos.google.cloud.speech.v2.IStreamingRecognizeResponse;

/**
 * Google Cloud Speech-to-Text v2（chirp_3）ストリーミングアダプター。
 *
 * v2 の双方向ストリームは `client._streamingRecognize()` を使う。ミックスインされた
 * `streamingRecognize()` は v1 セマンティクス（音声を `{ audioContent }` でラップ）のため
 * v2 の `{ audio }` フィールドと合わず使えない。最初に config リクエスト
 * （recognizer + streamingConfig）を write し、以降 `{ audio }` を write する。
 *
 * factory 時点では外部クライアントを生成せず、startSession 内で遅延生成する。
 */
export function createGoogleStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, params, location: modelLocation, onPartial, onFinal, onError }): SttSession {
      // リージョンはモデル固有の指定を最優先（chirp_3 は us/eu のみ等、モデルで決まるため）。
      const location = modelLocation ?? env.GOOGLE_SPEECH_LOCATION ?? 'us';
      // global は無印の speech.googleapis.com、リージョン指定は {location}-speech.googleapis.com。
      const apiEndpoint = location === 'global' ? 'speech.googleapis.com' : `${location}-speech.googleapis.com`;

      // ストリーム確立前に届いた音声を貯めるキュー。
      const pending: Uint8Array[] = [];
      let stream: ReturnType<SpeechV2.SpeechClient['_streamingRecognize']> | null = null;
      let ready = false;
      let closed = false;
      // Google がストリームを終了/破棄した後（short モデルが早期終了する等）に write すると
      // 「write after destroyed」で落ちるため、破棄後は書き込みをスキップするフラグ。
      let streamDead = false;

      // クライアント生成・接続確立は非同期。確立前の音声は pending に積む。
      void (async () => {
        try {
          const client = new speech.v2.SpeechClient({
            apiEndpoint,
          });
          const projectId = env.GOOGLE_CLOUD_PROJECT ?? (await client.getProjectId());
          if (closed) return; // init 中に close された場合は開始しない

          const recognizer = `projects/${projectId}/locations/${location}/recognizers/_`;

          const s = client._streamingRecognize();
          s.on('data', (data: StreamingResponse) => {
            for (const result of data.results ?? []) {
              const transcript = result.alternatives?.[0]?.transcript;
              if (!transcript) continue;
              if (result.isFinal) {
                onFinal(transcript);
              } else {
                onPartial(transcript);
              }
            }
          });
          s.on('error', (err: Error) => {
            streamDead = true;
            if (!closed) onError(err);
          });
          s.on('end', () => {
            streamDead = true;
          });
          s.on('close', () => {
            streamDead = true;
          });

          // config リクエストを最初に一度だけ送る。
          s.write({
            recognizer,
            streamingConfig: {
              config: {
                explicitDecodingConfig: {
                  encoding: 'LINEAR16',
                  sampleRateHertz: 16000,
                  audioChannelCount: 1,
                },
                languageCodes: ['ja-JP'],
                model,
                // UI から渡された追加の認識オプション（句読点付与など）を features に反映。
                features: { ...(params as Record<string, unknown>) },
              },
              streamingFeatures: { interimResults: true },
            },
          });

          stream = s;
          ready = true;

          // 確立前に貯めた音声を順に送出。
          for (const chunk of pending) {
            s.write({ audio: chunk });
          }
          pending.length = 0;

          // init 中に close 要求されていた場合はここで入力終了を通知。
          if (closed) s.end();
        } catch (err) {
          if (!closed) onError(err as Error);
        }
      })();

      return {
        sendAudio(chunk: Uint8Array): void {
          if (closed || streamDead) return;
          if (ready && stream) {
            try {
              stream.write({ audio: chunk });
            } catch {
              // ストリーム破棄直後の write レース。モデル単位で隔離し無視する。
              streamDead = true;
            }
          } else {
            pending.push(chunk);
          }
        },
        close(): void {
          closed = true;
          if (stream) stream.end();
        },
      };
    },
  };
}
