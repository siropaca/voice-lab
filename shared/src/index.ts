// ---- モデルレジストリ関連（Task 2） ----

export type ModelKind = 'tts' | 'stt';

export interface ParamSpec {
  name: string; // API に渡すキー
  label: string; // 表示名
  type: 'number' | 'select' | 'text';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  defaultValue: string | number;
}

export interface VoiceSpec {
  id: string;
  label: string;
}

export interface ModelEntry {
  key: string; // 例 "openai/gpt-4o-mini-tts"（provider/model 形式で一意）
  kind: ModelKind;
  provider: string; // アダプター解決キー 例 "openai"
  providerLabel: string; // 表示名 例 "OpenAI"
  model: string; // プロバイダー API に渡すモデルID
  label: string;
  requiredEnv: string[];
  streaming: boolean; // 逐次合成/逐次認識に対応しているか（比較表示に使う）
  audioFormat?: 'mp3' | 'pcm16'; // TTS のみ: クライアントへ流す形式
  sampleRate?: number; // audioFormat が pcm16 のときのレート
  voices?: VoiceSpec[]; // TTS のみ
  params?: ParamSpec[];
  note?: string; // GUI に出す注記（例 "英語最適化" ）
}

export interface UnavailableModel {
  key: string;
  kind: ModelKind;
  label: string;
  missingEnv: string[];
}

export interface ModelsResponse {
  available: ModelEntry[];
  unavailable: UnavailableModel[];
}

// ---- TTS ストリーム（Task 4） ----

export type TtsStreamLine =
  | { type: 'chunk'; b64: string }
  | { type: 'metrics'; serverTtfbMs: number; serverTotalMs: number; bytes: number }
  | { type: 'error'; message: string }
  | { type: 'end' };

// ---- STT メッセージ（Task 11） ----

export interface SttModelSummary {
  partials: number;
  finals: number;
  finalDelayMs: number | null; // stop 後、最後の final までの遅延（final が stop 前なら 0）
  transcript: string; // final の連結
}

export type SttServerMessage =
  | { type: 'ready'; models: string[] }
  | { type: 'partial' | 'final'; modelKey: string; text: string; at: number }
  | { type: 'error'; modelKey: string; message: string }
  | { type: 'summary'; stoppedAt: number; models: Record<string, SttModelSummary> };
