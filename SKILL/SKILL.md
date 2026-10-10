---
name: shapeshifting-software
description: Design or retrofit an application so it can reshape its own UI, workflows, data views and automations from natural-language intent while its core domain logic, permissions, audit trail and security boundaries stay invariant. Use when the user wants to make an app "shapeshifting", "malleable", "self-adapting" or "prompt-customizable"; add an AI "describe what you want and the app changes" feature to a new or existing codebase; separate an immutable core from a mutable shape layer; design a shape spec, shape patch language, guard, preview, versioning or rollback for AI-driven app customization; or review such a design for safety.
license: CC-BY-4.0
metadata:
  author: TriptoAfsin
  version: 0.1.0
  homepage: https://github.com/TriptoAfsin/shape-shifter
---

# Shapeshifting Software

Shapeshifting software is an existing application that adapts its interface, workflows and configurable behavior from natural-language intent, within verifiable security, data and business-rule constraints.

The rule everything else follows from: **the model proposes, the core decides.** The LLM only ever emits a *shape patch* (declarative data). It never emits code that runs, and it never touches the core.

## The four layers to establish

1. **Core (immutable):** domain model, business invariants, authorization and redaction, audit trail, security boundaries. The interpreter can read it and can never write it.
2. **Shape layer (mutable):** declarative, versioned data describing views, layouts, workflows/gates, data views and automations. Renderers and engines interpret it.
3. **Shape engine:** `interpret → clarify → guard → preview → apply → observe/rollback`.
4. **Shape registry:** org snapshots plus per-user/team overlays, versioned and reversible.

## Workflow

First decide the mode:

- **Greenfield** (new app or new module): follow steps 1–7 and build the shape layer in from the start.
- **Brownfield** (existing codebase): read [references/brownfield-adoption.md](references/brownfield-adoption.md) first, then follow steps 1–7 one slice at a time.

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

### 5. Build the shape engine

- **Interpret:** LLM with structured output (tool/function schema = patch schema). Give it the current shape, the core's *public* vocabulary (field ids, labels, stages) and the user's role. Never give it secrets or other users' data.
- **Clarify:** when intent is ambiguous, underspecified or high-impact, return a question rather than guessing.
- **Guard:** run deterministically and outside the model, in this order: scope/authority → allowlisted paths → apply to a copy → schema validation → permission check on newly referenced fields → invariants. Return human-readable violations.
- **Preview:** render the candidate shape in a sandbox and summarize the diff in plain language. Require explicit confirmation.
- **Apply:** re-run the guard against the *current* base (it may have moved), then commit a new version with author, intent text and timestamp.
- **Observe/rollback:** one-step undo per scope; replay personal overlays on read and skip (flag) any overlay that no longer validates.

### 6. Scope every change

- Classify each change as **personal** (only the requester), **team**, or **org** (everyone). Default to the narrowest scope.
- Authorize scope by role. Org-wide structural change usually needs an admin, and may need a second approver.

### 7. Verify

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

Run through [references/guardrails-checklist.md](references/guardrails-checklist.md) before calling the design done.

## Hard rules

- Never let model output execute: no `eval`, no generated code paths, no generated SQL, no arbitrary URLs/webhooks in shapes.
- Never let the interpreter's prompt be the security boundary. The guard and the core are the boundary.
- Never mutate a shape in place: every change is a new version.
- Never skip preview for org-scope or workflow changes.
- Keep the interpreter swappable. A deterministic rule-based interpreter is a valid first version and a good test double.

## Reference implementation

The repo this skill ships with contains a runnable zero-dependency demo (`demo/`) of a CRM that implements every step above. Use it as a pattern when the target stack is JavaScript/TypeScript, and as a structural guide for other stacks:

- `demo/src/core/`: domain model, roles, redaction and invariants
- `demo/src/shape/`: base shape, validator, patch ops, registry
- `demo/src/pipeline/`: interpreter (LLM stand-in) and guard
- `demo/src/engine.js`: propose → preview → apply → rollback
