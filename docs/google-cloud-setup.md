# Google Cloud セットアップ

voice·lab で Google の TTS (Gemini 2.5 Flash TTS・Chirp 3 HD など) と STT (Chirp 3 系) を使うための準備手順。  
他のプロバイダーは API キーを 1 つ発行して `server/.env` に入れるだけだが、Google は API の有効化と IAM ロールでつまずきやすいのでここにまとめる。  

## 手順

1. Text-to-Speech API と Speech-to-Text API の両方を有効化する。  

   ```sh
   gcloud services enable texttospeech.googleapis.com speech.googleapis.com
   ```

2. STT を使うなら、サービスアカウントに `roles/speech.editor` を付与する。  
   付与していないと 403 になる。  
3. Gemini TTS を使うなら、追加で `roles/aiplatform.user` を付与する。  
   Chirp 3 HD だけを使うなら不要。  
   ※ Vertex AI は 2026 に「Gemini Enterprise Agent Platform」へ改称されたが、API 名・ロール名は同じ。  
4. サービスアカウント JSON を発行し、`server/keys/` に置く。  
   このディレクトリは gitignore 済みなので、鍵ファイルがコミットされる心配はない。  

## 環境変数

`server/.env` に設定する (`server/.env.example` 参照)。  

- `GOOGLE_CLOUD_PROJECT` : プロジェクト ID。Google 系モデルの有効判定に使う (この変数が空だと GUI に Google のモデルが出ない)。  
- `GOOGLE_APPLICATION_CREDENTIALS` : サービスアカウント JSON の絶対パス。相対パスは `server/` 起点で解決される。  

ローカル実行なら、JSON を発行せず ADC (Application Default Credentials) ログインでも動く。  
その場合は `GOOGLE_APPLICATION_CREDENTIALS` を空のままにし、`GOOGLE_CLOUD_PROJECT` だけ設定する。  

```sh
gcloud auth application-default login
```

## 補足

- Google STT のリージョンはモデルごとに固定で、`server/src/registry.ts` の各エントリの `location` で指定している。  
