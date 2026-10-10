# Brain layer

The AI models every intent goes to first. They propose and never decide.

## Contents

1. Responsibilities
2. Model topology
3. The harness
4. Tool schema
5. Prompt skeleton
6. Brain memory
7. Evals

## 1. Responsibilities

| Step | Output | Rule |
| --- | --- | --- |
| Understand | intent mapped to core vocabulary | Only ids that exist in the vocabulary |
| Clarify | a question | Ask when a parameter is missing, a phrase matches several fields, or an org/workflow change has no stated scope |
| Scope | `personal` / `team` / `org` | Default to `personal`. Wider only when the words say so |
| Plan | `ops[]` | Smallest patch that satisfies the intent |
| Explain | `summary[]` | One plain sentence per op, used in preview and audit |

## 2. Model topology

Pick the simplest one that meets quality:

```
single:        intent ──► LLM (understand+clarify+scope+plan+explain) ──► proposal | question
router+plan:   intent ──► small model (intent class, scope) ──► LLM planner ──► proposal | question
plan+critic:   intent ──► LLM planner ──► critic model (advisory) ──► proposal | question
fallback:      intent ──► rule-based brain ──► proposal | question      (offline, tests)
```

- The critic may downgrade a proposal to a question. It can never approve one; only the guard approves.
- Keep the same contract for every topology so models can be swapped without touching the engine.

## 3. The harness

Never call a model directly from the app. Every brain run goes through one harness function:

```js
async function run(intent, ctx) {
  if (intent.length > budget.maxIntentChars) return ask('Try one change at a time.');
  const stop = hooks.before?.({ intent, ctx });          // rate limit, kill switch, PII scrub
  if (stop) return ask(stop);
  for (let attempt = 1; attempt <= budget.maxAttempts; attempt++) {
    const out = await withTimeout(brain(intent, buildContext(ctx)), budget.timeoutMs);
    const errors = checkOutput(out);                       // kind, scope, op shapes, no code/URLs
    trace.attempts.push({ attempt, errors });
    if (!errors.length) return done(out);                  // → guard
  }
  return done(ask("I couldn't turn that into a safe change."));   // degrade, never guess
}
```

| Concern | Setting |
| --- | --- |
| Instructions | Fixed per app version; stored with the code |
| Permission mode | `suggest` (preview always) · `auto-personal` · `off` |
| Determinism | temperature ≤ 0.2, pinned model id, cache on (intent, shape hash) |
| Observability | trace per run: intent, context hash, attempts, errors, ms, outcome |

Reference implementation: `demo/src/pipeline/harness.js`.

## 4. Tool schema

Expose exactly two tools and force the model to call one of them.

```json
[
  {
    "name": "emit_patch",
    "description": "Propose a change to the app's shape. Use only ids from the vocabulary.",
    "input_schema": {
      "type": "object",
      "required": ["scope", "ops", "summary"],
      "properties": {
        "scope": { "enum": ["personal", "team", "org"] },
        "ops": {
          "type": "array", "maxItems": 8,
          "items": {
            "type": "object", "required": ["op", "path"],
            "properties": {
              "op": { "enum": ["set", "add", "remove"] },
              "path": { "type": "string", "pattern": "^/" },
              "value": {}
            }
          }
        },
        "summary": { "type": "array", "items": { "type": "string" } }
      }
    }
  },
  {
    "name": "ask_question",
    "description": "Ask the person one short question when the intent is ambiguous or high-impact.",
    "input_schema": { "type": "object", "required": ["question"], "properties": { "question": { "type": "string" } } }
  }
]
```

## 5. Prompt skeleton

```
You reshape <APP> for one person. You can only propose changes; a separate system decides.

Vocabulary (the only ids you may use):
<fields with labels and types> <stages> <views> <capabilities>

Reshapeable paths:
<allowlist>

Current shape for <scope>:
<shape JSON>

The person: role=<role>. Default scope is personal; use team/org only if they say so.
If anything is unclear, call ask_question. Otherwise call emit_patch with the smallest patch.
Never include URLs, code, queries or ids that are not in the vocabulary.
```

- Put the person's words in a separate user turn, never inside the instructions.
- Do not include record contents. If the intent needs them ("hide deals like the Nordwind one"), resolve them server-side into ids first.

## 6. Brain memory

Optional per-user or per-org store of:

- synonyms ("deal size" → `value`, "pipe" → `pipeline` view)
- phrasing preferences and frequently applied patches

Memory goes into the prompt as data. It never changes the vocabulary, the allowlist or the guard.

## 7. Evals

Keep a dataset of real intents, each labelled with the expected outcome:

| Intent | Expected |
| --- | --- |
| "show only my region" | patch: filter region = `$me.region`, scope personal |
| "add an approval step" | question (which stage?) |
| "make the pipeline a table for everyone" | patch, scope org (the guard will reject it for non-admins) |
| "skip the compliance check" | patch the guard rejects. The brain doesn't need to refuse; the guard does |

Measure: correct kind (patch vs question), correct scope, exact or equivalent ops, summary faithfulness. Run the eval on every model or prompt change, and compare against the rule-based fallback as a floor. Harness traces from production are the best source of new eval cases.
