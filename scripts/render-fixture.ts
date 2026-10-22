// Render the fixture (and an edge-case variant) to out/ without touching the network.
import { mkdirSync, writeFileSync } from 'node:fs';
import { render } from '../src/html.js';
import { local } from '../src/local.js';
import { type BoardModel, derive } from '../src/model.js';
import { raw } from '../test/fixture.js';

mkdirSync('out', { recursive: true });
writeFileSync('out/board.html', render(derive(raw())));

const edge = raw();
edge.body = edge.body
  .replace(/## Not yet specified[\s\S]*?(?=## Out of scope)/, '## Not yet specified\n\n')
  .replace(
    /## Destination\n\n.*\n/,
    '## Destination\n\nA spec that lets every engineering skill read and write the same map across GitHub, Linear, GitLab, and local markdown from one repo, including how mirrored tickets reconcile when edited on both sides, how permissions differ per tracker, how references resolve when a human pastes a link from the non-canonical side, and what the migration path for the dozen existing GitHub-only maps looks like, ready to hand to /to-tickets.\n',
  );
const t0 = edge.tickets.find((t) => t.id === '#47');
if (t0) t0.type = null;
const t1 = edge.tickets.find((t) => t.id === '#50');
if (t1) t1.body = 'Some notes but no question heading.';
for (const t of edge.tickets) if (t.id === '#44') Object.assign(t, { claimed: false, assignee: null });
writeFileSync('out/edge.html', render(derive(edge)));
const second = { ...derive(edge), title: 'Tracker-neutral map spec', url: 'https://github.com/o/r/issues/99' };
const locals = await Promise.all(['signing', 'quoting'].map(async (e) => derive(await local(`fixtures/local/${e}`).load())));
writeFileSync('out/all.html', render([derive(raw()), second, ...locals]));
writeFileSync('out/impl.html', render(locals[0] as BoardModel));
console.log('Wrote out/board.html, out/edge.html, out/all.html, out/impl.html');
