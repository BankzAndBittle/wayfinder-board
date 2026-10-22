// Screenshot out/*.html at desktop and phone widths in both themes into out/shots/.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['board', 'board#map', 'edge', 'all', 'impl', 'impl#map'];
mkdirSync('out/shots', { recursive: true });
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    for (const p of pages) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
      const [name, hash] = p.split('#');
      await page.goto(`${pathToFileURL(resolve(`out/${name}.html`)).href}${hash ? `#${hash}` : ''}`);
      await page.evaluate(() => document.fonts.ready);
      const file = `out/shots/${p.replace('#', '-')}-${w}-${scheme}.png`;
      await page.screenshot({ path: file, fullPage: !hash });
      console.log(file);
      await page.close();
    }
  }
}
await browser.close();
