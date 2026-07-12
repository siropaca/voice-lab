import { Hono } from 'hono';
import type { VoiceSpec, VoicesResponse } from '@voice-lab/shared';
import { MODELS, filterAvailable } from '../registry.js';
import type { TTSAdapterResolver } from '../adapters/tts/types.js';

/**
 * ボイス一覧ルートを作る。
 *
 * 利用可能な各 TTS モデルについて、アダプターの listVoices() でプロバイダーの
 * 現在のボイス一覧を取得して返す。取得に失敗した／未実装のモデルは registry の
 * シード（ModelEntry.voices）にフォールバックする。結果はプロセス内でキャッシュする
 * （プロバイダー API を毎回叩かない）。
 */
export function voicesRoute(env: Record<string, string | undefined>, resolveTts: TTSAdapterResolver) {
  const cache = new Map<string, VoiceSpec[]>();
  const route = new Hono();

  route.get('/', async (c) => {
    const ttsModels = filterAvailable(MODELS, env).available.filter((m) => m.kind === 'tts');

    await Promise.all(
      ttsModels.map(async (m) => {
        if (cache.has(m.key)) return;
        let voices: VoiceSpec[] = m.voices ?? [];
        try {
          const adapter = resolveTts(m.provider);
          if (adapter.listVoices) {
            const live = await adapter.listVoices(m.model);
            if (live.length > 0) voices = live;
          }
        } catch (e) {
          // フォールバック: registry シードのまま。ラボが起動不能にならないようログのみ。
          console.error(`voices: listVoices failed for ${m.key}:`, e);
        }
        cache.set(m.key, voices);
      }),
    );

    const voices: Record<string, VoiceSpec[]> = {};
    for (const m of ttsModels) voices[m.key] = cache.get(m.key) ?? m.voices ?? [];
    return c.json<VoicesResponse>({ voices });
  });

  return route;
}
