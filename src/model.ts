// The tracker-neutral shape an adapter produces, and the pure derivation into a BoardModel.

export interface RawTicket {
  id: string; // display id: "#42" on GitHub, "03" locally
  url: string;
  title: string;
  body: string;
  open: boolean;
  type: string | null; // the `wayfinder:<type>` suffix, or null if unlabelled
  assignee: string | null;
  claimed: boolean;
  blockedBy: { url: string; title: string; open: boolean }[];
}

export interface RawMap {
  title: string;
  url: string;
  body: string;
  tickets: RawTicket[];
}

export interface TrackerAdapter {
  load(): Promise<RawMap>;
  /** The only write the tool performs: replace the map's body. */
  writeMapBody(body: string): Promise<void>;
}

export type TicketType = 'research' | 'prototype' | 'grilling' | 'task' | 'untyped';
export type TicketState = 'frontier' | 'blocked' | 'inSession' | 'decided' | 'outOfScope';

export interface Ticket {
  id: string;
  url: string;
  title: string;
  type: TicketType;
  hitl: boolean;
  state: TicketState;
  assignee: string | null;
  blockedBy: string[]; // urls of every blocker, open or closed
  waitingOn: string[]; // titles of open blockers
  question: string | null;
}

export interface BoardModel {
  title: string;
  url: string;
  destination: string;
  notes: string;
  fog: string[];
  outOfScope: string[];
  tickets: Ticket[];
}

const TYPES = new Set(['research', 'prototype', 'grilling', 'task']);

/** Text under `## <name>` up to the next `## `, HTML comments stripped. */
export function section(md: string, name: string): string {
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${name}`.toLowerCase());
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

/** Top-level bullets (continuation lines folded in); falls back to paragraphs when there are none. */
export function items(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  let bullets = false;
  for (const line of text.split('\n')) {
    const m = /^[-*+]\s+(.*)$/.exec(line);
    if (m) {
      bullets = true;
      out.push(m[1] ?? '');
    } else if (bullets && line.trim() && out.length) {
      out[out.length - 1] += ` ${line.trim().replace(/^[-*+]\s+/, '')}`;
    }
  }
  const all = bullets ? out.map((s) => s.trim()) : text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim());
  // ponytail: placeholder lines like "(empty: …)" or "<!-- … -->" are not items
  return all.filter((s) => s && !/^(\(.*\)|<!--.*-->)$/s.test(s));
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does a line of map markdown point at this ticket (full URL, relative link, or bare #N)? */
export function mentions(line: string, t: Pick<RawTicket, 'url' | 'id'>): boolean {
  if (new RegExp(`${esc(t.url)}(?![\\w/])`).test(line)) return true;
  for (const [, href] of line.matchAll(/\]\(([^)\s#]+)/g)) {
    if (href && t.url.endsWith(`/${href.replace(/^\.\//, '')}`)) return true;
  }
  return t.id.startsWith('#') && new RegExp(`(?<![\\w/&])${esc(t.id)}\\b`).test(line);
}

export function derive(raw: RawMap): BoardModel {
  const decisions = items(section(raw.body, 'Decisions so far'));
  const outOfScope = items(section(raw.body, 'Out of scope'));
  const tickets = raw.tickets.map((t): Ticket => {
    const type = (t.type && TYPES.has(t.type) ? t.type : 'untyped') as TicketType;
    const waitingOn = t.blockedBy.filter((b) => b.open).map((b) => b.title);
    let state: TicketState;
    // ponytail: a closed ticket listed in neither section still counts as decided; the map index lags the tracker.
    if (!t.open) state = outOfScope.some((l) => mentions(l, t)) && !decisions.some((l) => mentions(l, t)) ? 'outOfScope' : 'decided';
    else if (t.claimed) state = 'inSession';
    else if (waitingOn.length) state = 'blocked';
    else state = 'frontier';
    const question = section(t.body, 'Question');
    return {
      id: t.id,
      url: t.url,
      title: t.title,
      type,
      hitl: type !== 'research',
      state,
      assignee: t.assignee,
      blockedBy: t.blockedBy.map((b) => b.url),
      waitingOn,
      question: question || null,
    };
  });
  return {
    title: raw.title,
    url: raw.url,
    destination: section(raw.body, 'Destination'),
    notes: section(raw.body, 'Notes'),
    fog: items(section(raw.body, 'Not yet specified')),
    outOfScope,
    tickets,
  };
}
