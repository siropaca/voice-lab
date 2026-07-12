const SEGMENTS = 28;

/** マイク入力の RMS レベル（0..1）を段階表示する VU メーター。
 * 実マイクの RMS は発話中でも 0.01〜0.1 程度と小さいため、平方根で知覚的にスケールし、
 * 控えめな音量でも段が点灯するようにする（線形だと静かな声でほぼ光らない）。 */
export default function LevelMeter({ level }: { level: number }) {
  const norm = Math.min(1, Math.sqrt(Math.max(0, level)) * 2.6);
  const lit = Math.round(norm * SEGMENTS);
  return (
    <div className="meter" aria-hidden="true">
      {Array.from({ length: SEGMENTS }).map((_, i) => {
        const on = i < lit;
        const zone = i > SEGMENTS * 0.85 ? ' hot' : i > SEGMENTS * 0.65 ? ' mid' : '';
        const height = 12 + (i / SEGMENTS) * 88;
        return <span key={i} className={on ? `on${zone}` : ''} style={{ height: `${height}%` }} />;
      })}
    </div>
  );
}
