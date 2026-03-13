# Ralph Agent Instructions

## Overview

Ralph is an autonomous AI agent loop that runs AI coding tools (Amp or Claude Code) repeatedly until all PRD items are complete. Each iteration is a fresh instance with clean context.

## Commands

```bash
# Run Ralph (interactive TUI with setup wizard)
./ralph

# Check status
./ralph status

# Headless mode (no TUI, for CI/scripts)
bun src/ralph.ts [--tool amp|claude] [--judge] [--judge-mode test|llm] [--retries N] [max_iterations]
```

## Key Files

- `ralph` - Wrapper script (detects bun → node fallback)
- `src/tui/` - Interactive TUI (Ink/React) with setup wizard + live dashboard
- `src/ralph.ts` - Headless orchestrator (for CI/scripts)
- `src/templates/claude.md` - Prompt template for Claude Code (with placeholders)
- `src/templates/amp.md` - Prompt template for Amp (with placeholders)
- `prd.json` - Source of truth for stories (only format, no separate markdown PRD needed)
- `progress.md` - Append-only progress log with codebase patterns
- `judge-prompt.md` - LLM judge prompt (used with `--judge-mode llm`)

## Architecture

The TS orchestrator (`src/ralph.ts`) pre-extracts the next story and context, then injects them into the prompt template. The model never reads the full prd.json or progress.md — it receives only what it needs.

## Patterns

- Each iteration spawns a fresh AI instance with clean context
- Memory persists via git history, `progress.md`, and `prd.json`
- Stories should be small enough to complete in one context window
- Always update AGENTS.md/CLAUDE.md with discovered patterns
- Test-based judge (`--judge-mode test`) runs actual tests instead of LLM review
