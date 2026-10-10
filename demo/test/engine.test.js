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
  assert.deepEqual(engine.view(ana).shape.views.pipeline.filter, { field: 'region', eq: '$me.region' });
  assert.equal(engine.view(cy).shape.views.pipeline.filter, null);
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
