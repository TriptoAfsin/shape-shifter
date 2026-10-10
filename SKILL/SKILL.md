---
name: shapeshifting-software
description: Design or retrofit an application so it can reshape its own UI, workflows, data views and automations from natural-language intent while its core domain logic, permissions, audit trail and security boundaries stay invariant. Use when the user wants to make an app "shapeshifting", "malleable", "self-adapting" or "prompt-customizable"; add an AI "describe what you want and the app changes" feature to a new or existing codebase; separate an immutable core from a mutable shape layer; design the brain layer (the AI models that interpret intent), a shape spec, shape patch language, guard, preview, versioning or rollback for AI-driven app customization; or review such a design for safety.
license: CC-BY-4.0
metadata:
  author: TriptoAfsin
  version: 0.1.0
  homepage: https://github.com/TriptoAfsin/shape-shifter
---

# Shapeshifting Software

Shapeshifting software is an existing application that adapts its interface, workflows and configurable behavior from natural-language intent, within verifiable security, data and business-rule constraints.

The rule everything else follows from: **the brain proposes, the core decides.** Every intent goes to the **brain layer** (the AI models) first. The brain only ever emits a *shape patch* (declarative data) or a question. It never emits code that runs, and it never touches the core.

## The five layers to establish

```
intent → HARNESS ▸ BRAIN (AI models: understand → clarify → scope → plan)
       → SHAPE ENGINE (deterministic: guard → preview → apply → observe)
       → SHAPE LAYER + REGISTRY (versioned data) → renderer
       ↳ everything checked against the CORE (immutable)
```

1. **Brain layer (probabilistic, no authority), run inside a harness:** the AI models that understand the intent, ask when it's unclear, propose a scope and plan a patch. The harness (like Claude Code's or Codex's) makes them predictable: fixed instructions, tool allowlist, budgets, output checks with retry, hooks and traces.
2. **Shape engine (deterministic):** `guard → preview → apply → observe/rollback`. It decides.
3. **Shape layer (mutable):** declarative, versioned data describing views, layouts, charts, workflows/gates, data views and automations. Renderers and engines interpret it.
4. **Shape registry:** org snapshots plus per-user/team overlays, versioned and reversible.
5. **Core (immutable):** domain model, business invariants, authorization and redaction, audit trail, security boundaries. The brain can read its public vocabulary and can never write it.

## Workflow

First decide the mode:

- **Greenfield** (new app or new module): follow steps 1–8 and build the shape layer in from the start.
- **Brownfield** (existing codebase): read [references/brownfield-adoption.md](references/brownfield-adoption.md) first, then follow steps 1–8 one slice at a time.

### 1. Map the codebase and pick the first slice

- Find where UI layout, workflow and business rules currently live (hard-coded components, config, feature flags, DB-driven settings, rule engines).
- Pick **one** slice with high customization demand and low blast radius, e.g. a list/board view, a dashboard, a form's field order, or an approval step. Do not start with billing, auth or data schema.

### 2. Draw the core boundary

- List what must never change at runtime: entities and field semantics, money/date math, compliance rules, roles and permissions, audit, data egress, secrets.
- Express business rules that must always hold as **invariants**: pure predicates over the shape (`holds(shape) → bool`) owned by the core.
- Enforce permissions and redaction **server-side, before data leaves the core**. A shape may hide data and must never be able to reveal it.

### 3. Define the shape spec

- Model the slice as declarative JSON (or the stack's equivalent) that references core fields by id: never raw SQL, JS, templates or URLs.
- Write a validator for it (JSON Schema, Zod, Pydantic, etc.).
- Make the current hard-coded behavior the **base shape** so that nothing changes on day one.
- See [references/shape-spec.md](references/shape-spec.md) for the spec, patch format and an example.

### 4. Define the patch language and reshapeable surface

- Patches are small ordered op lists (`set` / `add` / `remove` on paths), not whole new shapes. Small patches are reviewable, diffable, replayable and explainable.
- Keep an explicit **allowlist of reshapeable paths**. Anything not on it belongs to the core.

### 5. Build the brain layer

Route every intent here first. The brain layer is one or more AI models with a single contract: `brain(intent, ctx) → proposal | question`.

- **Understand:** ground the model in the core's *public* vocabulary (field ids, labels, stages, capabilities) through the prompt or retrieval. Never give it secrets, bulk records or other users' data.
- **Clarify:** when the intent is ambiguous, underspecified or high-impact, return a question rather than guessing.
- **Scope:** propose personal, team or org from the wording. Default to personal. This is only a proposal; the guard authorizes it.
- **Plan:** use structured output (tool/function schema = patch schema) at low temperature. Allow only two tools: `emit_patch` and `ask_question`.
- **Explain:** produce the plain-language summary used by the preview and the audit log.
- **Compose models when useful:** a small router for intent and scope, a larger planner, and optionally a critic. Ship a deterministic rule-based fallback too; it doubles as the test double.

Wrap it in a **harness** so it behaves predictably, the way coding-agent harnesses do:

- **Instructions:** a fixed, versioned system prompt per app. Users cannot edit it.
- **Tool allowlist and permission modes:** `emit_patch` and `ask_question` only. Choose *suggest only*, *auto-apply personal* or *off* per tenant or role.
- **Budgets:** input size, timeout, attempts, ops per patch, tokens and cost.
- **Output contract + retry:** validate every response. Retry malformed output, then fall back to a question, never to a guess.
- **Hooks:** `before` (rate limit, kill switch, PII scrub) and `after` (metrics). A `before` hook can stop a run.
- **Traces:** record intent, attempts, errors, timing and outcome for audit, replay and evals.

The harness makes the brain well-behaved; the guard still decides what is allowed. See [references/brain-layer.md](references/brain-layer.md) for the harness, prompt skeleton, tool schema and evals.

### 6. Build the shape engine

- **Guard:** run deterministically and outside the model, in this order: scope/authority → allowlisted paths → apply to a copy → schema validation → permission check on newly referenced fields → invariants. Return human-readable violations.
- **Preview:** render the candidate shape in a sandbox and summarize the diff in plain language. Require explicit confirmation.
- **Apply:** re-run the guard against the *current* base (it may have moved), then commit a new version with author, intent text and timestamp.
- **Observe/rollback:** one-step undo per scope; replay personal overlays on read and skip (flag) any overlay that no longer validates.

### 7. Scope every change

- Classify each change as **personal** (only the requester), **team**, or **org** (everyone). Default to the narrowest scope.
- Authorize scope by role. Org-wide structural change usually needs an admin, and may need a second approver. The brain proposes a scope; only the guard grants it.

### 8. Verify

Write tests that prove the guardrails, not just the happy path. At minimum:

- [ ] A personal change does not leak to other users.
- [ ] Ambiguous intent produces a clarification, not a patch.
- [ ] A patch that breaks an invariant is rejected with the rule named.
- [ ] A patch that would reveal a restricted field is rejected for that role.
- [ ] A non-admin cannot change org scope.
- [ ] Restricted data stays redacted even when an org shape references it.
- [ ] Rollback restores the previous version.
- [ ] A stale overlay is skipped, not fatal.
- [ ] Prompt-injection text in records cannot widen scope or reach non-allowlisted paths.
- [ ] Swapping the brain's model (or using the fallback) changes proposal quality, never what the guard accepts.
- [ ] The harness retries malformed brain output, falls back to a question, enforces its budgets, and lets a `before` hook stop a run.

Run through [references/guardrails-checklist.md](references/guardrails-checklist.md) before calling the design done.

## Hard rules

- Never let model output execute: no `eval`, no generated code paths, no generated SQL, no arbitrary URLs/webhooks in shapes.
- Never let the brain layer's prompt be the security boundary. The guard and the core are the boundary.
- Never give the brain layer write access, network access, or tools beyond `emit_patch` and `ask_question`.
- Never mutate a shape in place: every change is a new version.
- Never skip preview for org-scope or workflow changes.
- Keep the brain swappable. A deterministic rule-based brain is a valid first version and a good test double.

## Reference implementation

The repo this skill ships with contains a runnable zero-dependency demo (`demo/`) of a CRM that implements every step above. Use it as a pattern when the target stack is JavaScript/TypeScript, and as a structural guide for other stacks:

- `demo/src/core/`: domain model, roles, redaction and invariants
- `demo/src/shape/`: base shape, validator, patch ops, registry
- `demo/src/pipeline/`: brain layer (deterministic stand-in for the AI models), its harness, and the guard
- `demo/src/engine.js`: propose → preview → apply → rollback
