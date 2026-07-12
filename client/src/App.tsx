import { Link, Route, Routes } from 'react-router-dom';

export default function App() {
  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <nav style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <Link to="/">TTS Lab</Link>
        <Link to="/stt">STT Lab</Link>
        <Link to="/history">履歴</Link>
      </nav>
      <Routes>
        <Route path="/" element={<p>TTS Lab（未実装）</p>} />
        <Route path="/stt" element={<p>STT Lab（未実装）</p>} />
        <Route path="/history" element={<p>履歴（未実装）</p>} />
      </Routes>
    </div>
  );
}
