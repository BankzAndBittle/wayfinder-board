import type { BoardModel } from './model.js';

export const START = '<!-- wayfinder-board:start -->';
export const END = '<!-- wayfinder-board:end -->';

const LABEL: Record<string, string> = { frontier: 'frontier', blocked: 'blocked', inSession: 'in session', decided: 'decided' };

// Mermaid labels choke on quotes and brackets; entity codes keep the title readable.
const label = (s: string) => s.replace(/"/g, '#quot;').replace(/[[\]{}()<>]/g, (c) => `#${c.charCodeAt(0)};`);

/** The decision graph while charting; the slice graph once the spec is split. */
const graphed = (m: BoardModel) => (m.impl.length ? m.impl : m.tickets);

export function toMermaid(m: BoardModel): string {
  const live = graphed(m).filter((t) => t.state !== 'outOfScope');
  const key = new Map(live.map((t, i) => [t.url, `t${i}`]));
  const lines = ['flowchart LR'];
  for (const t of live) {
    const who = t.state === 'inSession' && t.assignee ? ` · @${t.assignee}` : '';
    lines.push(`  ${key.get(t.url)}["${label(t.title)}<br/>${t.type} · ${LABEL[t.state]}${who}"]:::${t.state}`);
  }
  for (const t of live) for (const b of t.blockedBy) if (key.has(b)) lines.push(`  ${key.get(b)} --> ${key.get(t.url)}`);
  for (const t of live) if (/^https?:/.test(t.url)) lines.push(`  click ${key.get(t.url)} href "${t.url}" _blank`);
  lines.push(
    '  classDef frontier stroke:#2F6FED,stroke-width:2px',
    '  classDef blocked stroke-dasharray:4 3',
    '  classDef inSession stroke-width:2px',
    '  classDef decided opacity:0.55',
  );
  return lines.join('\n');
}

/** Put the diagram between the markers, appending the block if the markers are absent. */
export function upsert(body: string, m: BoardModel): string {
  const ts = graphed(m);
  const open = ts.filter((t) => t.state !== 'decided' && t.state !== 'outOfScope').length;
  const decided = ts.filter((t) => t.state === 'decided').length;
  const line = m.impl.length ? `${decided} of ${ts.length} slices done` : `${decided} decided · ${open} open · ${m.fog.length} in fog`;
  const block = `${START}\n## Board\n\n${line}\n\n\`\`\`mermaid\n${toMermaid(m)}\n\`\`\`\n${END}`;
  const i = body.indexOf(START);
  const j = body.indexOf(END, i);
  if (i >= 0 && j >= 0) return body.slice(0, i) + block + body.slice(j + END.length);
  return `${body.trimEnd()}\n\n${block}\n`;
}
