// The shape layer: a declarative description of how the app looks and flows.
// It is data, never code, so it can be validated, diffed, versioned and rolled back.

import { DEAL_FIELDS, STAGES, deepFreeze } from '../core/domain.js';
import { canReadField } from '../core/policy.js';

export const LAYOUTS = deepFreeze(['kanban', 'table']);

export const BASE_SHAPE = deepFreeze({
  views: {
    pipeline: {
      title: 'Pipeline',
      layout: 'kanban',
      groupBy: 'stage',
      columns: ['name', 'company', 'value', 'owner'],
      filter: null,
      sort: { field: 'value', dir: 'desc' },
    },
  },
  workflow: {
    audit: true,
    gates: [{ id: 'compliance-check', label: 'Compliance check', before: 'won' }],
  },
});

export function validateShape(shape) {
  const errors = [];
  for (const [id, view] of Object.entries(shape.views ?? {})) {
    const at = `views.${id}`;
    if (!LAYOUTS.includes(view.layout)) errors.push(`${at}.layout must be one of: ${LAYOUTS.join(', ')}`);
    if (!Array.isArray(view.columns) || view.columns.length === 0) errors.push(`${at}.columns must list at least one field`);
    for (const col of view.columns ?? []) {
      if (!DEAL_FIELDS[col]) errors.push(`${at}.columns: unknown field "${col}"`);
    }
    if (new Set(view.columns).size !== view.columns?.length) errors.push(`${at}.columns has duplicates`);
    if (view.groupBy && DEAL_FIELDS[view.groupBy]?.type !== 'enum') errors.push(`${at}.groupBy must be an enum field`);
    if (view.filter && !DEAL_FIELDS[view.filter.field]) errors.push(`${at}.filter: unknown field "${view.filter.field}"`);
    if (view.sort && !DEAL_FIELDS[view.sort.field]) errors.push(`${at}.sort: unknown field "${view.sort.field}"`);
    if (view.sort && !['asc', 'desc'].includes(view.sort.dir)) errors.push(`${at}.sort.dir must be asc or desc`);
  }
  for (const gate of shape.workflow?.gates ?? []) {
    if (!STAGES.includes(gate.before)) errors.push(`workflow.gates: unknown stage "${gate.before}"`);
  }
  return errors;
}

export function fieldsUsed(shape) {
  const fields = new Set();
  for (const view of Object.values(shape.views ?? {})) {
    (view.columns ?? []).forEach((f) => fields.add(f));
    if (view.filter) fields.add(view.filter.field);
    if (view.sort) fields.add(view.sort.field);
    if (view.groupBy) fields.add(view.groupBy);
  }
  return fields;
}

// What a specific person actually gets to see of a shape.
export function visibleShape(user, shape) {
  const next = structuredClone(shape);
  for (const view of Object.values(next.views)) {
    view.columns = view.columns.filter((f) => canReadField(user, f));
    if (view.sort && !canReadField(user, view.sort.field)) view.sort = null;
    if (view.filter && !canReadField(user, view.filter.field)) view.filter = null;
  }
  return next;
}
