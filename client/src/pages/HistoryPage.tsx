import { useEffect, useState, type CSSProperties } from 'react';
import type { RunRecord } from '@voice-lab/shared';
import { providerColor } from '../lib/providers';

/** modelKey ("openai/gpt-4o-mini-tts") から provider ("openai") を取り出す。 */
function providerOf(modelKey: string): string {
  return modelKey.split('/')[0] ?? '';
}

/** ISO 文字列を読みやすい時刻表記にする。 */
function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { hour12: false });
}

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[] | null>(null);

  useEffect(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  if (!runs) return <div className="loading">loading history…</div>;

  return (
    <div>
      <header className="bench__head">
        <span className="eyebrow">tape log</span>
        <h1 className="bench__title">実行履歴</h1>
        <p className="bench__lede">過去の合成・文字起こしを新しい順に。音声を聴き直し、メトリクスを見比べられます。</p>
      </header>

      {runs.length === 0 ? (
        <div className="empty">
          <div className="empty__big">まだ記録がありません</div>
          <div>TTS Lab で合成、または STT Lab で録音すると、ここに残ります。</div>
        </div>
      ) : (
        <div className="takes">
          {runs.map((r) => {
            const color = r.kind === 'tts' ? providerColor(providerOf(r.modelKey)) : '#8a93a3';
            const style = { '--ch': color } as CSSProperties;
            return (
              <div key={r.id} className="take" style={style}>
                <div className="take__rail" />
                <div>
                  <div className="take__head">
                    <span className="tag" style={style}>
                      {r.kind === 'tts' ? providerOf(r.modelKey) : 'stt'}
                    </span>
                    <span className="eyebrow">{r.kind === 'tts' ? 'synthesis' : 'transcription'}</span>
                    <span className="take__time">{formatAt(r.at)}</span>
                  </div>

                  {r.kind === 'tts' ? (
                    <>
                      <div className="take__body">
                        <b>{r.modelKey}</b>
                        {r.voice ? ` · ${r.voice}` : ''}
                        <div style={{ marginTop: 4 }}>{r.text}</div>
                      </div>
                      <div className="take__metrics">
                        <span>ttfb {r.serverTtfbMs ?? '—'} ms</span>
                        <span>total {r.serverTotalMs ?? '—'} ms</span>
                        <span>{r.bytes ? (r.bytes / 1024).toFixed(1) : '—'} KB</span>
                        {r.error && <span style={{ color: 'var(--rec)' }}>error: {r.error}</span>}
                      </div>
                    </>
                  ) : (
                    <>
                      {r.note && (
                        <div className="take__body">
                          メモ: <b>{r.note}</b>
                        </div>
                      )}
                      <table className="take__rows">
                        <tbody>
                          {Object.entries(r.models).map(([k, s]) => (
                            <tr key={k}>
                              <td className="mono">{k}</td>
                              <td>{s.transcript || <span style={{ color: 'var(--text-mute)' }}>—</span>}</td>
                              <td className="mono">{s.finalDelayMs ?? '—'} ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}

                  {r.audioFile && <audio controls preload="none" src={`/api/history/audio/${r.audioFile}`} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
