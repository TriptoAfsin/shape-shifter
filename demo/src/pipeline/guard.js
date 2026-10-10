// The guard: the only way a proposal reaches the shape registry.
// The interpreter proposes; the core decides.

import { canReadField, canShape, INVARIANTS } from '../core/policy.js';
import { applyPatch, isReshapeable, OPS } from '../shape/patch.js';
import { fieldsUsed, validateShape } from '../shape/spec.js';

export function guard(proposal, { user, base }) {
  const violations = [];
  const fail = (rule, message) => violations.push({ rule, message });

  // 1. Authority: may this person change this scope at all?
  if (!canShape(user, proposal.scope)) fail('scope', `A ${user.role} cannot change the ${proposal.scope} shape.`);

  // 2. Surface: does the patch only touch reshapeable paths?
  for (const { op, path } of proposal.ops) {
    if (!OPS.includes(op)) fail('patch', `Unknown operation "${op}".`);
    if (!isReshapeable(path)) fail('reshapeable', `${path} is part of the core and cannot be reshaped.`);
  }
  if (violations.length) return { ok: false, violations };

  let next;
  try {
    next = applyPatch(base, proposal.ops);
  } catch (err) {
    return { ok: false, violations: [{ rule: 'patch', message: err.message }] };
  }

  // 3. Schema: is the result still a well-formed shape?
  for (const message of validateShape(next)) fail('schema', message);

  // 4. Permissions: does the patch reveal any field this person may not read?
  const before = fieldsUsed(base);
  for (const field of fieldsUsed(next)) {
    if (!before.has(field) && !canReadField(user, field)) fail('permissions', `A ${user.role} cannot read "${field}".`);
  }

  // 5. Invariants: business rules that hold for every shape.
  for (const inv of INVARIANTS) if (!inv.holds(next)) fail(inv.id, inv.description);

  return { ok: violations.length === 0, violations, shape: next };
}
