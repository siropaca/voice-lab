import 'dotenv/config';
import { MODELS } from '../src/registry.js';
import { resamplePcm16 } from '../src/audio.js';
import { createDeepgramStt } from '../src/adapters/stt/deepgram.js';
import { createOpenAiRealtimeStt } from '../src/adapters/stt/openai-realtime.js';
import { createElevenLabsStt } from '../src/adapters/stt/elevenlabs.js';
import { createGoogleStt } from '../src/adapters/stt/google.js';
import type { STTAdapter } from '../src/adapters/stt/types.js';

const adapters: Record<string, (env: NodeJS.ProcessEnv) => STTAdapter> = {
  deepgram: createDeepgramStt,
  openai: createOpenAiRealtimeStt,
  elevenlabs: createElevenLabsStt,
  google: createGoogleStt,
};

/**
 * OpenAI TTS で試験音声（24kHz PCM）を作り 16kHz に変換、
 * 100ms ごとに送ってリアルタイム入力を模擬する。
 * 使い方: tsx scripts/try-stt.ts deepgram/nova-3 "こんにちは、音声認識のテストです"
 */
async function main() {
  const [modelKey, text] = process.argv.slice(2);
  const entry = MODELS.find((m) => m.key === modelKey && m.kind === 'stt');
  if (!entry || !text) throw new Error('usage: try-stt.ts <modelKey> <text>');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }),
  });
  if (!res.ok) throw new Error(`tts for test audio failed: ${res.status}`);
  const pcm24k = new Int16Array(await res.arrayBuffer());
  const pcm16k = resamplePcm16(pcm24k, 24000, 16000);

  const session = adapters[entry.provider](process.env).startSession({
    model: entry.model,
    params: {},
    onPartial: (t) => console.log(`  [partial] ${t}`),
    onFinal: (t) => console.log(`  [final]   ${t}`),
    onError: (e) => console.error(`  [error]   ${e.message}`),
  });

  const chunkSamples = 1600; // 100ms @16kHz
  for (let i = 0; i < pcm16k.length; i += chunkSamples) {
    const part = pcm16k.subarray(i, i + chunkSamples);
    session.sendAudio(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
    await new Promise((r) => setTimeout(r, 100));
  }
  session.close();
  await new Promise((r) => setTimeout(r, 4000));
  process.exit(0);
}

main();
