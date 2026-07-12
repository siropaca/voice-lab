export interface SttSession {
  sendAudio(chunk: Uint8Array): void; // 16kHz 16bit PCM mono
  close(): void; // 入力終了をプロバイダーへ通知
}

export interface STTAdapter {
  startSession(opts: {
    model: string;
    params: Record<string, unknown>;
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: Error) => void;
  }): SttSession;
}

export type STTAdapterResolver = (provider: string) => STTAdapter;
