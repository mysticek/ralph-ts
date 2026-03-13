# Ralph

![Ralph](ralph-banner.png)

Autonomous AI agent loop that implements PRD stories one by one using [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Amp](https://ampcode.com). Each iteration spawns a fresh AI instance with minimal context — only the next story, codebase patterns, and last progress entry. Memory persists via git history, `progress.md`, and `prd.json`.

Built with TypeScript and [Ink](https://github.com/vadimdemedes/ink). Features an interactive TUI with setup wizard, live activity dashboard (real-time tool call streaming via `stream-json`), elapsed time tracking, and token/cost monitoring.

Inspired by [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/) and [snarktank/ralph](https://github.com/snarktank/ralph).

## Install

### Claude Code Marketplace (recommended)

```
/plugin marketplace add mysticek/ralph-ts
/plugin install ralph-ts@ralph-ts-marketplace
```

This gives you four skills:

| Skill | What it does |
|-------|-------------|
| `/init` | Set up Ralph on a **new project** — installs orchestrator, generates config |
| `/brownfield` | Set up Ralph on an **existing codebase** — auto-detects stack, installs orchestrator |
| `/prd` | Generate a Product Requirements Document from a feature description |
| `/convert` | Convert a PRD to `prd.json` for autonomous execution |

### Manual install (Amp / Claude Code without marketplace)

```bash
# Clone the repo
git clone https://github.com/mysticek/ralph-ts.git

# Copy skills to your config
cp -r ralph-ts/skills/init ~/.claude/skills/    # or ~/.config/amp/skills/
cp -r ralph-ts/skills/brownfield ~/.claude/skills/
cp -r ralph-ts/skills/prd ~/.claude/skills/
cp -r ralph-ts/skills/convert ~/.claude/skills/
```

## Quick Start

### New project

```
/init Build a todo app with add, delete, and toggle
```

This runs an interactive interview, installs the Ralph orchestrator into your project, generates all config files, and creates `prd.json` — ready to run in one step.

### Existing codebase

```
/brownfield
```

Auto-detects your tech stack, asks ~20 targeted questions, installs the orchestrator, and generates config files.

### Then run Ralph

```bash
./ralph
```

The interactive TUI guides you through:
1. **Select AI tool** — Claude Code or Amp
2. **Max iterations** — pre-filled with remaining story count
3. **Judge mode** — no judge, test-based, or LLM judge

## Live Dashboard

```
╭──────────────────────────────────────────────────────────────────╮
│  Ralph                                      claude · iter 1/4    │
│  MyApp · ralph/feature-name          [█░░░] 1/4 · 12.5k↓ 8.3k↑ │
╰──────────────────────────────────────────────────────────────────╯
┌─────────────────────────┐ ┌──────────────────────────────────────┐
│ Stories                 │ │ Activity                             │
│ ✓ US-001 Add priority…  │ │ 📄 Read src/db/schema.ts             │
│ ▶ US-002 Display badge… │ │ ✏️  Edit src/tui/TaskCard.tsx          │
│ · US-003 Add selector…  │ │ 💻 Bash: bun run typecheck           │
│ · US-004 Filter tasks…  │ │ 📝 Write src/tui/PriorityBadge.tsx   │
├─────────────────────────┤ │                                      │
│ ⚡ Running 2m35s         │ │                                      │
│ ◆ PriorityBadge.tsx     │ │                                      │
│ ◦ TaskCard.tsx          │ │                                      │
└─────────────────────────┘ └──────────────────────────────────────┘
```

- Story progress with pass/fail indicators
- Real-time activity log (tool calls streamed via `stream-json`)
- File changes detected via git
- Elapsed time and token/cost tracking

## How It Works

For each iteration Ralph:
1. Pre-extracts the next story + codebase patterns + last progress entry
2. Injects them into the prompt template (model never reads full prd.json)
3. Spawns a fresh AI instance with minimal context
4. Streams tool calls in real-time to the dashboard
5. Runs quality checks, commits if passing
6. Marks story as `passes: true`, appends learnings to `progress.md`
7. Repeats until all stories pass or max iterations reached

## Prerequisites

- **[Bun](https://bun.sh)** (recommended — 18ms startup) or **Node.js 22+** (fallback, headless only)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Amp CLI](https://ampcode.com)
- A git repository for your project

## Key Concepts

### Fresh Context Per Iteration

Each iteration spawns a new AI instance. Memory between iterations:
- Git history (commits)
- `progress.md` (learnings and codebase patterns)
- `prd.json` (which stories are done)

### Right-Sized Stories

Each story must complete in one context window. If too big, the LLM runs out of context and produces broken code.

Good: "Add a database column", "Add a UI component", "Update a server action"
Bad: "Build the entire dashboard", "Add authentication", "Refactor the API"

### Test-Based Judge

Instead of asking an LLM if the code "looks good", Ralph can run actual tests (Playwright, vitest, jest). Configure in `ralph-test-runner.json`:

```json
{
  "framework": "vitest",
  "testDir": "tests/",
  "runCommand": "bun run test",
  "filePattern": "{storyId}.spec.ts"
}
```

## Architecture

```
./ralph
  → src/tui/index.tsx        # entry point, validates prd.json, clears screen
  → src/tui/Setup.tsx         # interactive wizard (tool, iterations, judge)
  → src/tui/App.tsx           # run loop, timer, usage tracking, terminal title
  → src/tui/Dashboard.tsx     # two-column layout with stories + activity log
  → src/prompt-builder.ts     # reads template, replaces <!-- RALPH:STORY --> etc.
  → src/runner.ts             # spawns claude/amp, parses stream-json events
  → src/judge.ts              # runs tests or LLM review after each story
```

The key insight: **the model never reads prd.json or progress.md**. The orchestrator pre-extracts exactly what the model needs (~3KB prompt vs ~6KB+ of raw files) and injects it into the template via placeholders.

## Debugging

```bash
./ralph status                    # check PRD status
cat prd.json | jq '.userStories[] | {id, title, passes}'
cat progress.md                   # see iteration learnings
git log --oneline -10             # see commits
```

## Acknowledgments

- [Geoffrey Huntley's Ralph pattern](https://ghuntley.com/ralph/) — the original concept
- [snarktank/ralph](https://github.com/snarktank/ralph) — the original bash implementation
- [Ink](https://github.com/vadimdemedes/ink) — React for CLIs
