import type { UpgradeWebSocket } from 'hono/ws';
import { Hono } from 'hono';
import { MODELS } from '../registry.js';
import { SttFanout } from '../stt-fanout.js';
import type { STTAdapterResolver } from '../adapters/stt/types.js';

/**
 * /ws/stt?models=a,b — バイナリ: 16kHz PCM16 音声、テキスト: {"type":"stop"} で停止。
 * 停止時は各モデルの summary を送って接続を閉じる。
 */
export function sttWsRoute(upgradeWebSocket: UpgradeWebSocket, resolve: STTAdapterResolver) {
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
              await fanout.stop();
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
