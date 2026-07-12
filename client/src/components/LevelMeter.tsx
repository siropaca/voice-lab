const SEGMENTS = 28;

/** マイク入力の RMS レベル（0..1）を段階表示する VU メーター。 */
export default function LevelMeter({ level }: { level: number }) {
  const lit = Math.round(Math.min(1, level * 2.4) * SEGMENTS);
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
