import type { ModelEntry, ModelsResponse } from '@voice-lab/shared';

/** 初期セットのモデル定義（スペック §3、2026-07-12 検証済み。実装時に公式ドキュメントで再確認すること） */
export const MODELS: ModelEntry[] = [
  // ---- TTS ----
  {
    key: 'openai/gpt-4o-mini-tts', kind: 'tts', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', requiredEnv: ['OPENAI_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [
      { id: 'alloy', label: 'alloy' }, { id: 'nova', label: 'nova' },
      { id: 'shimmer', label: 'shimmer' }, { id: 'sage', label: 'sage' },
    ],
    params: [{ name: 'speed', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 }],
    note: '公式に英語最適化と明記。基準値用',
  },
  {
    key: 'elevenlabs/eleven_flash_v2_5', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_flash_v2_5', label: 'Flash v2.5（低遅延）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    // 暫定の多言語ボイス（日本語ネイティブではない）。本番選定では GET /v2/voices で日本語ボイスに差し替える。
    voices: [
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah（暫定・多言語）' },
      { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte（暫定・多言語）' },
    ],
    params: [
      { name: 'stability', label: 'stability', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
      { name: 'similarity_boost', label: 'similarity', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    ],
  },
  {
    key: 'elevenlabs/eleven_v3', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_v3', label: 'v3（品質重視）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: false, audioFormat: 'mp3',
    voices: [
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah（暫定・多言語）' },
      { id: 'XB0fDUnXU5powFXDhCwa', label: 'Charlotte（暫定・多言語）' },
    ],
    note: 'リアルタイム非対応。品質比較用',
  },
  {
    key: 'google/gemini-2.5-flash-tts', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'gemini-2.5-flash-tts', label: 'Gemini 2.5 Flash TTS', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'Kore', label: 'Kore' }, { id: 'Puck', label: 'Puck' }],
    note: 'v1 は非ストリーミング実装（将来 gRPC streaming 化）',
  },
  {
    key: 'google/chirp3-hd', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp3-hd', label: 'Chirp 3 HD', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [
      { id: 'ja-JP-Chirp3-HD-Aoede', label: 'Aoede' }, { id: 'ja-JP-Chirp3-HD-Charon', label: 'Charon' },
      { id: 'ja-JP-Chirp3-HD-Kore', label: 'Kore' }, { id: 'ja-JP-Chirp3-HD-Puck', label: 'Puck' },
    ],
    note: 'v1 は非ストリーミング実装（将来 gRPC streaming 化）',
  },
  {
    key: 'aivis/default', kind: 'tts', provider: 'aivis', providerLabel: 'Aivis Cloud',
    model: 'default', label: 'AivisSpeech', requiredEnv: ['AIVIS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    // AivisHub の公式コラボモデル UUID（公式プレスリリースで確認済み）。
    voices: [
      { id: '22e8ed77-94fe-4ef2-871f-a86f94e9a579', label: 'コハク' },
      { id: 'a59cb814-0083-4369-8542-f51a29e72af7', label: 'まお' },
    ],
    params: [
      { name: 'speaking_rate', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
      { name: 'emotional_intensity', label: '感情強度', type: 'number', min: 0, max: 2, step: 0.1, defaultValue: 1 },
    ],
  },
  // ---- STT ----
  {
    key: 'openai/gpt-realtime-whisper', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-realtime-whisper', label: 'gpt-realtime-whisper', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
  },
  {
    key: 'openai/gpt-4o-transcribe', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
  },
  {
    key: 'deepgram/flux-general-multi', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'flux-general-multi', label: 'Flux Multilingual', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
    note: 'ターン検出内蔵',
  },
  {
    key: 'deepgram/nova-3', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'nova-3', label: 'Nova-3', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
  },
  {
    key: 'elevenlabs/scribe_v2_realtime', kind: 'stt', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'scribe_v2_realtime', label: 'Scribe v2 Realtime', requiredEnv: ['ELEVENLABS_API_KEY'], streaming: true,
  },
  {
    key: 'google/chirp_3', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp_3', label: 'Chirp 3 (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
  },
];

/**
 * env に必要なキーが揃っているモデルと、揃っていないモデル（不足キー付き）に分ける。
 */
export function filterAvailable(
  models: ModelEntry[],
  env: Record<string, string | undefined>,
): ModelsResponse {
  const has = (k: string) => Boolean(env[k] && env[k] !== '');
  const available = models.filter((m) => m.requiredEnv.every(has));
  const unavailable = models
    .filter((m) => !m.requiredEnv.every(has))
    .map((m) => ({ key: m.key, kind: m.kind, label: `${m.providerLabel} ${m.label}`, missingEnv: m.requiredEnv.filter((k) => !has(k)) }));
  return { available, unavailable };
}
