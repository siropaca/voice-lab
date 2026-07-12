export interface TTSRequest {
  text: string;
  model: string; // ModelEntry.model
  voice: string;
  params: Record<string, unknown>;
}

export interface TTSAdapter {
  synthesize(req: TTSRequest): AsyncIterable<Uint8Array>;
}

export type TTSAdapterResolver = (provider: string) => TTSAdapter;
