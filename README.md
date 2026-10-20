# wayfinder-board

Renders a [Wayfinder](https://github.com/mattpocock/skills) map as a board you can read at a glance: the destination as the headline, then fog, blocked, frontier, in-session and decided tickets, each referred to by name. A second view draws the blocking graph, ending in the fog. Frontier cards copy the `/wayfinder` command that picks them up.

It reads the map and its tickets in one `gh api graphql` call using your existing `gh` login. The only write it ever makes is a Mermaid diagram between `<!-- wayfinder-board:start -->` markers in the map body.

![The board for a sample map](docs/board.png)

## Install

```sh
npx skills add <owner>/wayfinder-board   # /wayfinder-board in Claude Code
npm i -g wayfinder-board                 # the CLI
```

## Usage

```sh
wayfinder-board <map-issue-url | .scratch/<effort>/map.md> [--html out/board.html] [--post] [--open]
```

In Claude Code: `/wayfinder-board <map-url>` runs it with `--html --open --post`, and `/wayfinder-run <map-url>` works the whole frontier: a subagent per ticket, AFK ones in parallel, HITL questions relayed to you grouped by topic. `.github/workflows/board.yml` re-posts the diagram when a map or its tickets change.

`--serve [--port 4173] [--poll 30]` serves a live board instead: each load re-reads the tracker, and the page checks for changes every `--poll` seconds.

Keys: `1` board, `2` map, `0` fit the map.

## Decisions

- **Closed but listed nowhere** on the map counts as decided; it's out of scope only when the Out of scope section links it.
- **Claimed beats blocked**: an assigned open ticket is in session even if a blocker is still open.
- **Untyped tickets** stay in their state column, labelled `untyped`, with no HITL/AFK.
- **The workflow** triggers on `issues` plus an hourly sweep and manual dispatch: Actions has no `sub_issues` or dependency trigger, so linking and blocking changes land within the hour.
- **Map layout** runs at render time; nodes with successors are pulled right after longest-path layering so edges don't cross columns needlessly.
- **Live board** flags `map changed, refresh` rather than reloading itself, so zoom and hover state survive until you choose.
- **`/wayfinder-run`** keeps one ticket per session by giving each ticket its own subagent; the orchestrator only relays answers verbatim and is the map's sole writer. Tasks count as HITL unless their body makes AFK plain.
- **Notes** are parsed into the model but not shown; the brief's masthead has no place for them.
- **Local markdown**: tickets are claimed by `Status: claimed`; an optional `Assignee:` line names who.
- **Limits**: the first 100 sub-issues and 20 blockers per ticket; titles in the map view wrap by character count.

## Develop

```sh
npm i && npm test && npm run typecheck && npm run lint
npx tsx scripts/render-fixture.ts && npm run shots   # out/board.html, out/shots/*.png
```
# wayfinder-board
