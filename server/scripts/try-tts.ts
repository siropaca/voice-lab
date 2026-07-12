import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODELS } from '../src/registry.js';
import { createOpenAiTts } from '../src/adapters/tts/openai.js';
import { createElevenLabsTts } from '../src/adapters/tts/elevenlabs.js';
import { createAivisTts } from '../src/adapters/tts/aivis.js';
import { createGoogleTts } from '../src/adapters/tts/google.js';
import type { TTSAdapter } from '../src/adapters/tts/types.js';

const adapters: Record<string, (env: NodeJS.ProcessEnv) => TTSAdapter> = {
  openai: createOpenAiTts,
  elevenlabs: createElevenLabsTts,
  aivis: createAivisTts,
  google: createGoogleTts,
};

/**
 * 使い方: tsx scripts/try-tts.ts openai/gpt-4o-mini-tts "こんにちは、音声テストです"
 */
async function main() {
  const [modelKey, text] = process.argv.slice(2);
  const entry = MODELS.find((m) => m.key === modelKey && m.kind === 'tts');
  if (!entry || !text) throw new Error('usage: try-tts.ts <modelKey> <text>');
  const adapter = adapters[entry.provider](process.env);
  const started = performance.now();
  let ttfb: number | null = null;
  const chunks: Uint8Array[] = [];
  for await (const c of adapter.synthesize({
    text, model: entry.model, voice: entry.voices?.[0]?.id ?? '', params: {},
  })) {
    if (ttfb === null) ttfb = performance.now() - started;
    chunks.push(c);
  }
  mkdirSync('out', { recursive: true });
  const file = `out/${modelKey.replace('/', '_')}.mp3`;
  writeFileSync(file, Buffer.concat(chunks));
  console.log(`${file} (${chunks.reduce((n, c) => n + c.byteLength, 0)} bytes, TTFB ${Math.round(ttfb!)}ms)`);
}

main();
