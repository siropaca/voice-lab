import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

// 実験ツールとして、1つのプロバイダー由来の未処理エラー（例: 無効な認証情報で
// Google gRPC クライアントが投げる非同期エラー）でサーバー全体を落とさない。
// ログには残しつつプロセスは生かし続ける（モデル単位の失敗隔離の最後の砦）。
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const { app, injectWebSocket } = createApp(process.env);
const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
