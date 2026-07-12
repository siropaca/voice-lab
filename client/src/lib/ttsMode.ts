import type { ModelsResponse } from '@voice-lab/shared';

export type TtsMode = 'streaming' | 'batch';

export const TTS_MODE_STORAGE_KEY = 'voice-lab:tts-mode';

/** モードごとの指標の見せ方（ヒーロー指標のキーと表示ラベル）。 */
export const MODE_METRIC: Record<TtsMode, { key: 'serverTtfbMs' | 'serverTotalMs'; label: string }> = {
  streaming: { key: 'serverTtfbMs', label: 'ttfb · server' },
  batch: { key: 'serverTotalMs', label: '合成時間' },
};

/**
 * ModelsResponse を指定モードの TTS モデルだけに絞る。
 * available / unavailable の双方を `kind === 'tts'` かつ streaming がモードに一致するものへ限定する。
 * @param models 全モデル
 * @param mode 'streaming' | 'batch'
 * @returns 当該モードの TTS だけを含む ModelsResponse
 */
export function filterModelsByMode(models: ModelsResponse, mode: TtsMode): ModelsResponse {
  const wantStreaming = mode === 'streaming';
  return {
    available: models.available.filter((m) => m.kind === 'tts' && m.streaming === wantStreaming),
    unavailable: models.unavailable.filter((m) => m.kind === 'tts' && m.streaming === wantStreaming),
  };
}
