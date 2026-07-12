import { NavLink, Route, Routes } from 'react-router-dom';
import TtsLabPage from './pages/TtsLabPage';
import SttLabPage from './pages/SttLabPage';

/** 上部コマンドバー内のオシロスコープ風ワードマーク */
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
