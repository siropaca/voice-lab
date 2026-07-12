import WebSocket from 'ws';
import type { STTAdapter, SttSession } from './types.js';

/** v2 API（Flux 系ターン検出モデル）に該当するモデル名。それ以外は v1 API（nova 系）で扱う。 */
const FLUX_MODELS = new Set(['flux-general-multi', 'flux-general-en']);

/** Deepgram の WS から受信する JSON メッセージ（必要フィールドのみ緩く定義）。 */
interface DeepgramMessage {
  type?: string;
  /** Flux(v2) TurnInfo のイベント種別: Update / StartOfTurn / EagerEndOfTurn / TurnResumed / EndOfTurn */
  event?: string;
  /** Flux(v2) TurnInfo のトップレベル transcript */
  transcript?: string;
  /** nova(v1) Results の確定フラグ */
  is_final?: boolean;
  /** nova(v1) Results の構造 */
  channel?: { alternatives?: Array<{ transcript?: string }> };
  /** エラーメッセージ用 */
  description?: string;
  message?: string;
  code?: string | number;
}

/**
 * リクエスト params をクエリ文字列へ反映する。既定値の上書きと追加パラメーターの両方に対応する。
 * 配列値（language_hint / keyterm 等）は同名キーを複数回付与する。
 */
function applyParams(sp: URLSearchParams, params: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      sp.delete(key);
      for (const item of value) sp.append(key, String(item));
    } else {
      sp.set(key, String(value));
    }
  }
}

/**
 * nova 系（v1 API）の WS 接続 URL を組み立てる。日本語はマルチリンガル(language=multi)を既定とし、
 * params で language=ja 等に上書き可能。
 */
function buildNovaUrl(model: string, params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  sp.set('model', model);
  sp.set('encoding', 'linear16');
  sp.set('sample_rate', '16000');
  sp.set('interim_results', 'true');
  sp.set('language', 'multi');
  applyParams(sp, params);
  return `wss://api.deepgram.com/v1/listen?${sp.toString()}`;
}

/**
 * Flux 系（v2 API）の WS 接続 URL を組み立てる。language_hint=ja を既定とし、params で上書き可能。
 */
function buildFluxUrl(model: string, params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  sp.set('model', model);
  sp.set('encoding', 'linear16');
  sp.set('sample_rate', '16000');
  sp.set('language_hint', 'ja');
  applyParams(sp, params);
  return `wss://api.deepgram.com/v2/listen?${sp.toString()}`;
}

/**
 * nova(v1) の Results メッセージを partial/final に振り分ける。is_final=true を確定とみなす。
 */
function handleNovaMessage(
  msg: DeepgramMessage,
  onPartial: (text: string) => void,
  onFinal: (text: string) => void,
  onError: (err: Error) => void,
): void {
  if (msg.type === 'Results') {
    const transcript = msg.channel?.alternatives?.[0]?.transcript ?? '';
    if (!transcript) return;
    if (msg.is_final) onFinal(transcript);
    else onPartial(transcript);
    return;
  }
  if (msg.type === 'Error') {
    onError(new Error(`deepgram nova: ${msg.description ?? msg.message ?? 'error'}`));
  }
}

/**
 * Flux(v2) の TurnInfo を partial/final に振り分ける。EndOfTurn を確定、
 * それ以外（Update / StartOfTurn / EagerEndOfTurn / TurnResumed）を暫定とみなす。
 */
function handleFluxMessage(
  msg: DeepgramMessage,
  onPartial: (text: string) => void,
  onFinal: (text: string) => void,
  onError: (err: Error) => void,
): void {
  switch (msg.type) {
    case 'TurnInfo': {
      const transcript = msg.transcript ?? '';
      if (!transcript) return;
      if (msg.event === 'EndOfTurn') onFinal(transcript);
      else onPartial(transcript);
      return;
    }
    case 'FatalError':
      onError(new Error(`deepgram flux: ${msg.description ?? String(msg.code ?? 'fatal error')}`));
      return;
    case 'ConfigureFailure':
      onError(new Error(`deepgram flux: configure failure ${msg.description ?? ''}`.trim()));
      return;
    default:
      // Connected / ConfigureSuccess などは無視
      return;
  }
}

/**
 * Deepgram STT アダプター。model 名で v1(nova) / v2(flux) を分岐し、WS ストリーミングで transcribe する。
 * クライアント生成・接続は startSession 内で遅延実行し、factory 呼び出し時点では何もしない。
 */
export function createDeepgramStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, params, onPartial, onFinal, onError }): SttSession {
      const apiKey = env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        onError(new Error('deepgram stt: DEEPGRAM_API_KEY が設定されていません'));
        return { sendAudio() {}, close() {} };
      }

      const isFlux = FLUX_MODELS.has(model);
      const url = isFlux ? buildFluxUrl(model, params) : buildNovaUrl(model, params);

      /** open 前に届いた音声を貯めるキュー。 */
      const pending: Uint8Array[] = [];
      let isOpen = false;
      let closeRequested = false;

      let ws: WebSocket;
      try {
        ws = new WebSocket(url, { headers: { Authorization: `Token ${apiKey}` } });
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
        return { sendAudio() {}, close() {} };
      }

      const sendCloseStream = (): void => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'CloseStream' }));
          } catch {
            // 送信不能時は無視（既に閉じている等）
          }
        }
      };

      ws.on('open', () => {
        isOpen = true;
        for (const chunk of pending) ws.send(chunk);
        pending.length = 0;
        if (closeRequested) sendCloseStream();
      });

      ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
        if (isBinary) return;
        let msg: DeepgramMessage;
        try {
          msg = JSON.parse(data.toString()) as DeepgramMessage;
        } catch {
          return;
        }
        if (isFlux) handleFluxMessage(msg, onPartial, onFinal, onError);
        else handleNovaMessage(msg, onPartial, onFinal, onError);
      });

      ws.on('error', (err: Error) => {
        onError(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on('unexpected-response', (_req, res) => {
        onError(new Error(`deepgram stt: 接続に失敗しました (HTTP ${res.statusCode ?? '?'})`));
      });

      return {
        sendAudio(chunk: Uint8Array): void {
          if (isOpen && ws.readyState === WebSocket.OPEN) {
            ws.send(chunk);
          } else {
            // まだ接続確立前 or 既に閉じ始めている場合はバッファへ
            if (!closeRequested) pending.push(chunk);
          }
        },
        close(): void {
          closeRequested = true;
          // open 済みなら即 CloseStream を送信。未 open なら open ハンドラ内でキュー送出後に送る。
          if (isOpen) sendCloseStream();
        },
      };
    },
  };
}
