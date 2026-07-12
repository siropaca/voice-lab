import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ModelsResponse, VoiceSpec } from '@voice-lab/shared';
import { fetchModels, fetchVoices, streamTts } from '../lib/api';
import { MsePlayer } from '../lib/mse-player';
import { PcmPlayer } from '../lib/pcm-player';
import { providerColor } from '../lib/providers';
import { filterModelsByMode, MODE_METRIC, TTS_MODE_STORAGE_KEY, type TtsMode } from '../lib/ttsMode';
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

function initialMode(): TtsMode {
  return localStorage.getItem(TTS_MODE_STORAGE_KEY) === 'batch' ? 'batch' : 'streaming';
}

export default function TtsLabPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [mode, setMode] = useState<TtsMode>(initialMode);
  const [selectedByMode, setSelectedByMode] = useState<Record<TtsMode, string[]>>({ streaming: [], batch: [] });
  const [configs, setConfigs] = useState<Record<string, ModelConfig>>({});
  const [voicesByModel, setVoicesByModel] = useState<Record<string, VoiceSpec[]>>({});
  const [text, setText] = useState(PRESETS[0]);
  const [cards, setCards] = useState<CardState[]>([]);
  const playersRef = useRef<Record<string, MsePlayer | PcmPlayer>>({});
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchModels()
      .then((m) => {
        setModels(m);
        // 既定で各モードの全モデルを比較対象にする（アーム操作を不要にする）。
        setSelectedByMode({
          streaming: filterModelsByMode(m, 'streaming').available.map((x) => x.key),
          batch: filterModelsByMode(m, 'batch').available.map((x) => x.key),
        });
      })
      .catch(() => setModels({ available: [], unavailable: [] }));
    // 各プロバイダーから現在のボイス一覧を取得（失敗しても registry シードで動く）。
    fetchVoices()
      .then((v) => setVoicesByModel(v.voices))
      .catch(() => setVoicesByModel({}));
  }, []);

  const metric = MODE_METRIC[mode];
  const modeModels = useMemo(() => (models ? filterModelsByMode(models, mode) : null), [models, mode]);
  const selected = selectedByMode[mode];
  const setSelected = (keys: string[]) => setSelectedByMode((prev) => ({ ...prev, [mode]: keys }));

  const patch = (modelKey: string, p: Partial<CardState>) =>
    setCards((prev) => prev.map((c) => (c.modelKey === modelKey ? { ...c, ...p } : c)));

  // 実験はモードに紐づくため、モード切替時は結果とプレイヤーを片付ける。
  const switchMode = (next: TtsMode) => {
    if (next === mode) return;
    setMode(next);
    localStorage.setItem(TTS_MODE_STORAGE_KEY, next);
    setCards([]);
    if (hostRef.current) hostRef.current.innerHTML = '';
    playersRef.current = {};
  };

  const fastestKey = useMemo(() => {
    const done = cards.filter((c) => c.status === 'done' && typeof c[metric.key] === 'number');
    if (done.length < 2) return null;
    return done.reduce((a, b) => ((a[metric.key] ?? Infinity) <= (b[metric.key] ?? Infinity) ? a : b)).modelKey;
  }, [cards, metric.key]);

  const maxMetric = useMemo(() => Math.max(1, ...cards.map((c) => c[metric.key] ?? 0)), [cards, metric.key]);

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
      // PCM を返すモデル（Google Chirp 3 HD streaming）は Web Audio 再生、mp3 は MSE。
      const player = m.audioFormat === 'pcm16' ? new PcmPlayer(m.sampleRate ?? 24000) : new MsePlayer();
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

  if (!models || !modeModels) return <div className="loading">loading models…</div>;

  const modeAvailable = modeModels.available.length;

  return (
    <div>
      <Rail label="input" />
      <div className="panel console">
        <div className="segmented" role="tablist" aria-label="TTS 実験モード">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'streaming'}
            className={`segmented__opt${mode === 'streaming' ? ' is-on' : ''}`}
            onClick={() => switchMode('streaming')}
            title="逐次合成（最初の音までの遅延で比較）"
          >
            streaming
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'batch'}
            className={`segmented__opt${mode === 'batch' ? ' is-on' : ''}`}
            onClick={() => switchMode('batch')}
            title="一括合成（全文の合成時間で比較）"
          >
            batch
          </button>
        </div>
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
              title={`${mode} モードの選択モデルへ同時に合成する`}
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
        hint={modeAvailable > 0 ? `armed ${selected.length}/${modeAvailable} · クリックで除外` : undefined}
      />
      {modeAvailable === 0 ? (
        <div className="empty">
          <div className="empty__big">{mode} な TTS モデルがありません</div>
          <div>
            {mode === 'streaming'
              ? 'streaming 対応モデルのキーを server/.env に設定すると、ここに並びます。'
              : 'batch（非ストリーミング）モデルのキーを server/.env に設定すると、ここに並びます。'}
          </div>
        </div>
      ) : (
        <ModelPicker
          kind="tts"
          models={modeModels}
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
                      <span className="readout__k">{metric.label}</span>
                      <span className="readout__v">
                        <b>{c[metric.key] ?? '—'}</b>
                        <i>ms</i>
                      </span>
                    </div>
                    {mode === 'streaming' && (
                      <>
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
                      </>
                    )}
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

          {cards.filter((c) => typeof c[metric.key] === 'number').length >= 2 && (
            <>
              <Rail label={mode === 'streaming' ? 'ttfb' : '合成時間'} hint="server · 昇順" />
              <div className="panel ttfb">
                {cards
                  .filter((c) => typeof c[metric.key] === 'number')
                  .sort((a, b) => (a[metric.key] ?? 0) - (b[metric.key] ?? 0))
                  .map((c) => {
                    const style = { '--ch': providerColor(c.provider) } as CSSProperties;
                    const isBest = c.modelKey === fastestKey;
                    return (
                      <div key={c.modelKey} className={`ttfb__row${isBest ? ' ttfb__row--best' : ''}`} style={style}>
                        <span className="ttfb__label">{c.label}</span>
                        <span className="ttfb__track">
                          <span className="ttfb__fill" style={{ width: `${((c[metric.key] ?? 0) / maxMetric) * 100}%` }} />
                        </span>
                        <span className="ttfb__val">{c[metric.key]} ms</span>
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
