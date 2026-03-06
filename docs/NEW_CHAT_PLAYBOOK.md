# PackPulse New Chat Playbook

Use this when starting a new Codex/Claude chat for PackPulse feature work.

## When to start a new chat

Start a new chat if any of these are true:

- You are switching to a new feature, incident, or architecture topic.
- The current thread has become long and responses are drifting.
- You need cleaner execution for commit-ready work.
- You are changing priorities and want fresh instructions.

Rule of thumb: new thread every 10-20 major requests, or sooner if quality drops.

## First message template (copy/paste)

```md
Project: PackPulse
Goal: <one clear outcome>

Current state:
- Branch: <branch>
- Last good commit: <sha>
- Environment: local/prod
- Relevant files:
  - <absolute path>
  - <absolute path>

Constraints:
- Keep existing UX patterns unless noted
- No breaking data sync flows
- Commit + push when done

Definition of done:
1) Implement change
2) Run build/tests
3) Report exact files changed
4) Commit message + push
```

## Best-practice workflow

1. Ask for an audit first
- “Audit current implementation and identify root cause before editing.”

2. Require an implementation plan
- “Give a short plan, then execute.”

3. Force verification
- Always require `npm run build` (and tests if available) before commit.

4. Require concrete delivery details
- Commit SHA
- What changed
- Any follow-up migration/env steps

5. Keep one thread = one unit of work
- Bug fix, feature, or refactor; avoid mixing all three in one thread.

## Recommended prompt patterns

### A) Bug fix

```md
Audit this bug first, find root cause, then implement minimal safe fix.
Run build, commit, and push.
Include: root cause, files changed, and why fix is safe.
```

### B) Feature

```md
Implement this feature with minimal UX disruption.
Before coding: list affected components and risks.
After coding: run build, commit, push, and provide rollout notes.
```

### C) Refactor

```md
Refactor for maintainability only (no behavior change).
Show before/after scope, run build, then commit and push.
```

## Guardrails to include in prompts

- “Do not revert unrelated local changes.”
- “If unexpected diffs appear, stop and ask.”
- “Prefer small focused commits.”
- “Use absolute file paths in explanations.”

## Handoff format to request every time

```md
Output format:
1) Summary
2) Files changed
3) Validation run
4) Commit SHA
5) Any required env/migration steps
```

