import type { ModelEntry, SttModelSummary, SttServerMessage } from '@voice-lab/shared';
import type { STTAdapterResolver, SttSession } from './adapters/stt/types.js';

interface SttEvent { modelKey: string; type: 'partial' | 'final'; text: string; at: number }

/**
 * 1 本のマイク入力を複数 STT モデルのセッションへ配信し、
 * 受信イベントに時刻を打刻して emit・集計する。
 */
export class SttFanout {
  private sessions = new Map<string, SttSession>();
  private events: SttEvent[] = [];
  private audioChunks: Uint8Array[] = [];

  constructor(
    entries: ModelEntry[],
    resolve: STTAdapterResolver,
    private emit: (msg: SttServerMessage) => void,
    private now: () => number = () => performance.now(),
  ) {
    for (const entry of entries) {
      try {
        const session = resolve(entry.provider).startSession({
          model: entry.model,
          params: {},
          onPartial: (text) => this.record(entry.key, 'partial', text),
          onFinal: (text) => this.record(entry.key, 'final', text),
          onError: (err) => this.emit({ type: 'error', modelKey: entry.key, message: err.message }),
        });
        this.sessions.set(entry.key, session);
      } catch (err) {
        this.emit({ type: 'error', modelKey: entry.key, message: err instanceof Error ? err.message : String(err) });
      }
    }
    this.emit({ type: 'ready', models: [...this.sessions.keys()] });
  }

  /** 16kHz PCM16 チャンクを全セッションに配る。履歴保存用に蓄積もする */
  sendAudio(chunk: Uint8Array) {
    this.audioChunks.push(chunk);
    for (const s of this.sessions.values()) {
      try { s.sendAudio(chunk); } catch { /* モデル単位で隔離 */ }
    }
  }

  /** 蓄積した入力音声（履歴保存用） */
  get audio(): Uint8Array[] { return this.audioChunks; }

  /** 打刻済みイベント列（履歴保存用） */
  get eventLog(): SttEvent[] { return this.events; }

  /** 全セッションを閉じ、grace 待機後に summary を emit する */
  async stop(graceMs = 2000): Promise<Record<string, SttModelSummary>> {
    const stoppedAt = this.now();
    for (const s of this.sessions.values()) {
      try { s.close(); } catch { /* noop */ }
    }
    await new Promise((r) => setTimeout(r, graceMs));
    const models: Record<string, SttModelSummary> = {};
    for (const key of this.sessions.keys()) {
      const evts = this.events.filter((e) => e.modelKey === key);
      const finals = evts.filter((e) => e.type === 'final');
      const lastFinalAt = finals.at(-1)?.at ?? null;
      models[key] = {
        partials: evts.filter((e) => e.type === 'partial').length,
        finals: finals.length,
        finalDelayMs: lastFinalAt === null ? null : Math.max(0, Math.round(lastFinalAt - stoppedAt)),
        transcript: finals.map((e) => e.text).join(''),
      };
    }
    this.emit({ type: 'summary', stoppedAt, models });
    return models;
  }

  private record(modelKey: string, type: 'partial' | 'final', text: string) {
    const at = this.now();
    this.events.push({ modelKey, type, text, at });
    this.emit({ type, modelKey, text, at });
  }
}
