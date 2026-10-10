// The brain harness: runs the brain (rule-based today, AI models tomorrow) predictably.
// Same idea as an agent harness: fixed contract, budgets, output checks with retry,
// hooks around every run, and a trace of everything that happened.
// The harness makes the brain well-behaved. The guard still decides.

import { randomUUID } from 'node:crypto';
import { OPS } from '../shape/patch.js';

const SCOPES = ['personal', 'team', 'org'];
const UNSAFE_VALUE = /(https?:|javascript:|<script|\beval\(|\bfunction\s*\(|=>)/i;
const FALLBACK = { kind: 'clarify', question: "I couldn't turn that into a safe change. Try saying it another way." };

// Contract check on what the brain returned. Shape only; meaning is the guard's job.
export function checkOutput(out) {
  const errors = [];
  if (!out || typeof out !== 'object') return ['output is not an object'];
  if (out.kind === 'clarify') {
    if (typeof out.question !== 'string' || !out.question.trim() || out.question.length > 300) errors.push('question must be 1–300 chars');
    return errors;
  }
  if (out.kind !== 'proposal') return [`unknown kind "${out.kind}"`];
  if (!SCOPES.includes(out.scope)) errors.push(`unknown scope "${out.scope}"`);
  if (!Array.isArray(out.ops) || out.ops.length === 0 || out.ops.length > 8) errors.push('ops must hold 1–8 operations');
  for (const op of out.ops ?? []) {
    if (!OPS.includes(op?.op)) errors.push(`unknown op "${op?.op}"`);
    if (typeof op?.path !== 'string' || !op.path.startsWith('/')) errors.push('op path must be a JSON pointer');
    if (UNSAFE_VALUE.test(JSON.stringify(op?.value ?? ''))) errors.push('op value looks like code or a URL');
  }
  if (!Array.isArray(out.summary) || out.summary.some((s) => typeof s !== 'string')) errors.push('summary must be a list of sentences');
  return errors;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`brain timed out after ${ms} ms`)), ms))),
  ]);
}

/**
 * @param {Function} brain  (intent, ctx) => proposal | clarify
 * @param {{ timeoutMs?, maxAttempts?, maxIntentChars?, hooks?: { before?, after? }, traceLimit? }} options
 */
export function createHarness(brain, { timeoutMs = 4000, maxAttempts = 2, maxIntentChars = 400, hooks = {}, traceLimit = 200 } = {}) {
  const traces = [];

  async function run(intent, ctx) {
    const trace = { id: randomUUID(), at: new Date().toISOString(), user: ctx.user.id, intent, attempts: [], outcome: null };
    const finish = (result, outcome) => {
      trace.outcome = outcome;
      traces.push(trace);
      if (traces.length > traceLimit) traces.shift();
      hooks.after?.({ intent, ctx, result, trace });
      return result;
    };

    // Budget: refuse oversized input before any model sees it.
    if (intent.length > maxIntentChars) {
      return finish({ kind: 'clarify', question: `That's a lot at once. Try one change in under ${maxIntentChars} characters.` }, 'over-budget');
    }
    // Pre-hook: policy can stop a run (rate limits, feature flags, kill switch).
    const blocked = hooks.before?.({ intent, ctx });
    if (blocked) return finish({ kind: 'clarify', question: blocked }, 'blocked-by-hook');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const out = await withTimeout(brain(intent, ctx), timeoutMs);
        const errors = checkOutput(out);
        trace.attempts.push({ attempt, ms: Date.now() - started, errors });
        if (errors.length === 0) return finish(out, out.kind);
      } catch (err) {
        trace.attempts.push({ attempt, ms: Date.now() - started, errors: [err.message] });
      }
    }
    // Out of attempts: degrade to a question, never to a guess.
    return finish(FALLBACK, 'fallback');
  }

  return { run, traces: (userId) => traces.filter((t) => !userId || t.user === userId) };
}
