// The shape engine: intent -> interpret -> guard -> preview -> apply -> (rollback).

import { randomUUID } from 'node:crypto';
import { DEALS } from './core/domain.js';
import { canShape, redact } from './core/policy.js';
import { guard } from './pipeline/guard.js';
import { interpret as defaultInterpreter } from './pipeline/interpret.js';
import { ShapeRegistry } from './shape/registry.js';
import { BASE_SHAPE, visibleShape } from './shape/spec.js';

export function createEngine({ interpret = defaultInterpreter } = {}) {
  const registry = new ShapeRegistry(BASE_SHAPE);
  const pending = new Map();

  return {
    registry,

    async propose(user, intent) {
      const result = await interpret(intent, { user, shapeFor: (scope) => registry.baseFor(user, scope) });
      if (result.kind === 'clarify') return result;

      const verdict = guard(result, { user, base: registry.baseFor(user, result.scope) });
      if (!verdict.ok) return { ...result, kind: 'rejected', violations: verdict.violations };

      const id = randomUUID();
      pending.set(id, { userId: user.id, proposal: result });
      return { ...result, kind: 'preview', id, preview: visibleShape(user, verdict.shape) };
    },

    apply(user, id) {
      const entry = pending.get(id);
      if (!entry || entry.userId !== user.id) return { ok: false, violations: [{ rule: 'proposal', message: 'Unknown or expired proposal.' }] };
      pending.delete(id);
      // The base may have moved since the preview, so check again right before committing.
      const verdict = guard(entry.proposal, { user, base: registry.baseFor(user, entry.proposal.scope) });
      if (!verdict.ok) return { ok: false, violations: verdict.violations };
      registry.commit(user, entry.proposal, verdict.shape);
      return { ok: true };
    },

    rollback(user, scope) {
      if (!canShape(user, scope)) return { ok: false, violations: [{ rule: 'scope', message: `A ${user.role} cannot roll back the ${scope} shape.` }] };
      return { ok: registry.rollback(user, scope) !== null };
    },

    view(user) {
      return {
        user,
        shape: visibleShape(user, registry.effectiveShape(user)),
        deals: redact(user, DEALS),
        history: registry.history(user),
        canShapeOrg: canShape(user, 'org'),
      };
    },
  };
}
