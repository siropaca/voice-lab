# voice·lab

日本語 TTS / STT クラウド API を品質・レイテンシ・ストリーミング対応で並べて比較する実験用 Web GUI。
最終目的は「Web 上で人間にインタビューする AI アバター」の音声モデル選定。

- 設計: [docs/specs/2026-07-12-voice-lab-design.md](docs/specs/2026-07-12-voice-lab-design.md)
- 実装計画: [docs/specs/2026-07-12-voice-lab-plan.md](docs/specs/2026-07-12-voice-lab-plan.md)
- 開発者向けルール・ドキュメントマップ: [AGENTS.md](AGENTS.md)

## できること（第一フェーズ）

- **TTS Lab** — 同じ文を複数モデルへ同時に合成し、声を聴き比べ、TTFB（発話開始までの遅延）を並べて比較
- **STT Lab** — マイク音声を複数モデルへ同時配信し、逐次認識（partial → final）と確定遅延を比較

各ラボとも、利用可能なモデルは既定で全部表示・全部比較対象になる（不要なものはカード上部をクリックで除外）。

対応プロバイダー: TTS = OpenAI / ElevenLabs / Google Cloud / Aivis Cloud、STT = OpenAI / Deepgram / ElevenLabs / Google Cloud。
同一プロバイダーの複数モデル（例: ElevenLabs Flash v2.5 と v3）も同時に比較できる。

## セットアップ

```bash
make bootstrap   # 依存インストール + server/.env を用意（make を使わないなら pnpm install && cp server/.env.example server/.env）
```

`server/.env` に持っているぶんだけ記入すればよい（キーのあるモデルだけ GUI に出る）:

| 変数 | 用途 |
|---|---|
| `OPENAI_API_KEY` | OpenAI TTS / STT |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS / STT |
| `DEEPGRAM_API_KEY` | Deepgram STT |
| `AIVIS_API_KEY` | Aivis Cloud TTS |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud TTS / STT（プロジェクト ID） |
| `GOOGLE_APPLICATION_CREDENTIALS` | 同上・サービスアカウント JSON のパス（ADC ログインなら空でも可） |

Google は API 有効化と IAM ロールの手順があるため [docs/google-cloud-setup.md](docs/google-cloud-setup.md) を参照。

## 起動

```bash
make dev        # = pnpm dev。client (5173) と server (3001) を同時起動
```

ブラウザで http://localhost:5173 を開く。マイク取得のため STT Lab は `localhost`（または HTTPS）で使うこと。

## テスト / 型チェック

```bash
make test        # = pnpm -r test
make typecheck   # = pnpm -r typecheck
```

`make help` で全ターゲットを一覧できる。

## 既知の注意点・挙動メモ

モデル / プロバイダー固有の挙動やラボ設計上の判断は [docs/notes.md](docs/notes.md) にまとめている（STT のマイク選択、ボイスの動的取得、streaming / batch 分離、Google のリージョン制約、レイテンシのネットワーク依存など）。

## 構成

pnpm workspace のモノレポ。`client`（Vite + React）/ `server`（Hono + WebSocket）/ `shared`（型定義）。
プロバイダー差異は `server/src/adapters/` のアダプターに吸収し、モデル定義は `server/src/registry.ts` に集約。
モデル追加はレジストリ 1 エントリ、プロバイダー追加はアダプター 1 ファイル + レジストリで完結する。
