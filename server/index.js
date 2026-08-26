import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { getDb } from './db.js';
import { attachUser } from './auth.js';
import { auth } from './routes/auth.js';
import { users, rooms } from './routes/users.js';
import { bookings } from './routes/bookings.js';
import { lists } from './routes/lists.js';
import { checklists } from './routes/checklists.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4848;

getDb(); // open + migrate + seed on boot

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(attachUser);

app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/rooms', rooms);
app.use('/api/bookings', bookings);
app.use('/api/lists', lists);
app.use('/api/checklists', checklists);
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built PWA if it exists (npm run build), with SPA fallback.
const dist = join(__dirname, '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res
      .type('text/plain')
      .send('AV Ranch API is running. Build the app with `npm run build`, or use `npm run dev` for development.')
  );
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  AV Ranch running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Network: http://${a.address}:${PORT}  (${name})`);
    }
  }
  console.log('');
});
