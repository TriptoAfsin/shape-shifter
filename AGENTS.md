# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository.

## What this repo is

The home of **Shapeshifting Software**, a concept and reference architecture by **TriptoAfsin** for applications that reshape their UI, workflows and configurable behavior from natural-language intent while their core logic and guardrails stay invariant.

- `README.md`: the idea, positioning, prior art
- `ARCHITECTURE.md`: the reference architecture (source of truth for terminology)
- `SKILL/`: agent skill for applying the architecture to other codebases
- `docs/diagram/architecture.html` → `docs/assets/shapeshifting-architecture.png`: the full diagram
- `docs/diagram/poster.html` → `docs/assets/shapeshifting-poster.png`: the social poster (1080×1350, rendered at 2x)
- `demo/`: zero-dependency Node reference implementation

## Ground rules

- **Do not commit, push, tag or open PRs.** The maintainer commits by hand. Leave changes in the working tree and suggest a commit message instead.
- **Authorship:** TriptoAfsin is the sole author. Never add `Co-Authored-By` trailers, AI attribution lines or "Generated with" footers to commits, PRs, docs or code.
- Keep the terminology consistent with `ARCHITECTURE.md`: *brain layer*, *brain harness*, *core*, *shape*, *shape layer*, *shape patch*, *shape engine*, *guard*, *shape registry*, *overlay*, *scope*, *invariant*, *effective shape*.
- The guiding rule is **"the brain proposes, the core decides."** Do not add anything that lets model output execute, reach non-allowlisted paths or bypass the guard.

## Demo

```bash
cd demo
npm start   # http://localhost:4173
npm test    # node:test, must stay green
```

- Node 20+, ES modules, **no runtime dependencies**. Ask before adding any.
- Style: 2-space indent, single quotes, semicolons, small pure functions, short comments that explain *why*.
- `src/core/` is the immutable core. Changes there are design changes, so update `ARCHITECTURE.md` too.
- Every new guard rule needs a rejecting test in `demo/test/`.
- `src/pipeline/interpret.js` is the brain layer: a deterministic stand-in for the AI models. Any model-backed brain must keep the same contract (`proposal | clarify`), run through `src/pipeline/harness.js`, and stay optional (the demo must run with no API key).

## Diagram

Edit `docs/diagram/architecture.html` (SVG + rough.js), then re-render the PNG with headless Chrome:

```bash
chrome --headless=new --hide-scrollbars --window-size=1800,1120 --force-device-scale-factor=2 \
  --virtual-time-budget=5000 --screenshot=docs/assets/shapeshifting-architecture.png \
  docs/diagram/architecture.html
```

Keep it light and minimal, with readable labels and the four pillar colors (intent amber, adaptation blue, constraint red, persistence violet).

## Skill

- `SKILL/SKILL.md` frontmatter keeps `name: shapeshifting-software` and `metadata.author: TriptoAfsin`.
- Keep `SKILL.md` lean and procedural. Put detail in `SKILL/references/`, one level deep and linked from `SKILL.md`.

## Commit messages (for suggestions)

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <imperative summary, ≤ 72 chars>

<optional body: what and why, wrapped at 72>
```

- **Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `build`, `ci`
- **Scopes:** `demo`, `core`, `engine`, `guard`, `skill`, `docs`, `diagram`, `repo`
- Examples:
  - `feat(guard): reject patches that reference restricted fields`
  - `docs(architecture): add threat model for prompt injection`
  - `chore(repo): add license and gitignore`
- One logical change per commit, and no AI co-author trailers.

## Writing style

Plain, direct prose. Avoid hype words, filler and stacked em dashes. Prefer tables and short lists over long paragraphs. Cite prior art when making claims about novelty.
