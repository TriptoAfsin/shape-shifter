# Guardrails checklist

Use this before calling a shapeshifting design done, and when reviewing one.

## Boundary

- [ ] The core is enumerated: entities, invariants, roles/permissions, audit, egress and secrets.
- [ ] The shape layer is pure data and validated by a schema.
- [ ] Reshapeable paths are an explicit allowlist.
- [ ] No shape field is ever executed, templated into code or SQL, or fetched as a URL.

## Authority

- [ ] Every change has a scope (personal/team/org), and personal is the default.
- [ ] Scope is authorized by role on the server, not by the brain layer.
- [ ] Org-wide workflow changes require preview and possibly a second approver.
- [ ] Identity comes from the session, never from the request body or the model.

## Data

- [ ] Redaction happens in the core before rendering. Shapes can hide data but never reveal it.
- [ ] The permission check covers every field a patch newly references (columns, filters, sorts, groupings, automations).
- [ ] Viewer tokens (`$me.*`) are resolved server-side.
- [ ] The brain layer gets the minimum context: schema vocabulary and the current shape, not bulk records.

## Prompt injection & abuse

- [ ] Text inside records, emails or attachments cannot change scope, role or allowlist. The guard is deterministic and outside the model.
- [ ] The brain layer has no tools besides "emit patch" and "ask question".
- [ ] Rate-limit proposals, and log every proposal, rejection and commit.
- [ ] Violations are explained in plain language without leaking restricted values.

## Change safety

- [ ] Preview renders the candidate in a sandbox with a plain-language diff.
- [ ] Commit re-validates against the current base (no time-of-check/time-of-use gap).
- [ ] Every commit is a new version with author, intent and timestamp.
- [ ] One-step rollback exists for each scope.
- [ ] Overlays that no longer validate after an org change are skipped and flagged, not fatal.
- [ ] Workflow changes define what happens to in-flight records (grandfather, migrate or block).

## Quality

- [ ] Tests cover each guard rule with a rejecting case (see SKILL.md step 8).
- [ ] Evals run a set of real user intents against the brain layer: measure the right patch, the right clarification and the right scope.
- [ ] A deterministic brain exists as a fallback and test double.
