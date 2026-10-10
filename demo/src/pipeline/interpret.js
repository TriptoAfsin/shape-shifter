// Brain layer: intent -> shape patch.
// This is a deterministic stand-in for an LLM so the demo runs offline. A model-backed
// interpreter has the same contract: free text in, a proposal or a question out.
// Nothing downstream trusts it: every proposal goes through the guard.

import { DEAL_FIELDS, STAGES } from '../core/domain.js';
import { applyPatch } from '../shape/patch.js';

const VIEW = 'pipeline';
const ORG_SCOPE = /\b(for everyone|for (the )?(whole )?(team|org|company)|org-?wide|company-?wide|by default)\b/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findField(text) {
  const t = text.toLowerCase();
  for (const [key, def] of Object.entries(DEAL_FIELDS)) {
    const names = [key.toLowerCase(), def.label.toLowerCase(), ...(def.aliases ?? [])];
    if (names.some((n) => new RegExp(`\\b${escape(n)}\\b`).test(t))) return key;
  }
  return null;
}

const findStage = (text) => STAGES.find((s) => new RegExp(`\\b${s}\\b`).test(text));
const label = (field) => DEAL_FIELDS[field].label;
const set = (key, value) => ({ op: 'set', path: `/views/${VIEW}/${key}`, value });

// Ordered: the first rule that matches a clause wins.
const RULES = [
  {
    match: /\b(remove|skip|drop|disable|bypass)\b.*\bcompliance\b/,
    build: ({ shape }) => {
      const i = shape.workflow.gates.findIndex((g) => g.id === 'compliance-check');
      if (i < 0) return { question: 'There is no compliance check to remove.' };
      return { summary: 'Remove the compliance check gate', ops: [{ op: 'remove', path: `/workflow/gates/${i}` }] };
    },
  },
  {
    match: /\bapprov/,
    build: ({ text }) => {
      const stage = findStage(text);
      if (!stage) return { question: 'Which stage should the approval come before? For example: "before won".' };
      return {
        summary: `Require manager approval before "${stage}"`,
        ops: [{ op: 'add', path: '/workflow/gates/-', value: { id: 'manager-approval', label: 'Manager approval', before: stage } }],
      };
    },
  },
  {
    match: /\b(charts?|graphs?|plot|donut|pie|ring|bars?)\b/,
    build: ({ text, shape }) => chartRule(text, shape.views[VIEW].charts ?? []),
  },
  {
    match: /\bmy region\b/,
    build: () => ({ summary: "Show only deals in the viewer's region", ops: [set('filter', { field: 'region', eq: '$me.region' })] }),
  },
  {
    match: /\b(all regions|every region|clear (the )?filter|show all|show everything)\b/,
    build: () => ({ summary: 'Clear the pipeline filter', ops: [set('filter', null)] }),
  },
  {
    match: /\bsort\b|\border by\b/,
    build: ({ text }) => {
      const field = findField(text.split(/\bsort\b|\border by\b/)[1] ?? '');
      if (!field) return { question: 'Sort by which field? For example: "sort by close date".' };
      const dir = /\b(asc|ascending|lowest|smallest|oldest|earliest|soonest)\b/.test(text) ? 'asc' : 'desc';
      return { summary: `Sort by ${label(field)} (${dir})`, ops: [set('sort', { field, dir })] };
    },
  },
  {
    match: /\b(kanban|board|cards)\b/,
    build: () => ({ summary: 'Show the pipeline as a kanban board', ops: [set('layout', 'kanban')] }),
  },
  {
    match: /\b(table|list|spreadsheet|grid)\b/,
    build: () => ({ summary: 'Show the pipeline as a table', ops: [set('layout', 'table')] }),
  },
  {
    match: /\b(hide|remove|drop)\b/,
    build: ({ text, shape }) => {
      const field = findField(text);
      const i = shape.views[VIEW].columns.indexOf(field);
      if (i < 0) return { question: `Which column should I hide? Currently shown: ${shape.views[VIEW].columns.map(label).join(', ')}.` };
      return { summary: `Hide the ${label(field)} column`, ops: [{ op: 'remove', path: `/views/${VIEW}/columns/${i}` }] };
    },
  },
  {
    match: /\b(show|add|include|display)\b/,
    build: ({ text, shape }) => {
      const field = findField(text);
      if (!field) return { question: 'Which field should I add?' };
      if (shape.views[VIEW].columns.includes(field)) return { question: `${label(field)} is already shown. Did you mean something else?` };
      return { summary: `Show the ${label(field)} column`, ops: [{ op: 'add', path: `/views/${VIEW}/columns/-`, value: field }] };
    },
  },
];

const MEASURES = {
  sum: (field) => `Total ${label(field).toLowerCase()}`,
  avg: (field) => `Average ${label(field).toLowerCase()}`,
  count: () => 'Deals',
};
const chartTitle = (c) => `${MEASURES[c.measure.agg](c.measure.field)} by ${label(c.groupBy).toLowerCase()}`;

function chartRule(text, charts) {
  const at = (i) => `/views/${VIEW}/charts/${i}`;
  const byPhrase = text.match(/\bby\s+([a-z ]+)/)?.[1] ?? '';
  const groupBy = byPhrase ? findField(byPhrase) : null;
  const type = /\b(donut|pie|ring)\b/.test(text) ? 'donut' : /\bbars?\b/.test(text) ? 'bar' : null;
  const measure = /\bmargin\b/.test(text)
    ? { agg: 'avg', field: 'margin' }
    : /\b(value|amount|revenue|pipeline|worth)\b/.test(text)
      ? { agg: 'sum', field: 'value' }
      : /\b(count|number|how many|deals)\b/.test(text)
        ? { agg: 'count' }
        : { agg: 'sum', field: 'value' };

  if (/\b(hide|remove|drop|delete)\b/.test(text)) {
    if (charts.length === 0) return { question: 'There are no charts to remove.' };
    const i = groupBy ? charts.findIndex((c) => c.groupBy === groupBy) : charts.length - 1;
    if (i < 0) return { question: `There is no chart by ${label(groupBy).toLowerCase()}. Which one should go?` };
    return { summary: `Remove the "${chartTitle(charts[i])}" chart`, ops: [{ op: 'remove', path: at(i) }] };
  }

  if (!groupBy) {
    // "make it a donut" restyles the most recent chart.
    if (type && charts.length) {
      const i = charts.length - 1;
      return { summary: `Show "${chartTitle(charts[i])}" as a ${type} chart`, ops: [{ op: 'set', path: `${at(i)}/type`, value: type }] };
    }
    return { question: 'Chart what, grouped by which field? For example: "chart value by region".' };
  }

  const same = charts.findIndex((c) => c.groupBy === groupBy && c.measure.agg === measure.agg && c.measure.field === measure.field);
  if (same >= 0) {
    if (!type || type === charts[same].type) return { question: `"${chartTitle(charts[same])}" is already on the page. Want it as a ${charts[same].type === 'bar' ? 'donut' : 'bar'} instead?` };
    return { summary: `Show "${chartTitle(charts[same])}" as a ${type} chart`, ops: [{ op: 'set', path: `${at(same)}/type`, value: type }] };
  }

  const chart = { id: `${measure.agg}-${measure.field ?? 'deals'}-by-${groupBy}`, type: type ?? 'bar', groupBy, measure };
  return { summary: `Add a ${chart.type} chart: ${chartTitle(chart)}`, ops: [{ op: 'add', path: `${at('-')}`, value: chart }] };
}

/**
 * @param {string} intent  what the person typed
 * @param {{ shapeFor: (scope: 'personal'|'org') => object }} ctx
 * @returns {Promise<{kind:'proposal', scope, ops, summary, intent} | {kind:'clarify', question}>}
 */
export async function interpret(intent, { shapeFor }) {
  const text = intent.toLowerCase().trim();
  const scope = ORG_SCOPE.test(text) ? 'org' : 'personal';
  // Split on conjunctions, but fold fragments like ", ascending" back into the clause before.
  const clauses = text
    .replace(ORG_SCOPE, '')
    .split(/\s*(?:;|,|\band then\b|\band\b|\bthen\b)\s*/)
    .filter(Boolean)
    .reduce((acc, part) => {
      if (acc.length && !RULES.some((r) => r.match.test(part))) acc[acc.length - 1] += ` ${part}`;
      else acc.push(part);
      return acc;
    }, []);
  if (clauses.length === 0) return { kind: 'clarify', question: 'What would you like to change?' };

  let shape = shapeFor(scope);
  const ops = [];
  const summary = [];
  for (const clause of clauses) {
    const rule = RULES.find((r) => r.match.test(clause));
    if (!rule) return { kind: 'clarify', question: `I'm not sure what "${clause}" should change. Try rephrasing it.` };
    const result = rule.build({ text: clause, shape });
    if (result.question) return { kind: 'clarify', question: result.question };
    // Later clauses see the effect of earlier ones, so indices stay correct.
    shape = applyPatch(shape, result.ops);
    ops.push(...result.ops);
    summary.push(result.summary);
  }
  return { kind: 'proposal', scope, ops, summary, intent };
}
