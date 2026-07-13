# 実装メモ・既知の注意点

モデル / プロバイダー固有の挙動や、ラボ設計上の判断をまとめる。  
セットアップ・起動は [README.md](../README.md) を参照。  

## STT のマイク選択

Chrome は deviceId 未指定だと OS の既定デバイスではなく、独自の優先順位（内蔵マイクなど）で選ぶ。  
そのため既定では OS 既定に追従する仮想 `default` デバイスを使い、任意のマイクをセレクタで明示選択できる（選択は localStorage に保存）。  
ドック運用でクラムシェル状態だと内蔵マイクは無音になる点に注意。  

## ボイス一覧の動的取得

TTS のボイスは `GET /api/voices` が各社 API から実行時に取得する。  

- Google: `voices.list` を ja-JP でフィルタ  
- ElevenLabs: `GET /v2/voices` のアカウントライブラリ  
- OpenAI: 固定 13 種  
- Aivis 等: registry のシードにフォールバック  

registry の `voices` は取得失敗時のフォールバック用シード。  
ラボとして「今そのプロバイダーで使えるボイス」を常に全部選べるようにしている。  

## TTS の streaming / batch 分離

画面上部のトグルで切り替え、そのモードのモデルだけを比較する（registry の `streaming` フラグで振り分け）。  
指標の意味が異なるため混在させない。streaming は「最初の音まで（TTFB）」、batch は「全文の合成時間」を主指標にする。  
選択モードは localStorage に保存。  
詳細は [docs/specs/2026-07-13-tts-streaming-batch-split.md](specs/2026-07-13-tts-streaming-batch-split.md) を参照。  

## 対応モデルの網羅方針

各社の現行ラインナップから、日本語対応の選べるモデルを registry に載せている。  

- TTS: OpenAI gpt-4o-mini-tts / tts-1 / tts-1-hd、ElevenLabs Flash / Turbo / Multilingual v2 / v3、Google Chirp3-HD（一括 + streaming）/ Gemini flash・pro / Neural2 / WaveNet / Standard、Aivis  
- STT: OpenAI 4 種、Deepgram Nova-3・2 / Flux、ElevenLabs Scribe v2 Realtime、Google Chirp3 / Chirp2 / latest_long / long / telephony  

英語専用や、連続ストリーミングに不適なモデル（Google `short` 等）は除外している。  

## Google Chirp 3 HD は一括と streaming の 2 エントリ

streaming 合成（`streamingSynthesize`）は MP3 非対応で PCM/24kHz を返す。  
そのためクライアントは `audioFormat: 'pcm16'` を Web Audio（`PcmPlayer`）で、mp3 を MSE（`MsePlayer`）で再生する。  
streaming 版は「最初の音まで」の TTFB が計測できる（一括版は全文合成時間）。  

## Google STT のリージョンはモデル固有

Chirp 3 は `us` / `eu` マルチリージョンのみで `global` 不可（実測確認済み）。  
`latest_long` は `global`、Chirp 2 は `us-central1`。  
registry の `location` でモデルごとに指定する（無指定は `us`）。  
別モデル / リージョンを試すのも registry 1 エントリで足せる。  

## レイテンシ値はネットワーク依存

ローカル実行時は「自宅回線 → 各社」の値になる。  
本番想定（東京 DC → 各社）の数値が必要なら、Cloud Run 等へのデプロイ後に計測する（デプロイは第二フェーズ）。  
