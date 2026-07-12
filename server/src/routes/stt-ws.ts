import type { UpgradeWebSocket } from 'hono/ws';
import { Hono } from 'hono';
import { MODELS } from '../registry.js';
import { SttFanout } from '../stt-fanout.js';
import { pcm16ToWav } from '../audio.js';
import { newRunId, type History } from '../history.js';
import type { STTAdapterResolver } from '../adapters/stt/types.js';

/** 受信した PCM16 チャンク列を 1 本の Int16Array に結合する */
function concatInt16(chunks: Uint8Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new Int16Array(buf.buffer, 0, Math.floor(total / 2));
}

/**
 * /ws/stt?models=a,b — バイナリ: 16kHz PCM16 音声、テキスト: {"type":"stop"} で停止。
 * 停止時は summary と入力音声（WAV）を履歴へ保存する。
 */
export function sttWsRoute(upgradeWebSocket: UpgradeWebSocket, resolve: STTAdapterResolver, history: History) {
  const route = new Hono();
  route.get(
    '/',
    upgradeWebSocket((c) => {
      const keys = (c.req.query('models') ?? '').split(',').filter(Boolean);
      let fanout: SttFanout | null = null;
      let stopped = false;
      return {
        onOpen(_evt, ws) {
          const entries = MODELS.filter((m) => m.kind === 'stt' && keys.includes(m.key));
          fanout = new SttFanout(entries, resolve, (msg) => ws.send(JSON.stringify(msg)));
        },
        async onMessage(evt, ws) {
          if (typeof evt.data === 'string') {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'stop' && fanout && !stopped) {
              stopped = true;
              const models = await fanout.stop();
              const id = newRunId();
              const pcm = concatInt16(fanout.audio);
              await history.saveAudio(`${id}.wav`, pcm16ToWav(pcm, 16000));
              await history.appendRun({
                id,
                kind: 'stt',
                at: new Date().toISOString(),
                note: msg.note,
                models,
                events: fanout.eventLog,
                audioFile: `${id}.wav`,
              });
              ws.close();
            }
          } else if (fanout) {
            const data = evt.data;
            const buf =
              data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : ArrayBuffer.isView(data)
                  ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                  : new Uint8Array(data as unknown as ArrayBufferLike);
            fanout.sendAudio(buf);
          }
        },
        onClose() {
          if (!stopped) {
            stopped = true;
            fanout?.stop(0);
          }
        },
      };
    }),
  );
  return route;
}
