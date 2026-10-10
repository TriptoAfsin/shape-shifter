import assert from 'node:assert/strict';
import { test } from 'node:test';
import { USERS } from '../src/core/policy.js';
import { createEngine } from '../src/engine.js';

const { ana, cy } = USERS;

async function shift(engine, user, intent) {
  const result = await engine.propose(user, intent);
  if (result.kind === 'preview') assert.equal(engine.apply(user, result.id).ok, true);
  return result;
}

test('reshapes a personal view from intent', async () => {
  const engine = createEngine();
  const result = await shift(engine, ana, 'Switch to a table and sort by close date, ascending');
  assert.equal(result.kind, 'preview');
  const view = engine.view(ana).shape.views.pipeline;
  assert.equal(view.layout, 'table');
  assert.deepEqual(view.sort, { field: 'closeDate', dir: 'asc' });
});

test('personal changes do not leak to other users', async () => {
  const engine = createEngine();
  await shift(engine, ana, 'show only my region');
  assert.deepEqual(engine.view(ana).shape.views.pipeline.filters, [{ field: 'region', eq: '$me.region' }]);
  assert.deepEqual(engine.view(cy).shape.views.pipeline.filters, []);
});

test('asks instead of guessing when intent is ambiguous', async () => {
  const engine = createEngine();
  const result = await engine.propose(ana, 'add an approval step');
  assert.equal(result.kind, 'clarify');
  assert.match(result.question, /which stage/i);
});

test('adds a workflow gate and keeps the compliance invariant', async () => {
  const engine = createEngine();
  const result = await shift(engine, ana, 'add manager approval before won');
  assert.equal(result.kind, 'preview');
  const gates = engine.view(ana).shape.workflow.gates.map((g) => g.id);
  assert.deepEqual(gates, ['compliance-check', 'manager-approval']);
});

test('rejects a change that breaks a core invariant', async () => {
  const engine = createEngine();
  const result = await engine.propose(cy, 'skip the compliance check for everyone');
  assert.equal(result.kind, 'rejected');
  assert.ok(result.violations.some((v) => v.rule === 'compliance-before-won'));
});

test('rejects a change that would reveal a restricted field', async () => {
  const engine = createEngine();
  const asRep = await engine.propose(ana, 'show the margin column');
  assert.equal(asRep.kind, 'rejected');
  assert.ok(asRep.violations.some((v) => v.rule === 'permissions'));

  const asAdmin = await engine.propose(cy, 'show the margin column');
  assert.equal(asAdmin.kind, 'preview');
});

test('only admins can change the org shape', async () => {
  const engine = createEngine();
  const result = await engine.propose(ana, 'make the pipeline a table for everyone');
  assert.equal(result.kind, 'rejected');
  assert.ok(result.violations.some((v) => v.rule === 'scope'));
});

test('org shape with a restricted column stays redacted for reps', async () => {
  const engine = createEngine();
  await shift(engine, cy, 'show the margin column for everyone');
  const forRep = engine.view(ana);
  assert.ok(!forRep.shape.views.pipeline.columns.includes('margin'));
  assert.ok(forRep.deals.every((d) => !('margin' in d)));
  assert.ok(engine.view(cy).shape.views.pipeline.columns.includes('margin'));
});

test('rolls back the latest personal change', async () => {
  const engine = createEngine();
  await shift(engine, ana, 'switch to a table');
  await shift(engine, ana, 'hide owner');
  assert.equal(engine.rollback(ana, 'personal').ok, true);
  const view = engine.view(ana).shape.views.pipeline;
  assert.equal(view.layout, 'table');
  assert.ok(view.columns.includes('owner'));
});

test('a stale personal patch is skipped, not fatal', async () => {
  const engine = createEngine();
  await shift(engine, ana, 'hide owner'); // removes column index 3 of the org shape
  await shift(engine, cy, 'hide company, hide name, hide value for everyone'); // org now: [owner]
  // Replaying ana's patch would leave the view with no columns, so it is skipped.
  const view = engine.view(ana);
  assert.deepEqual(view.shape.views.pipeline.columns, ['owner']);
  assert.equal(view.history.personal[0].stale, true);
});

test('adds a chart from intent and restyles it in the same request', async () => {
  const engine = createEngine();
  const result = await shift(engine, ana, 'Chart value by region and make it a donut');
  assert.equal(result.kind, 'preview');
  const charts = engine.view(ana).shape.views.pipeline.charts;
  assert.deepEqual(charts.at(-1), { id: 'sum-value-by-region', type: 'donut', groupBy: 'region', measure: { agg: 'sum', field: 'value' } });
});

test('a chart over a restricted field is blocked for reps, allowed for admins', async () => {
  const engine = createEngine();
  const asRep = await engine.propose(ana, 'chart average margin by owner');
  assert.equal(asRep.kind, 'rejected');
  assert.ok(asRep.violations.some((v) => v.rule === 'permissions'));
  assert.equal((await engine.propose(cy, 'chart average margin by owner')).kind, 'preview');
});

test('charts cannot group by a number field', async () => {
  const engine = createEngine();
  const result = await engine.propose(ana, 'chart deals by value');
  assert.equal(result.kind, 'rejected');
  assert.ok(result.violations.some((v) => v.rule === 'schema'));
});

test('removes a chart and asks when there is nothing to chart', async () => {
  const engine = createEngine();
  await shift(engine, ana, 'remove the trend chart');
  const charts = engine.view(ana).shape.views.pipeline.charts;
  assert.equal(charts.length, 2);
  assert.ok(charts.every((c) => c.type !== 'line'));
  assert.equal((await engine.propose(ana, 'add a chart')).kind, 'clarify');
});

test('harness retries malformed brain output, then succeeds', async () => {
  let calls = 0;
  const flaky = async () => (++calls === 1 ? { kind: 'proposal', scope: 'everyone', ops: [] } : { kind: 'clarify', question: 'Which view?' });
  const engine = createEngine({ interpret: flaky });
  const result = await engine.propose(ana, 'do the thing');
  assert.equal(result.kind, 'clarify');
  const [trace] = engine.traces(ana);
  assert.equal(trace.attempts.length, 2);
  assert.ok(trace.attempts[0].errors.length > 0);
});

test('harness degrades to a question when the brain keeps misbehaving', async () => {
  const sneaky = async () => ({ kind: 'proposal', scope: 'personal', summary: ['x'], ops: [{ op: 'set', path: '/views/pipeline/title', value: 'javascript:alert(1)' }] });
  const engine = createEngine({ interpret: sneaky });
  const result = await engine.propose(ana, 'rename the page');
  assert.equal(result.kind, 'clarify');
  assert.equal(engine.traces(ana)[0].outcome, 'fallback');
});

test('harness enforces a time budget and an input budget', async () => {
  const slow = () => new Promise((r) => setTimeout(() => r({ kind: 'clarify', question: 'late' }), 200));
  const engine = createEngine({ interpret: slow, harness: { timeoutMs: 20, maxAttempts: 1 } });
  assert.equal((await engine.propose(ana, 'anything')).question.includes('another way'), true);
  assert.equal((await engine.propose(ana, 'x'.repeat(1000))).kind, 'clarify');
  assert.equal(engine.traces(ana)[1].outcome, 'over-budget');
});

test('harness hooks can stop a run before the brain sees it', async () => {
  let brainCalled = false;
  const engine = createEngine({
    interpret: async () => ((brainCalled = true), { kind: 'clarify', question: '?' }),
    harness: { hooks: { before: () => 'Reshaping is paused for maintenance.' } },
  });
  const result = await engine.propose(ana, 'show only my region');
  assert.equal(result.question, 'Reshaping is paused for maintenance.');
  assert.equal(brainCalled, false);
});

test('one request reshapes filters, charts, KPIs and sort together', async () => {
  const engine = createEngine();
  const result = await shift(engine, ana, 'Set me up for my territory');
  assert.equal(result.kind, 'preview');
  assert.ok(result.summary.length >= 3);
  const view = engine.view(ana).shape.views.pipeline;
  assert.deepEqual(view.filters, [{ field: 'region', eq: '$me.region' }]);
  assert.deepEqual(view.kpis, ['pipeline', 'won', 'closing30', 'win']);
  assert.ok(view.charts.some((c) => c.groupBy === 'company'));
  assert.ok(!view.charts.some((c) => c.groupBy === 'region'));
});

test('filters stack: territory then forecast keeps both', async () => {
  const engine = createEngine();
  await shift(engine, ana, 'Set me up for my territory');
  await shift(engine, ana, 'Turn this into a forecast view');
  const view = engine.view(ana).shape.views.pipeline;
  assert.deepEqual(view.filters.map((f) => f.field), ['region', 'stage']);
  assert.equal(view.layout, 'table');
  assert.deepEqual(view.sort, { field: 'closeDate', dir: 'asc' });
});

test('the brain tailors a playbook to the role; the guard still guards KPIs', async () => {
  const engine = createEngine();
  const forRep = await engine.propose(ana, 'Executive summary');
  assert.equal(forRep.kind, 'preview');
  assert.ok(!JSON.stringify(forRep.ops).includes('margin'));
  const forAdmin = await engine.propose(cy, 'Executive summary for everyone');
  assert.ok(JSON.stringify(forAdmin.ops).includes('margin'));

  const sneaky = await engine.propose(ana, 'Add an average margin KPI');
  assert.equal(sneaky.kind, 'rejected');
  assert.ok(sneaky.violations.some((v) => v.rule === 'permissions'));
});

test('a line chart needs a date to run along', async () => {
  const engine = createEngine();
  const result = await engine.propose(ana, 'chart value by region and make it a line');
  assert.equal(result.kind, 'clarify');
  assert.equal((await engine.propose(ana, 'add a KPI for won value')).kind, 'preview');
});
