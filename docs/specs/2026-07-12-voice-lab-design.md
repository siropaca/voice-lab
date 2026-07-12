# voice-lab 設計ドキュメント

作成日: 2026-07-12（最終更新: 2026-07-12）

> **実装状況・当初設計からの変更**
> 第一フェーズは実装・実機検証済み。当初設計から次の点が変わっている（本文もこの内容に更新済み）:
> - **画面は TTS Lab / STT Lab の2つ**。「履歴」機能はユーザー判断で削除した。
> - **利用可能なモデルは既定で全部表示・全部比較**する（アーム選択は不要。不要なものはカード上部クリックで個別除外）。
> - **実行履歴・録音の永続化は行わない**（メトリクスはセッション内表示のみ）。
> - Google STT のリージョンは **us / eu のみ**（jp・global 非対応）。Gemini-TTS は API 有効化に加え `roles/aiplatform.user` が必要。
> - OpenAI / ElevenLabs / Google の TTS・STT は実 API キーで動作確認済み。ElevenLabs の声は暫定の多言語 voice（日本語ネイティブは要差し替え）。
> - 対話デモ・Cloud Run デプロイはフェーズ2（未着手）。

## 1. 背景・目的

Web 上で人間にインタビューする AI アバターの開発に向けて、各社の TTS（音声合成）/ STT（文字起こし）クラウド API を比較し、本番採用モデルを決めるための実験環境（Web GUI）を作る。

比較の評価軸は次の3つ。コストは評価軸に含めない。

1. **品質** — 日本語音声の自然さ（TTS）、日本語認識の精度（STT）。耳と目での主観比較
2. **レイテンシ** — 発話開始までの遅延（TTS の TTFB）、文字起こしの応答速度（STT）
3. **ストリーミング対応** — 逐次合成・逐次文字起こしの有無と使い勝手

対象言語は日本語のみ。実験環境も本番もブラウザなので、ここで測るレイテンシは本番の見積もりにほぼそのまま使える。

ソースコードの設計は二の次でよい（実験ツールであり本番コードではない）。ただしプロバイダー・モデルの追加が容易な構造だけは担保する。

## 2. スコープ

### やること（第一フェーズ）

- **TTS Lab / STT Lab の2画面**を持つ Web GUI
- モデル・パラメータの GUI 切替。**同一プロバイダーの複数モデルを同時に並べて比較できる**
- **利用可能な全モデルを既定で表示・比較対象にする**（アーム選択は不要。不要なものはカード上部クリックで個別除外）
- 複数モデルへの並列リクエストと結果の並列表示
- レイテンシ計測（結果はセッション内で表示）

### やらないこと（第一フェーズでは）

- **履歴機能** — 当初は入れる想定だったがユーザー判断で削除。実行結果・録音の永続化は行わない
- **対話デモ（STT→LLM→TTS の会話ページ）** — フェーズ2 に延期（§10 参照）。LLM の契約も対話デモ実装時でよい
- **Cloud Run へのデプロイ** — フェーズ2 に延期。第一フェーズはローカル実行のみ（デプロイ先の選定結果は §9 に維持）
- クラウド API 以外（ローカル/OSS モデル）の対応
- コスト比較機能
- CER/WER の自動計算（目視比較）
- 認証基盤・マルチユーザー対応（デプロイ時は Basic 認証のみ）

## 3. 対応プロバイダー

以下のプロバイダー情報は 2026-07-12 にウェブ検索・公式ドキュメントで検証済み。この領域は変化が速いため、実装着手時にもモデル名を再確認すること。

### 初期実装（契約5つ）

| 契約 | TTS | STT |
|---|---|---|
| OpenAI | gpt-4o-mini-tts | gpt-realtime-whisper / gpt-4o-transcribe（いずれも Realtime API 経由のストリーミング） |
| ElevenLabs | eleven_flash_v2_5（低遅延 ~75ms）/ eleven_v3（品質比較用。リアルタイム非対応） | scribe_v2_realtime（~150ms、日本語対応） |
| Deepgram | - | flux-general-multi（日本語対応・ターン検出内蔵）/ nova-3（multilingual で日本語ストリーミング対応） |
| Google Cloud | gemini-2.5-flash-tts（ja GA）/ Chirp 3 HD（ja-JP-Chirp3-HD-*） | chirp_3（STT v2 API、ja-JP ストリーミング GA） |
| Aivis Cloud API | AivisSpeech 公開モデル（コハク・まお等 + AivisHub のモデル） | - |

→ TTS 4社・STT 4社（モデル数ではそれ以上）の比較が初期状態で成立する。

**ユーザーに用意してもらうもの**:

- `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` / `DEEPGRAM_API_KEY` / `AIVIS_API_KEY`
- Google Cloud プロジェクト（Cloud Text-to-Speech API と Speech-to-Text API を有効化し、サービスアカウントキーを発行。Cloud Run デプロイ時は ADC を使うのでキーファイル不要）

注意点（検証で判明）:

- OpenAI の TTS は公式に「音声は英語に最適化」と明記されており、日本語ネイティブ品質の声はない。基準値としては有用だが、日本語品質の主軸比較は ElevenLabs / Google / Aivis が担う
- ElevenLabs の日本語は v3 の評判が良い（漢字の読み・イントネーション改善）が、v3 はリアルタイム非対応。低遅延用途は Flash v2.5 で品質が一段落ちる。この「品質とレイテンシのトレードオフ」自体が本ラボの比較対象になる
- Aivis Cloud API は日本語特化・ストリーミング対応（再生開始 最速0.3秒）・安価（従量 440円/1万文字 or 月額1,980円無制限、無料クレジットあり）。2026-02-01 正式リリース
- **ElevenLabs の声は暫定の多言語 voice_id**（日本語ネイティブではない）。本番選定では `GET /v2/voices` で日本語ボイスに差し替える
- **Google のセットアップ要点**（実機検証で判明）: (1) Text-to-Speech と Speech-to-Text の**両 API を有効化**、(2) STT はサービスアカウントに `roles/speech.editor`（無いと 403）、(3) Gemini-TTS は追加で `roles/aiplatform.user`（Chirp 3 HD だけなら不要）、(4) STT リージョンは **us / eu のみ**（jp・global 不可）。Vertex AI は 2026 に「Gemini Enterprise Agent Platform」へ改称（API・ロール名は不変）

### 追加候補（レジストリへの追加で対応）

TTS:

| プロバイダー | モデル（2026-07 時点） | 備考 |
|---|---|---|
| Cartesia | sonic-3.5 | sub-90ms、日本語ネイティブ対応（実品質は要PoC）、WebSocket ストリーミング |
| Azure Speech | DragonHD 日本語音声（ja-jp-Nanami / ja-jp-Masaru、GA） | レイテンシ 300ms 未満、入力テキストストリーミング対応（LLM 出力を流し込める） |
| さくらのAI Engine | VOICEVOX 系 8キャラ | OpenAI TTS API 互換。ストリーミング対応は未確認。キャラボイスがインタビュアーのトーンに合うかは要検討 |

STT（いずれも日本語リアルタイムストリーミング対応を確認済み）:

| プロバイダー | モデル（2026-07 時点） | 備考 |
|---|---|---|
| Speechmatics | Ursa 系（Standard / Enhanced） | 新多言語モデル Melia 1 はバッチのみで対象外 |
| Soniox | stt-rt-v5 | 60+言語、WebSocket、音声エージェント界隈で評価良好 |
| Azure Speech | 標準リアルタイム STT | ja-JP 対応。SDK 成熟 |
| AssemblyAI | Universal-3.5 Pro Streaming | 日本語含む18言語のストリーミングに対応済み |

### 検証により除外したもの

- **にじボイス** — サービス終了（2026-02-04。公式発表 2025-11-21）
- **CoeFont** — 提供中だが API はストリーミング非対応（生成済みファイルの取得方式）かつ Plus プラン（$350/月）以上限定。リアルタイム対話に不向き
- **rinna Koemotion** — 提供終了の模様（API ドメイン解決せず。公式発表は未確認）

## 4. アーキテクチャ

Vite + React (TypeScript) のフロントエンドと、Node.js (Hono) のバックエンドの2層構成。pnpm workspace のモノレポ。

- API キーはサーバー側にのみ保持する（ブラウザに露出させない）
- ブラウザ ↔ サーバー間: STT は WebSocket、TTS は HTTP ストリーミング（chunked）
- サーバー ↔ プロバイダー間: 各社の SDK / REST / WebSocket をアダプターで吸収

```
voice-lab/
├── client/                  # Vite + React
│   └── src/
│       ├── pages/           # TtsLabPage / SttLabPage
│       ├── components/      # ModelPicker / Equalizer / LevelMeter など
│       └── lib/             # マイク取得（AudioWorklet）、ストリーミング再生、API/WSクライアント
├── server/                  # Hono + ws
│   └── src/
│       ├── adapters/
│       │   ├── tts/         # openai.ts / elevenlabs.ts / google.ts / aivis.ts
│       │   └── stt/         # openai-realtime.ts / deepgram.ts / elevenlabs.ts / google.ts
│       ├── registry.ts      # モデルレジストリ（モデル定義・パラメータスキーマ）
│       └── routes/          # /api/models, /api/tts, /ws/stt
└── docs/
```

サーバーは 1 プロバイダー由来の未処理エラー（例: 無効な認証情報で Google gRPC クライアントが投げる非同期エラー）で全体が落ちないよう、`index.ts` にプロセスレベルのガード（unhandledRejection / uncaughtException をログして継続）を置く。

### アダプターインターフェース

プロバイダー差異を吸収する境界。**アダプターはプロバイダー単位で実装し、モデル ID は引数で受け取る**。モデル追加は「レジストリ1エントリ」、プロバイダー追加は「アダプター1ファイル + レジストリ1エントリ」で完結させる。

```ts
interface TTSAdapter {
  /** テキストを音声チャンクのストリームに変換する */
  synthesize(req: {
    text: string;
    model: string;
    voice: string;
    params: Record<string, unknown>;
  }): AsyncIterable<Uint8Array>;
}

interface STTAdapter {
  /** ストリーミング文字起こしセッションを開始する */
  startSession(opts: {
    model: string;
    params: Record<string, unknown>;
    onPartial: (text: string, at: number) => void;
    onFinal: (text: string, at: number) => void;
    onError: (err: Error) => void;
  }): {
    sendAudio(chunk: Uint8Array): void;  // 16kHz 16bit PCM mono
    close(): void;
  };
}
```

### モデルレジストリ

レジストリの単位は**モデル**であり、プロバイダーではない。同一プロバイダーの複数モデル（例: ElevenLabs の flash_v2_5 と v3、Deepgram の flux と nova-3、Google の Gemini-TTS と Chirp 3 HD）をそれぞれ独立したエントリとして登録し、GUI 上で同時に選択して並列比較できる。

各エントリはプロバイダー、モデルID、表示名、声の一覧、調整可能パラメータのスキーマを持ち、`registry.ts` に集約する。フロントは `GET /api/models` でこれを取得し、パラメータ UI を動的に生成する。対応する API キーが未設定のモデルはレスポンスから除外（または disabled 表示）し、キーを追加すれば GUI に現れる。

## 5. 画面仕様

### 5.1 TTS Lab

- テキスト入力欄（インタビュー想定のサンプル文をプリセットで数種類用意）
- 利用可能な TTS モデルは既定で全部表示・全部比較対象（不要なものはカード上部クリックで除外）。モデルごとにパラメータ調整（声、速度など。レジストリのスキーマから動的生成）
- 「合成」ボタンで対象モデルへ並列リクエスト
- 結果はモデルごとのカード（プロバイダー色のチャンネルストリップ）を横に並べ、各カードに:
  - 再生ボタン（ストリーミング再生。再生中はイコライザが動く。全カード順次再生ボタンも用意）
  - **TTFB**（リクエスト送信 → 最初の音声チャンク受信）: サーバー計測値とクライアント計測値の両方
  - 合成総時間、音声サイズ
  - TTFB 相対バーで最速モデルを強調表示

### 5.2 STT Lab

- 利用可能な STT モデルは既定で全部表示・全部比較対象（不要なものはカード上部クリックで除外）
- 「録音開始」でマイク取得（AudioWorklet で 16kHz 16bit PCM mono に変換）→ WebSocket でサーバーへ送信 → サーバーが対象モデル全てへ同時配信（ファンアウト）。マイク入力レベルは VU メーターで表示
- モデルごとの列を並べ、逐次表示:
  - partial（途中結果）はグレー、final（確定）は明色で追記
  - 各 partial/final の受信タイムスタンプを記録
- 「停止」時に:
  - 発話終了 → 最終確定までの遅延を各列に表示
  - 最終テキストを全モデル分並べて比較（正解文の目視比較用に、話した内容のメモ欄を任意入力。メモは画面上の参照用でセッション内のみ）

## 6. レイテンシ計測の定義

| 指標 | 定義 | 計測点 |
|---|---|---|
| TTS TTFB | 合成リクエスト送信 → 最初の音声チャンク受信 | サーバー（プロバイダー間の純粋な値）とクライアント（体感値）の両方 |
| TTS 総時間 | リクエスト送信 → 最終チャンク受信 | サーバー |
| STT partial 遅延 | 参考値として partial 受信間隔とタイムスタンプ列を記録 | サーバー |
| STT 確定遅延 | 発話終了（録音停止） → final 受信 | サーバー |

ネットワーク条件で値が揺れるため、複数回実行して見比べる前提（永続化・統計処理はしない。値はセッション内表示のみ）。

## 7. エラーハンドリング

- モデル単位で失敗を隔離する: 並列比較中に1モデルが失敗しても他モデルの結果表示は継続し、失敗したカード/列にエラー内容を表示する
- API キー未設定のモデルは GUI で無効化（グレーアウト + 理由表示）
- WebSocket 切断時は該当セッションを終了扱いにしてエラー表示（自動再接続はしない。実験ツールなので手動リトライで十分）
- プロバイダーのレート制限・課金エラーはメッセージをそのままカードに表示する（デバッグしやすさ優先）

## 8. テスト方針

実験ツールなのでテストは薄くする。ただしロジックが集中する箇所は単体テストを書く（vitest）:

- モデルレジストリのフィルタリング（キー有無による出し分け）
- メトリクス計算（タイムスタンプ列 → 各指標の算出）
- 音声フォーマット変換（Float32 → 16bit PCM など）

プロバイダーアダプターは実 API に依存するため自動テスト対象外とし、GUI からの手動確認とする。

## 9. デプロイ（フェーズ2 — 第一フェーズでは実施しない）

第一フェーズはローカル実行（`pnpm dev`）のみ。共有・スマホ実機での確認が必要になった時点で **Cloud Run（asia-northeast1 / 東京）** へデプロイする。選定は完了しており、以下はその根拠と構成。

選定理由（事実は 2026-07-12 に公式ドキュメントで確認）:

- **東京リージョンが必須**: レイテンシ計測が本ラボの主目的のため、サーバーは日本に置く。Railway は US/EU/シンガポールのみで日本から +150ms 程度が乗るため除外。Fly.io は東京リージョンがあり有力な代替だが、Google Cloud を TTS/STT で契約済みのため追加契約不要な Cloud Run を選ぶ
- **WebSocket 対応**: Cloud Run は WebSocket が GA（追加設定不要）。リクエストタイムアウトを最大値（60分）に設定する。切断時はクライアント側で手動リトライ（§7 の方針どおり）
- **HTTPS 標準**: マイク取得（getUserMedia）は HTTPS 必須のため、デフォルトで HTTPS が付く点も好都合
- **履歴の永続化**: Cloud Run はファイルシステムが揮発するため、`data/` を GCS バケットのボリュームマウント（Cloud Storage FUSE）にする。アプリのコードはローカルと同じファイル操作のままでよい。FUSE は同時書き込みの整合性を保証しないが、単一ユーザーの実験ツールなので許容する
- **API キー管理**: Secret Manager から環境変数に注入。Google の TTS/STT 認証は ADC（サービスアカウント）でキーファイル不要
- **アクセス制限**: 公開 URL のままだと第三者に API キー経由の課金を発生させられるため必須。v1 は Hono ミドルウェアでの Basic 認証（共有パスワード）とし、社内利用が広がる場合は IAP へ移行する

Vercel / Netlify は WebSocket の長時間接続に不向きなため対象外。

## 10. 将来拡張（設計上考慮するが初期実装では作らない）

- **フェーズ2: 対話デモ** — STT / LLM / TTS を1つずつ選び、プッシュトゥトークで実際に会話して「発話終了 → 返答の声が出るまで」をステージ別（STT確定 / LLM初トークン / TTS初音声）に計測するページ。LLM 契約（OpenAI or Anthropic、ストリーミング必須）はこの時点で選定。ルートは `/ws/conversation` を追加
- プロバイダー追加: §3 の追加候補表を参照（アダプター + レジストリ追加のみで対応可能）
- CER（文字誤り率）の自動計算: STT Lab に正解文入力欄を設けて自動採点
- 統合型 speech-to-speech モデルとの比較: OpenAI の Realtime 系（gpt-realtime-2 等）や Google の Gemini Live のような「STT→LLM→TTS を1モデルで置き換える」構成を、対話デモの第4の構成として追加できる余地を残す
- VAD による自動ターンテイキング
- コスト参考表示

## 11. マイルストーン（概要）

第一フェーズは 1〜3 まで実装・実機検証済み。

1. モノレポ雛形 + モデルレジストリ + `.env` 読み込み ✅
2. TTS Lab（OpenAI / ElevenLabs / Google / Aivis）✅
3. STT Lab（Deepgram / OpenAI / ElevenLabs / Google）✅

（フェーズ2: 対話デモ、Cloud Run デプロイ。履歴は当初 4 番目だったが削除）

詳細は実装計画（`2026-07-12-voice-lab-plan.md`）で分解している（同計画には削除前の履歴タスクが残る点に注意）。
