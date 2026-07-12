import WebSocket from 'ws';
import { resamplePcm16 } from '../../audio.js';
import type { STTAdapter, SttSession } from './types.js';

/** 入力音声のサンプルレート（マイク入力は 16kHz PCM16 mono 固定） */
const INPUT_RATE = 16000;
/** OpenAI Realtime が要求する PCM16 サンプルレート（24kHz mono, little-endian） */
const TARGET_RATE = 24000;
/**
 * transcription intent での Realtime WebSocket 接続 URL。
 * 会話モデルではなく文字起こし専用セッションを開くため ?intent=transcription を付ける。
 */
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
/** VAD を使わず手動コミットが必要な streaming モデル（公式に turn_detection=null 必須と明記） */
const MANUAL_COMMIT_MODELS = new Set(['gpt-realtime-whisper']);

/**
 * PCM16 のバイト列（little-endian）を Int16Array に変換する。
 * Uint8Array は 2 バイト境界に整列しているとは限らないため DataView で明示的に読む。
 */
function pcm16BytesToInt16(bytes: Uint8Array): Int16Array {
  const sampleCount = bytes.byteLength >> 1;
  const out = new Int16Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.getInt16(i * 2, true);
  }
  return out;
}

/**
 * Int16Array を little-endian PCM16 バイト列にして base64 文字列へ変換する。
 */
function int16ToBase64(samples: Int16Array): string {
  const bytes = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    bytes.writeInt16LE(samples[i], i * 2);
  }
  return bytes.toString('base64');
}

/**
 * OpenAI Realtime transcription を用いた STT アダプター。
 * 外部接続は startSession 内で遅延生成し、factory 時点では何も生成・送信しない。
 */
export function createOpenAiRealtimeStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, params, onPartial, onFinal, onError }): SttSession {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        onError(new Error('openai realtime stt: OPENAI_API_KEY が未設定です'));
        return { sendAudio() {}, close() {} };
      }

      const language = typeof params.language === 'string' ? params.language : 'ja';
      const manualCommit = MANUAL_COMMIT_MODELS.has(model);

      /** WS open 前に届いた音声チャンク（base64 append 済み）を貯める pending キュー */
      const pending: string[] = [];
      let opened = false;
      let closed = false;
      /** delta を連結して partial として通知するための現在の item バッファ */
      let currentText = '';

      let ws: WebSocket;
      try {
        ws = new WebSocket(REALTIME_URL, {
          headers: {
            // GA 版では OpenAI-Beta ヘッダーは不要。Bearer 認証のみ。
            Authorization: `Bearer ${apiKey}`,
          },
        });
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        return { sendAudio() {}, close() {} };
      }

      function sendJson(payload: unknown): void {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      }

      ws.on('open', () => {
        opened = true;
        // GA の session.update（type='transcription'、音声設定は audio.input 配下にネスト）。
        // gpt-realtime-whisper は turn_detection=null 必須。gpt-4o-transcribe は server_vad で自動コミット。
        sendJson({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: TARGET_RATE },
                transcription: { model, language },
                turn_detection: manualCommit ? null : { type: 'server_vad' },
              },
            },
          },
        });
        // pending に貯めた音声を順に送出する
        for (const audio of pending) {
          sendJson({ type: 'input_audio_buffer.append', audio });
        }
        pending.length = 0;
      });

      ws.on('message', (data: WebSocket.RawData) => {
        let event: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
        try {
          event = JSON.parse(data.toString());
        } catch {
          return;
        }
        switch (event.type) {
          case 'conversation.item.input_audio_transcription.delta': {
            currentText += event.delta ?? '';
            onPartial(currentText);
            break;
          }
          case 'conversation.item.input_audio_transcription.completed': {
            onFinal(event.transcript ?? currentText);
            currentText = '';
            break;
          }
          case 'conversation.item.input_audio_transcription.failed': {
            onError(new Error(event.error?.message ?? 'transcription failed'));
            break;
          }
          case 'error': {
            onError(new Error(event.error?.message ?? 'openai realtime error'));
            break;
          }
          default:
            break;
        }
      });

      ws.on('error', (err: Error) => {
        if (!closed) onError(err);
      });

      return {
        sendAudio(chunk: Uint8Array) {
          if (closed) return;
          const pcm16 = pcm16BytesToInt16(chunk);
          const resampled = resamplePcm16(pcm16, INPUT_RATE, TARGET_RATE);
          const audio = int16ToBase64(resampled);
          if (opened) {
            sendJson({ type: 'input_audio_buffer.append', audio });
          } else {
            pending.push(audio);
          }
        },
        close() {
          if (closed) return;
          closed = true;
          // VAD 無しモデルは末尾の音声を手動コミットしないと文字起こしされないため、
          // commit を送ってから .completed を受け取れるよう少し待って切断する。
          if (manualCommit && ws.readyState === WebSocket.OPEN) {
            sendJson({ type: 'input_audio_buffer.commit' });
            setTimeout(() => ws.close(), 1500);
          } else {
            ws.close();
          }
        },
      };
    },
  };
}
