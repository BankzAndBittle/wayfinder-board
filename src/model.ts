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
  /** Implementation slices split from the finished map (`<effort>-impl/issues/` locally); `type` carries the triage label. */
  impl: RawTicket[];
  spec: string | null; // url of the locked spec, when the tracker can see one
}

export interface TrackerAdapter {
  load(): Promise<RawMap>;
  /** The only write the tool performs: replace the map's body. */
  writeMapBody(body: string): Promise<void>;
}

export type TicketType = 'research' | 'prototype' | 'grilling' | 'task' | 'untyped' | 'impl';
/** Where an effort is: still deciding, decided but not yet sliced, slices in flight, or every slice done. */
export type Stage = 'charting' | 'needsTickets' | 'implementing' | 'done';
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
  summary: string; // `## What it does`: the plain-language headline; the board falls back to the destination
  notes: string;
  fog: string[];
  outOfScope: string[];
  tickets: Ticket[];
  stage: Stage;
  impl: Ticket[]; // implementation slices; `hitl` means labelled ready-for-human
  spec: string | null;
}

const undecided = (t: Ticket) => t.state !== 'decided' && t.state !== 'outOfScope';
/** A map still has somewhere to go: fog left, or a ticket that isn't decided or ruled out. */
export const isOpen = (m: Pick<BoardModel, 'fog' | 'tickets'>) => m.fog.length > 0 || m.tickets.some(undecided);

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
  const ticket = (t: RawTicket, impl: boolean): Ticket => {
    const type: TicketType = impl ? 'impl' : t.type && TYPES.has(t.type) ? (t.type as TicketType) : 'untyped';
    const waitingOn = t.blockedBy.filter((b) => b.open).map((b) => b.title);
    let state: TicketState;
    // ponytail: a closed ticket listed in neither section still counts as decided; the map index lags the tracker.
    if (!t.open) state = !impl && outOfScope.some((l) => mentions(l, t)) && !decisions.some((l) => mentions(l, t)) ? 'outOfScope' : 'decided';
    else if (t.claimed) state = 'inSession';
    else if (waitingOn.length) state = 'blocked';
    else state = 'frontier';
    // Slices from /to-tickets carry "## Goal" or a bold "What to build:" lead instead of a question.
    const question = section(t.body, 'Question') || section(t.body, 'Goal') || /\*\*What to build:\*\*\s*([^\n]+)/.exec(t.body)?.[1]?.trim() || '';
    return {
      id: t.id,
      url: t.url,
      title: t.title,
      type,
      hitl: impl ? t.type === 'ready-for-human' : type !== 'research',
      state,
      assignee: t.assignee,
      blockedBy: t.blockedBy.map((b) => b.url),
      waitingOn,
      question: question || null,
    };
  };
  const tickets = raw.tickets.map((t) => ticket(t, false));
  const impl = raw.impl.map((t) => ticket(t, true));
  const fog = items(section(raw.body, 'Not yet specified'));
  // `Status: complete` near the top of the map says the destination is reached even when fog outlives it.
  const complete = /^\**status:?\**:?\s*complete/im.test(raw.body) || !isOpen({ fog, tickets });
  const stage: Stage = impl.length ? (impl.some(undecided) ? 'implementing' : 'done') : complete ? 'needsTickets' : 'charting';
  return {
    title: raw.title.replace(/\s*[—–-]\s*Wayfinder Map$/i, ''),
    url: raw.url,
    destination: section(raw.body, 'Destination'),
    summary: section(raw.body, 'What it does'),
    notes: section(raw.body, 'Notes'),
    fog,
    outOfScope,
    tickets,
    stage,
    impl,
    spec: raw.spec,
  };
}
