// The immutable core: who may do what, and what must always be true.
// The interpreter never sees this file as something it can change.

import { DEAL_FIELDS, deepFreeze } from './domain.js';

export const USERS = deepFreeze({
  ana: { id: 'ana', name: 'Ana', role: 'rep', region: 'EMEA' },
  ben: { id: 'ben', name: 'Ben', role: 'manager', region: 'NA' },
  cy: { id: 'cy', name: 'Cy', role: 'admin', region: 'APAC' },
});

// Personal shapes affect only the person who asked. Org shapes affect everyone.
const SCOPE_ROLES = deepFreeze({
  personal: ['rep', 'manager', 'admin'],
  org: ['admin'],
});

export function canShape(user, scope) {
  return SCOPE_ROLES[scope]?.includes(user.role) ?? false;
}

export function canReadField(user, field) {
  const def = DEAL_FIELDS[field];
  if (!def) return false;
  return !def.readRoles || def.readRoles.includes(user.role);
}

// Redaction happens in the core, before data leaves the server.
// A shape can hide a field, but it can never reveal one.
export function redact(user, rows) {
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => key === 'id' || canReadField(user, key))),
  );
}

// Invariants hold for every shape, at every scope, no matter who asks.
export const INVARIANTS = deepFreeze([
  {
    id: 'compliance-before-won',
    description: 'Deals must pass the compliance check before they can be marked won.',
    holds: (shape) => (shape.workflow?.gates ?? []).some((g) => g.id === 'compliance-check' && g.before === 'won'),
  },
  {
    id: 'audit-trail',
    description: 'Every stage change is written to the audit log.',
    holds: (shape) => shape.workflow?.audit === true,
  },
]);
