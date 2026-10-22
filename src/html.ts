import { layout, NODE_W } from './layout.js';
import { type BoardModel, mentions, type Stage, type Ticket } from './model.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plain = (s: string) => s.replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2');

/** Map markdown → inline HTML. Ticket references always render as the ticket's title ("refer by name"). */
export function inline(md: string, tickets: Ticket[]): string {
  const find = (s: string) => tickets.find((t) => mentions(s, t));
  const link = (href: string, label: string) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(plain(label))}</a>`;
  let out = '';
  let last = 0;
  for (const m of md.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)|https?:\/\/[^\s)<>]+|(?<![\w/&])#\d+\b/g)) {
    out += esc(plain(md.slice(last, m.index)));
    last = (m.index ?? 0) + m[0].length;
    const t = find(m[0]);
    if (m[1] !== undefined) out += link(t?.url ?? (m[2] as string), t && /^#?\d+$/.test(m[1]) ? t.title : m[1]);
    else out += t ? link(t.url, t.title) : m[0].startsWith('#') ? esc(m[0]) : link(m[0], m[0]);
  }
  return out + esc(plain(md.slice(last)));
}

function excerpt(md: string, max = 140): string {
  const s = plain(md.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, s.lastIndexOf(' ', max)).replace(/[\s,.;:]+$/, '')}…`;
}

// Slices carry the triage label where decisions carry HITL/AFK.
const kind = (t: Ticket) => (t.type === 'untyped' ? '' : t.type === 'impl' ? (t.hitl ? 'ready-for-human' : '') : t.hitl ? 'HITL' : 'AFK');
const meta = (t: Ticket) =>
  [t.type === 'untyped' ? '<span class="untyped">untyped</span>' : t.type, kind(t), t.assignee ? `<span class="who">${esc(t.assignee)}</span>` : ''].filter(Boolean).join(' · ');

/** Local tickets are file URLs; the skills take paths. */
const loc = (u: string) => u.replace(/^file:\/\//, '');

// Eight hues at matched lightness/chroma so no map shouts louder than another; wraps past eight.
const HUES = [40, 150, 290, 200, 330, 100, 10, 250]; // blue last: it reads as the accent
const mapColor = (i: number) => `oklch(62% 0.16 ${HUES[i % HUES.length]})`;

/** `mapTitle` tags the card with the map it belongs to; only the all-maps panel needs it, and `mapIdx` picks its colour. */
function card(t: Ticket, mapUrl: string, mapTitle?: string, mapIdx = 0): string {
  const q = t.question ? esc(excerpt(t.question)) : '<span class="none">No question written.</span>';
  const waiting = t.state === 'blocked' && t.waitingOn.length ? `<span class="waiting">Waiting on ${t.waitingOn.map((w) => esc(w)).join('; ')}</span>` : '';
  const cmd = t.type === 'impl' ? `/implement ${loc(t.url)}` : `/wayfinder ${loc(mapUrl)} ${loc(t.url)}`;
  const copy = t.state === 'frontier' && !(t.type === 'impl' && t.hitl) ? `<button type="button" class="copy" data-cmd="${esc(cmd)}">copy command</button>` : '';
  return `<li class="card ${t.state}"${mapTitle ? ` style="--map:${mapColor(mapIdx)}"` : ''}>
<a class="t" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a>
<div class="meta">${from(mapUrl, mapTitle)}${meta(t)} <span class="id">${esc(t.id)}</span></div>${copy}
<div class="q" aria-hidden="true"><div>${q}${waiting}</div></div>
</li>`;
}

const from = (mapUrl: string, mapTitle?: string) => (mapTitle ? `<a class="map" href="${esc(mapUrl)}" target="_blank" rel="noopener">${esc(mapTitle)}</a> · ` : '');

/** The one frontier card of a finished map that hasn't been split yet: it copies the /to-tickets command. */
function splitCard(m: BoardModel, mapTitle?: string, mapIdx = 0): string {
  const target = m.spec ?? m.url;
  return `<li class="card frontier split"${mapTitle ? ` style="--map:${mapColor(mapIdx)}"` : ''}>
<a class="t" href="${esc(target)}" target="_blank" rel="noopener">Split the ${m.spec ? 'spec' : 'map'} into implementation tickets</a>
<div class="meta">${from(m.url, mapTitle)}to-tickets</div>
<button type="button" class="copy" data-cmd="${esc(`/to-tickets ${loc(target)}`)}">copy command</button>
</li>`;
}

function column(name: string, cls: string, body: string[]): string {
  return `<section class="col ${cls}" aria-label="${name}">
<h2>${name} <span class="n">${body.length}</span></h2>
<ol>${body.join('\n')}</ol>
</section>`;
}

function wrap(s: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(/\s+/)) {
    if (cur && `${cur} ${w}`.length > max) {
      out.push(cur);
      cur = w;
      if (out.length === lines) break;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (out.length < lines && cur) out.push(cur);
  else if (out.length === lines && s.length > out.join(' ').length) out[lines - 1] = `${(out[lines - 1] as string).replace(/[\s,.;:?]*\S{0,3}$/, '')}…`;
  return out;
}

// ponytail: line breaks are estimated from character counts at 14px Inter; swap for canvas measureText if titles overflow.
const LINE = 19;
const titleLines = (t: Ticket) => wrap(t.title, 30, 4);
const nodeHeight = (t: Ticket) => 28 + titleLines(t).length * LINE + 22;

/** `fog` is null for an implementation graph: slices have no fog past them. */
function mapSvg(tickets: Ticket[], fog: string[] | null, i: number): string {
  const live = tickets.filter((t) => t.state !== 'outOfScope');
  const g = layout(live, (t) => t.url, (t) => t.blockedBy, nodeHeight);
  const at = new Map(g.nodes.map((n) => [n.item.url, n]));
  const edges = g.edges
    .map(({ from, to }) => {
      const a = at.get(from);
      const b = at.get(to);
      if (!a || !b) return '';
      const x1 = a.x + NODE_W;
      const y1 = a.y + a.h / 2;
      const x2 = b.x - 4;
      const y2 = b.y + b.h / 2;
      const dx = Math.max(32, (x2 - x1) / 2);
      return `<path class="edge${a.item.state === 'decided' ? ' done' : ''}" d="M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}" marker-end="url(#arrow-${i})"/>`;
    })
    .join('');
  const nodes = g.nodes
    .map(({ item: t, x, y, h }) => {
      const lines = titleLines(t);
      const tspans = lines.map((l, i) => `<tspan x="${x + 14}" y="${y + 26 + i * LINE}">${esc(l)}</tspan>`).join('');
      const tip = t.question ? excerpt(t.question) : 'No question written.';
      return `<a class="node ${t.state}" href="${esc(t.url)}" target="_blank" rel="noopener"><title>${esc(tip)}</title>
<rect x="${x}" y="${y}" width="${NODE_W}" height="${h}" rx="6"/>
<text class="nt">${tspans}</text>
<text class="nm" x="${x + 14}" y="${y + h - 16}">${meta(t).replace(/<[^>]+>/g, '')}</text></a>`;
    })
    .join('');

  // The fog sits past the last column: where the map stops being charted.
  let fogSvg = '';
  let w = g.width;
  let h = g.height;
  if (fog) {
    const fx = g.nodes.length ? g.width + g.colGap : 0;
    const fogLines = fog.length ? fog.map((f) => wrap(plain(f), 34, 4)) : [['Nothing left unspecified.']];
    let fy = 56;
    const fogText = fogLines
      .map((ls) => {
        const block = ls.map((l, i) => `<tspan x="${fx + 20}" y="${fy + i * LINE}">${esc(l)}</tspan>`).join('');
        fy += ls.length * LINE + 14;
        return `<text class="ft">${block}</text>`;
      })
      .join('');
    const fh = Math.max(g.height, fy + 6);
    fogSvg = `<g class="fog${fog.length ? '' : ' empty'}"><rect x="${fx}" y="0" width="288" height="${fh}" rx="6"/><text class="fl" x="${fx + 20}" y="30">NOT YET SPECIFIED</text>${fogText}</g>`;
    w = fx + 288;
    h = Math.max(fh, g.height);
  }
  return `<svg class="graph" role="img" aria-label="Blocking graph" data-w="${w}" data-h="${h}">
<defs><marker id="arrow-${i}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0.5 L7.5 4 L0 7.5" /></marker></defs>
<g class="viewport"><g transform="translate(0 ${(h - g.height) / 2})">${edges}${nodes}</g>${fogSvg}</g>
</svg>`;
}

const STAGE: Record<Stage, string> = { charting: 'Charting', needsTickets: 'Needs tickets', implementing: 'Implementing', done: 'Done' };
const n = (ts: Ticket[], s: Ticket['state']) => ts.filter((t) => t.state === s).length;

/** One line of counts per effort, by what its stage makes worth counting. */
function tally(m: BoardModel): string {
  if (m.stage === 'charting') return `${n(m.tickets, 'decided')} decided · ${n(m.tickets, 'frontier') + n(m.tickets, 'blocked') + n(m.tickets, 'inSession')} open · ${m.fog.length} in fog`;
  if (m.stage === 'needsTickets') return `${m.spec ? 'spec locked' : 'map complete'} · awaiting /to-tickets`;
  if (m.stage === 'done') return `${m.impl.length} slices done`;
  return `${n(m.impl, 'inSession')} in session · ${n(m.impl, 'frontier')} ready · ${n(m.impl, 'blocked')} queued · ${n(m.impl, 'decided')} done`;
}

/** An implementing effort's whole slice graph is one `/implement-spec` on its tickets directory. */
const runAll = (m: BoardModel) => {
  const first = m.impl[0];
  if (m.stage !== 'implementing' || !first) return '';
  return `<button type="button" class="copy" data-cmd="${esc(`/implement-spec ${loc(first.url).replace(/\/[^/]+$/, '')}`)}">copy command</button>`;
};

/** The effort strip: every map under its stage, each a button onto its own tab. */
function efforts(ms: BoardModel[]): string {
  const groups = (['implementing', 'needsTickets', 'charting', 'done'] as Stage[])
    .map((st) => [st, ms.map((m, i) => [m, i] as const).filter(([m]) => m.stage === st)] as const)
    .filter(([, rows]) => rows.length);
  return `<div class="efforts">
${groups
  .map(
    ([st, rows]) => `<section class="col" aria-label="${STAGE[st]}">
<h2>${STAGE[st]} <span class="n">${rows.length}</span></h2>
<ul>${rows.map(([m, i]) => `<li style="--map:${mapColor(i)}"><button type="button" class="go" data-panel="panel-${i}">${esc(m.title)}</button><span class="counts">${esc(tally(m))}</span>${runAll(m)}</li>`).join('')}</ul>
</section>`,
  )
  .join('\n')}
</div>`;
}

const refreshBtn = (live?: object) => (live ? ' <button type="button" class="refresh">· refresh</button>' : '');

/** One map: masthead, Board/Map tabs, board and graph. Ids carry `i` so several panels can share a page. */
function mapPanel(m: BoardModel, i: number, slug: string, stamp: string, hidden: boolean, live?: object): string {
  const by = (ts: Ticket[], s: Ticket['state']) => ts.filter((t) => t.state === s).map((t) => card(t, m.url));
  const slicing = m.stage !== 'charting';
  const decided = n(m.tickets, 'decided');
  const open = n(m.tickets, 'frontier') + n(m.tickets, 'blocked') + n(m.tickets, 'inSession');
  const done = n(m.impl, 'decided');
  const pct = slicing ? (m.impl.length ? (done / m.impl.length) * 100 : 0) : decided + open ? (decided / (decided + open)) * 100 : 0;
  const oos = m.outOfScope.length
    ? `<details class="oos"><summary>Out of scope <span class="n">${m.outOfScope.length}</span></summary><ul>${m.outOfScope.map((o) => `<li>${inline(o, m.tickets)}</li>`).join('')}</ul></details>`
    : '';
  const decisions = `<div class="board">
${column('Fog', 'fog', m.fog.map((f) => `<li class="fogcard">${inline(f, m.tickets)}</li>`))}
${column('Blocked', 'blocked', by(m.tickets, 'blocked'))}
${column('Frontier', 'frontier', by(m.tickets, 'frontier'))}
${column('In session', 'insession', by(m.tickets, 'inSession'))}
${column('Decided', 'decided', by(m.tickets, 'decided'))}
</div>
${oos}`;
  // Once the map is complete the slices take the board; the decisions fold away, open again only if any are still live.
  const board = slicing
    ? `<div class="board four">
${column('Queued', 'blocked', by(m.impl, 'blocked'))}
${column('Ready', 'frontier', [...(m.stage === 'needsTickets' ? [splitCard(m)] : []), ...by(m.impl, 'frontier')])}
${column('In session', 'insession', by(m.impl, 'inSession'))}
${column('Done', 'decided', by(m.impl, 'decided'))}
</div>
<details class="oos decisions"${open ? ' open' : ''}><summary>Map complete · ${decided} decided${open ? ` · ${open} still open` : ''}${m.spec ? ` · <a href="${esc(m.spec)}" target="_blank" rel="noopener">spec</a>` : ''}</summary>
${decisions}
</details>`
    : decisions;
  return `<div class="panel" id="panel-${i}" data-slug="${esc(slug)}"${hidden ? ' hidden' : ''}>
<header class="mast">
  <div class="lede">
    <p class="maptitle"><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a> <span class="stamp">· ${esc(stamp)}</span>${refreshBtn(live)}</p>
    <h1 class="dest">${inline(m.summary || m.destination || 'No destination named yet.', m.tickets)}</h1>
  </div>
  <div class="progress" aria-label="Progress">
    <div class="rule"><span style="width:${pct.toFixed(1)}%"></span></div>
    <p>${slicing ? `${STAGE[m.stage]} · ${tally(m)}` : tally(m)}</p>
  </div>
</header>
<nav class="tabs" role="tablist" aria-label="View">
  <button role="tab" id="tab-board-${i}" aria-controls="board-${i}" aria-selected="true" aria-keyshortcuts="1">Board</button>
  <button role="tab" id="tab-map-${i}" aria-controls="map-${i}" aria-selected="false" aria-keyshortcuts="2" tabindex="-1">Map</button>
</nav>
<div id="board-${i}" role="tabpanel" aria-labelledby="tab-board-${i}">
${board}
</div>
<div id="map-${i}" role="tabpanel" aria-labelledby="tab-map-${i}" hidden>
<div class="canvas">${m.impl.length ? mapSvg(m.impl, null, i) : mapSvg(m.tickets, m.fog, i)}<button type="button" class="fit">Fit</button></div>
</div>
</div>`;
}

/** Every map's in-session and frontier tickets on one board, each card tagged with its map. */
function allPanel(ms: BoardModel[], stamp: string, live?: object): string {
  const all = (m: BoardModel) => [...m.tickets, ...m.impl];
  const by = (s: Ticket['state']) => ms.flatMap((m, i) => all(m).filter((t) => t.state === s).map((t) => card(t, m.url, m.title, i)));
  const count = (s: Ticket['state']) => ms.reduce((k, m) => k + n(all(m), s), 0);
  const inSession = by('inSession');
  const frontier = [...ms.flatMap((m, i) => (m.stage === 'needsTickets' ? [splitCard(m, m.title, i)] : [])), ...by('frontier')];
  return `<div class="panel" id="panel-all" data-slug="">
<header class="mast">
  <div class="lede">
    <p class="maptitle">${ms.length} maps <span class="stamp">· ${esc(stamp)}</span>${refreshBtn(live)}</p>
  </div>
  <div class="progress" aria-label="Progress">
    <p>${inSession.length} in session · ${frontier.length} on the frontier · ${count('blocked')} blocked</p>
  </div>
</header>
${efforts(ms)}
<div class="board two">
${column('In session', 'insession', inSession)}
${column('Frontier', 'frontier', frontier)}
</div>
</div>`;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';

export function render(model: BoardModel | BoardModel[], now = new Date(), live?: { rev: string; poll: number }): string {
  const ms = Array.isArray(model) ? model : [model];
  const many = ms.length > 1;
  const stamp = now.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const slugs: string[] = [];
  for (const m of ms) {
    const s = slugify(m.title);
    slugs.push(slugs.includes(s) ? `${s}-${slugs.length + 1}` : s);
  }
  const switcher = many
    ? `<nav class="tabs maps" role="tablist" aria-label="Map">
  <button role="tab" aria-controls="panel-all" aria-selected="true">All maps</button>
${ms.map((m, i) => `  <button role="tab" aria-controls="panel-${i}" aria-selected="false" tabindex="-1" style="--map:${mapColor(i)}">${esc(m.title)}</button>`).join('\n')}
</nav>
${allPanel(ms, stamp, live)}`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(many ? `${ms.length} maps` : (ms[0] as BoardModel).title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>${CSS}</style>
</head>
<body${live ? ` data-rev="${live.rev}" data-poll="${live.poll}"` : ''}>
<main>
${switcher}
${ms.map((m, i) => mapPanel(m, i, slugs[i] as string, stamp, many, live)).join('\n')}
</main>
<script>${JS}</script>
</body>
</html>
`;
}

const CSS = `
:root{--bg:#FAFAF9;--surface:#FFFFFF;--line:#E4E4E1;--text:#1B1B1A;--text-muted:#6E6E6A;--accent:#2F6FED;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111113;--surface:#18181B;--line:#2B2B30;--text:#EDEDEF;--text-muted:#8D8D95;--accent:#7AA2FF;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111113;--surface:#18181B;--line:#2B2B30;--text:#EDEDEF;--text-muted:#8D8D95;--accent:#7AA2FF;color-scheme:dark}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font:400 14px/1.4 Inter,system-ui,-apple-system,"Segoe UI",sans-serif;font-feature-settings:"cv11","ss01";-webkit-font-smoothing:antialiased}
main{max-width:1280px;margin:0 auto;padding:48px 24px 64px}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
ol,ul{list-style:none}
.n,.progress p{font-variant-numeric:tabular-nums}

.mast{display:flex;justify-content:space-between;align-items:flex-end;gap:48px;padding-bottom:32px}
.lede{min-width:0;max-width:800px}
.maptitle{font-size:14px;color:var(--text-muted);margin-bottom:8px}
.maptitle a:hover{color:var(--text)}
.stamp{font-size:12px;white-space:nowrap}
.refresh{font-size:12px;color:var(--text-muted);transition:color 120ms ease-out}
.refresh:hover{color:var(--text)}
.refresh.stale{color:var(--text);font-weight:500}
h1{font-size:28px;line-height:1.1;letter-spacing:-0.02em;font-weight:600;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}
h1 a{text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:4px}
h1.clamped{cursor:pointer}
h1.open{-webkit-line-clamp:unset;display:block}
.progress{flex:0 0 240px;padding-bottom:2px}
.rule{height:2px;background:var(--line);margin-bottom:8px}
.rule span{display:block;height:100%;background:var(--text)}
.progress p{font-size:12px;color:var(--text-muted);white-space:nowrap}

.tabs{display:flex;gap:24px;border-bottom:1px solid var(--line);margin-bottom:24px}
.tabs button{padding:8px 0;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--text-muted)}
.tabs button:hover{color:var(--text)}
.tabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--text);font-weight:500}
.tabs.maps{gap:32px;margin-bottom:40px;flex-wrap:wrap}
.tabs.maps button{font-size:16px}
.tabs.maps button[style]::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--map);margin-right:8px;vertical-align:1px}
.tabs.maps button[style][aria-selected="true"]{border-bottom-color:var(--map)}

.board{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;align-items:start}
.board.two{grid-template-columns:repeat(2,minmax(0,1fr));max-width:800px}
.board.four{grid-template-columns:repeat(4,minmax(0,1fr))}
.efforts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px 32px;align-items:start;margin-bottom:40px}
.efforts li{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--line)}
.efforts .go{text-align:left;font-weight:500;width:max-content;max-width:100%}
.efforts .go::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--map);margin-right:8px;vertical-align:1px}
.efforts .go:hover{color:var(--accent)}
.efforts .counts{font-size:12px;color:var(--text-muted);padding-left:16px}
.efforts .copy{align-self:flex-start;margin:2px 0 0 16px;color:var(--text-muted)}
.efforts li:hover .copy,.efforts li:focus-within .copy{color:var(--accent)}
.decisions{margin-top:40px}
.decisions .board{margin-top:24px}
.decisions summary a{text-decoration:underline;text-underline-offset:2px}
.col h2{font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);padding-bottom:8px;border-bottom:1px solid var(--line);margin-bottom:8px}
.col h2 .n{margin-left:4px;opacity:.7}
.col.frontier h2{color:var(--text);font-weight:600;border-bottom-color:var(--accent)}
.col.frontier h2 .n{color:var(--accent);opacity:1}
.col ol{display:flex;flex-direction:column;gap:8px}

.card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:12px;transition:border-color 120ms ease-out}
.card:hover,.card:focus-within{border-color:var(--text-muted)}
.card.frontier:hover,.card.frontier:focus-within{border-color:var(--accent)}
.card.blocked{background:transparent}
.card.decided>.t,.card.decided>.meta{opacity:.55}
.card .t{display:block;font-weight:500}
.card .t::after{content:"";position:absolute;inset:0;border-radius:6px}
.card .t:focus-visible{outline:none}
.card:has(.t:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.meta{margin-top:8px;font-size:12px;color:var(--text-muted)}
.meta .who{color:var(--text)}
.meta .map{position:relative;z-index:1;color:var(--map);font-weight:500}
.meta .map:hover{text-decoration:underline;text-underline-offset:2px}
.meta .untyped{opacity:.6}
.meta .id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;opacity:.6}
.copy{position:relative;z-index:1;display:block;margin-top:8px;font-size:12px;color:var(--text-muted);white-space:nowrap;transition:color 120ms ease-out}
.card:hover .copy,.card:focus-within .copy{color:var(--accent)}
.copy:hover{text-decoration:underline;text-underline-offset:2px}
.copy.done{color:var(--text-muted)}
.q{display:grid;grid-template-rows:0fr;font-size:12px;color:var(--text-muted);transition:grid-template-rows 160ms ease-out,margin-top 160ms ease-out}
.q>div{overflow:hidden;min-height:0}
.card:hover .q,.card:focus-within .q{grid-template-rows:1fr;margin-top:8px}
.q .none{font-style:italic}
.q .waiting{display:block;margin-top:8px;color:var(--text)}
.fogcard{border:1px dashed var(--line);border-radius:6px;padding:12px;color:var(--text-muted)}
.fogcard a{text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:2px}

.oos{margin-top:32px;border-top:1px solid var(--line);padding-top:16px}
.oos summary{cursor:pointer;font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);list-style:none;width:max-content}
.oos summary::-webkit-details-marker{display:none}
.oos summary::before{content:"+";display:inline-block;width:16px}
.oos[open] summary::before{content:"−"}
.oos summary:hover{color:var(--text)}
.oos summary .n{margin-left:4px;opacity:.7}
.oos ul{margin-top:16px;display:flex;flex-direction:column;gap:8px;max-width:800px;color:var(--text-muted);padding-left:16px}
.oos a{color:var(--text);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:2px}
.oos a:hover{text-decoration-color:var(--text-muted)}

.canvas{position:relative;height:max(420px,calc(100vh - 280px));border:1px solid var(--line);border-radius:6px;overflow:hidden;background:var(--bg)}
.graph{width:100%;height:100%;display:block;cursor:grab;touch-action:none;user-select:none}
.graph.dragging{cursor:grabbing}
.fit{position:absolute;top:8px;right:8px;font-size:12px;color:var(--text-muted);padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
.fit:hover{color:var(--text)}
.edge{fill:none;stroke:var(--text-muted);stroke-width:1.25}
.edge.done{opacity:.4}
marker path{fill:none;stroke:var(--text-muted);stroke-width:1.25;stroke-linecap:round;stroke-linejoin:round}
.node rect{fill:var(--surface);stroke:var(--line);stroke-width:1;transition:stroke 120ms ease-out}
.node:hover rect,.node:focus-visible rect{stroke:var(--text-muted)}
.node:focus-visible{outline:none}
.node:focus-visible rect{stroke:var(--accent);stroke-width:2}
.node .nt{font-size:14px;font-weight:500;fill:var(--text)}
.node .nm{font-size:12px;fill:var(--text-muted)}
.node.frontier rect{stroke:var(--accent);stroke-width:1.5}
.node.frontier:hover rect{stroke:var(--accent)}
.node.blocked rect{fill:var(--bg)}
.node.inSession rect{stroke:var(--text);stroke-width:1.5}
.node.decided{opacity:.55}
.fog rect{fill:none;stroke:var(--text-muted);stroke-width:1;stroke-dasharray:2 4;opacity:.8}
.fog .fl{font-size:12px;font-weight:500;letter-spacing:0.06em;fill:var(--text-muted)}
.fog .ft{font-size:14px;fill:var(--text-muted)}
.fog.empty .ft{font-style:italic}

@media (max-width:960px){
  main{padding:32px 16px 48px}
  .mast{flex-direction:column;align-items:stretch;gap:24px}
  .progress{flex:none;max-width:none}
  .board,.board.two,.board.four{grid-template-columns:minmax(0,1fr);gap:32px}
  .canvas{height:60vh;min-height:360px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

const JS = `
(() => {
  const panels = [...document.querySelectorAll('.panel')];
  const mapTabs = [...document.querySelectorAll('.maps [role=tab]')];
  const active = () => panels.find((p) => !p.hidden);
  // Hash: a single map keeps "#map"; several maps use "#<slug>" or "#<slug>/map" ("" is All maps).
  const setHash = () => {
    const p = active();
    const h = [panels.length > 1 ? p.dataset.slug : '', p.view === 'map' ? 'map' : ''].filter(Boolean).join('/');
    history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
  };

  for (const panel of panels) {
    panel.view = 'board';
    const tabs = [...panel.querySelectorAll('.tabs [role=tab]')];
    const show = (id) => {
      panel.view = id;
      for (const t of tabs) {
        const on = t.getAttribute('aria-controls') === id + '-' + panel.id.slice(6);
        t.setAttribute('aria-selected', on);
        t.tabIndex = on ? 0 : -1;
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      }
      setHash();
      if (id === 'map') panel.fit();
    };
    panel.show = show;
    tabs.forEach((t, i) => {
      t.onclick = () => show(t.getAttribute('aria-controls').split('-')[0]);
      t.onkeydown = (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = tabs[(i + 1) % tabs.length]; n.focus(); n.click(); }
      };
    });

    const dest = panel.querySelector('.dest');
    if (dest && dest.scrollHeight > dest.clientHeight + 1) {
      dest.classList.add('clamped');
      dest.tabIndex = 0;
      dest.setAttribute('role', 'button');
      dest.setAttribute('aria-expanded', 'false');
      const toggle = (e) => {
        if (e.target.closest('a')) return;
        const open = dest.classList.toggle('open');
        dest.setAttribute('aria-expanded', open);
      };
      dest.onclick = toggle;
      dest.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); } };
    }

    const svg = panel.querySelector('.graph');
    panel.fit = () => {};
    if (!svg) continue;
    const vp = svg.querySelector('.viewport');
    let k = 1, tx = 0, ty = 0;
    const apply = () => vp.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + k + ')');
    panel.fit = () => {
      const w = +svg.dataset.w, h = +svg.dataset.h, r = svg.getBoundingClientRect();
      if (!r.width) return;
      // Fit everything, but never below a legible scale; past that, start at the roots and let the reader pan.
      k = Math.max(Math.min((r.width - 64) / w, (r.height - 64) / h, 1), Math.min(0.6, (r.height - 64) / h));
      tx = w * k > r.width - 64 ? 24 : (r.width - w * k) / 2; ty = (r.height - h * k) / 2;
      apply();
    };
    panel.querySelector('.fit').onclick = panel.fit;
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const nk = Math.min(3, Math.max(0.2, k * Math.exp(-e.deltaY * 0.0015)));
      tx = mx - (mx - tx) * (nk / k); ty = my - (my - ty) * (nk / k); k = nk;
      apply();
    }, { passive: false });
    let start = null, moved = false;
    svg.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, tx, ty }; moved = false; });
    svg.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      if (!moved) { moved = true; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); }
      tx = start.tx + dx; ty = start.ty + dy; apply();
    });
    const end = () => { start = null; svg.classList.remove('dragging'); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
  }

  const showPanel = (p) => {
    for (const q of panels) q.hidden = q !== p;
    for (const t of mapTabs) {
      const on = t.getAttribute('aria-controls') === p.id;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
    }
    setHash();
    if (p.view === 'map') p.fit();
  };
  for (const b of document.querySelectorAll('.go')) b.onclick = () => showPanel(document.getElementById(b.dataset.panel));
  mapTabs.forEach((t, i) => {
    t.onclick = () => showPanel(document.getElementById(t.getAttribute('aria-controls')));
    t.onkeydown = (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { const n = mapTabs[(i + d + mapTabs.length) % mapTabs.length]; n.focus(); n.click(); }
    };
  });

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea/i.test(e.target.tagName)) return;
    const p = active();
    if (e.key === '1') p.show('board');
    if (e.key === '2' && p.querySelector('.graph')) p.show('map');
    if (e.key === '0' && p.view === 'map') p.fit();
    if ((e.key === ']' || e.key === '[') && panels.length > 1) {
      const i = panels.indexOf(p) + (e.key === ']' ? 1 : -1);
      showPanel(panels[(i + panels.length) % panels.length]);
    }
  });
  addEventListener('resize', () => { const p = active(); if (p.view === 'map') p.fit(); });

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  };
  for (const b of document.querySelectorAll('.copy')) {
    b.onclick = async () => {
      await copy(b.dataset.cmd);
      b.textContent = 'copied'; b.classList.add('done');
      setTimeout(() => { b.textContent = 'copy command'; b.classList.remove('done'); }, 1000);
    };
  }

  // Served by --serve: poll for a new model fingerprint and flag the refresh buttons rather than reloading under the reader.
  const refresh = [...document.querySelectorAll('.refresh')];
  if (refresh.length) {
    for (const r of refresh) r.onclick = () => location.reload();
    setInterval(async () => {
      if (document.hidden || refresh[0].classList.contains('stale')) return;
      try {
        const r = await fetch('/rev', { cache: 'no-store' });
        if (r.ok && (await r.text()) !== document.body.dataset.rev) {
          for (const b of refresh) { b.classList.add('stale'); b.textContent = '· map changed, refresh'; }
        }
      } catch {}
    }, +document.body.dataset.poll * 1000);
  }

  const [slug, view] = panels.length > 1 ? location.hash.slice(1).split('/') : ['', location.hash.slice(1)];
  const p = panels.find((q) => q.dataset.slug === slug) || panels[0];
  if (panels.length > 1) showPanel(p);
  if (view === 'map' && p.querySelector('.graph')) p.show('map');
})();
`;
