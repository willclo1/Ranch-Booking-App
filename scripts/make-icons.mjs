#!/usr/bin/env node
/**
 * Generates the PWA icons and in-app logo from the real AV Ranch logo
 * (assets/logo-original.png). Run after cloning if public/icons is missing:
 *   npm run icons
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, '..', 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });

const src = readFileSync(join(__dirname, '..', 'assets', 'logo-original.png'));
const b64 = src.toString('base64');

/** Wrap the logo PNG in an SVG so resvg can resize it cleanly. */
function wrap(size, { pad = 0, background = '#ffffff' } = {}) {
  const inner = size - 2 * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${background}"/>
  <image x="${pad}" y="${pad}" width="${inner}" height="${inner}" href="data:image/png;base64,${b64}"/>
</svg>`;
}

function renderPng(svg, size, file) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  writeFileSync(join(pub, file), png);
  console.log(`  ${file} (${size}x${size}, ${(png.length / 1024).toFixed(0)} KB)`);
}

console.log('Generating icons from assets/logo-original.png...');
renderPng(wrap(512), 512, 'logo.png'); // in-app logo (login, header)
renderPng(wrap(192), 192, 'icons/icon-192.png');
renderPng(wrap(512), 512, 'icons/icon-512.png');
renderPng(wrap(512, { pad: 60 }), 512, 'icons/icon-maskable-512.png');
renderPng(wrap(180), 180, 'icons/apple-touch-icon.png');
console.log('Done.');
