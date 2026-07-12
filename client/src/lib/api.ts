import type { ModelsResponse, TtsStreamLine, VoicesResponse } from '@voice-lab/shared';

/** GET /api/models */
export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch('/api/models');
  if (!res.ok) throw new Error(`models: ${res.status}`);
  return res.json();
}

/** GET /api/voices — TTS モデルごとの利用可能ボイス一覧（プロバイダーから動的取得）。 */
export async function fetchVoices(): Promise<VoicesResponse> {
  const res = await fetch('/api/voices');
  if (!res.ok) throw new Error(`voices: ${res.status}`);
  return res.json();
}

/**
 * POST /api/tts の NDJSON を逐次読み、クライアント側 TTFB（最初の chunk 行まで）を計測する。
 */
export async function streamTts(
  req: { modelKey: string; text: string; voice: string; params: Record<string, unknown> },
  onLine: (line: TtsStreamLine) => void,
): Promise<{ clientTtfbMs: number }> {
  const started = performance.now();
  let clientTtfbMs = -1;
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) throw new Error(`tts: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const line: TtsStreamLine = JSON.parse(raw);
      if (line.type === 'chunk' && clientTtfbMs < 0) clientTtfbMs = performance.now() - started;
      onLine(line);
    }
  }
  return { clientTtfbMs: Math.round(clientTtfbMs) };
}
