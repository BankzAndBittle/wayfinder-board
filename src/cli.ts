#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { github } from './github.js';
import { render } from './html.js';
import { local } from './local.js';
import { upsert } from './mermaid.js';
import { derive } from './model.js';

const USAGE = `Usage: wayfinder-board <map-issue-url | path/to/map.md> [--html out/board.html] [--post] [--open] [--json] [--serve [--port 4173] [--poll 30]]

  --html <file>  write the board as a self-contained HTML file (default out/board.html with --open)
  --post         upsert a Mermaid diagram into the map body (the only write this tool makes)
  --open         open the HTML in the default browser
  --json         print the board model as JSON to stdout (for agents)
  --serve        serve a live board on localhost that re-reads the tracker on refresh
  --port <n>     port for --serve (default 4173)
  --poll <s>     seconds between change checks in the served page (default 30)`;

const openInBrowser = (url: string) => {
  const [cmd, ...args] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open'];
  execFile(cmd as string, [...args, url]).unref();
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      html: { type: 'string' },
      post: { type: 'boolean' },
      open: { type: 'boolean' },
      serve: { type: 'boolean' },
      json: { type: 'boolean' },
      port: { type: 'string', default: '4173' },
      poll: { type: 'string', default: '30' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const ref = positionals[0];
  if (values.help || !ref) {
    console.log(USAGE);
    process.exit(ref || values.help ? 0 : 1);
  }
  const adapter = /^https?:\/\//.test(ref) ? github(ref) : local(ref);
  if (values.json) return console.log(JSON.stringify(derive(await adapter.load()), null, 2));
  if (values.serve) return serve(adapter, Number(values.port), Number(values.poll), values.open);
  const html = values.html ?? (values.open || !values.post ? 'out/board.html' : undefined);
  const raw = await adapter.load();
  const model = derive(raw);

  if (html) {
    const file = resolve(html);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, render(model));
    console.log(`Wrote ${file}`);
    if (values.open) openInBrowser(pathToFileURL(file).href);
  }
  if (values.post) {
    const body = upsert(raw.body, model);
    if (body === raw.body) console.log('Map diagram already up to date.');
    else {
      await adapter.writeMapBody(body);
      console.log(`Updated the diagram on "${model.title}".`);
    }
  }
}

// Every request re-reads the tracker; `/rev` is a fingerprint of the model the page polls to spot changes.
function serve(adapter: ReturnType<typeof local>, port: number, poll: number, open?: boolean) {
  const rev = (m: unknown) => createHash('sha1').update(JSON.stringify(m)).digest('hex').slice(0, 12);
  createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path !== '/' && path !== '/rev') return res.writeHead(404).end();
    try {
      const model = derive(await adapter.load());
      const body = path === '/rev' ? rev(model) : render(model, new Date(), { rev: rev(model), poll });
      res.writeHead(200, { 'content-type': path === '/rev' ? 'text/plain' : 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(body);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'text/plain' }).end(`wayfinder-board: ${(e as Error).message}`);
    }
  }).listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/`;
    console.log(`Serving ${url} (Ctrl-C to stop)`);
    if (open) openInBrowser(url);
  });
}

main().catch((e: Error) => {
  console.error(`wayfinder-board: ${e.message}`);
  process.exit(1);
});
