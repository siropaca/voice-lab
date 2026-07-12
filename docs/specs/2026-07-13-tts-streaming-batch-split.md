# TTS 実験の streaming / batch 分離

- 日付: 2026-07-13
- 状態: 実装着手

## 目的

TTS Lab は現状、streaming モデルと batch（非ストリーミング）モデルを 1 画面で混在比較している。
両者は TTFB の意味が異なる（streaming＝最初の音までの時間、batch＝全文合成の時間）ため、
同じ TTFB バーに並べると比較が誤解を招く。実験を「streaming」「batch」の 2 モードに分け、
各モードで意味の揃った指標だけを比較できるようにする。

## スコープ

- **対象**: クライアントの TTS Lab 画面（提示層）のみ。
- **対象外**: サーバー（TTS ルート・アダプター・メトリクス計算）、STT 画面、同一モデルの
  streaming/batch 両走（本件では扱わない）。

## 仕様

### モード切替（トグル）
- INPUT パネル上部に `[ STREAMING | BATCH ]` のセグメントトグルを置く（mono ラベル調）。
- 選択中モードは localStorage（`voice-lab:tts-mode`）に保存。既定は `streaming`。

### モデル振り分け
- 表示モデル = `models.available` を `kind === 'tts' && streaming === (mode === 'streaming')` でフィルタ。
- 各モードの既定選択はそのモードの全モデル。選択状態はモードごとに独立保持。
- registry の `streaming` フラグを唯一の振り分け基準にする（現状: streaming = OpenAI gpt-4o-mini-tts /
  ElevenLabs Flash v2.5、batch = ElevenLabs v3 / Google Chirp3-HD / Gemini）。

### RUN の挙動
- RUN は現在モードの選択モデルだけを合成する。
- モード切替時は結果カード（cards）をリセットする（実験はモードに紐づくため）。

### 指標のラベル（本分離の肝）
- **streaming モード**: ヒーロー指標 = `ttfb · server`（最初の音まで）。比較バー見出し = `ttfb`。
- **batch モード**: ヒーロー指標 = `合成時間`（= serverTotalMs。batch は first byte ≒ last byte のため全文合成時間）。
  比較バー見出し = `合成時間`。「ttfb」という語は batch では出さない。
- size 等の他行は共通。`fastest` バッジは「最速で音を出したモデル」として両モード維持。

### 空状態
- そのモードに利用可能モデルが 0 の場合、既存の空状態（キー設定を促す）を表示する。

## テスト
- モードによるモデルフィルタを純粋関数に切り出しユニットテスト（streaming/batch それぞれの抽出）。
- 既存の合成ロジック・TTFB 計測は変更しないため回帰は型チェック + 既存テストで担保。

## 受け入れ条件
- トグルで streaming/batch を切り替えると、そのモードのモデルだけが表示・比較される。
- batch モードのヒーロー指標と比較バーが「合成時間」表記になる。
- モード選択が再読み込み後も保持される。
- `make typecheck` / `make test` 緑、ブラウザで両モードの合成が動作。
