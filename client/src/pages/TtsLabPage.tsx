import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ModelsResponse, VoiceSpec } from '@voice-lab/shared';
import { fetchModels, fetchVoices, streamTts } from '../lib/api';
import { MsePlayer } from '../lib/mse-player';
import { providerColor } from '../lib/providers';
import ModelPicker, { defaultConfig, type ModelConfig } from '../components/ModelPicker';
import Equalizer from '../components/Equalizer';
import Rail from '../components/Rail';

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
  const [voicesByModel, setVoicesByModel] = useState<Record<string, VoiceSpec[]>>({});
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
    // 各プロバイダーから現在のボイス一覧を取得（失敗しても registry シードで動く）。
    fetchVoices()
      .then((v) => setVoicesByModel(v.voices))
      .catch(() => setVoicesByModel({}));
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
      const cfg = configs[modelKey] ?? defaultConfig(m, voicesByModel[modelKey]);
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
      <Rail label="input" />
      <div className="panel console">
        <textarea
          className="field"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="読み上げる文章を入力…"
        />
        <div className="console__row">
          <div className="presets">
            {PRESETS.map((p, i) => (
              <button key={i} type="button" className="preset-chip" title={p} onClick={() => setText(p)}>
                P{i + 1}
              </button>
            ))}
          </div>
          <div className="transport">
            <button
              type="button"
              className="btn btn--primary"
              onClick={synthesize}
              disabled={selected.length === 0 || !text.trim()}
              title="選択中の全モデルへ同時に合成する"
            >
              ▶ run ({selected.length})
            </button>
            <button type="button" className="btn btn--ghost" onClick={playAll} disabled={cards.length === 0} title="全チャンネルを順番に再生する">
              ⏵⏵ seq
            </button>
          </div>
        </div>
      </div>

      <Rail
        label="models"
        hint={ttsAvailable > 0 ? `armed ${selected.length}/${ttsAvailable} · クリックで除外` : undefined}
      />
      {ttsAvailable === 0 ? (
        <div className="empty">
          <div className="empty__big">利用可能な TTS モデルがありません</div>
          <div>server/.env に API キーを設定すると、ここにモデルが並びます。</div>
        </div>
      ) : (
        <ModelPicker
          kind="tts"
          models={models}
          selected={selected}
          onChange={setSelected}
          configs={configs}
          onConfigChange={(k, c) => setConfigs((prev) => ({ ...prev, [k]: c }))}
          voicesByModel={voicesByModel}
        />
      )}

      {cards.length > 0 && (
        <>
          <Rail label="output" />
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
                          {c.status === 'running' ? 'running…' : 'ready'}
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
              <Rail label="ttfb" hint="server · 昇順" />
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
