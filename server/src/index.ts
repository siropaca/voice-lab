import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const { app, injectWebSocket } = createApp(process.env);
const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
