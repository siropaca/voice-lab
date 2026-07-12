import WebSocket from 'ws';
import type { STTAdapter, SttSession } from './types.js';

/** クライアント→サーバーの音声チャンクメッセージ（公式 WS スキーマ）。 */
interface InputAudioChunkMessage {
  message_type: 'input_audio_chunk';
  audio_base_64: string;
  sample_rate: number;
  commit?: boolean;
}

/** サーバー→クライアントのメッセージ（必要なフィールドのみ）。 */
interface RealtimeServerMessage {
  message_type: string;
  text?: string;
  /** error 系メッセージの詳細（存在すればログ/通知に使う）。 */
  message?: string;
  reason?: string;
}

/** committed（確定）とみなすメッセージタイプ。 */
const COMMITTED_MESSAGE_TYPES = new Set([
  'committed_transcript',
  'committed_transcript_with_timestamps',
]);

/**
 * onError で通知すべきエラー系メッセージタイプ。
 * @see https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
 */
const ERROR_MESSAGE_TYPES = new Set([
  'error',
  'auth_error',
  'quota_exceeded',
  'unaccepted_terms',
  'rate_limited',
  'queue_overflow',
  'resource_exhausted',
  'session_time_limit_exceeded',
  'input_error',
  'chunk_size_exceeded',
  'transcriber_error',
]);

const SAMPLE_RATE = 16_000;

/**
 * ElevenLabs Scribe v2 Realtime STT アダプター。
 *
 * WS: wss://api.elevenlabs.io/v1/speech-to-text/realtime
 * 認証は xi-api-key ヘッダー。音声は base64 JSON（message_type: "input_audio_chunk"）で送信する。
 * commit_strategy=vad により、無音区間で committed_transcript が自動的に確定する。
 *
 * factory 呼び出し時点では WS を張らず、startSession() 内で遅延接続する。
 */
export function createElevenLabsStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, params, onPartial, onFinal, onError }): SttSession {
      const apiKey = env.ELEVENLABS_API_KEY;

      // 接続前に届いた音声を貯めるキュー。open 後にまとめて送出する。
      const pending: Uint8Array[] = [];
      let state: 'connecting' | 'open' | 'closed' = 'connecting';
      let closeRequested = false;

      // クレデンシャル未設定なら接続せずにエラー通知（app 起動自体は factory で通っている）。
      if (!apiKey) {
        onError(new Error('elevenlabs stt: ELEVENLABS_API_KEY is not set'));
        return {
          sendAudio() {},
          close() {},
        };
      }

      const languageCode = typeof params.language_code === 'string' ? params.language_code : 'ja';
      const commitStrategy = typeof params.commit_strategy === 'string' ? params.commit_strategy : 'vad';

      const query = new URLSearchParams({
        model_id: model,
        language_code: languageCode,
        audio_format: 'pcm_16000',
        commit_strategy: commitStrategy,
      });
      const url = `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query.toString()}`;

      const ws = new WebSocket(url, { headers: { 'xi-api-key': apiKey } });

      /** Uint8Array の PCM チャンクを base64 JSON にして送出する。 */
      function sendChunk(chunk: Uint8Array): void {
        const message: InputAudioChunkMessage = {
          message_type: 'input_audio_chunk',
          audio_base_64: Buffer.from(chunk).toString('base64'),
          sample_rate: SAMPLE_RATE,
        };
        ws.send(JSON.stringify(message));
      }

      /** WS を正常クローズする（多重呼び出し安全）。 */
      function closeSocket(): void {
        state = 'closed';
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000);
        }
      }

      ws.on('open', () => {
        // close() が既に要求され、貯めた音声も無ければそのままクローズ。
        state = 'open';
        for (const chunk of pending) {
          sendChunk(chunk);
        }
        pending.length = 0;
        if (closeRequested) {
          closeSocket();
        }
      });

      ws.on('message', (data: WebSocket.RawData) => {
        if (state === 'closed') return;
        let parsed: RealtimeServerMessage;
        try {
          parsed = JSON.parse(data.toString()) as RealtimeServerMessage;
        } catch {
          // JSON でないフレームは無視（バイナリ制御フレーム等）。
          return;
        }

        if (parsed.message_type === 'partial_transcript') {
          if (typeof parsed.text === 'string') onPartial(parsed.text);
          return;
        }
        if (COMMITTED_MESSAGE_TYPES.has(parsed.message_type)) {
          if (typeof parsed.text === 'string') onFinal(parsed.text);
          return;
        }
        if (ERROR_MESSAGE_TYPES.has(parsed.message_type)) {
          const detail = parsed.message ?? parsed.reason ?? '';
          onError(new Error(`elevenlabs stt: ${parsed.message_type}${detail ? `: ${detail}` : ''}`));
        }
        // session_started / commit_throttled / insufficient_audio_activity 等は無視。
      });

      ws.on('error', (err: Error) => {
        if (state === 'closed') return;
        onError(err);
      });

      // 101 以外のレスポンス（認証失敗など）を明示的に通知する。
      ws.on('unexpected-response', (_req, res) => {
        if (state === 'closed') return;
        onError(new Error(`elevenlabs stt: unexpected response ${res.statusCode} ${res.statusMessage ?? ''}`.trim()));
      });

      return {
        sendAudio(chunk: Uint8Array): void {
          if (state === 'closed' || closeRequested) return;
          if (state === 'open') {
            sendChunk(chunk);
          } else {
            pending.push(chunk);
          }
        },
        close(): void {
          if (state === 'closed') return;
          if (state === 'open') {
            closeSocket();
          } else {
            // 接続中の close は open ハンドラで貯めた音声を送出後にクローズさせる。
            closeRequested = true;
          }
        },
      };
    },
  };
}
