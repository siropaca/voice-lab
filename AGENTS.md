# AGENTS.md

voice·lab — 日本語 TTS / STT クラウド API の比較実験ツール（用途: Web 上でインタビューする AI アバターの音声モデル選定）。

## ルール（最小）

- 応答・コミットメッセージ・PR は日本語。PR に署名は入れない。
- 実験ツール。ソースの設計は二の次でよいが、**プロバイダー / モデルの追加容易性だけは保つ**（モデル追加は registry 1 エントリ、プロバイダー追加はアダプター 1 ファイル + registry で完結させる）。
- コード変更後は `make typecheck` と `make test` を通してから完了とする。
- 設計・計画ドキュメント（spec）は `docs/specs/` に置く。
- 外部プロバイダーの情報（提供状況・モデル名・対応機能）は、記載・実装前に必ず最新をウェブで確認する（音声 AI 領域は変化が速い）。
- API キーは `server/.env` のみに置く（`server/.env.example` 参照）。ブラウザ／クライアントに露出させない。
- コミット・プッシュはユーザーの承認を得てから行う。

## ドキュメントマップ

- [README.md](README.md) — セットアップ・起動・対応プロバイダー・既知の注意点
- [docs/specs/2026-07-12-voice-lab-design.md](docs/specs/2026-07-12-voice-lab-design.md) — 設計（目的・スコープ・画面仕様・レイテンシ定義・エラーハンドリング・デプロイ方針）
- [docs/specs/2026-07-12-voice-lab-plan.md](docs/specs/2026-07-12-voice-lab-plan.md) — 実装計画（タスク分解と受け入れ条件）

## 構成の勘所

- モノレポ（pnpm workspace）: `client`（Vite + React）/ `server`（Hono + ws）/ `shared`（型定義）。
- モデル定義は `server/src/registry.ts`（モデル単位。同一プロバイダーの複数モデルも並べられる）。
- プロバイダー実装は `server/src/adapters/{tts,stt}/`。外部クライアント生成は遅延させる（factory 呼び出し時にネットワーク接続・例外を出さない）。
- 現状は TTS Lab / STT Lab の 2 画面。対話デモ（STT→LLM→TTS）と Cloud Run デプロイは第二フェーズ（計画 Task 18〜19、未着手）。
