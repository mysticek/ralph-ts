---
name: brownfield
description: "Initialize Ralph for an existing (brownfield) codebase. Auto-detects tech stack, patterns, and conventions, then installs the Ralph orchestrator and generates CLAUDE.md, AGENTS.md, progress.md, and tasks/ directory through interactive interview. Use when setting up Ralph on a project that already has code. Triggers on: brownfield init, setup ralph for existing project, bootstrap ralph."
user-invocable: true
---

# Brownfield Init

Bootstrap Ralph for an existing codebase by auto-detecting its tech stack, interviewing the developer, installing the Ralph orchestrator, and generating all configuration files Ralph needs to operate.

---

## The Job

Three phases, executed in order:

1. **Auto-Detect** — Silently scan the codebase to identify tech stack, conventions, tooling, and project structure
2. **Interview** — Present findings to the user and ask targeted questions (5 batches) using `AskUserQuestion`
3. **Generate** — Install the Ralph orchestrator, produce CLAUDE.md, AGENTS.md, progress.md, and `tasks/` directory in the target project

**Important:** This skill sets up Ralph and generates configuration files. It does NOT implement features or create PRDs.

---

## Phase 1: Auto-Detection

Scan the codebase silently before presenting anything to the user. Follow the detection guide in `references/auto-detection.md`.

Scan these areas:
- **Project identity** — manifest files, README, existing Ralph files
- **Tech stack** — frameworks, languages, databases, ORMs, styling
- **Conventions** — file naming, import patterns, barrel exports, project structure
- **Quality tooling** — linters, formatters, pre-commit hooks, CI workflows
- **State and data layer** — state management, data fetching, authentication

Tag every detection with a confidence level:
- **HIGH** — Signal file exists AND contents confirm (e.g., `next` in package.json deps + `app/` directory exists)
- **MEDIUM** — Signal file exists but usage unclear (e.g., dependency installed but no config file)
- **LOW** — Inferred from indirect signals (e.g., file patterns suggest a convention but nothing explicit)

Build an internal detection report. Do NOT show raw output to the user yet.

---

## Phase 2: Interactive Interview

Present the auto-detection summary FIRST as a formatted overview:

```
## Detection Summary

**Project:** {name} — {description from README}
**Language:** TypeScript (HIGH)
**Framework:** Next.js 14, App Router (HIGH)
**Styling:** Tailwind CSS (HIGH)
**ORM:** Prisma (HIGH)
**Testing:** Vitest (MEDIUM)
**Package Manager:** pnpm (HIGH)
**Monorepo:** No
```

Then ask questions in 5 batches per `references/question-flow.md`.

### Question Rules

1. **Always use `AskUserQuestion` tool** — never plain text prompts
2. **2-4 options per question** — the tool auto-adds "Other" for free-form input
3. **Detected values go first** — label them with "(Detected)" suffix
4. **Skip questions where detection confidence is HIGH** — tell the user what was detected and move on
5. **Ask conditional questions only when relevant** — skip frontend questions for backend-only projects, skip monorepo questions for single-package projects
6. **Batch questions** — ask up to 4 questions at a time using `AskUserQuestion`'s multi-question support

### Batch Flow

- **Batch 1: Project Overview** (Q1-Q4) — Always asked
- **Batch 2: Architecture** (Q5-Q9) — Conditional, skip HIGH confidence items
- **Batch 3: Quality & Workflow** (Q10-Q14) — Always asked
- **Batch 4: Codebase-Specific** (Q15-Q19) — Conditional on detected stack
- **Batch 5: Ralph Configuration** (Q20-Q23) — Always asked (includes where to install Ralph scripts)

Between batches, acknowledge answers and show how they'll be used. Keep momentum — don't over-explain.

---

## Phase 3: Generation

Two parts: install the Ralph orchestrator, then generate config files.

### Step 1: Install Ralph Orchestrator

Determine the Ralph repo location. The skill is loaded from the Ralph repo, so use the skill's own path to find the source files.

**Find the ralph repo:** The skill file lives at `{ralph_repo}/skills/brownfield/SKILL.md`. Navigate up two levels from the skill's location to find the ralph repo root.

Copy the TypeScript orchestrator, TUI, and templates to the target location (from Q23, default `scripts/ralph/`):

```bash
mkdir -p {target_dir}/src/templates {target_dir}/src/tui
cp -r {ralph_repo}/src/*.ts {target_dir}/src/
cp -r {ralph_repo}/src/tui/*.tsx {target_dir}/src/tui/
cp -r {ralph_repo}/src/templates/*.md {target_dir}/src/templates/
cp {ralph_repo}/ralph {target_dir}/ralph
cp {ralph_repo}/package.json {target_dir}/package.json
cp {ralph_repo}/tsconfig.json {target_dir}/tsconfig.json
chmod +x {target_dir}/ralph
```

Also copy:
- `{ralph_repo}/prd.json.example` → `{target_dir}/prd.json.example`
- `{ralph_repo}/judge-prompt.md` → `{target_dir}/judge-prompt.md`

Then install dependencies:
```bash
cd {target_dir} && bun install || npm install
```

**CRITICAL: All files in Step 1 MUST be verbatim copies from the ralph repo using `cp`. NEVER generate, rewrite, or modify their content. These are exact operational files that the orchestrator depends on. If you generate or alter them, Ralph will break.**

### Step 2: Generate Config Files

Generate files using templates from `references/templates/`. Write them into the TARGET project's root directory (the codebase being initialized, NOT the Ralph repo).

#### Files to Generate

1. **CLAUDE.md** — Agent instructions tailored to this project (per `references/templates/claude-md-template.md`)
2. **AGENTS.md** — Ralph operational instructions (per `references/templates/agents-md-template.md`)
3. **progress.md** — Pre-populated with detected codebase patterns (per `references/templates/progress-txt-template.md`)
4. **`tasks/` directory** — Create if it doesn't exist

#### Generation Rules

- Use interview answers to fill template placeholders
- Include only sections relevant to the detected stack
- Keep generated content concise — agents need signal, not noise
- Quality commands must be exact (copy from package.json scripts or detection)
- Directory trees should be 2 levels deep max with purpose annotations

---

## Merge Rules

**Never overwrite existing files.** If CLAUDE.md or AGENTS.md already exists:

1. Read the existing file first
2. Identify sections that are NEW (not already covered)
3. Present a merge plan to the user showing what will be added
4. Ask for confirmation before writing
5. Append new sections below existing content, clearly marked:

```markdown
## --- Added by Ralph Brownfield Init ---

[new sections here]
```

If `progress.md` (or legacy `progress.txt`) exists with content, append the Codebase Patterns section at the top (below any existing header) rather than replacing. Rename `progress.txt` to `progress.md` if found.

If `prd.json` already exists, do NOT touch it. Inform the user it was found and left unchanged.

---

## Output Checklist

Before finishing, verify:

- [ ] Ralph orchestrator copied to {scripts_dir} and dependencies installed
- [ ] CLAUDE.md exists with correct tech stack, quality commands, and conventions
- [ ] AGENTS.md exists with Ralph operational instructions
- [ ] progress.md exists with Codebase Patterns section populated
- [ ] `tasks/` directory exists
- [ ] If Q20 answer was "Identify tech debt/TODOs" — scan for TODO/FIXME/HACK comments and produce `tasks/tech-debt-audit.md`
- [ ] No existing files were overwritten (merged if they existed)
- [ ] Quality commands in CLAUDE.md are accurate and runnable
- [ ] Orchestrator paths resolve correctly

Print a summary:

```
## Ralph Initialization Complete

**Ralph orchestrator installed to:** {scripts_dir}/
  - ralph (wrapper script with runtime detection)
  - src/tui/ (interactive TUI — setup wizard + live dashboard)
  - src/ralph.ts (headless orchestrator)
  - src/templates/ (prompt templates)
  - package.json + tsconfig.json

**Project files generated:**
- CLAUDE.md — Agent instructions for {project}
- AGENTS.md — Ralph operational config
- progress.md — Pre-populated with {N} codebase patterns
- tasks/ — Ready for PRDs

**Next steps:**
1. Review generated files and adjust as needed
2. Create a PRD with `/ralph-ts:prd`
3. Convert to prd.json with `/ralph-ts:convert`
4. Run Ralph: `cd {scripts_dir} && ./ralph`
```

---

## Edge Cases

### Empty or near-empty codebase
If fewer than 5 source files are detected, suggest the greenfield workflow instead:
> "This looks like a new project with very few files. Consider using the standard Ralph setup (write CLAUDE.md manually, create PRD with `/ralph-ts:prd`) instead of brownfield init. Continue anyway?"

### Monorepo detected
Ask which app or package to initialize for. Scope all detection to that path. Generate files in the monorepo root but with scope annotations.

### Non-JavaScript projects
Skip frontend-specific questions (Q6, Q15, Q16) for Python, Go, Rust, Java, etc. Adapt detection signals accordingly — look for `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml` instead of `package.json`.

### Existing Ralph setup
If `prd.json` and `progress.md` (or `progress.txt`) both exist with content, warn the user that Ralph appears to already be configured. Ask whether to re-initialize or skip.
