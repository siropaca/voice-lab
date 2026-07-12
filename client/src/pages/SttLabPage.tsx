import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ModelsResponse, SttModelSummary, SttServerMessage } from '@voice-lab/shared';
import { fetchModels } from '../lib/api';
import { startMic, type MicCapture } from '../lib/mic';
import { providerColor } from '../lib/providers';
import ModelPicker, { type ModelConfig } from '../components/ModelPicker';
import LevelMeter from '../components/LevelMeter';

interface Column {
  modelKey: string;
  provider: string;
  providerLabel: string;
  label: string;
  partial: string;
  finals: string[];
  error?: string;
  summary?: SttModelSummary;
}

export default function SttLabPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, ModelConfig>>({});
  const [columns, setColumns] = useState<Column[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [level, setLevel] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicCapture | null>(null);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setModels(m);
        // 既定で全 STT モデルを比較対象にする（アーム操作を不要にする）。
        setSelected(m.available.filter((x) => x.kind === 'stt').map((x) => x.key));
      })
      .catch(() => setModels({ available: [], unavailable: [] }));
    return () => {
      micRef.current?.stop();
      wsRef.current?.close();
    };
  }, []);

  const patch = (modelKey: string, fn: (c: Column) => Column) =>
    setColumns((prev) => prev.map((c) => (c.modelKey === modelKey ? fn(c) : c)));

  const start = async () => {
    if (!models) return;
    setColumns(
      selected.map((modelKey) => {
        const m = models.available.find((x) => x.key === modelKey)!;
        return {
          modelKey,
          provider: m.provider,
          providerLabel: m.providerLabel,
          label: m.label,
          partial: '',
          finals: [],
        };
      }),
    );

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/stt?models=${encodeURIComponent(selected.join(','))}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg: SttServerMessage = JSON.parse(e.data);
      if (msg.type === 'partial') patch(msg.modelKey, (c) => ({ ...c, partial: msg.text }));
      else if (msg.type === 'final') patch(msg.modelKey, (c) => ({ ...c, partial: '', finals: [...c.finals, msg.text] }));
      else if (msg.type === 'error') patch(msg.modelKey, (c) => ({ ...c, error: msg.message }));
      else if (msg.type === 'summary') {
        for (const [key, summary] of Object.entries(msg.models)) patch(key, (c) => ({ ...c, summary }));
      }
    };

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('ws error'));
    });

    micRef.current = await startMic(
      (pcm) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer);
      },
      (lvl) => setLevel(lvl),
    );
    setRunning(true);
  };

  const stop = () => {
    micRef.current?.stop();
    micRef.current = null;
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify({ type: 'stop', note }));
    setRunning(false);
    setLevel(0);
  };

  if (!models) return <div className="loading">loading models…</div>;

  const sttAvailable = models.available.filter((m) => m.kind === 'stt').length;

  return (
    <div>
      <header className="bench__head">
        <span className="eyebrow">transcription bench</span>
        <h1 className="bench__title">マイク入力を同時に文字起こし</h1>
        <p className="bench__lede">
          1本のマイク音声を選択したモデルへ同時配信し、逐次認識（partial → final）と確定までの遅延を並べて比較します。
        </p>
      </header>

      {sttAvailable === 0 ? (
        <div className="empty">
          <div className="empty__big">利用可能な STT モデルがありません</div>
          <div>server/.env に API キーを設定すると、ここにモデルが並びます。</div>
        </div>
      ) : (
        <div className="console">
          <p className="picker-hint">
            全 {sttAvailable} モデルを比較中 · 不要なモデルはカード上部をクリックで除外できます
          </p>
          <ModelPicker
            kind="stt"
            models={models}
            selected={selected}
            onChange={setSelected}
            configs={configs}
            onConfigChange={(k, c) => setConfigs((prev) => ({ ...prev, [k]: c }))}
          />

          <div className="stt-input">
            {running ? (
              <button type="button" className="btn btn--record" onClick={stop}>
                <span className="rec-dot" /> 停止
              </button>
            ) : (
              <button type="button" className="btn btn--primary" onClick={start} disabled={selected.length === 0}>
                ● 録音開始 ({selected.length})
              </button>
            )}
            <LevelMeter level={running ? level : 0} />
            <input
              className="field field--inline"
              style={{ flex: '1 1 240px', width: 'auto' }}
              placeholder="話した内容のメモ（任意・比較用）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
      )}

      {columns.length > 0 && (
        <>
          <div className="section-label">
            <span className="eyebrow">transcripts</span>
          </div>
          <div className="stt-cols">
            {columns.map((c) => {
              const style = { '--ch': providerColor(c.provider) } as CSSProperties;
              return (
                <div key={c.modelKey} className="stt-col" style={style}>
                  <div className="stt-col__head">
                    <span className="channel__dot" />
                    <span className="channel__provider">{c.providerLabel}</span>
                    <span className="arm__check" style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>
                      {c.label}
                    </span>
                  </div>
                  <div className="stt-col__transcript">
                    {c.error ? (
                      <span className="channel__err">{c.error}</span>
                    ) : (
                      <>
                        <span className="stt-col__final">{c.finals.join('')}</span>
                        <span className="stt-col__partial">{c.partial}</span>
                        {running && <span className="stt-col__cursor" />}
                      </>
                    )}
                  </div>
                  {c.summary && (
                    <div className="stt-col__foot readout">
                      <div className="readout__row">
                        <span className="readout__k">停止→最終確定</span>
                        <span className="readout__v">
                          <b>{c.summary.finalDelayMs ?? '—'}</b>
                          <i>ms</i>
                        </span>
                      </div>
                      <div className="readout__row">
                        <span className="readout__k">final / partial</span>
                        <span className="readout__v">
                          {c.summary.finals} / {c.summary.partials}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
