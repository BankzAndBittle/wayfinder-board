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

## 2. Run

```sh
wayfinder-board <map-url-or-path> --html out/board.html --open --post
```

If `wayfinder-board` is not on PATH, use `npx -y wayfinder-board` in its place.

`--post` rewrites only the block between `<!-- wayfinder-board:start -->` and `<!-- wayfinder-board:end -->` in the map body. It is the only write; never edit tickets, labels or assignees as part of this skill.

## 3. Report

One line: where the HTML was written, and the counts it printed. Refer to the map by its title, never by a bare `#number`. If `gh` is not authenticated, tell the user to run `! gh auth login`.
