/** 再生中にアニメーションするイコライザ。色は親の --ch を継承する。 */
export default function Equalizer({ active }: { active: boolean }) {
  return (
    <div className={`eq${active ? ' eq--active' : ''}`} aria-hidden="true">
      {Array.from({ length: 7 }).map((_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}
