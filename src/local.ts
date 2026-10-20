import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RawMap, RawTicket, TrackerAdapter } from './model.js';

const field = (md: string, name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(md)?.[1]?.trim() ?? null;

/** The local-markdown tracker: `.scratch/<effort>/map.md` plus `issues/NN-<slug>.md`. */
export function local(path: string): TrackerAdapter {
  const mapFile = basename(path) === 'map.md' ? resolve(path) : resolve(path, 'map.md');
  const dir = dirname(mapFile);
  return {
    async load(): Promise<RawMap> {
      const body = await readFile(mapFile, 'utf8');
      const files = (await readdir(join(dir, 'issues')).catch(() => [])).filter((f) => /^\d+-.*\.md$/.test(f)).sort();
      const raw = await Promise.all(
        files.map(async (f) => {
          const md = await readFile(join(dir, 'issues', f), 'utf8');
          const num = f.split('-')[0] as string;
          const status = field(md, 'Status')?.toLowerCase() ?? '';
          const assignee = field(md, 'Assignee')?.replace(/^[-—–]$|^none$/i, '') || null;
          return {
            num,
            md,
            ticket: {
              id: num,
              url: pathToFileURL(join(dir, 'issues', f)).href,
              title: /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? f.replace(/^\d+-|\.md$/g, '').replace(/-/g, ' '),
              body: md,
              open: !/^(resolved|closed|done)\b/.test(status),
              type: field(md, 'Type')?.toLowerCase() ?? null,
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
      const title = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? basename(dir);
      return { title, url: pathToFileURL(mapFile).href, body, tickets: raw.map((r) => r.ticket) };
    },
    async writeMapBody(body) {
      await writeFile(mapFile, body);
    },
  };
}
