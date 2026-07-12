/** セクションを区切る目盛り付きレール。ラックの刻印ラベルの見立て。 */
export default function Rail({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="rail">
      <span className="rail__label">{label}</span>
      <span className="rail__ticks" aria-hidden="true" />
      {hint && <span className="rail__hint">{hint}</span>}
    </div>
  );
}
