import { cpSync, mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fromGraphQL, parseIssueUrl } from '../src/github.js';
import { render } from '../src/html.js';
import { layout } from '../src/layout.js';
import { local } from '../src/local.js';
import { END, START, upsert } from '../src/mermaid.js';
import { derive, items, mentions, type Ticket } from '../src/model.js';
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
    expect(m.fog).toHaveLength(3);
    expect(m.outOfScope).toHaveLength(1);
    const t = m.tickets.find((t) => t.id === '#48');
    expect(t?.waitingOn).toHaveLength(2);
    expect(t?.question).toMatch(/^When a human writes/);
    expect(m.tickets.find((t) => t.id === '#47')?.hitl).toBe(false);
  });

  it('survives a missing type label, missing question, and missing sections', () => {
    const r = raw();
    r.body = '## Destination\n\nSomewhere.';
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
