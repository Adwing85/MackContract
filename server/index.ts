import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { openDb } from './db';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(rootDir, 'data'));
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

mkdirSync(dataDir, { recursive: true });
const db = openDb(path.join(dataDir, 'mackcontract.db'));
const app = createApp({
  db,
  uploadDir: path.join(dataDir, 'uploads'),
  staticDir: path.join(rootDir, 'dist'),
});

const server = app.listen(port, host, () => {
  console.log(`MackContract läuft auf http://localhost:${port}  (Daten: ${dataDir})`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
