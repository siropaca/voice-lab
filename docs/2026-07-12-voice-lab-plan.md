# voice-lab 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日本語 TTS/STT クラウド API を品質・レイテンシ・ストリーミング対応で並列比較する Web GUI（TTS Lab / STT Lab / 履歴）を作り、Cloud Run（東京）にデプロイする。

**Architecture:** pnpm workspace モノレポ。`client`（Vite + React SPA）と `server`（Hono + Node、WebSocket 中継）と `shared`（型定義のみ）。プロバイダー差異は TTSAdapter / STTAdapter に吸収し、モデル定義は `registry.ts` にモデル単位で集約。ブラウザ↔サーバーは TTS が NDJSON ストリーム、STT が WebSocket。

**Tech Stack:** TypeScript / pnpm workspace / Hono + @hono/node-server + @hono/node-ws / ws / Vite + React + react-router / vitest / @google-cloud/text-to-speech / @google-cloud/speech / Docker + Cloud Run

**Spec:** `docs/2026-07-12-voice-lab-design.md`

## Global Constraints

- Node 22+ / pnpm 9+ / TypeScript strict
- コーディング規約: 名前付き関数は `function` 宣言、コールバックはアロー関数、関数には JSDoc（React コンポーネントは除く）
- 音声パイプライン: ブラウザ→サーバーは **16kHz 16bit PCM mono**（プロバイダーが別レートを要求する場合はサーバー側アダプターで変換）
- モデル ID はスペック §3 の 2026-07-12 検証済みの値を使う。**各アダプター実装タスクの最初のステップで必ず公式ドキュメントを取得して API 仕様を確認する**（この領域は変化が速い）
- API キーは `server/.env` のみに置く。`data/` と `.env` は `.gitignore`
- 並列比較中の失敗はモデル単位で隔離（1モデルの失敗が他を壊さない）
- コミットは各タスク末尾で実施（ユーザーのコミット承認ルールに従う。実行開始時に包括承認を得ること）
- レジストリの単位はモデル。同一プロバイダー複数モデルの同時比較が常に可能であること

---

### Task 1: モノレポ雛形と dev サーバー

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `tsconfig.base.json`
- Create: `shared/package.json`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/index.ts`, `server/src/app.ts`
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/src/main.tsx`, `client/src/App.tsx`

**Interfaces:**
- Produces: `createApp(env: Record<string, string | undefined>)` → `{ app: Hono, injectWebSocket: (server) => void }`（以後の全サーバータスクがここにルートを足す）
- Produces: `pnpm dev` で client(5173, /api・/ws をサーバーへプロキシ) + server(3001) が起動

- [ ] **Step 1: ルート構成ファイルを作成**

`package.json`:

```json
{
  "name": "voice-lab",
  "private": true,
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"pnpm --filter server dev\" \"pnpm --filter client dev\"",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck"
  },
  "devDependencies": {
    "concurrently": "^9.1.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - client
  - server
  - shared
```

`.gitignore`:

```
node_modules/
dist/
data/
.env
.DS_Store
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 2: shared パッケージを作成**

`shared/package.json`:

```json
{
  "name": "@voice-lab/shared",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```

`shared/src/index.ts`（この時点では空エクスポート。Task 2 で型を足す）:

```ts
export {};
```

- [ ] **Step 3: server パッケージを作成**

`server/package.json`:

```json
{
  "name": "server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@hono/node-ws": "^1.0.4",
    "@voice-lab/shared": "workspace:*",
    "dotenv": "^16.4.0",
    "hono": "^4.6.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "scripts"]
}
```

`server/src/app.ts`:

```ts
import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';

/**
 * Hono アプリを組み立てる。env を注入できるようにしてテスト可能にする。
 */
export function createApp(env: Record<string, string | undefined>) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/api/health', (c) => c.json({ ok: true }));

  return { app, injectWebSocket, upgradeWebSocket };
}
```

`server/src/index.ts`:

```ts
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const { app, injectWebSocket } = createApp(process.env);
const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
```

- [ ] **Step 4: client パッケージを作成**

`client/package.json`:

```json
{
  "name": "client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@voice-lab/shared": "workspace:*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

`client/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
```

`client/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"] },
  "include": ["src"]
}
```

`client/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>voice-lab</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`client/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

`client/src/App.tsx`（ページは後続タスクで実装。まずナビだけ）:

```tsx
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
```

- [ ] **Step 5: インストールと起動確認**

Run: `pnpm install && pnpm dev` （数秒後に別ターミナルで）`curl -s localhost:3001/api/health`
Expected: `{"ok":true}`。ブラウザで http://localhost:5173 にナビ付きページが表示される。確認後 dev を停止。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "モノレポ雛形を追加（client/server/shared + dev サーバー）"
```

---

### Task 2: 共有型とモデルレジストリ（TDD）

**Files:**
- Modify: `shared/src/index.ts`
- Create: `server/src/registry.ts`
- Test: `server/test/registry.test.ts`

**Interfaces:**
- Produces（shared）:

```ts
export type ModelKind = 'tts' | 'stt';

export interface ParamSpec {
  name: string;                        // API に渡すキー
  label: string;                       // 表示名
  type: 'number' | 'select' | 'text';
  min?: number; max?: number; step?: number;
  options?: string[];
  defaultValue: string | number;
}

export interface VoiceSpec { id: string; label: string }

export interface ModelEntry {
  key: string;            // 例 "openai/gpt-4o-mini-tts"（provider/model 形式で一意）
  kind: ModelKind;
  provider: string;       // アダプター解決キー 例 "openai"
  providerLabel: string;  // 表示名 例 "OpenAI"
  model: string;          // プロバイダー API に渡すモデルID
  label: string;
  requiredEnv: string[];
  streaming: boolean;     // 逐次合成/逐次認識に対応しているか（比較表示に使う）
  audioFormat?: 'mp3' | 'pcm16';  // TTS のみ: クライアントへ流す形式
  sampleRate?: number;            // audioFormat が pcm16 のときのレート
  voices?: VoiceSpec[];           // TTS のみ
  params?: ParamSpec[];
  note?: string;          // GUI に出す注記（例 "英語最適化" ）
}

export interface UnavailableModel { key: string; label: string; missingEnv: string[] }

export interface ModelsResponse { available: ModelEntry[]; unavailable: UnavailableModel[] }
```

- Produces（server/src/registry.ts）: `MODELS: ModelEntry[]`（初期セット全モデル）と `filterAvailable(models: ModelEntry[], env: Record<string, string | undefined>): ModelsResponse`

- [ ] **Step 1: shared に上記の型をそのまま追加**（`export {};` を置き換える）

- [ ] **Step 2: 失敗するテストを書く** — `server/test/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ModelEntry } from '@voice-lab/shared';
import { MODELS, filterAvailable } from '../src/registry.js';

const stub = (over: Partial<ModelEntry>): ModelEntry => ({
  key: 'p/m', kind: 'tts', provider: 'p', providerLabel: 'P', model: 'm',
  label: 'M', requiredEnv: ['KEY_A'], streaming: true, ...over,
});

describe('filterAvailable', () => {
  it('必要な env が全て揃っているモデルだけ available になる', () => {
    const models = [
      stub({ key: 'a/1', requiredEnv: ['KEY_A'] }),
      stub({ key: 'b/1', requiredEnv: ['KEY_B'] }),
      stub({ key: 'c/1', requiredEnv: ['KEY_A', 'KEY_B'] }),
    ];
    const res = filterAvailable(models, { KEY_A: 'x' });
    expect(res.available.map((m) => m.key)).toEqual(['a/1']);
    expect(res.unavailable.map((u) => u.missingEnv)).toEqual([['KEY_B'], ['KEY_B']]);
  });

  it('空文字の env は未設定として扱う', () => {
    const res = filterAvailable([stub({})], { KEY_A: '' });
    expect(res.available).toHaveLength(0);
  });
});

describe('MODELS', () => {
  it('key が全モデルで一意', () => {
    const keys = MODELS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('初期セット: TTS 4プロバイダー / STT 4プロバイダーが登録されている', () => {
    const providers = (kind: string) => new Set(MODELS.filter((m) => m.kind === kind).map((m) => m.provider));
    expect(providers('tts')).toEqual(new Set(['openai', 'elevenlabs', 'google', 'aivis']));
    expect(providers('stt')).toEqual(new Set(['openai', 'elevenlabs', 'deepgram', 'google']));
  });
});
```

- [ ] **Step 3: テスト失敗を確認**

Run: `pnpm --filter server test`
Expected: FAIL（registry.js が存在しない）

- [ ] **Step 4: `server/src/registry.ts` を実装**

```ts
import type { ModelEntry, ModelsResponse } from '@voice-lab/shared';

/** 初期セットのモデル定義（スペック §3、2026-07-12 検証済み。実装時に公式ドキュメントで再確認すること） */
export const MODELS: ModelEntry[] = [
  // ---- TTS ----
  {
    key: 'openai/gpt-4o-mini-tts', kind: 'tts', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-mini-tts', label: 'gpt-4o-mini-tts', requiredEnv: ['OPENAI_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [
      { id: 'alloy', label: 'alloy' }, { id: 'nova', label: 'nova' },
      { id: 'shimmer', label: 'shimmer' }, { id: 'sage', label: 'sage' },
    ],
    params: [{ name: 'speed', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 }],
    note: '公式に英語最適化と明記。基準値用',
  },
  {
    key: 'elevenlabs/eleven_flash_v2_5', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_flash_v2_5', label: 'Flash v2.5（低遅延）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [], // Task 6 で /v1/voices から取得して埋める方針を決める
    params: [
      { name: 'stability', label: 'stability', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
      { name: 'similarity_boost', label: 'similarity', type: 'number', min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    ],
  },
  {
    key: 'elevenlabs/eleven_v3', kind: 'tts', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'eleven_v3', label: 'v3（品質重視）', requiredEnv: ['ELEVENLABS_API_KEY'],
    streaming: false, audioFormat: 'mp3', voices: [],
    note: 'リアルタイム非対応。品質比較用',
  },
  {
    key: 'google/gemini-2.5-flash-tts', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'gemini-2.5-flash-tts', label: 'Gemini 2.5 Flash TTS', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [{ id: 'Kore', label: 'Kore' }, { id: 'Puck', label: 'Puck' }],
    note: 'v1 は非ストリーミング実装（将来 gRPC streaming 化）',
  },
  {
    key: 'google/chirp3-hd', kind: 'tts', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp3-hd', label: 'Chirp 3 HD', requiredEnv: ['GOOGLE_CLOUD_PROJECT'],
    streaming: false, audioFormat: 'mp3',
    voices: [
      { id: 'ja-JP-Chirp3-HD-Aoede', label: 'Aoede' }, { id: 'ja-JP-Chirp3-HD-Charon', label: 'Charon' },
      { id: 'ja-JP-Chirp3-HD-Kore', label: 'Kore' }, { id: 'ja-JP-Chirp3-HD-Puck', label: 'Puck' },
    ],
    note: 'v1 は非ストリーミング実装（将来 gRPC streaming 化）',
  },
  {
    key: 'aivis/default', kind: 'tts', provider: 'aivis', providerLabel: 'Aivis Cloud',
    model: 'default', label: 'AivisSpeech', requiredEnv: ['AIVIS_API_KEY'],
    streaming: true, audioFormat: 'mp3',
    voices: [], // Task 7 で公式モデル UUID（コハク・まお等）を確認して埋める
    params: [
      { name: 'speaking_rate', label: '速度', type: 'number', min: 0.5, max: 2, step: 0.05, defaultValue: 1 },
      { name: 'emotional_intensity', label: '感情強度', type: 'number', min: 0, max: 2, step: 0.1, defaultValue: 1 },
    ],
  },
  // ---- STT ----
  {
    key: 'openai/gpt-realtime-whisper', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-realtime-whisper', label: 'gpt-realtime-whisper', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
  },
  {
    key: 'openai/gpt-4o-transcribe', kind: 'stt', provider: 'openai', providerLabel: 'OpenAI',
    model: 'gpt-4o-transcribe', label: 'gpt-4o-transcribe', requiredEnv: ['OPENAI_API_KEY'], streaming: true,
  },
  {
    key: 'deepgram/flux-general-multi', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'flux-general-multi', label: 'Flux Multilingual', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
    note: 'ターン検出内蔵',
  },
  {
    key: 'deepgram/nova-3', kind: 'stt', provider: 'deepgram', providerLabel: 'Deepgram',
    model: 'nova-3', label: 'Nova-3', requiredEnv: ['DEEPGRAM_API_KEY'], streaming: true,
  },
  {
    key: 'elevenlabs/scribe_v2_realtime', kind: 'stt', provider: 'elevenlabs', providerLabel: 'ElevenLabs',
    model: 'scribe_v2_realtime', label: 'Scribe v2 Realtime', requiredEnv: ['ELEVENLABS_API_KEY'], streaming: true,
  },
  {
    key: 'google/chirp_3', kind: 'stt', provider: 'google', providerLabel: 'Google Cloud',
    model: 'chirp_3', label: 'Chirp 3 (STT v2)', requiredEnv: ['GOOGLE_CLOUD_PROJECT'], streaming: true,
  },
];

/**
 * env に必要なキーが揃っているモデルと、揃っていないモデル（不足キー付き）に分ける。
 */
export function filterAvailable(
  models: ModelEntry[],
  env: Record<string, string | undefined>,
): ModelsResponse {
  const has = (k: string) => Boolean(env[k] && env[k] !== '');
  const available = models.filter((m) => m.requiredEnv.every(has));
  const unavailable = models
    .filter((m) => !m.requiredEnv.every(has))
    .map((m) => ({ key: m.key, label: `${m.providerLabel} ${m.label}`, missingEnv: m.requiredEnv.filter((k) => !has(k)) }));
  return { available, unavailable };
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter server test`
Expected: PASS（4テスト）

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "共有型とモデルレジストリを追加"
```

---

### Task 3: GET /api/models ルート（TDD）

**Files:**
- Create: `server/src/routes/models.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/models-route.test.ts`

**Interfaces:**
- Produces: `GET /api/models` → `ModelsResponse`（クライアントの ModelPicker が消費）

- [ ] **Step 1: 失敗するテストを書く** — `server/test/models-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /api/models', () => {
  it('env にあるキーのモデルだけ available で返す', async () => {
    const { app } = createApp({ OPENAI_API_KEY: 'x' });
    const res = await app.request('/api/models');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available.every((m: any) => m.requiredEnv.includes('OPENAI_API_KEY'))).toBe(true);
    expect(body.unavailable.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter server test`
Expected: FAIL（/api/models が 404）

- [ ] **Step 3: ルートを実装** — `server/src/routes/models.ts`:

```ts
import { Hono } from 'hono';
import { MODELS, filterAvailable } from '../registry.js';

/**
 * モデル一覧ルートを作る。
 */
export function modelsRoute(env: Record<string, string | undefined>) {
  const route = new Hono();
  route.get('/', (c) => c.json(filterAvailable(MODELS, env)));
  return route;
}
```

`server/src/app.ts` に追記（health の下）:

```ts
import { modelsRoute } from './routes/models.js';
// createApp 内:
app.route('/api/models', modelsRoute(env));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "GET /api/models ルートを追加"
```

---

### Task 4: TTS ルート骨格 — NDJSON ストリームとサーバー側計測（TDD）

**Files:**
- Create: `server/src/adapters/tts/types.ts`, `server/src/routes/tts.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/tts-route.test.ts`

**Interfaces:**
- Produces（adapters/tts/types.ts）:

```ts
export interface TTSRequest {
  text: string;
  model: string;                       // ModelEntry.model
  voice: string;
  params: Record<string, unknown>;
}

export interface TTSAdapter {
  synthesize(req: TTSRequest): AsyncIterable<Uint8Array>;
}

export type TTSAdapterResolver = (provider: string) => TTSAdapter;
```

- Produces（HTTP）: `POST /api/tts` body `{ modelKey, text, voice, params }` → NDJSON ストリーム。行の型（shared に追加）:

```ts
export type TtsStreamLine =
  | { type: 'chunk'; b64: string }
  | { type: 'metrics'; serverTtfbMs: number; serverTotalMs: number; bytes: number }
  | { type: 'error'; message: string }
  | { type: 'end' };
```

- Consumes: Task 2 の `MODELS`, `filterAvailable`

- [ ] **Step 1: shared に `TtsStreamLine` を追加**（上記のとおり）

- [ ] **Step 2: 失敗するテストを書く** — `server/test/tts-route.test.ts`。アダプターをフェイクに差し替えるため、`ttsRoute` はリゾルバーを注入できる形にする:

```ts
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { ttsRoute } from '../src/routes/tts.js';
import type { TTSAdapter } from '../src/adapters/tts/types.js';

const fake: TTSAdapter = {
  async *synthesize() {
    yield new Uint8Array([1, 2]);
    yield new Uint8Array([3]);
  },
};

const failing: TTSAdapter = {
  // eslint-disable-next-line require-yield
  async *synthesize() { throw new Error('boom'); },
};

/** NDJSON レスポンスを行オブジェクト配列にする */
async function readLines(res: Response) {
  const text = await res.text();
  return text.trim().split('\n').map((l) => JSON.parse(l));
}

function appWith(adapter: TTSAdapter) {
  const app = new Hono();
  app.route('/api/tts', ttsRoute(() => adapter));
  return app;
}

const body = JSON.stringify({ modelKey: 'openai/gpt-4o-mini-tts', text: 'こんにちは', voice: 'alloy', params: {} });
const post = { method: 'POST', headers: { 'content-type': 'application/json' }, body };

describe('POST /api/tts', () => {
  it('chunk → metrics → end の順で NDJSON を返す', async () => {
    const res = await appWith(fake).request('/api/tts', post);
    const lines = await readLines(res);
    expect(lines.map((l) => l.type)).toEqual(['chunk', 'chunk', 'metrics', 'end']);
    expect(lines[0].b64).toBe(Buffer.from([1, 2]).toString('base64'));
    expect(lines[2].bytes).toBe(3);
    expect(lines[2].serverTtfbMs).toBeGreaterThanOrEqual(0);
  });

  it('アダプターの例外は error 行になる', async () => {
    const res = await appWith(failing).request('/api/tts', post);
    const lines = await readLines(res);
    expect(lines.at(-1).type).toBe('error');
    expect(lines.at(-1).message).toContain('boom');
  });

  it('未知の modelKey は 404', async () => {
    const res = await appWith(fake).request('/api/tts', {
      ...post, body: JSON.stringify({ modelKey: 'nope/x', text: 'a', voice: 'v', params: {} }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: テスト失敗を確認**

Run: `pnpm --filter server test`
Expected: FAIL（tts.js が存在しない）

- [ ] **Step 4: `server/src/routes/tts.ts` を実装**

```ts
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import type { TtsStreamLine } from '@voice-lab/shared';
import { MODELS } from '../registry.js';
import type { TTSAdapterResolver } from '../adapters/tts/types.js';

/**
 * TTS 合成ルート。選択モデルのアダプターに委譲し、NDJSON でチャンクとメトリクスを流す。
 */
export function ttsRoute(resolve: TTSAdapterResolver) {
  const route = new Hono();

  route.post('/', async (c) => {
    const { modelKey, text, voice, params } = await c.req.json();
    const entry = MODELS.find((m) => m.key === modelKey && m.kind === 'tts');
    if (!entry) return c.json({ message: `unknown model: ${modelKey}` }, 404);

    return stream(c, async (s) => {
      const write = (line: TtsStreamLine) => s.write(JSON.stringify(line) + '\n');
      const start = performance.now();
      let ttfb: number | null = null;
      let bytes = 0;
      try {
        const adapter = resolve(entry.provider);
        for await (const chunk of adapter.synthesize({ text, model: entry.model, voice, params })) {
          if (ttfb === null) ttfb = performance.now() - start;
          bytes += chunk.byteLength;
          await write({ type: 'chunk', b64: Buffer.from(chunk).toString('base64') });
        }
        await write({
          type: 'metrics',
          serverTtfbMs: Math.round(ttfb ?? performance.now() - start),
          serverTotalMs: Math.round(performance.now() - start),
          bytes,
        });
        await write({ type: 'end' });
      } catch (err) {
        await write({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  return route;
}
```

`server/src/adapters/tts/types.ts` は Interfaces 節のとおり作成。

`server/src/app.ts` に本物のリゾルバーを組む（アダプター実装は Task 5〜8。それまで未実装プロバイダーは例外を投げる）:

```ts
import { ttsRoute } from './routes/tts.js';
import type { TTSAdapter } from './adapters/tts/types.js';

// createApp 内:
const ttsAdapters: Record<string, TTSAdapter> = {}; // Task 5〜8 で埋める
app.route(
  '/api/tts',
  ttsRoute((provider) => {
    const a = ttsAdapters[provider];
    if (!a) throw new Error(`TTS adapter not implemented: ${provider}`);
    return a;
  }),
);
```

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "TTS ルート骨格（NDJSON ストリーム + サーバー計測）を追加"
```

---

### Task 5: OpenAI TTS アダプター + 手動確認スクリプト

**Files:**
- Create: `server/src/adapters/tts/openai.ts`, `server/scripts/try-tts.ts`, `server/.env.example`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `TTSAdapter`（Task 4）
- Produces: `createOpenAiTts(env): TTSAdapter`。以後の TTS アダプターはすべて同じ `create<Provider>Tts(env)` 形式
- Produces: `pnpm --filter server exec tsx scripts/try-tts.ts <modelKey> "<text>"` → `out/<modelKey>.mp3` 生成（全 TTS アダプターの手動確認に使う）

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

context7 か WebFetch で https://developers.openai.com/api/docs/guides/text-to-speech を取得し、(a) エンドポイント `POST /v1/audio/speech`、(b) `response_format: "mp3"` のストリーミング挙動（chunked）、(c) `speed` パラメータ、(d) 利用可能 voice 一覧を確認。差分があればレジストリと以下のコードを直す。

- [ ] **Step 2: `server/src/adapters/tts/openai.ts` を実装**

```ts
import type { TTSAdapter, TTSRequest } from './types.js';

/**
 * OpenAI TTS アダプター。/v1/audio/speech の chunked レスポンスをそのまま流す。
 */
export function createOpenAiTts(env: Record<string, string | undefined>): TTSAdapter {
  return {
    async *synthesize(req: TTSRequest) {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: req.model,
          voice: req.voice,
          input: req.text,
          response_format: 'mp3',
          ...req.params,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`openai tts ${res.status}: ${await res.text()}`);
      }
      for await (const chunk of res.body) yield chunk as Uint8Array;
    },
  };
}
```

`server/src/app.ts` の `ttsAdapters` に登録:

```ts
import { createOpenAiTts } from './adapters/tts/openai.js';
const ttsAdapters: Record<string, TTSAdapter> = {
  openai: createOpenAiTts(env),
};
```

- [ ] **Step 3: 手動確認スクリプトを作成** — `server/scripts/try-tts.ts`:

```ts
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MODELS } from '../src/registry.js';
import { createOpenAiTts } from '../src/adapters/tts/openai.js';
import type { TTSAdapter } from '../src/adapters/tts/types.js';

const adapters: Record<string, (env: NodeJS.ProcessEnv) => TTSAdapter> = {
  openai: createOpenAiTts,
  // 以後のタスクで elevenlabs / aivis / google を追加
};

/**
 * 使い方: tsx scripts/try-tts.ts openai/gpt-4o-mini-tts "こんにちは、音声テストです"
 */
async function main() {
  const [modelKey, text] = process.argv.slice(2);
  const entry = MODELS.find((m) => m.key === modelKey && m.kind === 'tts');
  if (!entry || !text) throw new Error('usage: try-tts.ts <modelKey> <text>');
  const adapter = adapters[entry.provider](process.env);
  const started = performance.now();
  let ttfb: number | null = null;
  const chunks: Uint8Array[] = [];
  for await (const c of adapter.synthesize({
    text, model: entry.model, voice: entry.voices?.[0]?.id ?? '', params: {},
  })) {
    if (ttfb === null) ttfb = performance.now() - started;
    chunks.push(c);
  }
  mkdirSync('out', { recursive: true });
  const file = `out/${modelKey.replace('/', '_')}.mp3`;
  writeFileSync(file, Buffer.concat(chunks));
  console.log(`${file} (${chunks.reduce((n, c) => n + c.byteLength, 0)} bytes, TTFB ${Math.round(ttfb!)}ms)`);
}

main();
```

`server/.env.example`:

```
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
DEEPGRAM_API_KEY=
AIVIS_API_KEY=
GOOGLE_APPLICATION_CREDENTIALS=
GOOGLE_CLOUD_PROJECT=
GOOGLE_SPEECH_LOCATION=us
```

（注: Google モデルの available 判定は `GOOGLE_CLOUD_PROJECT` で行う。ローカルでは `GOOGLE_APPLICATION_CREDENTIALS` にサービスアカウント JSON のパスも設定する。Cloud Run では ADC が使われるためプロジェクト ID のみでよい）

`server/.gitignore` に `out/` を追加（1行のファイルを新規作成）。

- [ ] **Step 4: 手動確認（OPENAI_API_KEY が server/.env にある前提）**

Run: `cd server && pnpm exec tsx scripts/try-tts.ts openai/gpt-4o-mini-tts "こんにちは、音声テストです"`
Expected: `out/openai_gpt-4o-mini-tts.mp3` が生成され TTFB が表示される。ファイルを再生して日本語音声を確認。キー未設定ならこのステップはスキップし、キー取得後に必ず戻って確認。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "OpenAI TTS アダプターと手動確認スクリプトを追加"
```

---

### Task 6: ElevenLabs TTS アダプター

**Files:**
- Create: `server/src/adapters/tts/elevenlabs.ts`
- Modify: `server/src/app.ts`, `server/scripts/try-tts.ts`, `server/src/registry.ts`

**Interfaces:**
- Produces: `createElevenLabsTts(env): TTSAdapter`

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://elevenlabs.io/docs/api-reference/text-to-speech/convert-as-stream を確認: (a) `POST /v1/text-to-speech/{voice_id}/stream?output_format=mp3_44100_128`、(b) ヘッダー `xi-api-key`、(c) body `{ text, model_id, voice_settings }`、(d) 日本語向け `language_code` の要否。また https://elevenlabs.io/docs/api-reference/voices で日本語向きの voice_id を2つ選び、レジストリの `elevenlabs/*` 両モデルの `voices` に `{ id, label }` で記入する（マルチリンガル voice なら共通でよい）。

- [ ] **Step 2: `server/src/adapters/tts/elevenlabs.ts` を実装**

```ts
import type { TTSAdapter, TTSRequest } from './types.js';

/**
 * ElevenLabs TTS アダプター。/stream エンドポイントの chunked mp3 を流す。
 * voice_settings 系パラメータは params から拾う。
 */
export function createElevenLabsTts(env: Record<string, string | undefined>): TTSAdapter {
  return {
    async *synthesize(req: TTSRequest) {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${req.voice}/stream?output_format=mp3_44100_128`;
      const { stability, similarity_boost, ...rest } = req.params as Record<string, number>;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'content-type': 'application/json' },
        body: JSON.stringify({
          text: req.text,
          model_id: req.model,
          voice_settings: { stability, similarity_boost },
          ...rest,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`elevenlabs tts ${res.status}: ${await res.text()}`);
      }
      for await (const chunk of res.body) yield chunk as Uint8Array;
    },
  };
}
```

`app.ts` の `ttsAdapters` と `try-tts.ts` の `adapters` に `elevenlabs: createElevenLabsTts` を追加。

- [ ] **Step 3: 手動確認**

Run: `cd server && pnpm exec tsx scripts/try-tts.ts elevenlabs/eleven_flash_v2_5 "こんにちは、音声テストです"` と `... elevenlabs/eleven_v3 "..."`
Expected: mp3 が生成・再生できる。TTFB の目安: flash_v2_5 は数百ms、v3 は秒単位でも正常。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "ElevenLabs TTS アダプターを追加"
```

---

### Task 7: Aivis Cloud TTS アダプター

**Files:**
- Create: `server/src/adapters/tts/aivis.ts`
- Modify: `server/src/app.ts`, `server/scripts/try-tts.ts`, `server/src/registry.ts`

**Interfaces:**
- Produces: `createAivisTts(env): TTSAdapter`

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://aivis-project.com/cloud-api/ から API ドキュメントを辿り、(a) 合成エンドポイントのパスと認証ヘッダー形式（Bearer 想定）、(b) ストリーミングレスポンスの形式と `output_format: "mp3"` 指定方法、(c) `model_uuid` の指定方法、(d) 公式モデル（コハク・まお等）の UUID を確認。**確認した UUID をレジストリ `aivis/default` の `voices` に記入**（voice = model_uuid として扱う）。以下のコードのエンドポイント・フィールド名を実仕様に合わせて修正する。

- [ ] **Step 2: `server/src/adapters/tts/aivis.ts` を実装**（フィールド名は Step 1 の確認結果を正とする）

```ts
import type { TTSAdapter, TTSRequest } from './types.js';

/**
 * Aivis Cloud TTS アダプター。voice には AivisHub のモデル UUID を渡す。
 */
export function createAivisTts(env: Record<string, string | undefined>): TTSAdapter {
  return {
    async *synthesize(req: TTSRequest) {
      const res = await fetch('https://api.aivis-project.com/v1/tts/synthesize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AIVIS_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model_uuid: req.voice,
          text: req.text,
          output_format: 'mp3',
          ...req.params,
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(`aivis tts ${res.status}: ${await res.text()}`);
      }
      for await (const chunk of res.body) yield chunk as Uint8Array;
    },
  };
}
```

`app.ts` と `try-tts.ts` に `aivis: createAivisTts` を追加。

- [ ] **Step 3: 手動確認**

Run: `cd server && pnpm exec tsx scripts/try-tts.ts aivis/default "こんにちは、音声テストです"`
Expected: mp3 生成・再生 OK。ストリーミング対応なので TTFB は 1秒未満が目安。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "Aivis Cloud TTS アダプターを追加"
```

---

### Task 8: Google Cloud TTS アダプター（v1 は非ストリーミング）

**Files:**
- Create: `server/src/adapters/tts/google.ts`
- Modify: `server/src/app.ts`, `server/scripts/try-tts.ts`, `server/package.json`

**Interfaces:**
- Produces: `createGoogleTts(env): TTSAdapter`（`synthesize` は音声全体を1チャンクで yield。streaming:false のためメトリクス上 TTFB ≒ 総時間となるのは仕様どおり）

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://docs.cloud.google.com/text-to-speech/docs/gemini-tts と https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd を確認: (a) Gemini-TTS の `model` 指定と voice 名（Kore 等）の渡し方（`voice.model_name` + `voice.name`）、(b) Chirp 3 HD の voice 名形式 `ja-JP-Chirp3-HD-*`、(c) `audioEncoding: MP3`。相違があればレジストリとコードを直す。

- [ ] **Step 2: 依存を追加**

Run: `pnpm --filter server add @google-cloud/text-to-speech`

- [ ] **Step 3: `server/src/adapters/tts/google.ts` を実装**

```ts
import textToSpeech from '@google-cloud/text-to-speech';
import type { TTSAdapter, TTSRequest } from './types.js';

/**
 * Google Cloud TTS アダプター。v1 は synthesizeSpeech（非ストリーミング）で
 * Gemini-TTS / Chirp 3 HD の両方をカバーする。
 * - model が 'chirp3-hd' のとき: voice 名（ja-JP-Chirp3-HD-*）のみで指定
 * - それ以外（gemini-*-tts）: modelName + voice 名で指定
 */
export function createGoogleTts(env: Record<string, string | undefined>): TTSAdapter {
  const client = new textToSpeech.TextToSpeechClient();
  return {
    async *synthesize(req: TTSRequest) {
      const isChirp = req.model === 'chirp3-hd';
      const [res] = await client.synthesizeSpeech({
        input: { text: req.text },
        voice: {
          languageCode: 'ja-JP',
          name: req.voice,
          ...(isChirp ? {} : { modelName: req.model }),
        },
        audioConfig: { audioEncoding: 'MP3' },
      });
      if (!res.audioContent) throw new Error('google tts: empty audioContent');
      yield res.audioContent as Uint8Array;
    },
  };
}
```

`app.ts` と `try-tts.ts` に `google: createGoogleTts` を追加。

- [ ] **Step 4: 手動確認（server/.env に GOOGLE_APPLICATION_CREDENTIALS＝サービスアカウント JSON のパス、GOOGLE_CLOUD_PROJECT＝プロジェクト ID を設定した前提）**

Run: `cd server && pnpm exec tsx scripts/try-tts.ts google/chirp3-hd "こんにちは、音声テストです"` と `... google/gemini-2.5-flash-tts "..."`
Expected: mp3 生成・再生 OK。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Google Cloud TTS アダプターを追加"
```

---

### Task 9: クライアント基盤 — API クライアントと PCM ユーティリティ（TDD）

**Files:**
- Create: `client/src/lib/pcm.ts`, `client/src/lib/api.ts`
- Test: `client/src/lib/pcm.test.ts`

**Interfaces:**
- Produces（pcm.ts）:

```ts
export function floatTo16BitPcm(input: Float32Array): Int16Array;
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array;
```

- Produces（api.ts）:

```ts
export function fetchModels(): Promise<ModelsResponse>;
/** POST /api/tts を読み、行ごとにコールバック。クライアント TTFB も計測して返す */
export function streamTts(
  req: { modelKey: string; text: string; voice: string; params: Record<string, unknown> },
  onLine: (line: TtsStreamLine) => void,
): Promise<{ clientTtfbMs: number }>;
```

- [ ] **Step 1: 失敗するテストを書く** — `client/src/lib/pcm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { downsample, floatTo16BitPcm } from './pcm';

describe('floatTo16BitPcm', () => {
  it('-1..1 を int16 範囲へ変換し、範囲外はクランプする', () => {
    const out = floatTo16BitPcm(new Float32Array([0, 1, -1, 2, -2]));
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});

describe('downsample', () => {
  it('48kHz→16kHz で長さが 1/3 になる', () => {
    const out = downsample(new Float32Array(4800), 48000, 16000);
    expect(out.length).toBe(1600);
  });
  it('同一レートはそのまま返す', () => {
    const src = new Float32Array([0.1, 0.2]);
    expect(downsample(src, 16000, 16000)).toBe(src);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter client test`
Expected: FAIL（pcm が存在しない）

- [ ] **Step 3: `client/src/lib/pcm.ts` を実装**

```ts
/**
 * Float32 サンプル列（-1..1）を 16bit PCM に変換する。範囲外はクランプ。
 */
export function floatTo16BitPcm(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/**
 * 平均化による単純ダウンサンプリング。inRate は outRate の倍数でなくてもよい。
 */
export function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start || 1);
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter client test`
Expected: PASS

- [ ] **Step 5: `client/src/lib/api.ts` を実装**（純粋なネットワーク層なので自動テストなし）

```ts
import type { ModelsResponse, TtsStreamLine } from '@voice-lab/shared';

/** GET /api/models */
export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch('/api/models');
  if (!res.ok) throw new Error(`models: ${res.status}`);
  return res.json();
}

/**
 * POST /api/tts の NDJSON を逐次読み、クライアント側 TTFB（最初の chunk 行まで）を計測する。
 */
export async function streamTts(
  req: { modelKey: string; text: string; voice: string; params: Record<string, unknown> },
  onLine: (line: TtsStreamLine) => void,
): Promise<{ clientTtfbMs: number }> {
  const started = performance.now();
  let clientTtfbMs = -1;
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok || !res.body) throw new Error(`tts: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      if (!raw.trim()) continue;
      const line: TtsStreamLine = JSON.parse(raw);
      if (line.type === 'chunk' && clientTtfbMs < 0) clientTtfbMs = performance.now() - started;
      onLine(line);
    }
  }
  return { clientTtfbMs: Math.round(clientTtfbMs) };
}
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "クライアント基盤（PCM ユーティリティ / API クライアント）を追加"
```

---

### Task 10: TTS Lab ページ

**Files:**
- Create: `client/src/lib/mse-player.ts`, `client/src/components/ModelPicker.tsx`, `client/src/pages/TtsLabPage.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `fetchModels` / `streamTts`（Task 9）、`ModelsResponse`（Task 2）
- Produces（mse-player.ts）:

```ts
/** MSE で mp3 チャンクを逐次再生するプレイヤー */
export class MsePlayer {
  constructor();               // 内部で <audio> と MediaSource を作る
  appendChunk(b64: string): void;
  endOfStream(): void;
  play(): Promise<void>;
  reset(): void;
  readonly audioEl: HTMLAudioElement;  // カード内に表示する
}
```

- Produces（ModelPicker）: `<ModelPicker kind="tts" models={ModelsResponse} selected={string[]} onChange={(keys)=>void} configs={Record<key,{voice,params}>} onConfigChange={...} />` — provider ごとにグルーピングした複数チェック + モデルごとの voice セレクト / params 入力（ParamSpec から動的生成）。unavailable モデルはグレーアウトし不足 env 名を表示。STT Lab（Task 16）でも再利用する

- [ ] **Step 1: `client/src/lib/mse-player.ts` を実装**

```ts
/**
 * mp3 の NDJSON チャンクを MediaSource に流し込む逐次再生プレイヤー。
 * appendChunk はキューイングし、SourceBuffer の updateend で順次 append する。
 */
export class MsePlayer {
  readonly audioEl: HTMLAudioElement;
  private mediaSource = new MediaSource();
  private sourceBuffer: SourceBuffer | null = null;
  private queue: Uint8Array[] = [];
  private ended = false;

  constructor() {
    this.audioEl = document.createElement('audio');
    this.audioEl.controls = true;
    this.audioEl.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', () => {
      this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
      this.sourceBuffer.addEventListener('updateend', () => this.pump());
      this.pump();
    });
  }

  appendChunk(b64: string) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.queue.push(bytes);
    this.pump();
  }

  endOfStream() {
    this.ended = true;
    this.pump();
  }

  async play() {
    await this.audioEl.play();
  }

  reset() {
    this.audioEl.pause();
    this.audioEl.removeAttribute('src');
  }

  private pump() {
    if (!this.sourceBuffer || this.sourceBuffer.updating) return;
    const next = this.queue.shift();
    if (next) {
      this.sourceBuffer.appendBuffer(next);
    } else if (this.ended && this.mediaSource.readyState === 'open') {
      this.mediaSource.endOfStream();
    }
  }
}
```

- [ ] **Step 2: `client/src/components/ModelPicker.tsx` を実装**

```tsx
import type { ModelEntry, ModelsResponse } from '@voice-lab/shared';

export interface ModelConfig { voice: string; params: Record<string, string | number> }

interface Props {
  kind: 'tts' | 'stt';
  models: ModelsResponse;
  selected: string[];
  onChange: (keys: string[]) => void;
  configs: Record<string, ModelConfig>;
  onConfigChange: (key: string, config: ModelConfig) => void;
}

export function defaultConfig(m: ModelEntry): ModelConfig {
  return {
    voice: m.voices?.[0]?.id ?? '',
    params: Object.fromEntries((m.params ?? []).map((p) => [p.name, p.defaultValue])),
  };
}

export default function ModelPicker({ kind, models, selected, onChange, configs, onConfigChange }: Props) {
  const list = models.available.filter((m) => m.kind === kind);
  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {list.map((m) => {
        const checked = selected.includes(m.key);
        const cfg = configs[m.key] ?? defaultConfig(m);
        return (
          <div key={m.key} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 8, minWidth: 220 }}>
            <label style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(m.key)} />
              {m.providerLabel} / {m.label}
            </label>
            <div style={{ fontSize: 12, color: '#666' }}>
              {m.streaming ? 'ストリーミング対応' : '非ストリーミング'}
              {m.note ? ` — ${m.note}` : ''}
            </div>
            {checked && m.voices && m.voices.length > 0 && (
              <select
                value={cfg.voice}
                onChange={(e) => onConfigChange(m.key, { ...cfg, voice: e.target.value })}
              >
                {m.voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            )}
            {checked && (m.params ?? []).map((p) => (
              <div key={p.name} style={{ fontSize: 12 }}>
                <label>
                  {p.label}:{' '}
                  {p.type === 'select' ? (
                    <select
                      value={String(cfg.params[p.name])}
                      onChange={(e) => onConfigChange(m.key, { ...cfg, params: { ...cfg.params, [p.name]: e.target.value } })}
                    >
                      {(p.options ?? []).map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={p.type}
                      min={p.min} max={p.max} step={p.step}
                      value={cfg.params[p.name]}
                      style={{ width: 64 }}
                      onChange={(e) =>
                        onConfigChange(m.key, {
                          ...cfg,
                          params: { ...cfg.params, [p.name]: p.type === 'number' ? Number(e.target.value) : e.target.value },
                        })
                      }
                    />
                  )}
                </label>
              </div>
            ))}
          </div>
        );
      })}
      {models.unavailable.map((u) => (
        <div key={u.key} style={{ border: '1px dashed #ccc', borderRadius: 8, padding: 8, color: '#999', minWidth: 220 }}>
          {u.label}
          <div style={{ fontSize: 12 }}>要 {u.missingEnv.join(', ')}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `client/src/pages/TtsLabPage.tsx` を実装**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ModelsResponse } from '@voice-lab/shared';
import { fetchModels, streamTts } from '../lib/api';
import { MsePlayer } from '../lib/mse-player';
import ModelPicker, { defaultConfig, type ModelConfig } from '../components/ModelPicker';

const PRESETS = [
  '本日はインタビューにご協力いただきありがとうございます。まずは自己紹介をお願いできますか？',
  'なるほど、その経験についてもう少し詳しく教えてください。特に苦労した点はどこでしたか？',
  'それでは最後の質問です。今後挑戦してみたいことがあれば教えてください。',
];

interface CardState {
  modelKey: string;
  status: 'running' | 'done' | 'error';
  error?: string;
  serverTtfbMs?: number;
  serverTotalMs?: number;
  clientTtfbMs?: number;
  bytes?: number;
}

export default function TtsLabPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, ModelConfig>>({});
  const [text, setText] = useState(PRESETS[0]);
  const [cards, setCards] = useState<CardState[]>([]);
  const playersRef = useRef<Record<string, MsePlayer>>({});
  const cardHostRef = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    fetchModels().then(setModels);
  }, []);

  const patchCard = (modelKey: string, patch: Partial<CardState>) =>
    setCards((prev) => prev.map((c) => (c.modelKey === modelKey ? { ...c, ...patch } : c)));

  const synthesize = () => {
    setCards(selected.map((modelKey) => ({ modelKey, status: 'running' })));
    playersRef.current = {};
    for (const modelKey of selected) {
      const m = models!.available.find((x) => x.key === modelKey)!;
      const cfg = configs[modelKey] ?? defaultConfig(m);
      const player = new MsePlayer();
      playersRef.current[modelKey] = player;
      // audio 要素をカードにぶら下げる（描画後に ref 経由で append）
      setTimeout(() => cardHostRef.current[modelKey]?.appendChild(player.audioEl), 0);
      streamTts({ modelKey, text, voice: cfg.voice, params: cfg.params }, (line) => {
        if (line.type === 'chunk') player.appendChunk(line.b64);
        if (line.type === 'metrics') patchCard(modelKey, { serverTtfbMs: line.serverTtfbMs, serverTotalMs: line.serverTotalMs, bytes: line.bytes });
        if (line.type === 'error') patchCard(modelKey, { status: 'error', error: line.message });
        if (line.type === 'end') { player.endOfStream(); patchCard(modelKey, { status: 'done' }); }
      })
        .then(({ clientTtfbMs }) => patchCard(modelKey, { clientTtfbMs }))
        .catch((e) => patchCard(modelKey, { status: 'error', error: String(e) }));
    }
  };

  const playAll = async () => {
    for (const key of selected) {
      const player = playersRef.current[key];
      if (!player) continue;
      await player.play();
      await new Promise((r) => player.audioEl.addEventListener('ended', r, { once: true }));
    }
  };

  if (!models) return <p>loading...</p>;
  return (
    <div>
      <h2>TTS Lab</h2>
      <div style={{ marginBottom: 8 }}>
        {PRESETS.map((p, i) => (
          <button key={i} onClick={() => setText(p)} style={{ marginRight: 4 }}>プリセット{i + 1}</button>
        ))}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} style={{ width: '100%' }} />
      <ModelPicker
        kind="tts" models={models} selected={selected} onChange={setSelected}
        configs={configs} onConfigChange={(k, c) => setConfigs((prev) => ({ ...prev, [k]: c }))}
      />
      <button onClick={synthesize} disabled={selected.length === 0} style={{ margin: '12px 0', fontSize: 16 }}>
        合成
      </button>
      <button onClick={playAll} disabled={cards.length === 0} style={{ marginLeft: 8 }}>
        ▶ 順次再生
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {cards.map((c) => (
          <div key={c.modelKey} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, minWidth: 280 }}>
            <strong>{c.modelKey}</strong>
            <div ref={(el) => { cardHostRef.current[c.modelKey] = el; }} />
            {c.status === 'error' && <p style={{ color: 'red' }}>{c.error}</p>}
            <table style={{ fontSize: 12 }}>
              <tbody>
                <tr><td>TTFB(server)</td><td>{c.serverTtfbMs ?? '-'} ms</td></tr>
                <tr><td>TTFB(client)</td><td>{c.clientTtfbMs ?? '-'} ms</td></tr>
                <tr><td>total(server)</td><td>{c.serverTotalMs ?? '-'} ms</td></tr>
                <tr><td>bytes</td><td>{c.bytes ?? '-'}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
```

`client/src/App.tsx` のルートを差し替え: `<Route path="/" element={<TtsLabPage />} />`（import 追加）。

- [ ] **Step 4: 手動確認**

Run: `pnpm dev` → http://localhost:5173
Expected: キー設定済みモデルが選択でき、複数選択で「合成」→ カードが並び、音声がストリーミング再生され、TTFB(server/client)・total・bytes が埋まる。1モデルを意図的に失敗させ（例: 一時的に .env のキーを壊す）、他モデルの結果が生きることを確認。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "TTS Lab ページを追加"
```

---

### Task 11: STT ファンアウトと WS ルート骨格（TDD）

**Files:**
- Create: `server/src/adapters/stt/types.ts`, `server/src/stt-fanout.ts`, `server/src/audio.ts`, `server/src/routes/stt-ws.ts`
- Modify: `shared/src/index.ts`, `server/src/app.ts`
- Test: `server/test/stt-fanout.test.ts`, `server/test/audio.test.ts`

**Interfaces:**
- Produces（shared に追加）:

```ts
export interface SttModelSummary {
  partials: number;
  finals: number;
  finalDelayMs: number | null;   // stop 後、最後の final までの遅延（final が stop 前なら 0）
  transcript: string;            // final の連結
}

export type SttServerMessage =
  | { type: 'ready'; models: string[] }
  | { type: 'partial' | 'final'; modelKey: string; text: string; at: number }
  | { type: 'error'; modelKey: string; message: string }
  | { type: 'summary'; stoppedAt: number; models: Record<string, SttModelSummary> };
```

- Produces（adapters/stt/types.ts）:

```ts
export interface SttSession {
  sendAudio(chunk: Uint8Array): void;   // 16kHz 16bit PCM mono
  close(): void;                        // 入力終了をプロバイダーへ通知
}

export interface STTAdapter {
  startSession(opts: {
    model: string;
    params: Record<string, unknown>;
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (err: Error) => void;
  }): SttSession;
}

export type STTAdapterResolver = (provider: string) => STTAdapter;
```

- Produces（stt-fanout.ts）: `class SttFanout` — 1 つのマイク入力を複数モデルのセッションへ配信し、イベントに受信時刻を打刻して emit、`stop()` で要約を出す
- Produces（audio.ts）: `resamplePcm16(input: Int16Array, inRate: number, outRate: number): Int16Array`（線形補間。OpenAI 用 16k→24k と検証スクリプト用 24k→16k の両方に使う）と `pcm16ToWav(pcm: Int16Array, sampleRate: number): Buffer`
- Produces（WS）: `GET /ws/stt?models=key1,key2` — バイナリ = 音声、テキスト `{"type":"stop","note"?:string}` = 停止。サーバー→クライアントは `SttServerMessage` の JSON

- [ ] **Step 1: shared に上記メッセージ型を追加し、失敗するテストを書く**

`server/test/audio.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pcm16ToWav, resamplePcm16 } from '../src/audio.js';

describe('resamplePcm16', () => {
  it('16k→24k で長さが 1.5 倍になる', () => {
    expect(resamplePcm16(new Int16Array(1600), 16000, 24000).length).toBe(2400);
  });
  it('一定値の信号は値が保存される', () => {
    const out = resamplePcm16(new Int16Array(100).fill(1000), 16000, 24000);
    expect(out.every((v) => v === 1000)).toBe(true);
  });
  it('同一レートはそのまま返す', () => {
    const src = new Int16Array([1, 2, 3]);
    expect(resamplePcm16(src, 16000, 16000)).toBe(src);
  });
});

describe('pcm16ToWav', () => {
  it('44 バイトヘッダー + データ長になり RIFF マジックを持つ', () => {
    const wav = pcm16ToWav(new Int16Array(8), 16000);
    expect(wav.length).toBe(44 + 16);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(16000);
  });
});
```

`server/test/stt-fanout.test.ts`（フェイクアダプターで partial/final/error/summary を検証）:

```ts
import { describe, expect, it } from 'vitest';
import type { SttServerMessage } from '@voice-lab/shared';
import { SttFanout } from '../src/stt-fanout.js';
import type { STTAdapter } from '../src/adapters/stt/types.js';

/** onPartial/onFinal を外から叩けるフェイク */
function fakeAdapter() {
  const handlers: any[] = [];
  const adapter: STTAdapter = {
    startSession(opts) {
      handlers.push(opts);
      return { sendAudio: () => {}, close: () => {} };
    },
  };
  return { adapter, handlers };
}

const entries = [
  { key: 'a/1', provider: 'a', model: '1' },
  { key: 'b/1', provider: 'b', model: '1' },
] as any[];

describe('SttFanout', () => {
  it('イベントを modelKey 付きで emit し、summary に集計する', async () => {
    const { adapter, handlers } = fakeAdapter();
    const messages: SttServerMessage[] = [];
    let now = 0;
    const fanout = new SttFanout(entries, () => adapter, (m) => messages.push(m), () => now);

    handlers[0].onPartial('こん');
    now = 100;
    handlers[0].onFinal('こんにちは');
    handlers[1].onFinal('今日は');
    now = 500;
    await fanout.stop(0);

    expect(messages.filter((m) => m.type === 'partial')).toHaveLength(1);
    const summary = messages.at(-1) as Extract<SttServerMessage, { type: 'summary' }>;
    expect(summary.models['a/1']).toEqual({ partials: 1, finals: 1, finalDelayMs: 0, transcript: 'こんにちは' });
    expect(summary.stoppedAt).toBe(500);
  });

  it('stop 後に届いた final は finalDelayMs に反映される', async () => {
    const { adapter, handlers } = fakeAdapter();
    const messages: SttServerMessage[] = [];
    let now = 0;
    const fanout = new SttFanout(entries.slice(0, 1), () => adapter, (m) => messages.push(m), () => now);
    now = 1000;
    const stopping = fanout.stop(50); // grace 50ms
    now = 1200;
    handlers[0].onFinal('遅れて確定');
    await stopping;
    const summary = messages.at(-1) as Extract<SttServerMessage, { type: 'summary' }>;
    expect(summary.models['a/1'].finalDelayMs).toBe(200);
  });

  it('アダプター生成の失敗は error として emit し他モデルは生きる', () => {
    const { adapter } = fakeAdapter();
    const messages: SttServerMessage[] = [];
    const resolve = (p: string) => {
      if (p === 'a') throw new Error('no key');
      return adapter;
    };
    const fanout = new SttFanout(entries, resolve, (m) => messages.push(m), () => 0);
    expect(messages.some((m) => m.type === 'error' && m.modelKey === 'a/1')).toBe(true);
    fanout.sendAudio(new Uint8Array(2)); // b/1 に配信されても例外にならない
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter server test`
Expected: FAIL（audio.js / stt-fanout.js が存在しない）

- [ ] **Step 3: `server/src/audio.ts` を実装**

```ts
/**
 * 16bit PCM を線形補間でリサンプリングする。
 */
export function resamplePcm16(input: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) return input;
  const outLen = Math.floor((input.length * outRate) / inRate);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * inRate) / outRate;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = Math.round(input[i0] + (input[i1] - input[i0]) * (pos - i0));
  }
  return out;
}

/**
 * 16bit PCM mono に 44 バイトの WAV ヘッダーを付ける。
 */
export function pcm16ToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataSize).copy(buf, 44);
  return buf;
}
```

- [ ] **Step 4: `server/src/stt-fanout.ts` を実装**

```ts
import type { ModelEntry, SttModelSummary, SttServerMessage } from '@voice-lab/shared';
import type { STTAdapterResolver, SttSession } from './adapters/stt/types.js';

interface SttEvent { modelKey: string; type: 'partial' | 'final'; text: string; at: number }

/**
 * 1 本のマイク入力を複数 STT モデルのセッションへ配信し、
 * 受信イベントに時刻を打刻して emit・集計する。
 */
export class SttFanout {
  private sessions = new Map<string, SttSession>();
  private events: SttEvent[] = [];
  private audioChunks: Uint8Array[] = [];

  constructor(
    entries: ModelEntry[],
    resolve: STTAdapterResolver,
    private emit: (msg: SttServerMessage) => void,
    private now: () => number = () => performance.now(),
  ) {
    for (const entry of entries) {
      try {
        const session = resolve(entry.provider).startSession({
          model: entry.model,
          params: {},
          onPartial: (text) => this.record(entry.key, 'partial', text),
          onFinal: (text) => this.record(entry.key, 'final', text),
          onError: (err) => this.emit({ type: 'error', modelKey: entry.key, message: err.message }),
        });
        this.sessions.set(entry.key, session);
      } catch (err) {
        this.emit({ type: 'error', modelKey: entry.key, message: err instanceof Error ? err.message : String(err) });
      }
    }
    this.emit({ type: 'ready', models: [...this.sessions.keys()] });
  }

  /** 16kHz PCM16 チャンクを全セッションに配る。履歴保存用に蓄積もする */
  sendAudio(chunk: Uint8Array) {
    this.audioChunks.push(chunk);
    for (const s of this.sessions.values()) {
      try { s.sendAudio(chunk); } catch { /* モデル単位で隔離 */ }
    }
  }

  /** 蓄積した入力音声（履歴保存用） */
  get audio(): Uint8Array[] { return this.audioChunks; }

  /** 打刻済みイベント列（履歴保存用） */
  get eventLog(): SttEvent[] { return this.events; }

  /** 全セッションを閉じ、grace 待機後に summary を emit する */
  async stop(graceMs = 2000): Promise<Record<string, SttModelSummary>> {
    const stoppedAt = this.now();
    for (const s of this.sessions.values()) {
      try { s.close(); } catch { /* noop */ }
    }
    await new Promise((r) => setTimeout(r, graceMs));
    const models: Record<string, SttModelSummary> = {};
    for (const key of this.sessions.keys()) {
      const evts = this.events.filter((e) => e.modelKey === key);
      const finals = evts.filter((e) => e.type === 'final');
      const lastFinalAt = finals.at(-1)?.at ?? null;
      models[key] = {
        partials: evts.filter((e) => e.type === 'partial').length,
        finals: finals.length,
        finalDelayMs: lastFinalAt === null ? null : Math.max(0, Math.round(lastFinalAt - stoppedAt)),
        transcript: finals.map((e) => e.text).join(''),
      };
    }
    this.emit({ type: 'summary', stoppedAt, models });
    return models;
  }

  private record(modelKey: string, type: 'partial' | 'final', text: string) {
    const at = this.now();
    this.events.push({ modelKey, type, text, at });
    this.emit({ type, modelKey, text, at });
  }
}
```

（注: `params` の受け渡しは v1 では未使用のため空でよいが、`entry.params` から defaultValue を引く実装にしても可。テストが通る最小でよい）

- [ ] **Step 5: テストが通ることを確認**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 6: WS ルートを実装** — `server/src/routes/stt-ws.ts`（薄いシェル。自動テスト対象外、Task 12 で実機確認）

```ts
import type { UpgradeWebSocket } from 'hono/ws';
import { Hono } from 'hono';
import { MODELS } from '../registry.js';
import { SttFanout } from '../stt-fanout.js';
import type { STTAdapterResolver } from '../adapters/stt/types.js';

/**
 * /ws/stt?models=a,b — バイナリ: 16kHz PCM16 音声、テキスト: {"type":"stop"} で停止。
 */
export function sttWsRoute(upgradeWebSocket: UpgradeWebSocket, resolve: STTAdapterResolver) {
  const route = new Hono();
  route.get(
    '/',
    upgradeWebSocket((c) => {
      const keys = (c.req.query('models') ?? '').split(',').filter(Boolean);
      let fanout: SttFanout | null = null;
      let stopped = false;
      return {
        onOpen(_evt, ws) {
          const entries = MODELS.filter((m) => m.kind === 'stt' && keys.includes(m.key));
          fanout = new SttFanout(entries, resolve, (msg) => ws.send(JSON.stringify(msg)));
        },
        async onMessage(evt, ws) {
          if (typeof evt.data === 'string') {
            const msg = JSON.parse(evt.data);
            if (msg.type === 'stop' && fanout && !stopped) {
              stopped = true;
              await fanout.stop();
              ws.close();
            }
          } else if (fanout) {
            const buf = evt.data instanceof ArrayBuffer ? new Uint8Array(evt.data) : new Uint8Array(evt.data as Buffer);
            fanout.sendAudio(buf);
          }
        },
        onClose() {
          if (!stopped) {
            stopped = true;
            fanout?.stop(0);
          }
        },
      };
    }),
  );
  return route;
}
```

`server/src/app.ts` に配線（TTS と同じパターンで sttAdapters を用意）:

```ts
import { sttWsRoute } from './routes/stt-ws.js';
import type { STTAdapter } from './adapters/stt/types.js';

// createApp 内:
const sttAdapters: Record<string, STTAdapter> = {}; // Task 12〜15 で埋める
app.route(
  '/ws/stt',
  sttWsRoute(upgradeWebSocket, (provider) => {
    const a = sttAdapters[provider];
    if (!a) throw new Error(`STT adapter not implemented: ${provider}`);
    return a;
  }),
);
```

- [ ] **Step 7: typecheck とテスト**

Run: `pnpm --filter server typecheck && pnpm --filter server test`
Expected: いずれも PASS

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "STT ファンアウトと WS ルート骨格を追加"
```

---

### Task 12: Deepgram STT アダプター + STT 手動確認スクリプト

**Files:**
- Create: `server/src/adapters/stt/deepgram.ts`, `server/scripts/try-stt.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Produces: `createDeepgramStt(env): STTAdapter`（nova-3 と flux-general-multi の両モデルを 1 アダプターで処理）
- Produces: `pnpm --filter server exec tsx scripts/try-stt.ts <modelKey> "<話す内容>"` — OpenAI TTS で試験音声を作り、リアルタイム相当のペースで流して partial/final を印字（全 STT アダプターの手動確認に使う。要 OPENAI_API_KEY）

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://developers.deepgram.com/docs/ で以下を確認し、相違があればコードを直す:
(a) nova-3 系: `wss://api.deepgram.com/v1/listen` のクエリ（`model`, `language`（ja は multilingual: `language=multi` か `language=ja` か）, `encoding=linear16`, `sample_rate=16000`, `interim_results=true`）と Results イベント構造（`is_final`, `channel.alternatives[0].transcript`）、終了メッセージ `{"type":"CloseStream"}`
(b) flux: `wss://api.deepgram.com/v2/listen` のクエリ（`model=flux-general-multi`, `language_hint=ja` ほか）とイベント構造（TurnInfo 系。turn 確定を final、途中を partial にマップ）

- [ ] **Step 2: `server/src/adapters/stt/deepgram.ts` を実装**（フィールドは Step 1 の確認結果を正とする）

```ts
import WebSocket from 'ws';
import type { STTAdapter } from './types.js';

/**
 * Deepgram STT アダプター。model 名で v1 (nova) / v2 (flux) を切り替える。
 */
export function createDeepgramStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, onPartial, onFinal, onError }) {
      const isFlux = model.startsWith('flux');
      const url = new URL(isFlux ? 'wss://api.deepgram.com/v2/listen' : 'wss://api.deepgram.com/v1/listen');
      url.searchParams.set('model', model);
      url.searchParams.set('encoding', 'linear16');
      url.searchParams.set('sample_rate', '16000');
      if (isFlux) {
        url.searchParams.set('language_hint', 'ja');
      } else {
        url.searchParams.set('language', 'multi');
        url.searchParams.set('interim_results', 'true');
        url.searchParams.set('smart_format', 'true');
      }
      const ws = new WebSocket(url, { headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}` } });
      const pending: Buffer[] = [];
      ws.on('open', () => { for (const b of pending.splice(0)) ws.send(b); });
      ws.on('error', (err) => onError(err as Error));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (isFlux) {
          // Step 1 で確認した Flux のイベント名に合わせる（例: TurnInfo）
          if (msg.type === 'TurnInfo' && msg.transcript) {
            if (msg.event === 'EndOfTurn') onFinal(msg.transcript);
            else onPartial(msg.transcript);
          }
        } else if (msg.type === 'Results') {
          const text = msg.channel?.alternatives?.[0]?.transcript ?? '';
          if (!text) return;
          if (msg.is_final) onFinal(text);
          else onPartial(text);
        }
      });
      return {
        sendAudio(chunk) {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
          else if (ws.readyState === WebSocket.CONNECTING) pending.push(Buffer.from(chunk));
        },
        close() {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }));
          setTimeout(() => ws.close(), 3000);
        },
      };
    },
  };
}
```

`app.ts` の `sttAdapters` に `deepgram: createDeepgramStt(env)` を登録。

- [ ] **Step 3: `server/scripts/try-stt.ts` を作成**

```ts
import 'dotenv/config';
import { MODELS } from '../src/registry.js';
import { resamplePcm16 } from '../src/audio.js';
import { createDeepgramStt } from '../src/adapters/stt/deepgram.js';
import type { STTAdapter } from '../src/adapters/stt/types.js';

const adapters: Record<string, (env: NodeJS.ProcessEnv) => STTAdapter> = {
  deepgram: createDeepgramStt,
  // 以後のタスクで openai / elevenlabs / google を追加
};

/**
 * OpenAI TTS で試験音声（24kHz PCM）を作り 16kHz に変換、
 * 100ms ごとに送ってリアルタイム入力を模擬する。
 * 使い方: tsx scripts/try-stt.ts deepgram/nova-3 "こんにちは、音声認識のテストです"
 */
async function main() {
  const [modelKey, text] = process.argv.slice(2);
  const entry = MODELS.find((m) => m.key === modelKey && m.kind === 'stt');
  if (!entry || !text) throw new Error('usage: try-stt.ts <modelKey> <text>');

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'alloy', input: text, response_format: 'pcm' }),
  });
  if (!res.ok) throw new Error(`tts for test audio failed: ${res.status}`);
  const pcm24k = new Int16Array((await res.arrayBuffer()));
  const pcm16k = resamplePcm16(pcm24k, 24000, 16000);

  const session = adapters[entry.provider](process.env).startSession({
    model: entry.model,
    params: {},
    onPartial: (t) => console.log(`  [partial] ${t}`),
    onFinal: (t) => console.log(`  [final]   ${t}`),
    onError: (e) => console.error(`  [error]   ${e.message}`),
  });

  const chunkSamples = 1600; // 100ms @16kHz
  for (let i = 0; i < pcm16k.length; i += chunkSamples) {
    const part = pcm16k.subarray(i, i + chunkSamples);
    session.sendAudio(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
    await new Promise((r) => setTimeout(r, 100));
  }
  session.close();
  await new Promise((r) => setTimeout(r, 4000));
  process.exit(0);
}

main();
```

- [ ] **Step 4: 手動確認**

Run: `cd server && pnpm exec tsx scripts/try-stt.ts deepgram/nova-3 "こんにちは、音声認識のテストです"` と `... deepgram/flux-general-multi "..."`
Expected: partial → final が流れ、final の内容が概ね発話どおり。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Deepgram STT アダプターと手動確認スクリプトを追加"
```

---

### Task 13: OpenAI Realtime STT アダプター

**Files:**
- Create: `server/src/adapters/stt/openai-realtime.ts`
- Modify: `server/src/app.ts`, `server/scripts/try-stt.ts`

**Interfaces:**
- Consumes: `resamplePcm16`（Task 11。16k→24k 変換）
- Produces: `createOpenAiRealtimeStt(env): STTAdapter`（gpt-realtime-whisper / gpt-4o-transcribe 共用）

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://developers.openai.com/api/docs/guides/realtime-transcription を確認: (a) 接続 URL（`wss://api.openai.com/v1/realtime?intent=transcription` 等）と必要ヘッダー（GA 版でのヘッダー要件）、(b) セッション設定メッセージ（`transcription_session.update` / `session.update`）での `input_audio_format`（pcm16 のサンプルレート要件。24kHz 想定）、モデル・言語指定、server_vad、(c) 途中結果/確定のイベント名（`conversation.item.input_audio_transcription.delta` / `.completed` 等）。以下のコードを確認結果に合わせて修正する。

- [ ] **Step 2: `server/src/adapters/stt/openai-realtime.ts` を実装**

```ts
import WebSocket from 'ws';
import { resamplePcm16 } from '../../audio.js';
import type { STTAdapter } from './types.js';

/**
 * OpenAI Realtime API の transcription セッション。入力 16kHz を 24kHz に変換して送る。
 */
export function createOpenAiRealtimeStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, onPartial, onFinal, onError }) {
      const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      });
      const pending: string[] = [];
      const sendJson = (obj: unknown) => {
        const s = JSON.stringify(obj);
        if (ws.readyState === WebSocket.OPEN) ws.send(s);
        else pending.push(s);
      };
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'transcription_session.update',
          session: {
            input_audio_format: 'pcm16',
            input_audio_transcription: { model, language: 'ja' },
            turn_detection: { type: 'server_vad' },
          },
        }));
        for (const s of pending.splice(0)) ws.send(s);
      });
      ws.on('error', (err) => onError(err as Error));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'conversation.item.input_audio_transcription.delta' && msg.delta) onPartial(msg.delta);
        if (msg.type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) onFinal(msg.transcript);
        if (msg.type === 'error') onError(new Error(msg.error?.message ?? 'openai realtime error'));
      });
      return {
        sendAudio(chunk) {
          const pcm16k = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
          const pcm24k = resamplePcm16(pcm16k, 16000, 24000);
          sendJson({ type: 'input_audio_buffer.append', audio: Buffer.from(pcm24k.buffer).toString('base64') });
        },
        close() {
          setTimeout(() => ws.close(), 3000);
        },
      };
    },
  };
}
```

`app.ts` の `sttAdapters` と `try-stt.ts` に `openai: createOpenAiRealtimeStt` を追加。

- [ ] **Step 3: 手動確認**

Run: `cd server && pnpm exec tsx scripts/try-stt.ts openai/gpt-realtime-whisper "こんにちは、音声認識のテストです"` と `... openai/gpt-4o-transcribe "..."`
Expected: partial/final が印字される。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "OpenAI Realtime STT アダプターを追加"
```

---

### Task 14: ElevenLabs Scribe v2 Realtime STT アダプター

**Files:**
- Create: `server/src/adapters/stt/elevenlabs.ts`
- Modify: `server/src/app.ts`, `server/scripts/try-stt.ts`

**Interfaces:**
- Produces: `createElevenLabsStt(env): STTAdapter`

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://elevenlabs.io/docs/ の Speech to Text → Realtime（scribe_v2_realtime）を確認: (a) WS URL とクエリ（`model_id`, `language_code=ja`, 入力フォーマット `pcm_16000` 系の指定方法）、(b) 認証（`xi-api-key` ヘッダー）、(c) 音声送信形式（バイナリか base64 JSON か）、(d) 途中/確定イベント名。以下のコードを確認結果に合わせて修正する。

- [ ] **Step 2: `server/src/adapters/stt/elevenlabs.ts` を実装**

```ts
import WebSocket from 'ws';
import type { STTAdapter } from './types.js';

/**
 * ElevenLabs Scribe v2 Realtime アダプター。
 */
export function createElevenLabsStt(env: Record<string, string | undefined>): STTAdapter {
  return {
    startSession({ model, onPartial, onFinal, onError }) {
      const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
      url.searchParams.set('model_id', model);
      url.searchParams.set('language_code', 'ja');
      url.searchParams.set('audio_format', 'pcm_16000');
      const ws = new WebSocket(url, { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY! } });
      const pending: Buffer[] = [];
      ws.on('open', () => { for (const b of pending.splice(0)) ws.send(b); });
      ws.on('error', (err) => onError(err as Error));
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'partial_transcript' && msg.text) onPartial(msg.text);
        if (msg.type === 'final_transcript' && msg.text) onFinal(msg.text);
        if (msg.type === 'error') onError(new Error(msg.message ?? 'elevenlabs stt error'));
      });
      return {
        sendAudio(chunk) {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
          else if (ws.readyState === WebSocket.CONNECTING) pending.push(Buffer.from(chunk));
        },
        close() {
          setTimeout(() => ws.close(), 3000);
        },
      };
    },
  };
}
```

`app.ts` の `sttAdapters` と `try-stt.ts` に `elevenlabs: createElevenLabsStt` を追加。

- [ ] **Step 3: 手動確認**

Run: `cd server && pnpm exec tsx scripts/try-stt.ts elevenlabs/scribe_v2_realtime "こんにちは、音声認識のテストです"`
Expected: partial/final が印字される。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "ElevenLabs Scribe STT アダプターを追加"
```

---

### Task 15: Google Cloud STT アダプター

**Files:**
- Create: `server/src/adapters/stt/google.ts`
- Modify: `server/src/app.ts`, `server/scripts/try-stt.ts`, `server/package.json`

**Interfaces:**
- Produces: `createGoogleStt(env): STTAdapter`

- [ ] **Step 1: 公式ドキュメントで API 仕様を確認**

https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3 で (a) chirp_3 のストリーミング対応リージョン（us / eu マルチリージョン。東京から使う場合のエンドポイント指定 `{location}-speech.googleapis.com`）、(b) v2 `StreamingRecognize` の config（`explicitDecodingConfig`, `languageCodes: ['ja-JP']`, `model: 'chirp_3'`, `interimResults`）を確認、(c) Node クライアント（@google-cloud/speech v2）のストリーミングメソッド名（`_streamingRecognize` か `streamingRecognize` か）を確認。リージョンは env `GOOGLE_SPEECH_LOCATION`（デフォルトは確認したストリーミング対応リージョン）で持つ。

- [ ] **Step 2: 依存を追加**

Run: `pnpm --filter server add @google-cloud/speech`

- [ ] **Step 3: `server/src/adapters/stt/google.ts` を実装**

```ts
import speech from '@google-cloud/speech';
import type { STTAdapter } from './types.js';

/**
 * Google Cloud Speech-to-Text v2 ストリーミングアダプター（chirp_3）。
 */
export function createGoogleStt(env: Record<string, string | undefined>): STTAdapter {
  const location = env.GOOGLE_SPEECH_LOCATION ?? 'us';
  const client = new speech.v2.SpeechClient({
    apiEndpoint: `${location === 'global' ? '' : `${location}-`}speech.googleapis.com`,
  });
  return {
    startSession({ model, onPartial, onFinal, onError }) {
      let stream: ReturnType<typeof client._streamingRecognize> | null = null;
      const init = (async () => {
        const projectId = await client.getProjectId();
        stream = client._streamingRecognize();
        stream.on('error', (err: Error) => onError(err));
        stream.on('data', (res: any) => {
          for (const result of res.results ?? []) {
            const text = result.alternatives?.[0]?.transcript ?? '';
            if (!text) continue;
            if (result.isFinal) onFinal(text);
            else onPartial(text);
          }
        });
        stream.write({
          recognizer: `projects/${projectId}/locations/${location}/recognizers/_`,
          streamingConfig: {
            config: {
              explicitDecodingConfig: { encoding: 'LINEAR16', sampleRateHertz: 16000, audioChannelCount: 1 },
              languageCodes: ['ja-JP'],
              model,
            },
            streamingFeatures: { interimResults: true },
          },
        });
      })().catch(onError);
      return {
        sendAudio(chunk) {
          init.then(() => stream?.write({ audio: Buffer.from(chunk) }));
        },
        close() {
          init.then(() => stream?.end());
        },
      };
    },
  };
}
```

`app.ts` の `sttAdapters` と `try-stt.ts` に `google: createGoogleStt` を追加。

- [ ] **Step 4: 手動確認**

Run: `cd server && pnpm exec tsx scripts/try-stt.ts google/chirp_3 "こんにちは、音声認識のテストです"`
Expected: partial/final が印字される。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Google Cloud STT アダプターを追加"
```

---

### Task 16: STT Lab ページ（マイク取得 + 並列文字起こし表示）

**Files:**
- Create: `client/src/lib/mic.ts`, `client/src/pages/SttLabPage.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `downsample` / `floatTo16BitPcm`（Task 9）、`ModelPicker`（Task 10）、`SttServerMessage`（Task 11）
- Produces（mic.ts）:

```ts
export interface MicCapture { stop(): void }
/** マイクを 16kHz 16bit PCM mono に変換して onChunk へ渡す */
export function startMic(onChunk: (pcm: Int16Array) => void): Promise<MicCapture>;
```

- [ ] **Step 1: `client/src/lib/mic.ts` を実装**（AudioWorklet を Blob URL で登録）

```ts
import { downsample, floatTo16BitPcm } from './pcm';

const WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) this.port.postMessage(new Float32Array(ch));
    return true;
  }
}
registerProcessor('capture', CaptureProcessor);
`;

export interface MicCapture { stop(): void }

/**
 * マイクを取得し、AudioWorklet 経由で Float32 フレームを受け取り
 * 16kHz 16bit PCM に変換して onChunk へ渡す。
 */
export async function startMic(onChunk: (pcm: Int16Array) => void): Promise<MicCapture> {
  const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const ctx = new AudioContext();
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' })));
  const source = ctx.createMediaStreamSource(media);
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    onChunk(floatTo16BitPcm(downsample(e.data, ctx.sampleRate, 16000)));
  };
  source.connect(node);
  return {
    stop() {
      node.disconnect();
      source.disconnect();
      media.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
```

- [ ] **Step 2: `client/src/pages/SttLabPage.tsx` を実装**

```tsx
import { useEffect, useRef, useState } from 'react';
import type { ModelsResponse, SttModelSummary, SttServerMessage } from '@voice-lab/shared';
import { fetchModels } from '../lib/api';
import { startMic, type MicCapture } from '../lib/mic';
import ModelPicker, { type ModelConfig } from '../components/ModelPicker';

interface Column {
  modelKey: string;
  partial: string;
  finals: string[];
  error?: string;
  summary?: SttModelSummary;
}

export default function SttLabPage() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [configs, setConfigs] = useState<Record<string, ModelConfig>>({});
  const [columns, setColumns] = useState<Column[]>([]);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicCapture | null>(null);

  useEffect(() => {
    fetchModels().then(setModels);
  }, []);

  const patch = (modelKey: string, fn: (c: Column) => Column) =>
    setColumns((prev) => prev.map((c) => (c.modelKey === modelKey ? fn(c) : c)));

  const start = async () => {
    setColumns(selected.map((modelKey) => ({ modelKey, partial: '', finals: [] })));
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/stt?models=${selected.join(',')}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    ws.onmessage = (e) => {
      const msg: SttServerMessage = JSON.parse(e.data);
      if (msg.type === 'partial') patch(msg.modelKey, (c) => ({ ...c, partial: msg.text }));
      if (msg.type === 'final') patch(msg.modelKey, (c) => ({ ...c, partial: '', finals: [...c.finals, msg.text] }));
      if (msg.type === 'error') patch(msg.modelKey, (c) => ({ ...c, error: msg.message }));
      if (msg.type === 'summary') {
        for (const [key, summary] of Object.entries(msg.models)) patch(key, (c) => ({ ...c, summary }));
      }
    };
    await new Promise((resolve) => { ws.onopen = resolve; });
    micRef.current = await startMic((pcm) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm.buffer);
    });
    setRunning(true);
  };

  const stop = () => {
    micRef.current?.stop();
    wsRef.current?.send(JSON.stringify({ type: 'stop', note }));
    setRunning(false);
  };

  if (!models) return <p>loading...</p>;
  return (
    <div>
      <h2>STT Lab</h2>
      <ModelPicker
        kind="stt" models={models} selected={selected} onChange={setSelected}
        configs={configs} onConfigChange={(k, c) => setConfigs((prev) => ({ ...prev, [k]: c }))}
      />
      <div style={{ margin: '12px 0' }}>
        {running
          ? <button onClick={stop} style={{ fontSize: 16 }}>■ 停止</button>
          : <button onClick={start} disabled={selected.length === 0} style={{ fontSize: 16 }}>● 開始（マイク）</button>}
        <input
          placeholder="話した内容のメモ（任意・比較用）" value={note}
          onChange={(e) => setNote(e.target.value)} style={{ marginLeft: 8, width: 320 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {columns.map((c) => (
          <div key={c.modelKey} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, flex: 1, minWidth: 240 }}>
            <strong>{c.modelKey}</strong>
            {c.error && <p style={{ color: 'red' }}>{c.error}</p>}
            <p>
              {c.finals.map((f, i) => <span key={i}>{f}</span>)}
              <span style={{ color: '#999' }}>{c.partial}</span>
            </p>
            {c.summary && (
              <table style={{ fontSize: 12 }}>
                <tbody>
                  <tr><td>final数</td><td>{c.summary.finals}</td></tr>
                  <tr><td>partial数</td><td>{c.summary.partials}</td></tr>
                  <tr><td>停止→最終確定</td><td>{c.summary.finalDelayMs ?? '-'} ms</td></tr>
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

`client/src/App.tsx` のルートを差し替え: `<Route path="/stt" element={<SttLabPage />} />`。

- [ ] **Step 3: 手動確認**

Run: `pnpm dev` → http://localhost:5173/stt
Expected: STT モデルを複数選択 → 開始 → マイクに日本語で話すと各列に partial（グレー）→ final（黒）が流れる。停止で summary（final数・停止→最終確定 ms）が出る。モデル間の速度差が体感できる。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "STT Lab ページを追加"
```

---

### Task 17: 実行履歴（保存・一覧・音声再生）

**Files:**
- Create: `server/src/history.ts`, `server/src/routes/history.ts`, `client/src/pages/HistoryPage.tsx`
- Modify: `shared/src/index.ts`, `server/src/routes/tts.ts`, `server/src/routes/stt-ws.ts`, `server/src/app.ts`, `client/src/App.tsx`
- Test: `server/test/history.test.ts`

**Interfaces:**
- Produces（shared に追加）:

```ts
export interface TtsRunRecord {
  id: string; kind: 'tts'; at: string;   // ISO 8601
  modelKey: string; text: string; voice: string; params: Record<string, unknown>;
  serverTtfbMs?: number; serverTotalMs?: number; bytes?: number; error?: string;
  audioFile?: string;                    // data/audio/ 内のファイル名
}
export interface SttRunRecord {
  id: string; kind: 'stt'; at: string;
  note?: string; models: Record<string, SttModelSummary>;
  events?: Array<{ modelKey: string; type: 'partial' | 'final'; text: string; at: number }>;  // スペック §6「partial のタイムスタンプ列」
  audioFile?: string;
}
export type RunRecord = TtsRunRecord | SttRunRecord;
```

- Produces（history.ts）:

```ts
export interface History {
  appendRun(run: RunRecord): Promise<void>;
  listRuns(): Promise<RunRecord[]>;          // 新しい順
  saveAudio(fileName: string, data: Buffer): Promise<void>;
  audioDir: string;
}
export function createHistory(dataDir: string): History;
export function newRunId(): string;          // crypto.randomUUID ベース
```

- Produces（HTTP）: `GET /api/history` → `RunRecord[]`、`GET /api/history/audio/:file` → 音声ファイル
- Consumes: `pcm16ToWav`（Task 11、STT 入力音声の保存）

- [ ] **Step 1: 失敗するテストを書く** — `server/test/history.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHistory, newRunId } from '../src/history.js';

describe('history', () => {
  it('append した run が新しい順で list される', async () => {
    const h = createHistory(mkdtempSync(join(tmpdir(), 'vl-')));
    await h.appendRun({ id: '1', kind: 'tts', at: '2026-07-12T00:00:00Z', modelKey: 'a', text: 't', voice: 'v', params: {} });
    await h.appendRun({ id: '2', kind: 'stt', at: '2026-07-12T00:01:00Z', models: {} });
    const runs = await h.listRuns();
    expect(runs.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('データディレクトリが無ければ作る・空なら空配列', async () => {
    const h = createHistory(join(mkdtempSync(join(tmpdir(), 'vl-')), 'nested'));
    expect(await h.listRuns()).toEqual([]);
  });

  it('saveAudio でファイルが audioDir に書かれる', async () => {
    const h = createHistory(mkdtempSync(join(tmpdir(), 'vl-')));
    await h.saveAudio('x.wav', Buffer.from([1]));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(h.audioDir, 'x.wav'))[0]).toBe(1);
  });

  it('newRunId は一意', () => {
    expect(newRunId()).not.toBe(newRunId());
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter server test`
Expected: FAIL

- [ ] **Step 3: `server/src/history.ts` を実装**

```ts
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RunRecord } from '@voice-lab/shared';

export interface History {
  appendRun(run: RunRecord): Promise<void>;
  listRuns(): Promise<RunRecord[]>;
  saveAudio(fileName: string, data: Buffer): Promise<void>;
  audioDir: string;
}

/** 一意な実行 ID を作る */
export function newRunId(): string {
  return randomUUID();
}

/**
 * data ディレクトリ（runs.jsonl + audio/）を使ったフラットファイル履歴。
 */
export function createHistory(dataDir: string): History {
  const runsFile = join(dataDir, 'runs.jsonl');
  const audioDir = join(dataDir, 'audio');
  const ensure = async () => {
    await mkdir(audioDir, { recursive: true });
  };
  return {
    audioDir,
    async appendRun(run) {
      await ensure();
      await appendFile(runsFile, JSON.stringify(run) + '\n', 'utf8');
    },
    async listRuns() {
      await ensure();
      const text = await readFile(runsFile, 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RunRecord)
        .reverse();
    },
    async saveAudio(fileName, data) {
      await ensure();
      await writeFile(join(audioDir, fileName), data);
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 5: ルートと配線**

`server/src/routes/history.ts`:

```ts
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { History } from '../history.js';

/**
 * 履歴一覧と保存音声の配信。
 */
export function historyRoute(history: History) {
  const route = new Hono();
  route.get('/', async (c) => c.json(await history.listRuns()));
  route.get('/audio/:file', async (c) => {
    const file = c.req.param('file');
    if (file.includes('/') || file.includes('..')) return c.text('bad request', 400);
    const data = await readFile(join(history.audioDir, file)).catch(() => null);
    if (!data) return c.text('not found', 404);
    const type = file.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
    return c.body(data, 200, { 'content-type': type });
  });
  return route;
}
```

`server/src/app.ts`: `const history = createHistory(env.DATA_DIR ?? 'data');` を作り `app.route('/api/history', historyRoute(history));`。`ttsRoute(resolver)` と `sttWsRoute(...)` に `history` を追加引数で渡す。

`server/src/routes/tts.ts` の変更: 合成完了/失敗時に record を保存し、音声は `saveAudio(`${id}.mp3`, ...)`（チャンクを蓄積して結合）。metrics 行の直前に追加:

```ts
// ttsRoute(resolve, history) に変更し、stream 内の成功パスで:
const id = newRunId();
await history.saveAudio(`${id}.mp3`, Buffer.concat(collected));   // collected: chunk を push しておいた配列
await history.appendRun({
  id, kind: 'tts', at: new Date().toISOString(),
  modelKey, text, voice, params,
  serverTtfbMs: Math.round(ttfb ?? 0), serverTotalMs: Math.round(performance.now() - start), bytes,
  audioFile: `${id}.mp3`,
});
// エラーパスでは audioFile 無しで error 付き record を appendRun
```

`server/src/routes/stt-ws.ts` の変更: `stop` 受信時に `fanout.stop()` の戻り値（summary）と蓄積音声で保存:

```ts
// sttWsRoute(upgradeWebSocket, resolve, history) に変更し、stop 処理で:
const models = await fanout.stop();
const id = newRunId();
const pcm = concatInt16(fanout.audio);          // Uint8Array[] → Int16Array 結合ヘルパーを同ファイルに実装
await history.saveAudio(`${id}.wav`, pcm16ToWav(pcm, 16000));
await history.appendRun({ id, kind: 'stt', at: new Date().toISOString(), note: msg.note, models, events: fanout.eventLog, audioFile: `${id}.wav` });
```

`concatInt16` の実装（stt-ws.ts 内）:

```ts
/** 受信した PCM16 チャンク列を 1 本の Int16Array に結合する */
function concatInt16(chunks: Uint8Array[]): Int16Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new Int16Array(buf.buffer, 0, Math.floor(total / 2));
}
```

既存テスト（tts-route / stt-fanout）はシグネチャ変更に合わせて `createHistory(mkdtempSync(...))` を渡すよう更新する。

- [ ] **Step 6: `client/src/pages/HistoryPage.tsx` を実装**

```tsx
import { useEffect, useState } from 'react';
import type { RunRecord } from '@voice-lab/shared';

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  useEffect(() => {
    fetch('/api/history').then((r) => r.json()).then(setRuns);
  }, []);
  return (
    <div>
      <h2>履歴</h2>
      {runs.map((r) => (
        <div key={r.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: '#666' }}>{r.at} — {r.kind.toUpperCase()}</div>
          {r.kind === 'tts' ? (
            <>
              <div><strong>{r.modelKey}</strong>（{r.voice}）: {r.text}</div>
              <div style={{ fontSize: 12 }}>
                TTFB {r.serverTtfbMs ?? '-'}ms / total {r.serverTotalMs ?? '-'}ms / {r.bytes ?? '-'}bytes
                {r.error && <span style={{ color: 'red' }}> エラー: {r.error}</span>}
              </div>
            </>
          ) : (
            <>
              {r.note && <div>メモ: {r.note}</div>}
              <table style={{ fontSize: 12 }}>
                <tbody>
                  {Object.entries(r.models).map(([k, s]) => (
                    <tr key={k}><td>{k}</td><td>{s.transcript}</td><td>{s.finalDelayMs ?? '-'}ms</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {r.audioFile && <audio controls src={`/api/history/audio/${r.audioFile}`} />}
        </div>
      ))}
    </div>
  );
}
```

`client/src/App.tsx` のルートを差し替え: `<Route path="/history" element={<HistoryPage />} />`。

- [ ] **Step 7: テストと手動確認**

Run: `pnpm test` → PASS。`pnpm dev` で TTS 合成・STT セッションを 1 回ずつ実行 → /history に両方が出て音声再生できる。`data/runs.jsonl` と `data/audio/` が生成されている。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "実行履歴（保存・一覧・音声再生）を追加"
```

---

### Task 18: 本番配信モードと Basic 認証（TDD）

**Files:**
- Modify: `server/src/app.ts`
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Produces: env `BASIC_AUTH_PASSWORD` があれば全ルートに Basic 認証（ユーザー名は `BASIC_AUTH_USER`、デフォルト `lab`）。env `CLIENT_DIST` があればそのディレクトリを静的配信し、SPA フォールバックで `index.html` を返す

- [ ] **Step 1: 失敗するテストを書く** — `server/test/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('basic auth', () => {
  it('BASIC_AUTH_PASSWORD 設定時は認証なしで 401', async () => {
    const { app } = createApp({ BASIC_AUTH_PASSWORD: 'secret' });
    const res = await app.request('/api/health');
    expect(res.status).toBe(401);
  });

  it('正しい認証情報で 200', async () => {
    const { app } = createApp({ BASIC_AUTH_PASSWORD: 'secret' });
    const res = await app.request('/api/health', {
      headers: { Authorization: `Basic ${btoa('lab:secret')}` },
    });
    expect(res.status).toBe(200);
  });

  it('未設定なら認証なしで 200', async () => {
    const { app } = createApp({});
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `pnpm --filter server test`
Expected: FAIL（401 にならない）

- [ ] **Step 3: `server/src/app.ts` に認証と静的配信を追加**（ルート登録より前に置く）

```ts
import { basicAuth } from 'hono/basic-auth';
import { serveStatic } from '@hono/node-server/serve-static';

// createApp 冒頭:
if (env.BASIC_AUTH_PASSWORD) {
  app.use('*', basicAuth({ username: env.BASIC_AUTH_USER ?? 'lab', password: env.BASIC_AUTH_PASSWORD }));
}

// createApp 末尾（API ルート登録の後）:
if (env.CLIENT_DIST) {
  app.use('/*', serveStatic({ root: env.CLIENT_DIST }));
  app.get('*', serveStatic({ root: env.CLIENT_DIST, path: 'index.html' }));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter server test`
Expected: PASS

- [ ] **Step 5: 本番モードの手動確認**

Run: `pnpm --filter client build && cd server && BASIC_AUTH_PASSWORD=secret CLIENT_DIST=../client/dist pnpm start`
Expected: http://localhost:3001 で Basic 認証プロンプト（lab / secret）→ SPA が 1 ポートで動く。TTS/STT/履歴を一通り確認。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "本番配信モードと Basic 認証を追加"
```

---

### Task 19: Dockerfile と Cloud Run デプロイ

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docs/deploy.md`

**Interfaces:**
- Consumes: Task 18 の `CLIENT_DIST` / `BASIC_AUTH_PASSWORD` / `DATA_DIR`
- Produces: Cloud Run（asia-northeast1）で稼働する本番環境。`data/` は GCS ボリュームマウント

- [ ] **Step 1: `Dockerfile` と `.dockerignore` を作成**

`Dockerfile`:

```dockerfile
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter client build

FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app .
ENV NODE_ENV=production CLIENT_DIST=/app/client/dist DATA_DIR=/app/data PORT=8080
EXPOSE 8080
CMD ["pnpm", "--filter", "server", "start"]
```

`.dockerignore`:

```
node_modules
**/node_modules
data
server/out
.env
**/.env
.git
```

ローカル確認: `docker build -t voice-lab . && docker run --rm -p 8080:8080 --env-file server/.env -e BASIC_AUTH_PASSWORD=secret voice-lab` → http://localhost:8080 で動作確認（Google だけはキーファイルの都合でローカル Docker では未確認でよい）。

- [ ] **Step 2: `docs/deploy.md` にデプロイ手順を書く**（以下の内容そのまま）

````markdown
# Cloud Run デプロイ手順

前提: gcloud CLI ログイン済み、課金有効なプロジェクト、`PROJECT_ID` は自分のものに読み替え。

## 初回セットアップ

```bash
gcloud config set project PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  texttospeech.googleapis.com speech.googleapis.com secretmanager.googleapis.com

# シークレット登録（値は各自のキー）
printf '%s' "sk-..."   | gcloud secrets create openai-api-key --data-file=-
printf '%s' "..."      | gcloud secrets create elevenlabs-api-key --data-file=-
printf '%s' "..."      | gcloud secrets create deepgram-api-key --data-file=-
printf '%s' "..."      | gcloud secrets create aivis-api-key --data-file=-
printf '%s' "パスワード" | gcloud secrets create voice-lab-basic-pass --data-file=-

# 履歴永続化用バケット
gcloud storage buckets create gs://PROJECT_ID-voice-lab-data --location=asia-northeast1
```

## デプロイ（初回・更新とも）

```bash
gcloud run deploy voice-lab --source . \
  --region=asia-northeast1 --allow-unauthenticated \
  --timeout=3600 --memory=1Gi --session-affinity \
  --add-volume=name=data,type=cloud-storage,bucket=PROJECT_ID-voice-lab-data \
  --add-volume-mount=volume=data,mount-path=/app/data \
  --set-env-vars=DATA_DIR=/app/data,BASIC_AUTH_USER=lab,GOOGLE_CLOUD_PROJECT=PROJECT_ID \
  --set-secrets=OPENAI_API_KEY=openai-api-key:latest,ELEVENLABS_API_KEY=elevenlabs-api-key:latest,DEEPGRAM_API_KEY=deepgram-api-key:latest,AIVIS_API_KEY=aivis-api-key:latest,BASIC_AUTH_PASSWORD=voice-lab-basic-pass:latest
```

- `--allow-unauthenticated` はアプリ側 Basic 認証で守る前提（IAP に移行する場合はここを見直す）
- `--timeout=3600` は WebSocket（STT セッション）を 60 分まで維持するため
- Google TTS/STT の認証は Cloud Run のサービスアカウント（ADC）で行われる。キーファイル不要
````

- [ ] **Step 3: デプロイして動作確認**

Run: `docs/deploy.md` の手順を実行
Expected:
- 発行された URL で Basic 認証 → TTS Lab / STT Lab / 履歴が動く
- STT Lab のマイクが HTTPS 経由で動作する
- 再デプロイ後も履歴が残っている（GCS マウントの確認）
- **もし WS 接続だけ 401 になる場合**（ブラウザが WS ハンドシェイクに Basic 認証を付けないケース）: `/ws/*` を Basic 認証の対象外にし、代わりに「`GET /api/ws-ticket` が `BASIC_AUTH_PASSWORD` を HMAC 署名した短命チケットを返し、クライアントは WS URL に `?ticket=` を付け、`sttWsRoute` が検証する」方式に置き換える（認証済みページからしか ticket を取れないため防御は同等）

- [ ] **Step 4: 計測上の注意を README に記録**

`README.md` に以下を追記:

```markdown
# voice-lab

日本語 TTS/STT クラウド API の比較実験環境。設計: docs/2026-07-12-voice-lab-design.md

- ローカル: `pnpm install && pnpm dev` （キーは server/.env に。server/.env.example 参照）
- デプロイ: docs/deploy.md
- レイテンシ計測の注意: ローカル実行時は自宅回線→各社、Cloud Run 実行時は東京 DC→各社の値になる。
  本番想定の数値は Cloud Run 上での計測を使うこと。
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Dockerfile と Cloud Run デプロイ手順を追加"
```

---

## マイルストーン対応表（スペック §11）

| スペックのマイルストーン | タスク |
|---|---|
| 1. モノレポ雛形 + レジストリ + .env | Task 1〜3 |
| 2. TTS Lab | Task 4〜10 |
| 3. STT Lab | Task 11〜16 |
| 4. 履歴 | Task 17 |
| 5. Cloud Run デプロイ | Task 18〜19 |


