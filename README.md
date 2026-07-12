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
| `GOOGLE_APPLICATION_CREDENTIALS` | 同上・サービスアカウント JSON のパス（ローカルは必須） |
| `GOOGLE_SPEECH_LOCATION` | Google STT のリージョン（既定 `us`） |

Google は Text-to-Speech API と Speech-to-Text API を有効化し、サービスアカウントキーを発行して `GOOGLE_APPLICATION_CREDENTIALS` にそのパスを設定する。

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

## 既知の注意点

- **STT のマイクは画面のセレクタで選ぶ**。Chrome は deviceId 未指定だと OS の既定デバイスではなく独自の優先順位（内蔵マイクなど）で選ぶため、既定では OS 既定に追従する仮想 `default` デバイスを使い、任意のマイクをセレクタで明示選択できる（選択は localStorage に保存）。ドック運用でクラムシェル状態だと内蔵マイクは無音になる点に注意。
- **ボイス一覧はプロバイダーから動的取得**。TTS のボイスは `GET /api/voices` が各社 API から実行時に取得する（Google=`voices.list` を ja-JP でフィルタ、ElevenLabs=`GET /v2/voices` のアカウントライブラリ、OpenAI=固定 13 種、Aivis 等は registry のシードにフォールバック）。registry の `voices` は取得失敗時のフォールバック用シード。ラボとして「今そのプロバイダーで使えるボイス」を常に全部選べる。
- **TTS 実験は streaming / batch を分けて行う**。画面上部のトグルで切り替え、そのモードのモデルだけを比較する（registry の `streaming` フラグで振り分け）。指標の意味が異なるため、streaming モードは「最初の音まで（TTFB）」、batch モードは「全文の合成時間」を主指標にして混在させない。選択モードは localStorage に保存。
- **対応プロバイダーの日本語モデルは網羅表示**。各社の現行ラインナップから日本語対応の選べるモデルを registry に載せている（TTS: OpenAI gpt-4o-mini-tts/tts-1/tts-1-hd、ElevenLabs Flash/Turbo/Multilingual v2/v3、Google Chirp3-HD(一括+streaming)/Gemini flash・pro/Neural2/WaveNet/Standard、Aivis。STT: OpenAI 4種、Deepgram Nova-3/2・Flux、ElevenLabs Scribe v2 Realtime、Google Chirp3/Chirp2/latest_long/long/telephony）。英語専用や連続ストリーミングに不適なモデル（Google `short` 等）は除外。
- **Google Chirp 3 HD は一括と streaming の 2 エントリ**。streaming 合成（`streamingSynthesize`）は MP3 非対応で PCM/24kHz を返すため、クライアントは `audioFormat: 'pcm16'` を Web Audio（`PcmPlayer`）で、mp3 を MSE（`MsePlayer`）で再生する。streaming 版は「最初の音まで」の TTFB が計測できる（一括版は全文合成時間）。
- **Google STT のリージョンはモデル固有**。Chirp 3 は `us`/`eu` マルチリージョンのみで `global` 不可（実測確認済み）。`latest_long` は `global`、Chirp 2 は `us-central1`。registry の `location` でモデルごとに指定し、無指定は `GOOGLE_SPEECH_LOCATION`（既定 `us`）に従う。別モデル/リージョンを試すのも registry 1 エントリで足せる。
- **レイテンシ値はネットワーク依存**。ローカル実行時は「自宅回線 → 各社」の値になる。本番想定（東京 DC → 各社）の数値が必要なら Cloud Run 等へのデプロイ後に計測する（デプロイは第二フェーズ）。

## 構成

pnpm workspace のモノレポ。`client`（Vite + React）/ `server`（Hono + WebSocket）/ `shared`（型定義）。
プロバイダー差異は `server/src/adapters/` のアダプターに吸収し、モデル定義は `server/src/registry.ts` に集約。
モデル追加はレジストリ 1 エントリ、プロバイダー追加はアダプター 1 ファイル + レジストリで完結する。
