import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { modelsRoute } from './routes/models.js';
import { voicesRoute } from './routes/voices.js';
import { ttsRoute } from './routes/tts.js';
import { sttWsRoute } from './routes/stt-ws.js';
import { createOpenAiTts } from './adapters/tts/openai.js';
import { createElevenLabsTts } from './adapters/tts/elevenlabs.js';
import { createAivisTts } from './adapters/tts/aivis.js';
import { createGoogleTts } from './adapters/tts/google.js';
import { createOpenAiRealtimeStt } from './adapters/stt/openai-realtime.js';
import { createDeepgramStt } from './adapters/stt/deepgram.js';
import { createElevenLabsStt } from './adapters/stt/elevenlabs.js';
import { createGoogleStt } from './adapters/stt/google.js';
import type { TTSAdapter } from './adapters/tts/types.js';
import type { STTAdapter } from './adapters/stt/types.js';

/**
 * Hono アプリを組み立てる。env を注入できるようにしてテスト可能にする。
 * 全アダプターを最初から配線し、後続フェーズではスタブの中身のみ差し替える。
 */
export function createApp(env: Record<string, string | undefined>) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/models', modelsRoute(env));

  const ttsAdapters: Record<string, TTSAdapter> = {
    openai: createOpenAiTts(env),
    elevenlabs: createElevenLabsTts(env),
    aivis: createAivisTts(env),
    google: createGoogleTts(env),
  };
  const resolveTts = (provider: string): TTSAdapter => {
    const a = ttsAdapters[provider];
    if (!a) throw new Error(`TTS adapter not found: ${provider}`);
    return a;
  };

  const sttAdapters: Record<string, STTAdapter> = {
    openai: createOpenAiRealtimeStt(env),
    deepgram: createDeepgramStt(env),
    elevenlabs: createElevenLabsStt(env),
    google: createGoogleStt(env),
  };

  app.route('/api/voices', voicesRoute(env, resolveTts));
  app.route('/api/tts', ttsRoute(resolveTts));

  app.route(
    '/ws/stt',
    sttWsRoute(upgradeWebSocket, (provider) => {
      const a = sttAdapters[provider];
      if (!a) throw new Error(`STT adapter not found: ${provider}`);
      return a;
    }),
  );

  return { app, injectWebSocket, upgradeWebSocket };
}
