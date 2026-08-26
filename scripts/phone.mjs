#!/usr/bin/env node
/**
 * One command to test AV Ranch on your phone:  npm run phone
 *
 * Builds the app if needed, starts the server, and prints the Wi-Fi address
 * plus a QR code you can scan with your phone camera. The PWA runs entirely
 * in the phone's browser — this backend is the only thing that has to run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const PORT = Number(process.env.PORT) || 4848;

// 1. Build the frontend if it hasn't been built yet.
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.log('No build found — building the app first (one-time)...\n');
  const r = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('\nBuild failed — fix the error above and run `npm run phone` again.');
    process.exit(1);
  }
}

// 2. Find this computer's Wi-Fi/LAN address.
const candidates = [];
for (const [name, addrs] of Object.entries(networkInterfaces())) {
  for (const a of addrs || []) {
    if (a.family === 'IPv4' && !a.internal) candidates.push({ name, address: a.address });
  }
}
// Prefer typical home-network ranges over virtual adapters.
candidates.sort((a, b) => {
  const score = (c) =>
    (c.address.startsWith('192.168.') ? 0 : c.address.startsWith('10.') ? 1 : 2) +
    (/wi-?fi|wlan|ethernet/i.test(c.name) ? 0 : 10);
  return score(a) - score(b);
});
const ip = candidates[0]?.address;
const url = ip ? `http://${ip}:${PORT}` : `http://localhost:${PORT}`;

console.log('\n============================================================');
console.log('  📲  AV RANCH — TEST IT ON YOUR PHONE');
console.log('============================================================\n');
if (!ip) {
  console.log('  ⚠ Could not find a network address — is Wi-Fi/Ethernet on?');
  console.log('    The app will still run at http://localhost:' + PORT + '\n');
} else {
  console.log(`  1. Put your phone on the same Wi-Fi as this computer.`);
  console.log(`  2. Scan this QR code with the phone camera, or type:`);
  console.log(`\n         ${url}\n`);
  qrcode.generate(url, { small: true });
  console.log(`  3. On iPhone, open it in SAFARI, then:`);
  console.log(`       Share button (square with arrow) -> "Add to Home Screen" -> Add`);
  console.log(`     (The app also shows these steps the first time it opens on a phone.)\n`);
  console.log(`  Phone can't connect?`);
  console.log(`   - When Windows asks about the firewall, allow Node.js on PRIVATE networks.`);
  console.log(`   - Or run this once in an ADMIN PowerShell:`);
  console.log(`       netsh advfirewall firewall add rule name="AV Ranch ${PORT}" dir=in action=allow protocol=TCP localport=${PORT}\n`);
}
console.log('  Press Ctrl+C to stop the server.');
console.log('============================================================\n');

// 3. Start the server (also creates/migrates the database).
await import(join(root, 'server', 'index.js').replace(/\\/g, '/'));
