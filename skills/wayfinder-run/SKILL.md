---
name: wayfinder-run
description: Work a Wayfinder map's whole frontier at once — AFK tickets run in parallel subagents, HITL tickets relayed to you grouped by topic.
disable-model-invocation: true
---

You are the **orchestrator** for one Wayfinder map. Every frontier ticket gets its own subagent, and that subagent is the ticket's session: you resolve nothing yourself. AFK subagents run to completion. HITL subagents reach the human only through you, so you are their **relay**: you carry questions out and the human's answers back, **verbatim**. You are also the map's only writer.

## 1. Load the map

Locate the map and its tracker exactly as step 1 of the wayfinder-board skill (`../wayfinder-board/SKILL.md`) does, and read the tracker doc's **Wayfinding operations**: they define claim, resolve, and create-then-wire for this tracker.

```sh
wayfinder-board <map-url-or-path> --json   # or: npx -y wayfinder-board …
```

Done when you hold the board JSON (`tickets[]` with `state`, `type`, `blockedBy`, `question`) and the tracker's operations.

## 2. Sort the frontier

Take every ticket with `state: "frontier"`.

- **AFK**: `research`, plus any `task` whose question an agent can finish entirely alone (no human account, credential, physical action or judgement call). Classify a task as AFK only when its body makes that plain; every other task is **HITL**.
- **HITL**: `grilling`, `prototype`, the remaining tasks, and `untyped`.

Group the HITL tickets into **topic groups**: tickets that share a subject (judge by title and question) or sit next to each other in the blocking graph. Order groups by how many open tickets they unblock, directly or transitively; break ties by map order.

Tickets in `inSession` with no subagent of yours are claims from an earlier run. List them by name and ask the human whether to take them over.

Done when every frontier ticket sits in exactly one place: the AFK list or one topic group. Show the plan to the human in a few lines, by ticket **name**, then carry on.

## 3. Claim and dispatch

For each frontier ticket, in plan order:

1. **Claim** it with the tracker's claim operation. Claims are yours to write, one at a time.
2. Spawn one background subagent named after the ticket, with the brief from **Subagent brief** below.

Done when every frontier ticket is claimed and has a running subagent.

## 4. Relay

Work through the topic groups in order. Within the current group, present each waiting question as it arrives:

> **<ticket name>**
> <the subagent's question, as written>

Pass the human's reply to that subagent with `SendMessage`, verbatim. The human is the only source of HITL answers: when you know something relevant from another ticket, offer it to the human as context, naming its ticket, and let them answer. Questions from later groups wait their turn; move on when every ticket in the current group has resolved. The human can say "skip" (move the group to the end) or "next group".

AFK results arrive in the background throughout: record each one (step 5) and mention it to the human in one line, by name.

## 5. Record each resolution

When a subagent reports `RESOLVED`, apply its report to the map, one write at a time:

1. Confirm the ticket itself carries the answer and is closed/resolved.
2. Append a context pointer (linked name + gist) to **Decisions so far**.
3. Create its `NEW TICKETS` (create-then-wire; locally, number each one past the highest existing number), graduate its `FOG` out of **Not yet specified**, and move `OUT OF SCOPE` tickets per the wayfinder rules.
4. Apply `INVALIDATES` notes by updating or closing the named tickets.

Done when a fresh `--json` shows the ticket decided and the map reflects every line of the report.

## 6. Refill

After each resolution, re-run `--json`. New frontier tickets go through steps 2 and 3: AFK ones dispatch at once; HITL ones join their topic group, or a new group at the end.

## 7. Stop

The run ends when the frontier is empty and no subagent is running, or when the human says stop. On stop, message each unresolved subagent to append its progress to its ticket (a comment, or under `## Comments` locally), then release its claim. Finish with one line per resolved ticket, by name.

## Subagent brief

Give each subagent this, filled in:

```
You are resolving one Wayfinder ticket: "<title>" (<url>), a <type> ticket on the map "<map title>" (<map url>).
Tracker operations: <the tracker doc's Wayfinding operations, or its path>.
The ticket is already claimed for you.

1. Read the map's Destination and Notes, then the ticket. Zoom into related or closed tickets as needed, and call the Skill tool for any skill the Notes name.
2. Resolve it as its type:
   - research: call the Skill tool with "research".
   - prototype: call the Skill tool with "prototype"; link the artifact from the ticket.
   - grilling: call the Skill tool for "grilling" and "domain-modeling".
   - task: do the work if you can do all of it; otherwise write the human a precise checklist and wait for "done".
3. <HITL only> The human reaches you only through your final message, so ask every question there (AskUserQuestion does not reach them). End every turn with exactly one question, on one line starting "QUESTION:"; the human answers one thing at a time. Their reply arrives as your next message, verbatim; the resolution comes from their words.
4. Record the answer on this ticket only, with the tracker's resolve operation (local: "## Answer" and "Status: resolved"; GitHub: a resolution comment, then close). The orchestrator owns the map and every other ticket.
5. Finish with:
   RESOLVED: <one-line gist of the answer>
   NEW TICKETS: <title | type | question | blocked by (names)>, or none
   FOG: <newly visible, not-yet-specifiable questions>, or none
   OUT OF SCOPE: <ticket names ruled past the destination, with why>, or none
   INVALIDATES: <ticket names and what changed>, or none
```
