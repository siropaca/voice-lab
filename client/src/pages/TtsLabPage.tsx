import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ModelsResponse } from '@voice-lab/shared';
import { fetchModels, streamTts } from '../lib/api';
import { MsePlayer } from '../lib/mse-player';
import { providerColor } from '../lib/providers';
import ModelPicker, { defaultConfig, type ModelConfig } from '../components/ModelPicker';
import Equalizer from '../components/Equalizer';

const PRESETS = [
  '本日はインタビューにご協力いただきありがとうございます。まずは自己紹介をお願いできますか？',
  'なるほど、その経験についてもう少し詳しく教えてください。特に苦労した点はどこでしたか？',
  'それでは最後の質問です。今後挑戦してみたいことがあれば、ぜひ聞かせてください。',
];

interface CardState {
  modelKey: string;
  provider: string;
  providerLabel: string;
  label: string;
  status: 'running' | 'done' | 'error';
  error?: string;
  serverTtfbMs?: number;
  serverTotalMs?: number;
  clientTtfbMs?: number;
  bytes?: number;
  playing: boolean;
}

export default function TtsLabPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, ModelConfig>>({});
  const [text, setText] = useState(PRESETS[0]);
  const [cards, setCards] = useState<CardState[]>([]);
  const playersRef = useRef<Record<string, MsePlayer>>({});
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setModels(m);
        // 既定で全 TTS モデルを比較対象にする（アーム操作を不要にする）。
        setSelected(m.available.filter((x) => x.kind === 'tts').map((x) => x.key));
      })
      .catch(() => setModels({ available: [], unavailable: [] }));
  }, []);

  const patch = (modelKey: string, p: Partial<CardState>) =>
    setCards((prev) => prev.map((c) => (c.modelKey === modelKey ? { ...c, ...p } : c)));

  const fastestKey = useMemo(() => {
    const done = cards.filter((c) => c.status === 'done' && typeof c.serverTtfbMs === 'number');
    if (done.length < 2) return null;
    return done.reduce((a, b) => ((a.serverTtfbMs ?? Infinity) <= (b.serverTtfbMs ?? Infinity) ? a : b)).modelKey;
  }, [cards]);

  const maxTtfb = useMemo(
    () => Math.max(1, ...cards.map((c) => c.serverTtfbMs ?? 0)),
    [cards],
  );

  const synthesize = () => {
    if (!models) return;
    // 前回のプレイヤーを片付ける
    if (hostRef.current) hostRef.current.innerHTML = '';
    playersRef.current = {};

    const next: CardState[] = selected.map((modelKey) => {
      const m = models.available.find((x) => x.key === modelKey)!;
      return {
        modelKey,
        provider: m.provider,
        providerLabel: m.providerLabel,
        label: m.label,
        status: 'running',
        playing: false,
      };
    });
    setCards(next);

    for (const modelKey of selected) {
      const m = models.available.find((x) => x.key === modelKey)!;
      const cfg = configs[modelKey] ?? defaultConfig(m);
      const player = new MsePlayer();
      playersRef.current[modelKey] = player;
      player.audioEl.style.display = 'none';
      player.audioEl.addEventListener('play', () => patch(modelKey, { playing: true }));
      player.audioEl.addEventListener('pause', () => patch(modelKey, { playing: false }));
      player.audioEl.addEventListener('ended', () => patch(modelKey, { playing: false }));
      hostRef.current?.appendChild(player.audioEl);

      streamTts({ modelKey, text, voice: cfg.voice, params: cfg.params }, (line) => {
        if (line.type === 'chunk') player.appendChunk(line.b64);
        else if (line.type === 'metrics')
          patch(modelKey, { serverTtfbMs: line.serverTtfbMs, serverTotalMs: line.serverTotalMs, bytes: line.bytes });
        else if (line.type === 'error') patch(modelKey, { status: 'error', error: line.message });
        else if (line.type === 'end') {
          player.endOfStream();
          patch(modelKey, { status: 'done' });
        }
      })
        .then(({ clientTtfbMs }) => patch(modelKey, { clientTtfbMs }))
        .catch((e) => patch(modelKey, { status: 'error', error: String(e) }));
    }
  };

  const playAll = async () => {
    for (const c of cards) {
      const player = playersRef.current[c.modelKey];
      if (!player || c.status === 'error') continue;
      try {
        await player.play();
        await new Promise<void>((r) => player.audioEl.addEventListener('ended', () => r(), { once: true }));
      } catch {
        /* ignore */
      }
    }
  };

  if (!models) return <div className="loading">loading models…</div>;

  const ttsAvailable = models.available.filter((m) => m.kind === 'tts').length;

  return (
    <div>
      <header className="bench__head">
        <span className="eyebrow">synthesis bench</span>
        <h1 className="bench__title">TTS を横並びで聴き比べる</h1>
        <p className="bench__lede">
          同じ文を選択した音声モデルへ同時に送り、声の質感と発話開始までの遅延（TTFB）を並べて比較します。
        </p>
      </header>

      <div className="console">
        <textarea
          className="field"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="読み上げる文章を入力…"
        />
        <div className="presets">
          {PRESETS.map((p, i) => (
            <button key={i} type="button" className="preset-chip" title={p} onClick={() => setText(p)}>
              例文 {i + 1}
            </button>
          ))}
        </div>

        {ttsAvailable === 0 ? (
          <div className="empty">
            <div className="empty__big">利用可能な TTS モデルがありません</div>
            <div>server/.env に API キーを設定すると、ここにモデルが並びます。</div>
          </div>
        ) : (
          <>
            <p className="picker-hint">
              全 {ttsAvailable} モデルを比較中 · 不要なモデルはカード上部をクリックで除外できます
            </p>
            <ModelPicker
              kind="tts"
              models={models}
              selected={selected}
              onChange={setSelected}
              configs={configs}
              onConfigChange={(k, c) => setConfigs((prev) => ({ ...prev, [k]: c }))}
            />
          </>
        )}

        <div className="transport">
          <button type="button" className="btn btn--primary" onClick={synthesize} disabled={selected.length === 0 || !text.trim()}>
            ▶ 合成 ({selected.length})
          </button>
          <button type="button" className="btn btn--ghost" onClick={playAll} disabled={cards.length === 0}>
            ⏯ 順次再生
          </button>
        </div>
      </div>

      {cards.length > 0 && (
        <>
          <div className="section-label">
            <span className="eyebrow">channels</span>
          </div>
          <div className="channels">
            {cards.map((c, i) => {
              const style = { '--ch': providerColor(c.provider), animationDelay: `${i * 60}ms` } as CSSProperties;
              const isFastest = c.modelKey === fastestKey;
              const player = playersRef.current[c.modelKey];
              return (
                <div
                  key={c.modelKey}
                  className={`channel${isFastest ? ' channel--fastest' : ''}${c.status === 'error' ? ' channel--error' : ''}`}
                  style={style}
                >
                  <div className="channel__head">
                    <span className="channel__dot" />
                    <span className="channel__provider">{c.providerLabel}</span>
                    {isFastest && <span className="channel__fastest-badge">fastest</span>}
                  </div>
                  <div className="channel__name">{c.label}</div>

                  <div className="channel__stage">
                    {c.status === 'error' ? (
                      <span className="channel__err">{c.error}</span>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="btn btn--icon"
                          disabled={c.status !== 'done'}
                          onClick={() => player?.play()}
                          aria-label="再生"
                          title="再生"
                        >
                          ▶
                        </button>
                        <Equalizer active={c.playing} />
                        <span className="channel__status">
                          {c.status === 'running' ? '合成中…' : '準備完了'}
                        </span>
                      </>
                    )}
                  </div>

                  <div className="readout">
                    <div className="readout__row">
                      <span className="readout__k">ttfb · server</span>
                      <span className="readout__v">
                        <b>{c.serverTtfbMs ?? '—'}</b>
                        <i>ms</i>
                      </span>
                    </div>
                    <div className="readout__row">
                      <span className="readout__k">ttfb · client</span>
                      <span className="readout__v">
                        {typeof c.clientTtfbMs === 'number' && c.clientTtfbMs >= 0 ? c.clientTtfbMs : '—'}
                        <i>ms</i>
                      </span>
                    </div>
                    <div className="readout__row">
                      <span className="readout__k">total</span>
                      <span className="readout__v">
                        {c.serverTotalMs ?? '—'}
                        <i>ms</i>
                      </span>
                    </div>
                    <div className="readout__row">
                      <span className="readout__k">size</span>
                      <span className="readout__v">
                        {c.bytes ? (c.bytes / 1024).toFixed(1) : '—'}
                        <i>KB</i>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {cards.filter((c) => typeof c.serverTtfbMs === 'number').length >= 2 && (
            <>
              <div className="section-label" style={{ marginTop: 28 }}>
                <span className="eyebrow">time to first byte</span>
              </div>
              <div className="panel ttfb">
                {cards
                  .filter((c) => typeof c.serverTtfbMs === 'number')
                  .sort((a, b) => (a.serverTtfbMs ?? 0) - (b.serverTtfbMs ?? 0))
                  .map((c) => {
                    const style = { '--ch': providerColor(c.provider) } as CSSProperties;
                    const isBest = c.modelKey === fastestKey;
                    return (
                      <div key={c.modelKey} className={`ttfb__row${isBest ? ' ttfb__row--best' : ''}`} style={style}>
                        <span className="ttfb__label">{c.label}</span>
                        <span className="ttfb__track">
                          <span className="ttfb__fill" style={{ width: `${((c.serverTtfbMs ?? 0) / maxTtfb) * 100}%` }} />
                        </span>
                        <span className="ttfb__val">{c.serverTtfbMs} ms</span>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </>
      )}

      <div ref={hostRef} aria-hidden="true" />
    </div>
  );
}
