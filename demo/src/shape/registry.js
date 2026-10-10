// Versioned shapes. The org shape is a list of full snapshots; each person's
// personal shape is a list of patches replayed on top of the current org shape.

import { INVARIANTS } from '../core/policy.js';
import { applyPatch } from './patch.js';
import { validateShape } from './spec.js';

export class ShapeRegistry {
  constructor(base) {
    this.org = [{ version: 1, shape: base, intent: 'Base shape', author: 'system', at: new Date().toISOString() }];
    this.personal = new Map();
  }

  orgShape() {
    return this.org.at(-1).shape;
  }

  overlay(userId) {
    return this.personal.get(userId) ?? [];
  }

  // Personal patches are re-checked on every read: if an org change makes one
  // invalid, it is skipped (and flagged) instead of breaking the app.
  effectiveShape(user) {
    let shape = this.orgShape();
    for (const entry of this.overlay(user.id)) {
      try {
        const candidate = applyPatch(shape, entry.ops);
        entry.stale = validateShape(candidate).length > 0 || !INVARIANTS.every((inv) => inv.holds(candidate));
        if (!entry.stale) shape = candidate;
      } catch {
        entry.stale = true;
      }
    }
    return shape;
  }

  baseFor(user, scope) {
    return scope === 'org' ? this.orgShape() : this.effectiveShape(user);
  }

  commit(user, proposal, shape) {
    const at = new Date().toISOString();
    if (proposal.scope === 'org') {
      this.org.push({ version: this.org.length + 1, shape, intent: proposal.intent, author: user.id, at });
    } else {
      const list = this.overlay(user.id);
      list.push({ version: list.length + 1, ops: proposal.ops, intent: proposal.intent, at });
      this.personal.set(user.id, list);
    }
  }

  rollback(user, scope) {
    if (scope === 'org') return this.org.length > 1 ? this.org.pop() : null;
    return this.overlay(user.id).pop() ?? null;
  }

  history(user) {
    return {
      org: this.org.map(({ version, intent, author, at }) => ({ version, intent, author, at })),
      personal: this.overlay(user.id).map(({ version, intent, at, stale }) => ({ version, intent, at, stale: !!stale })),
    };
  }
}
