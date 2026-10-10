# Brownfield adoption: making an existing app shapeshift

Retrofit one slice at a time. The app must behave identically on day one.

## 1. Survey

Search the codebase for where variability already lives. Those are your seams:

- Hard-coded layout: list/table/board components, column arrays, form field order.
- Config: feature flags, tenant settings, JSON/YAML config, "custom fields" tables.
- Workflow: status enums, state machines, approval logic, rule engines, cron/automation jobs.
- Authorization: middleware, policies, row/field-level security, serializers that drop fields.

Write down each candidate slice with: demand (how often do users ask for it to change?), blast radius (what breaks if it goes wrong?) and existing seam (is there config already?).

## 2. Choose the first slice

Prefer high demand, low blast radius and an existing seam. Good first slices:

- Column choice, order, sort and filter on one list view.
- Dashboard widget arrangement.
- Adding an optional approval or notification step that the core already supports.

Avoid at first: schema changes, billing, auth, data deletion, cross-tenant anything.

## 3. Extract the base shape

1. Turn the slice's hard-coded behavior into a shape object that reproduces it exactly.
2. Change the component/engine to read from the shape instead of constants.
3. Ship this with no AI at all. Behavior must be byte-for-byte the same, so snapshot-test it.

## 4. Harden the core around it

- Move field-level permission checks to the server, if they are not there already, so the renderer receives only readable fields.
- Express the slice's business rules as invariant predicates over the shape.
- Make sure audit already captures the events the slice can affect.

## 5. Add the engine

- Build the guard first and test it with hand-written patches. Then add the brain layer, starting with a deterministic rule-based brain and putting the AI models behind the same contract.
- Start with personal scope only. Add org scope once the audit and rollback paths are proven.
- Put the feature behind a flag, for internal users first.

## 6. Expand

Repeat for the next slice. Extract shared pieces (registry, guard, preview) once two slices use them, not before.

## Mapping common stacks

| Stack | Shape storage | Validation | Guard location |
| --- | --- | --- | --- |
| Next.js / Node | Postgres JSONB per scope | Zod | API route / server action |
| Django / Rails | JSON column + version table | Pydantic / dry-schema | service object before save |
| Spring / .NET | JSON column + version table | JSON Schema | domain service |
| Low-code / Retool-like | existing app definition JSON | its own schema | publish hook |
