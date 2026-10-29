---
name: wayfinder-board
description: Render a Wayfinder map as a visual board (HTML) and refresh the Mermaid diagram on the map.
disable-model-invocation: true
---

Render the map the user names as a board, open it, and refresh the diagram on the map itself.

## 1. Find the tracker

Locate the tracker the same way `/wayfinder` does: read `CLAUDE.md` (else `AGENTS.md`) at the repo root, follow its `## Agent skills` → **Issue tracker** pointer (normally `docs/agents/issue-tracker.md`), and read its **Wayfinding operations** section.

- **GitHub**: the map is an issue labelled `wayfinder:map`. Use its URL.
- **Local markdown**, or no tracker configured (the `/wayfinder` default): the map is `.scratch/<effort>/map.md`. Use that path.
- **Anything else**: tell the user wayfinder-board supports GitHub and local markdown only, and stop.

If the user gave a map number or name instead of a URL/path, resolve it with the tracker doc's conventions (on GitHub: `gh issue list --label wayfinder:map --state all --json number,title,url`). If several maps match, list them **by title** and ask which one.

If the user asks for **all maps**, every active map, or what is in flight across projects, pass every open map (GitHub: `--state open`; local: pass the repo directory, which expands to every open `.scratch/*/map.md`) as positionals in one run. The page then opens on an all-maps board: an effort strip grouped by stage (charting, needs tickets, implementing), then the in-session and frontier cards, with a tab per map. A finished map's tab shows its implementation slices from `.scratch/<effort>-impl/issues/`.

## 2. Run

```sh
wayfinder-board <map-url-or-path>... --html out/board.html --open --post
```

If `wayfinder-board` is not on PATH, use `npx -y wayfinder-board` in its place.

`--post` rewrites only the block between `<!-- wayfinder-board:start -->` and `<!-- wayfinder-board:end -->` in the map body. It is the only write; never edit tickets, labels or assignees as part of this skill.

## 3. Report

One line: where the HTML was written, and the counts it printed. With several maps, add one line per effort naming its stage. Refer to the map by its title, never by a bare `#number`. If `gh` is not authenticated, tell the user to run `! gh auth login`.
