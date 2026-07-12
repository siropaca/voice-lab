import type { ModelEntry, ModelsResponse } from '@voice-lab/shared';

/** 初期セットのモデル定義（スペック §3、2026-07-12 検証済み。実装時に公式ドキュメントで再確認すること） */
export const MODELS: ModelEntry[] = [
  // ======== TTS ========
  // ---- OpenAI（POST /v1/audio/speech・chunked streaming。ボイスは listVoices でモデル別に）----
  {
    key: 'openai/gpt-4o-mini-tts', kind: 'tts', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', requiredEnv: ['OPENAI_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [{ id: 'alloy', label: 'alloy' }, { id: 'marin', label: 'marin' }],
    params: [{ name: 'speed', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 }],
    note: '最新・推奨。全13ボイス（marin/cedar 含む）',
  },
  {
    key: 'openai/tts-1', kind: 'tts', provider: 'openai', providerLabel: 'OpenAI',
    model: 'tts-1', label: 'tts-1', requiredEnv: ['OPENAI_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [{ id: 'alloy', label: 'alloy' }, { id: 'nova', label: 'nova' }],
    params: [{ name: 'speed', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 }],
    note: '低レイテンシ版。9ボイス',
  },
  {
    key: 'openai/tts-1-hd', kind: 'tts', provider: 'openai', providerLabel: 'OpenAI',
    model: 'tts-1-hd', label: 'tts-1-hd', requiredEnv: ['OPENAI_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [{ id: 'alloy', label: 'alloy' }, { id: 'nova', label: 'nova' }],
    params: [{ name: 'speed', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 }],
    note: '高品質版。9ボイス',
  },
  // ---- ElevenLabs（ボイスはアカウントの /v2/voices を listVoices で動的取得）----
  {
    key: 'elevenlabs/eleven_flash_v2_5', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_flash_v2_5', label: 'Flash v2.5（低遅延）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [{ id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah（暫定）' }],
    params: [
      { name: 'stability', label: 'stability', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
      { name: 'similarity_boost', label: 'similarity', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    ],
    note: '超低遅延(~75ms)。対話向け第一候補',
  },
  {
    key: 'elevenlabs/eleven_turbo_v2_5', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_turbo_v2_5', label: 'Turbo v2.5', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [{ id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah（暫定）' }],
    params: [
      { name: 'stability', label: 'stability', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
      { name: 'similarity_boost', label: 'similarity', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    ],
    note: 'Flash と同等（公式は Flash 推奨）',
  },
  {
    key: 'elevenlabs/eleven_multilingual_v2', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_multilingual_v2', label: 'Multilingual v2（品質）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [{ id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah（暫定）' }],
    params: [
      { name: 'stability', label: 'stability', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
      { name: 'similarity_boost', label: 'similarity', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    ],
    note: '高品質・感情豊か。ナレーション向け',
  },
  {
    key: 'elevenlabs/eleven_v3', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_v3', label: 'v3（品質重視）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah（暫定）' }],
    note: '最高品質・最も表情豊か。WS非対応（batch）',
  },
  // ---- Google Cloud TTS（ボイスは voices.list を listVoices で ja-JP 抽出）----
  {
    key: 'google/gemini-2.5-flash-tts', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'gemini-2.5-flash-tts', label: 'Gemini 2.5 Flash TTS', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'Kore', label: 'Kore' }, { id: 'Puck', label: 'Puck' }],
    note: '一括合成（Chirp 3 HD の streaming 版は別エントリ）',
  },
  {
    key: 'google/gemini-2.5-pro-tts', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'gemini-2.5-pro-tts', label: 'Gemini 2.5 Pro TTS', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'Kore', label: 'Kore' }, { id: 'Puck', label: 'Puck' }],
    note: '高品質 Gemini TTS（一括合成）',
  },
  {
    key: 'google/chirp3-hd', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp3-hd', label: 'Chirp 3 HD', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'ja-JP-Chirp3-HD-Aoede', label: 'Aoede' }, { id: 'ja-JP-Chirp3-HD-Leda', label: 'Leda' }],
    note: '一括合成。ja-JP 天体名30ボイス',
  },
  {
    key: 'google/chirp3-hd-streaming', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp3-hd-streaming', label: 'Chirp 3 HD（streaming）', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: true, audioFormat: 'pcm16', sampleRate: 24000,
    voices: [{ id: 'ja-JP-Chirp3-HD-Aoede', label: 'Aoede' }, { id: 'ja-JP-Chirp3-HD-Leda', label: 'Leda' }],
    note: 'streamingSynthesize（PCM/24kHz）。最初の音までの TTFB を計測',
  },
  {
    key: 'google/neural2', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'neural2', label: 'Neural2', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'ja-JP-Neural2-B', label: 'Neural2-B' }, { id: 'ja-JP-Neural2-C', label: 'Neural2-C' }],
    note: '一括合成のみ（streaming 非対応）',
  },
  {
    key: 'google/wavenet', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'wavenet', label: 'WaveNet', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'ja-JP-Wavenet-A', label: 'Wavenet-A' }, { id: 'ja-JP-Wavenet-B', label: 'Wavenet-B' }],
    note: '一括合成のみ（streaming 非対応）',
  },
  {
    key: 'google/standard', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'standard', label: 'Standard', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'ja-JP-Standard-A', label: 'Standard-A' }, { id: 'ja-JP-Standard-B', label: 'Standard-B' }],
    note: '一括合成のみ。低コスト',
  },
  // ---- Aivis Cloud（model_uuid をボイスとして扱う。listVoices は AivisHub 検索）----
  {
    key: 'aivis/default', kind: 'tts', provider: 'aivis', providerLabel: 'Aivis Cloud',
    model: 'default', label: 'AivisSpeech', requiredEnv: ['AIVIS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [
      { id: '22e8ed77-94fe-4ef2-871f-a86f94e9a579', label: 'コハク' },
      { id: 'a59cb814-0083-4369-8542-f51a29e72af7', label: 'まお' },
    ],
    params: [
      { name: 'speaking_rate', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
      { name: 'emotional_intensity', label: '感情強度', type: 'number', min: 0, max: 2, step: 0.1, defaultValue: 1 },
    ],
    note: 'AivisHub の人気モデルから選択',
  },
  // ======== STT（すべてストリーミング）========
  // ---- OpenAI Realtime（wss ?intent=transcription）----
  {
    key: 'openai/gpt-realtime-whisper', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-realtime-whisper', label: 'gpt-realtime-whisper', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
    note: 'realtime 専用。手動 commit',
  },
  {
    key: 'openai/gpt-4o-transcribe', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
    note: '高精度。server VAD',
  },
  {
    key: 'openai/gpt-4o-mini-transcribe', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-mini-transcribe', label: 'gpt-4o-mini-transcribe', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
    note: '低コスト版。server VAD',
  },
  {
    key: 'openai/whisper-1', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'whisper-1', label: 'whisper-1', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
    note: 'レガシー（realtime 互換）',
  },
  // ---- Deepgram（nova系=v1 / Flux=v2）----
  {
    key: 'deepgram/flux-general-multi', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'flux-general-multi', label: 'Flux Multilingual', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
    note: 'ターン検出内蔵（v2）',
  },
  {
    key: 'deepgram/nova-3', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'nova-3', label: 'Nova-3', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
    note: '最新の汎用ASR（v1）',
  },
  {
    key: 'deepgram/nova-2', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'nova-2', label: 'Nova-2', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
    note: '前世代の汎用ASR（v1）',
  },
  // ---- ElevenLabs ----
  {
    key: 'elevenlabs/scribe_v2_realtime', kind: 'stt', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'scribe_v2_realtime', label: 'Scribe v2 Realtime', requiredEnv: ['ELEVENLABS_API_KEY'], streaming: true,
    note: '超低遅延(~150ms)',
  },
  // ---- Google Cloud STT v2（リージョンはモデル固有・実測確認済み）----
  {
    key: 'google/chirp_3', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp_3', label: 'Chirp 3 (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
    location: 'us',
    note: 'us リージョン（Chirp 3 は global 非提供）',
  },
  {
    key: 'google/chirp_2', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp_2', label: 'Chirp 2 (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
    location: 'us-central1',
    note: 'us-central1 リージョン',
  },
  {
    key: 'google/latest_long', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'latest_long', label: 'latest_long (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
    location: 'global',
    note: 'global。Conformer 系の汎用モデル',
  },
  {
    key: 'google/long', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'long', label: 'long (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
    location: 'us',
    note: 'us。長尺向け汎用モデル',
  },
  {
    key: 'google/telephony', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'telephony', label: 'telephony (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
    location: 'us',
    note: 'us。電話音声向け',
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
    .map((m) => ({ key: m.key, kind: m.kind, label: `${m.providerLabel} ${m.label}`, streaming: m.streaming, missingEnv: m.requiredEnv.filter((k) => !has(k)) }));
  return { available, unavailable };
}
