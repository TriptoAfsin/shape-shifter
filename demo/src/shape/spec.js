// The shape layer: a declarative description of how the app looks and flows.
// It is data, never code, so it can be validated, diffed, versioned and rolled back.

import { DEAL_FIELDS, STAGES, deepFreeze } from '../core/domain.js';
import { canReadField } from '../core/policy.js';

export const LAYOUTS = deepFreeze(['kanban', 'table']);
export const CHART_TYPES = deepFreeze(['bar', 'donut']);
export const AGGREGATES = deepFreeze(['sum', 'avg', 'count']);
const MAX_CHARTS = 4;

export const BASE_SHAPE = deepFreeze({
  views: {
    pipeline: {
      title: 'Pipeline',
      layout: 'kanban',
      groupBy: 'stage',
      columns: ['name', 'company', 'value', 'owner'],
      filter: null,
      sort: { field: 'value', dir: 'desc' },
      charts: [{ id: 'sum-value-by-stage', type: 'bar', groupBy: 'stage', measure: { agg: 'sum', field: 'value' } }],
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
    errors.push(...validateCharts(view.charts ?? [], `${at}.charts`));
  }
  for (const gate of shape.workflow?.gates ?? []) {
    if (!STAGES.includes(gate.before)) errors.push(`workflow.gates: unknown stage "${gate.before}"`);
  }
  return errors;
}

function validateCharts(charts, at) {
  const errors = [];
  if (charts.length > MAX_CHARTS) errors.push(`${at} can hold at most ${MAX_CHARTS} charts`);
  if (new Set(charts.map((c) => c.id)).size !== charts.length) errors.push(`${at} has duplicate charts`);
  for (const chart of charts) {
    if (!CHART_TYPES.includes(chart.type)) errors.push(`${at}: type must be one of ${CHART_TYPES.join(', ')}`);
    const group = DEAL_FIELDS[chart.groupBy];
    if (!group || !['string', 'enum'].includes(group.type)) errors.push(`${at}: can only group by a text or stage field, not "${chart.groupBy}"`);
    const { agg, field } = chart.measure ?? {};
    if (!AGGREGATES.includes(agg)) errors.push(`${at}: measure must be one of ${AGGREGATES.join(', ')}`);
    if (agg !== 'count' && DEAL_FIELDS[field]?.type !== 'number') errors.push(`${at}: can only ${agg} a number field, not "${field}"`);
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
    for (const chart of view.charts ?? []) {
      fields.add(chart.groupBy);
      if (chart.measure?.field) fields.add(chart.measure.field);
    }
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
    view.charts = (view.charts ?? []).filter(
      (c) => canReadField(user, c.groupBy) && (!c.measure.field || canReadField(user, c.measure.field)),
    );
  }
  return next;
}
