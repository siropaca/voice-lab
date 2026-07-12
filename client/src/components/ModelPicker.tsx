import type { CSSProperties } from 'react';
import type { ModelEntry, ModelsResponse } from '@voice-lab/shared';
import { providerColor } from '../lib/providers';

export interface ModelConfig {
  voice: string;
  params: Record<string, string | number>;
}

/** モデル定義からデフォルトの設定（先頭 voice + 各パラメータの既定値）を作る。 */
export function defaultConfig(m: ModelEntry): ModelConfig {
  return {
    voice: m.voices?.[0]?.id ?? '',
    params: Object.fromEntries((m.params ?? []).map((p) => [p.name, p.defaultValue])),
  };
}

interface Props {
  kind: 'tts' | 'stt';
  models: ModelsResponse;
  selected: string[];
  onChange: (keys: string[]) => void;
  configs: Record<string, ModelConfig>;
  onConfigChange: (key: string, config: ModelConfig) => void;
}

/**
 * 比較に載せるモデルを選ぶ「アーム」グリッド。プロバイダー色でチャンネルを識別する。
 * 選択中のモデルには voice / パラメータの調整コントロールを展開する。
 */
export default function ModelPicker({ kind, models, selected, onChange, configs, onConfigChange }: Props) {
  const list = models.available.filter((m) => m.kind === kind);
  const unavailable = models.unavailable.filter((u) => u.kind === kind);

  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <div className="arm-grid">
      {list.map((m) => {
        const on = selected.includes(m.key);
        const cfg = configs[m.key] ?? defaultConfig(m);
        const style = { '--ch': providerColor(m.provider) } as CSSProperties;
        return (
          <div key={m.key} className={`arm${on ? ' arm--on' : ' arm--excluded'}`} style={style}>
            <button
              type="button"
              className="arm__top"
              onClick={() => toggle(m.key)}
              title={on ? '比較から除外する' : '比較に戻す'}
              style={{ all: 'unset', display: 'flex', alignItems: 'center', gap: 9, width: '100%', cursor: 'pointer' }}
            >
              <span className="arm__dot" />
              <span className="arm__provider">{m.providerLabel}</span>
              <span className="arm__check">{on ? '● 比較中' : '○ 除外中'}</span>
            </button>
            <div className="arm__name">{m.label}</div>
            <div className="arm__meta">
              <span className={m.streaming ? 'stream' : ''}>{m.streaming ? 'streaming' : 'batch'}</span>
              {m.voices && m.voices.length > 0 && <span>{m.voices.length} voices</span>}
            </div>
            {m.note && <div className="arm__note">{m.note}</div>}

            {on && (m.voices?.length || m.params?.length) ? (
              <div className="arm__controls">
                {m.voices && m.voices.length > 0 && (
                  <div className="ctl">
                    <label className="ctl__label" htmlFor={`voice-${m.key}`}>
                      voice
                    </label>
                    <select
                      id={`voice-${m.key}`}
                      value={cfg.voice}
                      onChange={(e) => onConfigChange(m.key, { ...cfg, voice: e.target.value })}
                    >
                      {m.voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {(m.params ?? []).map((p) => (
                  <div className="ctl" key={p.name}>
                    <label className="ctl__label" htmlFor={`p-${m.key}-${p.name}`}>
                      {p.label}
                    </label>
                    {p.type === 'select' ? (
                      <select
                        id={`p-${m.key}-${p.name}`}
                        value={String(cfg.params[p.name])}
                        onChange={(e) =>
                          onConfigChange(m.key, { ...cfg, params: { ...cfg.params, [p.name]: e.target.value } })
                        }
                      >
                        {(p.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : p.type === 'number' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          id={`p-${m.key}-${p.name}`}
                          type="range"
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          value={cfg.params[p.name]}
                          onChange={(e) =>
                            onConfigChange(m.key, { ...cfg, params: { ...cfg.params, [p.name]: Number(e.target.value) } })
                          }
                        />
                        <span className="ctl__num">{cfg.params[p.name]}</span>
                      </div>
                    ) : (
                      <input
                        id={`p-${m.key}-${p.name}`}
                        type="text"
                        value={String(cfg.params[p.name])}
                        onChange={(e) =>
                          onConfigChange(m.key, { ...cfg, params: { ...cfg.params, [p.name]: e.target.value } })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {unavailable.map((u) => (
        <div key={u.key} className="arm arm--off">
          <div className="arm__top">
            <span className="arm__dot" />
            <span className="arm__provider">unavailable</span>
          </div>
          <div className="arm__name">{u.label}</div>
          <div className="arm__meta">要 {u.missingEnv.join(', ')}</div>
        </div>
      ))}
    </div>
  );
}
