import { cpSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fromGraphQL, parseIssueUrl } from '../src/github.js';
import { render } from '../src/html.js';
import { layout } from '../src/layout.js';
import { discover, local } from '../src/local.js';
import { END, START, toMermaid, upsert } from '../src/mermaid.js';
import { derive, isOpen, items, mentions, type Ticket } from '../src/model.js';
import { raw } from './fixture.js';

const titles = (ts: Ticket[], state: Ticket['state']) => ts.filter((t) => t.state === state).map((t) => t.id);

describe('derive', () => {
  const m = derive(raw());

  it('sorts tickets into states', () => {
    expect(titles(m.tickets, 'decided')).toEqual(['#41', '#42']);
    expect(titles(m.tickets, 'inSession')).toEqual(['#44']);
    expect(titles(m.tickets, 'frontier')).toEqual(['#45', '#46', '#47', '#50']);
    expect(titles(m.tickets, 'blocked')).toEqual(['#48', '#49']);
    expect(titles(m.tickets, 'outOfScope')).toEqual(['#51']);
  });

  it('reads the map sections', () => {
    expect(m.destination).toMatch(/^A spec that lets every engineering skill/);
    expect(m.summary).toBe('');
    expect(m.fog).toHaveLength(3);
    expect(m.outOfScope).toHaveLength(1);
    const t = m.tickets.find((t) => t.id === '#48');
    expect(t?.waitingOn).toHaveLength(2);
    expect(t?.question).toMatch(/^When a human writes/);
    expect(m.tickets.find((t) => t.id === '#47')?.hitl).toBe(false);
  });

  it('survives a missing type label, missing question, and missing sections', () => {
    const r = raw();
    r.title = 'Fluid on Sui — Wayfinder Map';
    r.body = '## What it does\n\nLiquidates.\n\n## Destination\n\nSomewhere.';
    expect(derive(r).title).toBe('Fluid on Sui');
    expect(derive(r).summary).toBe('Liquidates.');
    Object.assign(r.tickets[3] as object, { type: null, body: 'no heading here' });
    const t = derive(r).tickets[3] as Ticket;
    expect(t.type).toBe('untyped');
    expect(t.question).toBeNull();
    expect(derive(r).fog).toEqual([]);
  });

  it('treats a closed ticket listed nowhere as decided', () => {
    const r = raw();
    r.body = r.body.replace(/## Out of scope[\s\S]*/, '');
    expect(derive(r).tickets.find((t) => t.id === '#51')?.state).toBe('decided');
  });
});

describe('mentions', () => {
  const t = { id: '#4', url: 'https://github.com/o/r/issues/4' };
  it('matches links, bare urls and #N without matching longer numbers', () => {
    expect(mentions('[x](https://github.com/o/r/issues/4): y', t)).toBe(true);
    expect(mentions('see #4.', t)).toBe(true);
    expect(mentions('see #42', t)).toBe(false);
    expect(mentions('https://github.com/o/r/issues/42', t)).toBe(false);
    expect(mentions('[x](issues/04-a.md)', { id: '04', url: 'file:///x/issues/04-a.md' })).toBe(true);
  });
  it('folds bullet continuations', () => {
    expect(items('- a\n  more\n- b')).toEqual(['a more', 'b']);
    expect(items('<!-- note -->\n\n- (empty: graduated)')).toEqual([]);
  });
});

describe('layout', () => {
  it('layers by longest path and keeps edges one column long where it can', () => {
    const live = derive(raw()).tickets.filter((t) => t.state !== 'outOfScope');
    const g = layout(live, (t) => t.url, (t) => t.blockedBy, () => 80);
    const layer = Object.fromEntries(g.nodes.map((n) => [n.item.id, n.layer]));
    expect(layer).toMatchObject({ '#42': 0, '#44': 1, '#45': 1, '#48': 2, '#49': 3 });
    expect(g.edges).toHaveLength(4);
  });
  it('does not drop nodes caught in a cycle', () => {
    const g = layout(['a', 'b'], (k) => k, (k) => (k === 'a' ? ['b'] : ['a']), () => 10);
    expect(g.nodes).toHaveLength(2);
  });
});

describe('mermaid', () => {
  it('upserts between markers and is idempotent', () => {
    const r = raw();
    const once = upsert(r.body, derive(r));
    expect(once).toContain(START);
    expect(once).toContain('t3 --> t6'); // #45 blocks #48
    expect(upsert(once, derive({ ...r, body: once }))).toBe(once);
    expect(once.split(END)).toHaveLength(2);
    expect(derive({ ...r, body: once }).outOfScope).toEqual(derive(r).outOfScope);
  });
});

describe('html', () => {
  const html = render(derive(raw()));
  it('refers to tickets by name and avoids the forbidden words', () => {
    expect(html).toContain('>Export a month of Linear issues');
    expect(html).not.toMatch(/Dashboard|Powered by|Overview|✨/);
    expect(html.match(/class="copy"/g)).toHaveLength(4);
    expect(html).not.toContain('class="refresh"');
  });
  it('adds the refresh control only when served', () => {
    expect(render(derive(raw()), new Date(), { rev: 'abc', poll: 30 })).toMatch(/data-rev="abc"[\s\S]*class="refresh"/);
  });
  it('renders several maps as an all-maps board plus a tab per map', () => {
    const a = derive(raw());
    const b = { ...a, title: 'Second map', url: 'https://github.com/o/r/issues/99' };
    const many = render([a, b]);
    expect(many).toMatch(/class="tabs maps"[\s\S]*>Second map<\/button>/);
    expect(many).toMatch(/id="panel-all"[\s\S]*class="map" href="https:\/\/github\.com\/o\/r\/issues\/99"/);
    expect(many.match(/class="copy"/g)).toHaveLength(16); // 4 frontier cards × (all-maps + two map panels)
    expect(many).toContain('data-cmd="/wayfinder https://github.com/o/r/issues/99 ');
    expect(many.match(/id="arrow-\d"/g)).toHaveLength(2);
    expect(render([a])).toBe(render(a));
  });
});

describe('github', () => {
  it('parses map urls and surfaces GraphQL errors', () => {
    expect(parseIssueUrl('https://github.com/o/r/issues/12#x')).toEqual({ owner: 'o', repo: 'r', number: 12 });
    expect(() => fromGraphQL({ errors: [{ message: 'nope' }] })).toThrow('nope');
  });
});

describe('local markdown tracker', () => {
  it('derives the same states from .scratch files', async () => {
    const m = derive(await local('fixtures/local/caching').load());
    expect(m.title).toBe('Response caching for the public API');
    expect(m.tickets.map((t) => [t.id, t.state])).toEqual([
      ['01', 'decided'],
      ['02', 'frontier'],
      ['03', 'inSession'],
      ['04', 'outOfScope'],
    ]);
    expect(m.tickets[2]?.assignee).toBe('dana');
  });

  it('discovers open maps under a repo .scratch', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'wb-'));
    cpSync('fixtures/local/caching', join(repo, '.scratch/caching'), { recursive: true });
    mkdirSync(join(repo, '.scratch/notes')); // no map.md
    expect(await discover(repo)).toEqual([join(repo, '.scratch/caching')]);
    expect(isOpen(derive(await local(join(repo, '.scratch/caching')).load()))).toBe(true);
  });

  it('warns when two tickets share a number', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wb-'));
    cpSync('fixtures/local/caching', dir, { recursive: true });
    renameSync(join(dir, 'issues/04-cdn-vendor.md'), join(dir, 'issues/03-cdn-vendor.md'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await local(dir).load();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('numbered 03'));
    warn.mockRestore();
  });
});

describe('implementation stage', () => {
  it('reads slices from <effort>-impl, in either field style, and stages the effort', async () => {
    const m = derive(await local('fixtures/local/signing').load());
    expect(m.stage).toBe('implementing');
    expect(m.spec).toMatch(/signing\/spec\.md$/);
    expect(m.tickets.map((t) => t.state)).toEqual(['decided', 'decided']);
    expect(m.impl.map((t) => [t.id, t.state, t.hitl])).toEqual([
      ['01', 'decided', false],
      ['02', 'inSession', false],
      ['03', 'blocked', false],
      ['04', 'frontier', true],
    ]);
    expect(m.impl[0]?.title).toBe('Prefactor: the EvmSigner seam over Fordefi');
    expect(m.impl[0]?.question).toMatch(/^Every EVM caller/);
    expect(m.impl[1]?.question).toMatch(/^A Solana transaction/);
    expect(m.impl.every((t) => t.type === 'impl')).toBe(true);
  });

  it('stages a complete map with no slices as needing tickets, and keeps fog from reopening it', async () => {
    const q = derive(await local('fixtures/local/quoting').load());
    expect(q.stage).toBe('needsTickets');
    const c = derive(await local('fixtures/local/caching').load());
    expect(c.stage).toBe('charting');
    const s = await local('fixtures/local/signing').load();
    expect(derive({ ...s, impl: [] }).stage).toBe('needsTickets'); // Status: complete wins over the fog line
    expect(derive({ ...s, impl: [], body: s.body.replace(/^Status:.*$/m, '') }).stage).toBe('charting');
    expect(derive({ ...s, impl: s.impl.map((t) => ({ ...t, open: false })) }).stage).toBe('done');
  });

  it('renders the impl board, the effort strip and the next-skill commands', async () => {
    const s = derive(await local('fixtures/local/signing').load());
    const q = derive(await local('fixtures/local/quoting').load());
    const c = derive(await local('fixtures/local/caching').load());
    const one = render(s);
    expect(one).toMatch(/class="board four"/);
    expect(one).toContain('impl · ready-for-human');
    expect(one).not.toContain('/implement'); // the only ready slice is for a human
    expect(render({ ...s, impl: s.impl.map((t) => ({ ...t, hitl: false })) })).toContain('data-cmd="/implement /');
    expect(one).toMatch(/<summary>Map complete · 2 decided · <a/);
    expect(one).not.toContain('class="fog"'); // slice graph has no fog block
    expect(render(q)).toContain('data-cmd="/to-tickets /');
    const many = render([s, q, c]);
    expect(many).toMatch(/class="efforts"[\s\S]*<h2>Implementing[\s\S]*<h2>Needs tickets[\s\S]*<h2>Charting/);
    expect(many).toContain('1 in session · 1 ready · 1 queued · 1 done');
    expect(many).toContain('spec locked · awaiting /to-tickets');
    expect(many).toContain('data-panel="panel-1"');
    expect(many).toMatch(/data-cmd="\/implement-spec \/[^"]*fixtures\/local\/signing-impl\/issues"/);
    expect(toMermaid(s)).toContain('impl · frontier');
    expect(upsert('# x', s)).toContain('1 of 4 slices done');
  });
});
