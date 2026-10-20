import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RawMap, TrackerAdapter } from './model.js';

const run = promisify(execFile);

export const QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      number title url body
      subIssues(first: 100) {
        nodes {
          number title url body state stateReason
          labels(first: 20) { nodes { name } }
          assignees(first: 5) { nodes { login } }
          blockedBy(first: 20) { nodes { title url state } }
        }
      }
    }
  }
}`;

interface Node {
  number: number;
  title: string;
  url: string;
  body: string;
  state: 'OPEN' | 'CLOSED';
  labels: { nodes: { name: string }[] };
  assignees: { nodes: { login: string }[] };
  blockedBy: { nodes: { title: string; url: string; state: string }[] };
}

export interface GraphQLResponse {
  data?: { repository: { issue: (Omit<Node, 'state' | 'labels' | 'assignees' | 'blockedBy'> & { subIssues: { nodes: Node[] } }) | null } | null };
  errors?: { message: string }[];
}

export function parseIssueUrl(url: string) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(url);
  if (!m) throw new Error(`Not a GitHub issue URL: ${url}`);
  return { owner: m[1] as string, repo: m[2] as string, number: Number(m[3]) };
}

export function fromGraphQL(res: GraphQLResponse): RawMap {
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join('\n'));
  const map = res.data?.repository?.issue;
  if (!map) throw new Error('Map issue not found');
  return {
    title: map.title,
    url: map.url,
    body: map.body,
    // ponytail: first 100 children only; paginate subIssues if a map ever outgrows that.
    tickets: map.subIssues.nodes.map((n) => ({
      id: `#${n.number}`,
      url: n.url,
      title: n.title,
      body: n.body,
      open: n.state === 'OPEN',
      type: n.labels.nodes.map((l) => /^wayfinder:(.+)$/.exec(l.name)?.[1]).find(Boolean) ?? null,
      assignee: n.assignees.nodes[0]?.login ?? null,
      claimed: n.assignees.nodes.length > 0,
      blockedBy: n.blockedBy.nodes.map((b) => ({ url: b.url, title: b.title, open: b.state === 'OPEN' })),
    })),
  };
}

async function gh(args: string[]) {
  try {
    return (await run('gh', args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (e) {
    const err = e as { code?: string; stderr?: string; message: string };
    if (err.code === 'ENOENT') throw new Error('The GitHub CLI (gh) is not installed: https://cli.github.com');
    throw new Error(err.stderr?.trim() || err.message);
  }
}

export function github(url: string): TrackerAdapter {
  const { owner, repo, number } = parseIssueUrl(url);
  return {
    async load() {
      const out = await gh(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${number}`]);
      return fromGraphQL(JSON.parse(out));
    },
    async writeMapBody(body) {
      await gh(['issue', 'edit', String(number), '--repo', `${owner}/${repo}`, '--body', body]);
    },
  };
}
