import { createApp } from './app.js';

const port = Number(process.env['PORT'] ?? 3000);

createApp().listen(port, () => {
  // Replaced by the pino logger in M2.
  // eslint-disable-next-line no-console
  console.log(`Listening on http://localhost:${port}`);
});
