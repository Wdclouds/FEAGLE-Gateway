import { rmSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const publicDir = resolve('..', 'bridge', 'src', 'public');
const assetsDir = join(publicDir, 'assets');
const oldFiles = ['index.html', 'app.js', 'styles.css', 'pixel-blast.js'];

for (const file of oldFiles) {
  const p = join(publicDir, file);
  if (existsSync(p)) {
    rmSync(p, { force: true });
  }
}

if (existsSync(assetsDir)) {
  const entries = readdirSync(assetsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.css') || entry.name.endsWith('.map'))) {
      rmSync(join(assetsDir, entry.name), { force: true });
    }
  }
}

console.log('[clean-assets] Legacy frontend assets cleaned successfully. downloads/ folder preserved.');
