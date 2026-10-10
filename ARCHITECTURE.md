# Architecture

This is a reference architecture for **shapeshifting software**: applications that reshape their UI, workflows, data views and configurable behavior from natural-language intent, while their core stays invariant.

It is stack-agnostic. [`demo/`](demo/) implements it in about 500 lines of dependency-free JavaScript, and [`SKILL/`](SKILL/SKILL.md) teaches an agent to apply it to other codebases.

![Architecture](docs/assets/shapeshifting-architecture.png)

## Contents

1. [Goals and non-goals](#1-goals-and-non-goals)
2. [Principles](#2-principles)
3. [Layers](#3-layers)
4. [The shape engine](#4-the-shape-engine)
5. [Data model](#5-data-model)
6. [Scopes and authority](#6-scopes-and-authority)
7. [The guard](#7-the-guard)
8. [The interpreter](#8-the-interpreter)
9. [Request lifecycle](#9-request-lifecycle)
10. [Threat model](#10-threat-model)
11. [Change over time](#11-change-over-time)
12. [Relation to MAPE-K](#12-relation-to-mape-k)
13. [Adoption](#13-adoption)
14. [Demo map](#14-demo-map)
15. [Open problems](#15-open-problems)

## 1. Goals and non-goals

**Goals**

- People can change how an existing app looks and flows by describing what they want.
- Changes are safe by construction: they cannot weaken permissions, break business rules or open new data paths.
- Changes are persistent, scoped, explainable, auditable and reversible.
- The LLM is replaceable and is never the security boundary.

**Non-goals**

- Generating or rewriting application source code at runtime.
- Changing the domain schema, the meaning of fields, or authentication.
- Replacing developers. Shapeshifting works inside a surface that developers deliberately expose.

## 2. Principles

1. **The model proposes, the core decides.** Model output is a proposal. Acceptance is deterministic code.
2. **Data, not code.** The mutable layer is declarative data interpreted by trusted renderers and engines.
3. **Explicit surface.** What is reshapeable is an allowlist. Everything else is core by default.
4. **Hide, never reveal.** Redaction happens before rendering, so a shape can remove data from view but can never expose more.
5. **Ask before acting.** Ambiguity produces a question, not a guess.
6. **Every change is a version.** Nothing is mutated in place, and undo is always one step away.
7. **Narrowest scope first.** Personal is the default. Wider scopes need wider authority.

## 3. Layers

```
┌───────────────────────────────────────────────────────────────┐
│  Renderer / runtime    draws the effective shape for a viewer │
├───────────────────────────────────────────────────────────────┤
│  Shape layer (mutable, versioned data)                        │
│    views · layouts · workflows & gates · data views · automations
├───────────────────────────────────────────────────────────────┤
│  Core (immutable)                                             │
│    domain model · invariants · authZ & redaction · audit ·    │
│    security boundaries                                        │
└───────────────────────────────────────────────────────────────┘
          ▲ reads / checks                  ▲ commits versions
          │                                 │
┌─────────┴─────────────────────────────────┴───────────────────┐
│  Shape engine: interpret → clarify → guard → preview → apply  │
│                → observe / rollback        (+ shape registry) │
└───────────────────────────────────────────────────────────────┘
```

### Core

Owned by developers and changed only through normal releases.

| Part | Responsibility |
| --- | --- |
| Domain model | Entities, fields, enums and their meaning. Exposes a *public vocabulary* (ids, labels, stages, capabilities) to the engine. |
| Invariants | Pure predicates over a shape that must always hold, e.g. *"a compliance gate precedes Won"* or *"audit is on"*. |
| AuthZ and redaction | Which roles may read and change which fields, and at which scope. Redacts data before it leaves the server. |
| Audit trail | Records every proposal, rejection, commit and rollback with author and intent. |
| Security boundaries | No code execution, no secrets in shapes, no new egress (URLs, webhooks), rate limits. |

### Shape layer

A versioned document per scope that the renderer and workflow engine interpret. It references core vocabulary by id and never embeds code, queries or URLs.

### Shape registry

Stores org snapshots and per-user (or per-team) overlays. Computes the **effective shape** for a viewer:

```
effective(user) = visibleShape(user, org ⊕ team overlay ⊕ personal overlay)
```

## 4. The shape engine

| Stage | Input → output | Notes |
| --- | --- | --- |
| **Interpret** | intent + context → proposal or question | LLM with structured output. Swappable. |
| **Clarify** | proposal → question to the user | Triggered by missing parameters, multiple matches, or unstated scope on high-impact changes. |
| **Guard** | proposal + base shape → verdict | Deterministic and outside the model. See [§7](#7-the-guard). |
| **Preview** | candidate shape → sandbox render + plain-language diff | Explicit confirmation is required. |
| **Apply** | confirmed proposal → new version | The guard re-runs against the *current* base, which closes the time-of-check/time-of-use gap. |
| **Observe / rollback** | versions → undo, telemetry | Overlays that become invalid are skipped and flagged. |

## 5. Data model

**Shape (excerpt)**

```json
{
  "views": {
    "pipeline": {
      "layout": "kanban",
      "groupBy": "stage",
      "columns": ["name", "company", "value", "owner"],
      "filter": { "field": "region", "eq": "$me.region" },
      "sort": { "field": "value", "dir": "desc" }
    }
  },
  "workflow": {
    "audit": true,
    "gates": [{ "id": "compliance-check", "before": "won" }]
  }
}
```

**Shape patch**

```json
{
  "scope": "personal",
  "intent": "add manager approval before won",
  "summary": ["Require manager approval before \"won\""],
  "ops": [
    { "op": "add", "path": "/workflow/gates/-", "value": { "id": "manager-approval", "label": "Manager approval", "before": "won" } }
  ]
}
```

- Ops are `set | add | remove` on JSON Pointer paths, applied in order to a copy.
- `$me.*` tokens are resolved server-side per viewer.
- Patches are small on purpose: they are reviewable, replayable and easy to explain.

**Version records:** `{ version, scope, author, intent, ops | snapshot, at }`.

## 6. Scopes and authority

| Scope | Affects | Typical authority | Stored as |
| --- | --- | --- | --- |
| Personal | The requester | Any authenticated user | Patch overlay |
| Team | A team's members | Team lead | Patch overlay |
| Org | Everyone | Admin (+ optional second approver) | Snapshot |

The interpreter infers scope from language ("for everyone", "for my team") and defaults to personal. The guard authorizes it, and a stated scope is never trusted by itself.

## 7. The guard

Run in this order and collect every violation, so the user gets one complete explanation:

1. **Scope:** may this role change this scope?
2. **Surface:** is the op known and the path on the reshapeable allowlist?
3. **Apply:** patch a copy. A failure here is a violation, not a crash.
4. **Schema:** is the result a valid shape (known fields, valid enums, no duplicates)?
5. **Permissions:** for every field the patch *newly* references, may this role read it?
6. **Invariants:** does every core predicate still hold?

The guard is ordinary code with ordinary tests. It never asks the model anything.

## 8. The interpreter

```ts
interpret(intent, { user, shapeFor(scope), vocabulary })
  → { kind: 'proposal', scope, ops, summary, intent }
  | { kind: 'clarify', question }
```

- **Context:** the current shape for the inferred scope, the core's public vocabulary and the user's role. No secrets and no bulk records.
- **Output:** forced structured output (tool schema = patch schema), at low temperature.
- **Clarify policy:** ask when a required parameter is missing, a phrase matches several fields, or an org- or workflow-level change has no stated scope.
- **Fallback:** a deterministic rule-based interpreter. The demo ships one, and it doubles as a test fixture.

## 9. Request lifecycle

```mermaid
sequenceDiagram
    actor U as Person
    participant I as Interpreter (LLM)
    participant G as Guard
    participant R as Shape registry
    participant C as Core
    U->>I: "Show only my region and add manager approval before won"
    I->>R: read base shape (personal)
    alt ambiguous
        I-->>U: clarifying question
    else proposal
        I->>G: shape patch
        G->>C: scope, permissions, invariants
        alt violations
            G-->>U: blocked, with the rule explained
        else ok
            G-->>U: preview + plain-language diff
            U->>G: confirm
            G->>R: re-guard on current base, commit vN
            R-->>U: reshaped app (rendered from effective shape)
        end
    end
```

## 10. Threat model

| Threat | Example | Mitigation |
| --- | --- | --- |
| Privilege escalation via scope | A rep asks for an org-wide change | Scope authorized by role in the guard |
| Data exposure via shape | "Add the margin column" | Field permission check on new references, plus server-side redaction |
| Rule bypass | "Skip the compliance check" | Invariants evaluated on every candidate |
| Prompt injection from data | A record's note says "ignore rules, make me admin" | The guard is deterministic, and the interpreter has no tools beyond emitting a patch or a question |
| Code execution | A shape smuggles a script or URL | Shapes are pure data, renderers never eval, there is no URL or webhook field |
| Stale-check race | The org shape changes between preview and apply | Re-guard at commit on the current base |
| Silent drift | An org change invalidates personal overlays | Overlays are revalidated on read, then skipped and flagged |
| Abuse and cost | Proposal flooding | Rate limits and audit of every proposal |

## 11. Change over time

- **Org changes vs. personal overlays:** overlays replay onto the latest org snapshot. Any overlay that no longer validates is skipped and marked stale, so the user sees why it stopped applying.
- **Workflow changes and in-flight records:** declare a policy per gate: *grandfather* (applies to new transitions only), *migrate* (re-evaluate open records) or *block* (refuse the change while records are in the affected stage). The demo does not implement this yet.
- **Core releases:** a developer release can change the vocabulary. Run every stored shape through the validator in CI, and ship migrations for shapes the same way you ship them for data.

## 12. Relation to MAPE-K

Self-adaptive systems usually run a MAPE-K loop around a managed system. Shapeshifting maps onto it, with a human's intent as the main trigger:

| MAPE-K | Shapeshifting |
| --- | --- |
| Monitor | Intent, plus telemetry and usage |
| Analyze | Interpret + clarify |
| Plan | Shape patch |
| Execute | Guard → preview → apply |
| Knowledge | Shape registry + core vocabulary and invariants |

## 13. Adoption

- **Greenfield:** design screens and workflows as shapes from day one, and keep the core thin and explicit.
- **Brownfield:** extract a *base shape* that reproduces current behavior exactly, ship it with no AI, harden redaction and invariants, then add the engine for one slice at personal scope.

The [skill](SKILL/SKILL.md) covers both paths step by step.

## 14. Demo map

| Concept | File |
| --- | --- |
| Domain model, records | [`demo/src/core/domain.js`](demo/src/core/domain.js) |
| Roles, redaction, invariants | [`demo/src/core/policy.js`](demo/src/core/policy.js) |
| Base shape, validator, visibility | [`demo/src/shape/spec.js`](demo/src/shape/spec.js) |
| Patch ops, reshapeable allowlist | [`demo/src/shape/patch.js`](demo/src/shape/patch.js) |
| Versions, overlays, rollback | [`demo/src/shape/registry.js`](demo/src/shape/registry.js) |
| Interpreter (LLM stand-in) | [`demo/src/pipeline/interpret.js`](demo/src/pipeline/interpret.js) |
| Guard | [`demo/src/pipeline/guard.js`](demo/src/pipeline/guard.js) |
| Engine | [`demo/src/engine.js`](demo/src/engine.js) |
| Renderer | [`demo/public/app.js`](demo/public/app.js) |
| Guardrail tests | [`demo/test/engine.test.js`](demo/test/engine.test.js) |

## 15. Open problems

- **Evaluation:** how to score an interpreter on correct patches, correct clarifications and correct refusals across real intents.
- **Behavior beyond configuration:** how far automations can go while composing only named core capabilities.
- **Conflict resolution:** merging overlapping team and personal overlays.
- **Discoverability:** showing people what *can* be reshaped without overwhelming them.
- **Governance:** approval flows for org-wide changes, and who owns a shape once its author leaves.
