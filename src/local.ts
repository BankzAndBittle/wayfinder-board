import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RawMap, RawTicket, TrackerAdapter } from './model.js';

// `Status: x` and `**Status:** x` both count: /to-tickets writes the bold form.
const field = (md: string, name: string) => new RegExp(`^\\**${name}:?\\**:?\\s*(.+)$`, 'mi').exec(md)?.[1]?.trim() ?? null;

/** A repo root → every `.scratch/<effort>/` that holds a map.md. */
export async function discover(repo: string): Promise<string[]> {
  const scratch = join(repo, '.scratch');
  const entries = await readdir(scratch, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(scratch, e.name, 'map.md')))
    .map((e) => join(scratch, e.name))
    .sort();
}

/** Every `NN-<slug>.md` in a directory as a raw ticket; `impl` reads the triage label into `type` instead of the wayfinder type. */
async function tickets(dir: string, impl: boolean): Promise<RawTicket[]> {
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d+-.*\.md$/.test(f)).sort();
  const raw = await Promise.all(
    files.map(async (f) => {
      const md = await readFile(join(dir, f), 'utf8');
      const num = f.split('-')[0] as string;
      const status = field(md, 'Status')?.toLowerCase() ?? '';
      const assignee = field(md, 'Assignee')?.replace(/^[-—–]$|^none$/i, '') || null;
      const label = (field(md, 'Labels') ?? status).toLowerCase();
      return {
        num,
        md,
        ticket: {
          id: num,
          url: pathToFileURL(join(dir, f)).href,
          title: /^#\s+(?:\d+:\s*)?(.+)$/m.exec(md)?.[1]?.trim() ?? f.replace(/^\d+-|\.md$/g, '').replace(/-/g, ' '),
          body: md,
          open: !/^(resolved|closed|done)\b/.test(status),
          type: impl ? (/ready-for-human/.test(label) ? 'ready-for-human' : 'ready-for-agent') : (field(md, 'Type')?.toLowerCase() ?? null),
          assignee,
          // same as GitHub: an assignee is the claim
          claimed: !!assignee || /^(claimed|in progress)/.test(status),
          blockedBy: [],
        } as RawTicket,
      };
    }),
  );
  const byNum = new Map<number, RawTicket>();
  for (const r of raw) {
    if (byNum.has(Number(r.num))) console.warn(`wayfinder-board: two tickets are numbered ${r.num}; "Blocked by: ${r.num}" is ambiguous until one is renumbered.`);
    byNum.set(Number(r.num), r.ticket);
  }
  for (const r of raw) {
    const nums = (field(r.md, 'Blocked by') ?? '').match(/\d+/g) ?? [];
    r.ticket.blockedBy = nums.flatMap((n) => {
      const b = byNum.get(Number(n));
      return b ? [{ url: b.url, title: b.title, open: b.open }] : [];
    });
  }
  return raw.map((r) => r.ticket);
}

/** The local-markdown tracker: `.scratch/<effort>/map.md` plus `issues/NN-<slug>.md`, and `.scratch/<effort>-impl/issues/` once the spec is split. */
export function local(path: string): TrackerAdapter {
  const mapFile = basename(path) === 'map.md' ? resolve(path) : resolve(path, 'map.md');
  const dir = dirname(mapFile);
  return {
    async load(): Promise<RawMap> {
      const body = await readFile(mapFile, 'utf8');
      const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? basename(dir);
      const spec = join(dir, 'spec.md');
      return {
        title,
        url: pathToFileURL(mapFile).href,
        body,
        tickets: await tickets(join(dir, 'issues'), false),
        impl: await tickets(join(`${dir}-impl`, 'issues'), true),
        spec: existsSync(spec) ? pathToFileURL(spec).href : null,
      };
    },
    async writeMapBody(body) {
      await writeFile(mapFile, body);
    },
  };
}
