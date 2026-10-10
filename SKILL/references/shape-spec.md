# Shape spec, patch format and guard

## Contents

1. Shape spec
2. Shape patch
3. Reshapeable surface
4. Guard order
5. Interpreter contract
6. Registry and scopes

## 1. Shape spec

A shape is declarative data that references core vocabulary by id. Example (CRM pipeline):

```json
{
  "views": {
    "pipeline": {
      "title": "Pipeline",
      "layout": "kanban",
      "groupBy": "stage",
      "columns": ["name", "company", "value", "owner"],
      "filter": { "field": "region", "eq": "$me.region" },
      "sort": { "field": "value", "dir": "desc" }
    }
  },
  "workflow": {
    "audit": true,
    "gates": [
      { "id": "compliance-check", "label": "Compliance check", "before": "won" },
      { "id": "manager-approval", "label": "Manager approval", "before": "won" }
    ]
  }
}
```

Rules:

- Field, stage, role and action ids must exist in the core. Validate them, never trust them.
- Use symbolic tokens for viewer context (`$me.region`, `$me.team`) and resolve them server-side.
- Use enums for layouts, operators and directions. Avoid free-form strings that a renderer would interpret.
- Automations reference **named core capabilities** (`notify(role)`, `assign(queue)`), never URLs, scripts or queries.

## 2. Shape patch

```json
{
  "scope": "personal",
  "intent": "Show only my region and add manager approval before won",
  "summary": ["Show only deals in the viewer's region", "Require manager approval before \"won\""],
  "ops": [
    { "op": "set", "path": "/views/pipeline/filter", "value": { "field": "region", "eq": "$me.region" } },
    { "op": "add", "path": "/workflow/gates/-", "value": { "id": "manager-approval", "label": "Manager approval", "before": "won" } }
  ]
}
```

- `op` ∈ `set | add | remove`, `path` is a JSON Pointer, and `-` appends.
- Apply ops to a **copy**, in order. Later ops see earlier results.
- Keep `intent` and `summary`: they become the audit entry and the preview text.

## 3. Reshapeable surface

Keep an explicit allowlist and treat everything else as core:

```js
const RESHAPEABLE = [
  /^\/views\/[a-z]+\/(title|layout|groupBy|filter|sort)$/,
  /^\/views\/[a-z]+\/columns\/(\d+|-)$/,
  /^\/workflow\/gates\/(\d+|-)$/,
];
```

Note that `/workflow/audit` is deliberately absent, and so is any path that edits roles, fields or data.

## 4. Guard order

Run the checks cheapest and most decisive first, and collect every violation:

1. **Scope:** may this role change this scope?
2. **Surface:** known op? path allowlisted?
3. **Apply** to a copy (a failure is a violation, not a crash).
4. **Schema:** is the result a valid shape?
5. **Permissions:** for fields the patch *newly* references, may this role read them?
6. **Invariants:** does every core predicate still hold?

Re-run the whole guard at commit time against the current base.

## 5. Interpreter contract

```ts
type Interpret = (intent: string, ctx: {
  user: { id: string; role: string };          // no secrets
  shapeFor: (scope: Scope) => Shape;            // current base for that scope
  vocabulary: CorePublicVocabulary;             // field ids/labels, stages, capabilities
}) => Promise<
  | { kind: 'proposal'; scope: Scope; ops: Op[]; summary: string[]; intent: string }
  | { kind: 'clarify'; question: string }
>;
```

- With an LLM, force structured output (tool schema = patch schema) and low temperature.
- Treat record contents as untrusted. Do not paste raw user data into the interpreter prompt unless it is needed.
- Ask a clarifying question when a required parameter is missing, several fields match, or the scope is org/workflow-level and not stated.

## 6. Registry and scopes

- **Org:** full snapshots `v1..vN` with author, intent and timestamp. Rollback pops a snapshot.
- **Personal/team:** an ordered list of patches replayed onto the current org shape on every read. Revalidate each patch and skip (flag as stale) any that fail.
- Effective shape = org snapshot + team overlay + personal overlay, then filtered by `visibleShape(user)` (drop anything the user may not read).
