// Layered DAG layout: longest-path layers via Kahn's algorithm, barycenter ordering, column placement.

export interface LayoutNode<T> {
  item: T;
  layer: number;
  x: number;
  y: number;
  h: number;
}

export const NODE_W = 248;
const COL_GAP = 96;
const ROW_GAP = 16;

export function layout<T>(items: T[], key: (t: T) => string, preds: (t: T) => string[], height: (t: T) => number) {
  const keys = new Set(items.map(key));
  const byKey = new Map(items.map((t) => [key(t), t]));
  const ins = new Map(items.map((t) => [key(t), preds(t).filter((p) => keys.has(p))]));
  const outs = new Map<string, string[]>(items.map((t) => [key(t), []]));
  for (const [k, ps] of ins) for (const p of ps) outs.get(p)?.push(k);

  // Kahn's algorithm; a node's layer is the longest path from any root.
  const layer = new Map<string, number>();
  const indeg = new Map([...ins].map(([k, ps]) => [k, ps.length]));
  const queue = items.map(key).filter((k) => indeg.get(k) === 0);
  for (const k of queue) layer.set(k, 0);
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i] as string;
    for (const s of outs.get(k) ?? []) {
      layer.set(s, Math.max(layer.get(s) ?? 0, (layer.get(k) ?? 0) + 1));
      indeg.set(s, (indeg.get(s) ?? 0) - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  // Pull nodes with successors right so no edge spans a column it doesn't need to (keeps edges out of nodes).
  for (const k of [...queue].reverse()) {
    const succ = (outs.get(k) ?? []).map((s) => layer.get(s) ?? 0);
    if (succ.length) layer.set(k, Math.min(...succ) - 1);
  }
  // ponytail: a cycle can't happen with GitHub dependencies, but if one sneaks in, its nodes land in a final column instead of vanishing.
  const maxLayer = Math.max(0, ...layer.values());
  for (const k of keys) if (!layer.has(k)) layer.set(k, maxLayer + 1);

  const cols: string[][] = [];
  for (const t of items) {
    const k = key(t);
    const l = layer.get(k) ?? 0;
    cols[l] = cols[l] ?? [];
    cols[l].push(k);
  }
  for (let l = 0; l < cols.length; l++) cols[l] = cols[l] ?? [];

  // Barycenter: sort each column by the mean position of its neighbours in the reference direction.
  const pos = new Map<string, number>();
  const index = (col: string[]) => {
    for (const [i, k] of col.entries()) pos.set(k, i / Math.max(1, col.length - 1));
  };
  const sweep = (neighbours: Map<string, string[]>, order: number[]) => {
    for (const l of order) {
      const col = cols[l] as string[];
      const bary = new Map(
        col.map((k) => {
          const ns = neighbours.get(k) ?? [];
          return [k, ns.length ? ns.reduce((s, n) => s + (pos.get(n) ?? 0), 0) / ns.length : (pos.get(k) ?? 0)];
        }),
      );
      col.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
      index(col);
    }
  };
  const down = cols.map((_, i) => i).slice(1);
  for (const col of cols) index(col);
  sweep(ins, down);
  sweep(outs, down.map((i) => i - 1).reverse());
  sweep(ins, down);

  const colHeight = (col: string[]) => col.reduce((s, k) => s + height(byKey.get(k) as T), 0) + ROW_GAP * Math.max(0, col.length - 1);
  const tallest = Math.max(0, ...cols.map(colHeight));
  const nodes: LayoutNode<T>[] = [];
  cols.forEach((col, l) => {
    let y = (tallest - colHeight(col)) / 2;
    for (const k of col) {
      const item = byKey.get(k) as T;
      const h = height(item);
      nodes.push({ item, layer: l, x: l * (NODE_W + COL_GAP), y, h });
      y += h + ROW_GAP;
    }
  });
  const edges = [...ins].flatMap(([to, ps]) => ps.map((from) => ({ from, to })));
  return { nodes, edges, width: cols.length * (NODE_W + COL_GAP) - COL_GAP, height: tallest, colGap: COL_GAP };
}
