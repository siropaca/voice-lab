import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { fetchModels } from './lib/api';
import TtsLabPage from './pages/TtsLabPage';
import SttLabPage from './pages/SttLabPage';

/** 上部ステータスバー内のオシロスコープ風ワードマーク */
function Wordmark() {
  return (
    <div className="wordmark">
      <svg className="wordmark__glyph" viewBox="0 0 30 20" aria-hidden="true">
        <path className="dim" d="M1 10 H29" />
        <path d="M1 10 h4 l2 -7 l3 14 l3 -11 l3 8 l2 -4 h8" />
      </svg>
      <div>
        <span className="wordmark__name">
          voice<b>·</b>lab
        </span>
        <span className="wordmark__sub">tts / stt bench</span>
      </div>
    </div>
  );
}

/** 利用可能モデル数の readout。稼働状況を LED で示す。 */
function StatusLine() {
  const [counts, setCounts] = useState<{ tts: number; stt: number } | null>(null);

  useEffect(() => {
    fetchModels()
      .then((m) =>
        setCounts({
          tts: m.available.filter((x) => x.kind === 'tts').length,
          stt: m.available.filter((x) => x.kind === 'stt').length,
        }),
      )
      .catch(() => setCounts({ tts: 0, stt: 0 }));
  }, []);

  const ready = counts !== null && counts.tts + counts.stt > 0;
  return (
    <div className="statusline" title="利用可能なモデル数">
      <span className={`statusline__led${ready ? '' : ' statusline__led--warn'}`} />
      {counts === null ? 'scanning…' : `tts ${counts.tts} · stt ${counts.stt}`}
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <Wordmark />
        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
            TTS
          </NavLink>
          <NavLink to="/stt" className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
            STT
          </NavLink>
        </nav>
        <StatusLine />
      </header>
      <main className="bench">
        <Routes>
          <Route path="/" element={<TtsLabPage />} />
          <Route path="/stt" element={<SttLabPage />} />
        </Routes>
      </main>
    </div>
  );
}
