export interface TTSRequest {
  text: string;
  model: string; // ModelEntry.model
  voice: string;
  params: Record<string, unknown>;
}

export interface Voice {
  id: string; // API に渡す voice 識別子
  label: string; // 表示名
}

export interface TTSAdapter {
  synthesize(req: TTSRequest): AsyncIterable<Uint8Array>;
  /**
   * このプロバイダーで現在利用可能なボイス一覧を返す（TTS のみ）。
   * model はプロバイダー内でモデルごとにボイスが異なる場合の絞り込みに使う。
   * 未実装なら呼び出し側は registry のシードにフォールバックする。
   */
  listVoices?(model: string): Promise<Voice[]>;
}

export type TTSAdapterResolver = (provider: string) => TTSAdapter;
