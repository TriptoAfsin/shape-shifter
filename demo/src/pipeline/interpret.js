// Brain layer: intent -> shape patch.
// This is a deterministic stand-in for the AI models so the demo runs offline. A model-backed
// brain has the same contract: free text in, a proposal or a question out.
// It runs inside the harness, and nothing downstream trusts it: every proposal goes through the guard.

import { DEAL_FIELDS, METRICS, STAGES } from '../core/domain.js';
import { canReadField } from '../core/policy.js';
import { applyPatch } from '../shape/patch.js';

const VIEW = 'pipeline';
const OPEN_STAGES = ['lead', 'qualified', 'proposal', 'negotiation'];
const MAX_KPIS = 6;
const ORG_SCOPE = /\b(for everyone|for (the )?(whole )?(team|org|company)|org-?wide|company-?wide|by default)\b/;

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, names) => names.some((n) => new RegExp(`\\b${escape(n)}\\b`).test(text));

function findField(text) {
  const t = text.toLowerCase();
  for (const [key, def] of Object.entries(DEAL_FIELDS)) {
    if (mentions(t, [key.toLowerCase(), def.label.toLowerCase(), ...(def.aliases ?? [])])) return key;
  }
  return null;
}

// Longest alias first, so "average margin" beats "margin" and "won value" beats "value".
function findMetric(text) {
  const pairs = Object.entries(METRICS).flatMap(([id, m]) => [m.label.toLowerCase(), ...m.aliases].map((a) => [a, id]));
  return pairs.sort((a, b) => b[0].length - a[0].length).find(([alias]) => mentions(text, [alias]))?.[1] ?? null;
}

const findStage = (text) => STAGES.find((s) => new RegExp(`\\b${s}\\b`).test(text));
const label = (field) => DEAL_FIELDS[field].label;
const at = (key) => `/views/${VIEW}/${key}`;
const set = (key, value) => ({ op: 'set', path: at(key), value });
const view = (shape) => shape.views[VIEW];

/* ---------- small building blocks the rules and playbooks share ---------- */

function setFilter(shape, filter) {
  const i = (view(shape).filters ?? []).findIndex((f) => f.field === filter.field);
  return i >= 0 ? { op: 'set', path: at(`filters/${i}`), value: filter } : { op: 'add', path: at('filters/-'), value: filter };
}

const MEASURE_TEXT = { sum: (f) => `Total ${label(f).toLowerCase()}`, avg: (f) => `Average ${label(f).toLowerCase()}`, count: () => 'Deals' };
const chartTitle = (c) =>
  `${MEASURE_TEXT[c.measure.agg](c.measure.field)} ${c.type === 'line' ? 'by close month' : `by ${label(c.groupBy).toLowerCase()}`}`;
const makeChart = (type, groupBy, measure) => ({ id: `${measure.agg}-${measure.field ?? 'deals'}-by-${groupBy}`, type, groupBy, measure });
const VALUE = { agg: 'sum', field: 'value' };

/* ---------- playbooks: one request, many coordinated changes ---------- */

const PLAYBOOKS = [
  {
    // A rep narrows the app to their patch, and everything else follows.
    match: /\b(set me up|my territory|my patch|my book|focus on me)\b/,
    build: ({ shape }) => {
      const charts = view(shape).charts ?? [];
      const regionChart = charts.findIndex((c) => c.groupBy === 'region');
      const byCompany = makeChart('donut', 'company', VALUE);
      const chartOp = charts.some((c) => c.id === byCompany.id)
        ? null
        : regionChart >= 0
          ? { op: 'set', path: at(`charts/${regionChart}`), value: byCompany }
          : { op: 'add', path: at('charts/-'), value: byCompany };
      return {
        summary: [
          'Show only deals in your region',
          regionChart >= 0 ? 'Swap the region chart (now a single slice) for value by company' : 'Add a value-by-company chart',
          'KPIs: open pipeline, won value, closing in 30 days, win rate',
          'Sort by value, largest first',
        ],
        ops: [
          setFilter(shape, { field: 'region', eq: '$me.region' }),
          chartOp,
          set('kpis', ['pipeline', 'won', 'closing30', 'win']),
          set('sort', { field: 'value', dir: 'desc' }),
        ].filter(Boolean),
      };
    },
  },
  {
    // Forecasting is about open deals, in date order, over time. Won/lost KPIs stop making sense.
    match: /\bforecast/,
    build: ({ shape }) => {
      const line = makeChart('line', 'closeDate', VALUE);
      const hasLine = view(shape).charts.some((c) => c.id === line.id);
      return {
        summary: [
          'Hide won and lost deals',
          'Switch to a table sorted by close date',
          hasLine ? 'Keep the value-by-month trend' : 'Add a value-by-month trend line',
          'KPIs for open work: pipeline, open deals, average deal, closing in 30 days',
        ],
        ops: [
          setFilter(shape, { field: 'stage', in: OPEN_STAGES }),
          set('layout', 'table'),
          set('sort', { field: 'closeDate', dir: 'asc' }),
          hasLine ? null : { op: 'add', path: at('charts/-'), value: line },
          set('kpis', ['pipeline', 'open', 'avg', 'closing30']),
        ].filter(Boolean),
      };
    },
  },
  {
    match: /\blate[- ]stage\b/,
    build: ({ shape }) => ({
      summary: ['Show only proposal and negotiation deals', 'Sort by close date, soonest first', 'KPIs: pipeline, open deals, closing in 30 days'],
      ops: [
        setFilter(shape, { field: 'stage', in: ['proposal', 'negotiation'] }),
        set('sort', { field: 'closeDate', dir: 'asc' }),
        set('kpis', ['pipeline', 'open', 'closing30']),
      ],
    }),
  },
  {
    // The brain knows the asker's role and doesn't propose what they can't read.
    match: /\b(executive|exec|leadership|board)\b/,
    build: ({ user }) => {
      const margin = canReadField(user, 'margin');
      return {
        summary: [
          'A compact table of every deal',
          `KPIs: open pipeline, won value, win rate, ${margin ? 'average margin' : 'average deal'}`,
          'Charts: value by stage, value by region, value by close month',
        ],
        ops: [
          set('layout', 'table'),
          set('filters', []),
          set('kpis', ['pipeline', 'won', 'win', margin ? 'margin' : 'avg']),
          set('charts', [makeChart('bar', 'stage', VALUE), makeChart('donut', 'region', VALUE), makeChart('line', 'closeDate', VALUE)]),
        ],
      };
    },
  },
];

/* ---------- single-purpose rules ---------- */

function chartRule(text, charts) {
  const path = (i) => at(`charts/${i}`);
  const wantsLine = /\b(line|trend|over time|timeline)\b/.test(text);
  const byPhrase = text.match(/\bby\s+([a-z ]+)/)?.[1] ?? '';
  const groupBy = wantsLine ? 'closeDate' : byPhrase ? findField(byPhrase) : null;
  const type = wantsLine ? 'line' : /\b(donut|pie|ring)\b/.test(text) ? 'donut' : /\bbars?\b/.test(text) ? 'bar' : null;
  const measure = /\bmargin\b/.test(text)
    ? { agg: 'avg', field: 'margin' }
    : /\b(value|amount|revenue|pipeline|worth)\b/.test(text)
      ? VALUE
      : /\b(count|number|how many|deals)\b/.test(text)
        ? { agg: 'count' }
        : VALUE;

  if (/\b(hide|remove|drop|delete)\b/.test(text)) {
    if (charts.length === 0) return { question: 'There are no charts to remove.' };
    const i = groupBy ? charts.findIndex((c) => c.groupBy === groupBy) : charts.length - 1;
    if (i < 0) return { question: `There is no chart by ${label(groupBy).toLowerCase()}. Which one should go?` };
    return { summary: `Remove the "${chartTitle(charts[i])}" chart`, ops: [{ op: 'remove', path: path(i) }] };
  }

  if (!byPhrase && !wantsLine) {
    // "make it a donut" restyles the most recent chart that can take that shape.
    if (type && charts.length) {
      const fits = (c) => (type === 'line' ? c.groupBy === 'closeDate' : c.groupBy !== 'closeDate');
      const i = charts.map(fits).lastIndexOf(true);
      if (i < 0) return { question: `None of the charts can become a ${type} chart. Which data should it show?` };
      if (charts[i].type === type) return { question: `"${chartTitle(charts[i])}" is already a ${type} chart.` };
      return { summary: `Show "${chartTitle(charts[i])}" as a ${type} chart`, ops: [{ op: 'set', path: `${path(i)}/type`, value: type }] };
    }
    return { question: 'Chart what, grouped by which field? For example: "chart value by region".' };
  }
  if (!groupBy) return { question: `I don't know a field called "${byPhrase.trim()}". Try region, stage, owner or company.` };

  const chart = makeChart(type ?? (DEAL_FIELDS[groupBy].type === 'date' ? 'line' : 'bar'), groupBy, measure);
  const same = charts.findIndex((c) => c.id === chart.id);
  if (same >= 0) {
    if (!type || type === charts[same].type) return { question: `"${chartTitle(charts[same])}" is already on the page.` };
    return { summary: `Show "${chartTitle(charts[same])}" as a ${type} chart`, ops: [{ op: 'set', path: `${path(same)}/type`, value: type }] };
  }
  return { summary: `Add a ${chart.type} chart: ${chartTitle(chart)}`, ops: [{ op: 'add', path: path('-'), value: chart }] };
}

function kpiRule(text, kpis) {
  const metric = findMetric(text);
  const names = Object.values(METRICS).map((m) => m.label.toLowerCase()).join(', ');
  if (!metric) return { question: `Which KPI? I know: ${names}.` };
  const name = METRICS[metric].label;
  if (/\b(hide|remove|drop|delete)\b/.test(text)) {
    const i = kpis.indexOf(metric);
    if (i < 0) return { question: `There is no "${name}" card to remove.` };
    return { summary: `Remove the ${name} KPI`, ops: [{ op: 'remove', path: at(`kpis/${i}`) }] };
  }
  if (kpis.includes(metric)) return { question: `"${name}" is already on the page.` };
  if (kpis.length >= MAX_KPIS) return { question: `There's room for ${MAX_KPIS} KPIs. Which one should go to make space?` };
  return { summary: `Add a ${name} KPI`, ops: [{ op: 'add', path: at('kpis/-'), value: metric }] };
}

// Ordered: the first rule that matches a clause wins.
const RULES = [
  ...PLAYBOOKS,
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
    match: /\b(kpis?|metrics?|cards?|tiles?)\b/,
    build: ({ text, shape }) => kpiRule(text, view(shape).kpis ?? []),
  },
  {
    match: /\b(charts?|graphs?|plot|donut|pie|ring|bars?|line|trend)\b/,
    build: ({ text, shape }) => chartRule(text, view(shape).charts ?? []),
  },
  {
    match: /\bmy region\b/,
    build: ({ shape }) => ({ summary: "Show only deals in the viewer's region", ops: [setFilter(shape, { field: 'region', eq: '$me.region' })] }),
  },
  {
    match: /\b(all regions|every region|clear (the )?filters?|show all|show everything)\b/,
    build: () => ({ summary: 'Clear all filters', ops: [set('filters', [])] }),
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
    match: /\b(kanban|board)\b/,
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
      const i = view(shape).columns.indexOf(field);
      if (i < 0) return { question: `Which column should I hide? Currently shown: ${view(shape).columns.map(label).join(', ')}.` };
      return { summary: `Hide the ${label(field)} column`, ops: [{ op: 'remove', path: at(`columns/${i}`) }] };
    },
  },
  {
    match: /\b(show|add|include|display)\b/,
    build: ({ text, shape }) => {
      const field = findField(text);
      if (!field) return { question: 'Which field should I add?' };
      if (view(shape).columns.includes(field)) return { question: `${label(field)} is already shown. Did you mean something else?` };
      return { summary: `Show the ${label(field)} column`, ops: [{ op: 'add', path: at('columns/-'), value: field }] };
    },
  },
];

/**
 * @param {string} intent  what the person typed
 * @param {{ user, shapeFor: (scope: 'personal'|'org') => object }} ctx
 * @returns {Promise<{kind:'proposal', scope, ops, summary, intent} | {kind:'clarify', question}>}
 */
export async function interpret(intent, { user, shapeFor }) {
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
    const result = rule.build({ text: clause, shape, user });
    if (result.question) return { kind: 'clarify', question: result.question };
    // Later clauses see the effect of earlier ones, so indices stay correct.
    shape = applyPatch(shape, result.ops);
    ops.push(...result.ops);
    summary.push(...[].concat(result.summary));
  }
  return { kind: 'proposal', scope, ops, summary, intent };
}
