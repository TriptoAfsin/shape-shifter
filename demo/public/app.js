// The renderer: it draws whatever shape the server hands it, and nothing else.
// Filtering here is presentation only. Redaction already happened in the core.

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const LABELS = { name: 'Name', company: 'Company', owner: 'Owner', region: 'Region', stage: 'Stage', value: 'Value', closeDate: 'Close date', margin: 'Margin' };
const STEPS = ['interpret', 'clarify', 'guard', 'preview', 'apply'];
const CHECKS = [
  ['scope', 'Authority', 'May you change this scope?'],
  ['surface', 'Surface', 'Only reshapeable paths'],
  ['schema', 'Schema', 'Still a valid shape'],
  ['permissions', 'Permissions', 'No hidden field revealed'],
  ['invariants', 'Invariants', 'Business rules still hold'],
];
const CHECK_OF = { scope: 'scope', reshapeable: 'surface', patch: 'surface', schema: 'schema', permissions: 'permissions' };

const MISSIONS = [
  { id: 'reshape', title: 'Reshape your own view', hint: 'One request, many parts: data, charts, KPIs.', try: 'Set me up for my territory' },
  { id: 'chart', title: 'Change a chart', hint: 'Charts are part of the shape too.', try: 'Make it a bar chart' },
  { id: 'clarify', title: 'Get asked, not guessed', hint: 'Leave out a detail on purpose.', try: 'Add an approval step' },
  { id: 'blocked', title: 'Hit the core', hint: 'Ask for something no shape may do.', try: 'Skip the compliance check for everyone' },
  { id: 'isolated', title: 'See it stay personal', hint: "Switch user. Your change isn't theirs.", action: 'Switch to Cy' },
  { id: 'undo', title: 'Undo a change', hint: 'Every change is a version. Find them in History.', action: 'Open history' },
];

// Ready-made stories, so nobody needs an AI key (or a blank-page idea) to try it.
const SCENARIOS = [
  {
    id: 'rep',
    title: 'A sales rep makes it theirs',
    user: 'ana',
    note: 'Ana sells in EMEA. One request narrows the data, swaps a chart and changes the KPIs, for her only.',
    prompts: ['Set me up for my territory', 'Turn this into a forecast view', 'Add a KPI for won value'],
  },
  {
    id: 'manager',
    title: 'A manager adds a process step',
    user: 'ben',
    note: 'Ben wants approvals before deals close. Leave out the stage and the brain asks.',
    prompts: ['Add an approval step', 'Focus on late-stage deals', 'Chart deals by owner and make it a donut'],
  },
  {
    id: 'admin',
    title: 'An admin changes it for everyone',
    user: 'cy',
    note: "Cy reshapes the org default. Reps get it too, minus anything they aren't allowed to read.",
    prompts: ['Executive summary for everyone', 'Add an average margin KPI for everyone', 'Make the pipeline a kanban board for everyone'],
  },
  {
    id: 'breaker',
    title: 'Someone pushes past the guardrails',
    user: 'ana',
    note: 'Ask for things no shape may do. The guard blocks them and explains why.',
    prompts: ['Add an average margin KPI', 'Skip the compliance check for everyone', 'Chart average margin by owner'],
  },
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

const state = { user: 'ana', view: null, done: new Set(store.get('ss-missions', [])), changedSinceSwitch: false, kpis: {} };

async function api(path, body) {
  const init = body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {};
  const res = await fetch(`/api/${path}?user=${state.user}`, init);
  return res.json();
}

// The shapeshift moment: let the browser morph old DOM into new DOM.
function morph(update) {
  if (!document.startViewTransition || reduced()) return update();
  return document.startViewTransition(update).finished;
}

/* ---------- data helpers ---------- */

const format = (field, value) => {
  if (value == null) return '—';
  if (field === 'value') return money.format(value);
  if (field === 'margin') return `${Math.round(value * 100)}%`;
  if (field === 'closeDate') return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return value;
};

function rows(view, deals, me) {
  let out = deals;
  for (const f of view.filters ?? []) {
    const target = f.eq === '$me.region' ? me.region : f.eq;
    out = out.filter((d) => ('in' in f ? f.in.includes(d[f.field]) : d[f.field] === target));
  }
  if (view.sort) {
    const { field, dir } = view.sort;
    out = [...out].sort((a, b) => (a[field] > b[field] ? 1 : -1) * (dir === 'asc' ? 1 : -1));
  }
  return out;
}

function aggregate(list, { groupBy, measure }) {
  const groups = new Map();
  const monthly = groupBy === 'closeDate';
  for (const d of list) {
    const key = monthly ? d.closeDate.slice(0, 7) : d[groupBy];
    const g = groups.get(key) ?? { key, sum: 0, n: 0 };
    g.n += 1;
    if (measure.field) g.sum += d[measure.field] ?? 0;
    groups.set(key, g);
  }
  const value = (g) => (measure.agg === 'count' ? g.n : measure.agg === 'avg' ? g.sum / g.n : g.sum);
  let out = [...groups.values()].map((g) => ({ key: g.key, value: value(g) }));
  if (monthly) out.sort((a, b) => a.key.localeCompare(b.key));
  else if (groupBy === 'stage') out.sort((a, b) => STAGES.indexOf(a.key) - STAGES.indexOf(b.key));
  else out.sort((a, b) => b.value - a.value);
  return out;
}

const measureFormat = (measure, v) =>
  measure.agg === 'count' ? String(v) : measure.field === 'margin' ? `${Math.round(v * 100)}%` : compact.format(v);
const chartTitle = ({ groupBy, measure }) =>
  `${measure.agg === 'count' ? 'Deals' : `${measure.agg === 'avg' ? 'Average' : 'Total'} ${LABELS[measure.field].toLowerCase()}`} by ${groupBy === 'closeDate' ? 'close month' : LABELS[groupBy].toLowerCase()}`;
const monthLabel = (key) => new Date(`${key}-15`).toLocaleDateString('en-US', { month: 'short' });

/* ---------- canvas ---------- */

function renderFlow(shape) {
  const gates = shape.workflow.gates;
  $('flow').innerHTML = STAGES.filter((s) => s !== 'lost')
    .map((s) => {
      const gateHtml = gates
        .filter((g) => g.before === s)
        .map((g) => `<li class="gate" style="view-transition-name: gate-${esc(g.id)}"><span>${esc(g.label)}</span></li>`)
        .join('');
      return `${gateHtml}<li class="stage">${s}</li>`;
    })
    .join('');
}

// KPI math lives with the renderer; which KPIs appear is decided by the shape.
const KPI_MATH = {
  pipeline: (l) => [open(l).reduce((s, d) => s + d.value, 0), (v) => compact.format(v)],
  open: (l) => [open(l).length, (v) => String(Math.round(v))],
  avg: (l) => [open(l).length ? open(l).reduce((s, d) => s + d.value, 0) / open(l).length : 0, (v) => compact.format(v)],
  win: (l) => {
    const closed = l.filter((d) => d.stage === 'won' || d.stage === 'lost').length;
    return [closed ? (l.filter((d) => d.stage === 'won').length / closed) * 100 : 0, (v) => `${Math.round(v)}%`];
  },
  won: (l) => [l.filter((d) => d.stage === 'won').reduce((s, d) => s + d.value, 0), (v) => compact.format(v)],
  closing30: (l) => {
    const asOf = new Date(state.view.asOf), soon = new Date(asOf.getTime() + 30 * 864e5);
    return [open(l).filter((d) => new Date(d.closeDate) >= asOf && new Date(d.closeDate) <= soon).length, (v) => String(Math.round(v))];
  },
  margin: (l) => [l.length ? (l.reduce((s, d) => s + (d.margin ?? 0), 0) / l.length) * 100 : 0, (v) => `${Math.round(v)}%`],
};
const open = (l) => l.filter((d) => d.stage !== 'won' && d.stage !== 'lost');

function renderKpis(view, list) {
  const kpis = (view.kpis ?? []).filter((id) => KPI_MATH[id]).map((id) => [id, state.view.metrics[id], ...KPI_MATH[id](list)]);
  $('kpis').style.setProperty('--n', Math.max(kpis.length, 1));
  $('kpis').innerHTML = kpis
    .map(([id, label, , fmt]) => `<div class="kpi" style="view-transition-name: kpi-${id}"><span>${esc(label)}</span><b data-kpi="${id}">${fmt(state.kpis[id] ?? 0)}</b></div>`)
    .join('');
  for (const [id, , target, fmt] of kpis) tick($('kpis').querySelector(`[data-kpi="${id}"]`), state.kpis[id] ?? 0, target, fmt);
  kpis.forEach(([id, , v]) => (state.kpis[id] = v));
}

// Number tick: count from the old value to the new one. Final value only for reduced motion.
function tick(el, from, to, fmt) {
  if (from === to || reduced()) return void (el.textContent = fmt(to));
  const start = performance.now();
  const dur = 600;
  const step = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 4);
    el.textContent = fmt(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function barChart(chart, data) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return `<ul class="bars">${data
    .map(
      (d, i) => `<li style="--i:${i}">
        <span class="bar-label">${esc(d.key)}</span>
        <span class="bar-track"><span class="bar-fill" style="--v:${(d.value / max).toFixed(3)}"></span></span>
        <span class="bar-value">${measureFormat(chart.measure, d.value)}</span>
      </li>`,
    )
    .join('')}</ul>`;
}

function donutChart(chart, data) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = 42, c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = data
    .map((d, i) => {
      const len = (d.value / total) * c;
      const arc = `<circle r="${r}" cx="60" cy="60" style="stroke: var(--color-series-${(i % 6) + 1})" stroke-dasharray="${Math.max(len - 2, 0.1)} ${c}" stroke-dashoffset="${-offset}"></circle>`;
      offset += len;
      return arc;
    })
    .join('');
  const totalLabel = chart.measure.agg === 'avg' ? '' : measureFormat(chart.measure, data.reduce((s, d) => s + d.value, 0));
  return `<div class="donut">
    <svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(-90 60 60)">${arcs}</g>
      <text x="60" y="64" text-anchor="middle">${totalLabel}</text></svg>
    <ul class="legend">${data
      .map((d, i) => `<li><i style="background: var(--color-series-${(i % 6) + 1})"></i>${esc(d.key)} <b>${measureFormat(chart.measure, d.value)}</b></li>`)
      .join('')}</ul></div>`;
}

function lineChart(chart, data) {
  const W = 300, H = 120, pad = 14;
  const max = Math.max(...data.map((d) => d.value), 1);
  const x = (i) => (data.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (data.length - 1));
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.value).toFixed(1)}`);
  const area = `M${x(0)},${H - pad} L${pts.join(' L')} L${x(data.length - 1)},${H - pad} Z`;
  return `<div class="line">
    <svg viewBox="0 0 ${W} ${H + 18}" aria-hidden="true">
      <line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}"></line>
      <path class="area" d="${area}"></path>
      <polyline class="stroke" points="${pts.join(' ')}" pathLength="1"></polyline>
      ${data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.value)}" r="3.5" style="--i:${i}"></circle>`).join('')}
      ${data.map((d, i) => `<text x="${x(i)}" y="${H + 12}" text-anchor="middle">${monthLabel(d.key)}</text>`).join('')}
    </svg>
    <p class="line-note">Peak ${monthLabel(data.reduce((a, b) => (b.value > a.value ? b : a)).key)}: <b>${measureFormat(chart.measure, max)}</b></p>
  </div>`;
}

function renderCharts(view, list) {
  if (!view.charts.length) {
    $('charts').innerHTML = `<p class="empty">No charts in this shape. Try <button type="button" class="link" data-try="Chart value by region">“chart value by region”</button>.</p>`;
    return;
  }
  $('charts').innerHTML = view.charts
    .map((chart) => {
      const data = aggregate(list, chart);
      const draw = { donut: donutChart, line: lineChart, bar: barChart }[chart.type] ?? barChart;
      const body = data.length === 0 ? '<p class="empty">Nothing to chart in this view.</p>' : draw(chart, data);
      return `<figure class="chart chart-${chart.type}" style="view-transition-name: chart-${esc(chart.id)}">
        <figcaption>${chartTitle(chart)}</figcaption>${body}</figure>`;
    })
    .join('');
}

function renderView() {
  const { shape, deals, user } = state.view;
  const view = shape.views.pipeline;
  const list = rows(view, deals, user);

  $('view-title').textContent = view.title;
  const chips = (view.filters ?? []).map((f) =>
    f.eq === '$me.region' ? `${user.region} only` : 'in' in f ? (f.in.length === 4 && f.field === 'stage' ? 'Open deals' : f.in.join(' + ')) : String(f.eq),
  );
  $('scope-chip').hidden = chips.length === 0;
  $('scope-chip').textContent = chips.join(' · ');

  renderFlow(shape);
  renderKpis(view, list);
  renderCharts(view, list);

  const cell = (d, c) => `<span class="cell ${c === 'value' || c === 'margin' ? 'num' : ''}" data-label="${LABELS[c]}">${esc(format(c, d[c]))}</span>`;
  if (view.layout === 'table') {
    $('view').innerHTML = `<div class="table" role="table" aria-label="${esc(view.title)}">
      <div class="row head" role="row">${view.columns.map((c) => `<span role="columnheader" class="${c === 'value' || c === 'margin' ? 'num' : ''}">${LABELS[c]}</span>`).join('')}<span role="columnheader">Stage</span></div>
      ${list.map((d) => `<div class="row" role="row" style="view-transition-name: deal-${d.id}">${view.columns.map((c) => cell(d, c)).join('')}<span class="cell"><span class="pill pill-${d.stage}">${d.stage}</span></span></div>`).join('')}
    </div>`;
    $('view').style.setProperty('--cols', view.columns.length + 1);
  } else {
    $('view').innerHTML = `<div class="board">${STAGES.map((s) => {
      const cards = list.filter((d) => d[view.groupBy] === s);
      return `<section class="lane" aria-label="${s}"><h3>${s} <span>${cards.length}</span></h3>${cards
        .map((d) => `<article class="card" style="view-transition-name: deal-${d.id}">${view.columns
          .map((c, i) => (i === 0 ? `<b class="card-title">${esc(format(c, d[c]))}</b>` : `<span class="card-row"><small>${LABELS[c]}</small><span class="${c === 'value' || c === 'margin' ? 'num' : ''}">${esc(format(c, d[c]))}</span></span>`))
          .join('')}</article>`)
        .join('')}</section>`;
    }).join('')}</div>`;
  }
}

/* ---------- console ---------- */

function renderHistory() {
  const { history, canShapeOrg } = state.view;
  const count = history.personal.length + history.org.length - 1;
  $('history-count').textContent = count;
  $('history-count').hidden = count === 0;
  const entry = (h, by = '') =>
    `<li class="${h.stale ? 'is-stale' : ''}"><span class="ver">v${h.version}</span><span class="what">${esc(h.intent)}${h.stale ? '<em>stale, skipped</em>' : ''}${by}</span></li>`;
  $('history').innerHTML = `
    <div class="hist-group">
      <div class="hist-head"><h3>Personal</h3><button type="button" class="btn btn-quiet" data-rollback="personal" ${history.personal.length ? '' : 'disabled'}>Undo last</button></div>
      <ol>${history.personal.map((h) => entry(h)).reverse().join('') || '<li class="none">Nothing yet. Your changes land here.</li>'}</ol>
    </div>
    <div class="hist-group">
      <div class="hist-head"><h3>Organization</h3>${canShapeOrg ? `<button type="button" class="btn btn-quiet" data-rollback="org" ${history.org.length > 1 ? '' : 'disabled'}>Undo last</button>` : ''}</div>
      <ol>${history.org.map((h) => entry(h, `<small> by ${esc(h.author)}</small>`)).reverse().join('')}</ol>
    </div>`;
}

function renderMissions() {
  const done = state.done;
  $('missions').innerHTML = MISSIONS.map((m, i) => {
    const isDone = done.has(m.id);
    const next = !isDone && MISSIONS.findIndex((x) => !done.has(x.id)) === i;
    const cta = m.try
      ? `<button type="button" class="btn btn-quiet" data-try="${esc(m.try)}">Try “${esc(m.try)}”</button>`
      : `<button type="button" class="btn btn-quiet" data-action="${m.id}">${m.action}</button>`;
    return `<li class="mission ${isDone ? 'is-done' : ''} ${next ? 'is-next' : ''}">
      <span class="tick" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg></span>
      <div><b>${m.title}</b><p>${m.hint}</p>${isDone ? '' : cta}</div>
      <span class="sr-only">${isDone ? 'done' : 'not done'}</span></li>`;
  }).join('');
  const n = MISSIONS.filter((m) => done.has(m.id)).length;
  $('tour-count').textContent = n === MISSIONS.length ? 'All done' : `${n} of ${MISSIONS.length}`;
  $('meter').style.transform = `scaleX(${n / MISSIONS.length})`;
}

function complete(id) {
  if (state.done.has(id)) return;
  state.done.add(id);
  store.set('ss-missions', [...state.done]);
  renderMissions();
}

function setEngine(statuses) {
  for (const li of $('engine').children) li.dataset.status = statuses[li.dataset.step] ?? '';
}

async function playEngine(sequence) {
  const statuses = {};
  setEngine(statuses);
  for (const [step, status] of sequence) {
    statuses[step] = status;
    setEngine(statuses);
    await wait(130);
  }
  return statuses;
}

function checksHtml(violations = []) {
  const failed = new Set(violations.map((v) => CHECK_OF[v.rule] ?? 'invariants'));
  return `<ul class="checks">${CHECKS.map(
    ([id, name, desc], i) => `<li class="${failed.has(id) ? 'fail' : 'pass'}" style="--i:${i}">
      <span class="mark" aria-hidden="true">${failed.has(id) ? '✕' : '✓'}</span><b>${name}</b><span>${desc}</span></li>`,
  ).join('')}</ul>`;
}

function renderResult(p) {
  const box = $('result');
  if (!p) return void (box.innerHTML = '');

  if (p.kind === 'clarify') {
    const stageChoices = /stage/i.test(p.question)
      ? `<div class="answers">${['qualified', 'proposal', 'negotiation', 'won'].map((s) => `<button type="button" class="chip" data-try="${esc(`${p.retry} before ${s}`)}">before ${s}</button>`).join('')}</div>`
      : '';
    box.innerHTML = `<div class="card-note note-ask"><h3>One detail first</h3><p>${esc(p.question)}</p>${stageChoices}</div>`;
    return;
  }

  if (p.kind === 'rejected') {
    box.innerHTML = `<div class="card-note note-block">
      <h3>Blocked by the core</h3>
      ${checksHtml(p.violations)}
      <ul class="why">${p.violations.map((v) => `<li>${esc(v.message)}</li>`).join('')}</ul>
      <p class="aside">Nothing changed. The guard runs outside the model, so no wording gets around it.</p></div>`;
    return;
  }

  box.innerHTML = `<div class="card-note note-ok">
    <h3>Preview <span class="scope scope-${p.scope}">${p.scope}</span></h3>
    <ul class="summary">${p.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
    ${checksHtml()}
    <details><summary>Shape patch</summary><pre>${esc(JSON.stringify(p.ops, null, 2))}</pre></details>
    <div class="actions"><button type="button" class="btn btn-primary" id="apply">Apply</button><button type="button" class="btn btn-quiet" id="discard">Discard</button></div></div>`;

  $('apply').onclick = async () => {
    $('apply').disabled = true;
    const res = await api('apply', { id: p.id });
    if (!res.ok) return renderResult({ kind: 'rejected', violations: res.violations });
    setEngine({ interpret: 'done', clarify: 'done', guard: 'done', preview: 'done', apply: 'done' });
    renderResult(null);
    if (p.scope === 'personal') {
      complete('reshape');
      state.changedSinceSwitch = true;
    }
    if (p.ops.some((o) => o.path.includes('/charts'))) complete('chart');
    await refresh();
  };
  $('discard').onclick = () => {
    setEngine({});
    renderResult(null);
  };
}

async function refresh() {
  const view = await api('view');
  await morph(() => {
    state.view = view;
    renderView();
    renderHistory();
  });
}

async function propose(intent) {
  const btn = $('reshape');
  btn.dataset.state = 'loading';
  btn.disabled = true;
  $('coach').hidden = true;
  store.set('ss-coached', true);
  renderResult(null);

  const [p] = await Promise.all([api('propose', { intent }), playEngine([['interpret', 'active']])]);
  btn.disabled = false;
  delete btn.dataset.state;

  if (p.kind === 'clarify') {
    await playEngine([['interpret', 'done'], ['clarify', 'ask']]);
    complete('clarify');
    return renderResult({ ...p, retry: intent.replace(/\.$/, '') });
  }
  if (p.kind === 'rejected') {
    await playEngine([['interpret', 'done'], ['clarify', 'done'], ['guard', 'fail']]);
    complete('blocked');
    return renderResult(p);
  }
  await playEngine([['interpret', 'done'], ['clarify', 'done'], ['guard', 'done'], ['preview', 'active']]);
  renderResult(p);
}

function switchUser(id) {
  if (id === state.user) return;
  if (state.changedSinceSwitch) complete('isolated');
  state.user = id;
  state.changedSinceSwitch = false;
  for (const b of $('users').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.user === id));
  $('users').style.setProperty('--at', ['ana', 'ben', 'cy'].indexOf(id));
  setEngine({});
  renderResult(null);
  refresh();
}

/* ---------- history drawer ---------- */

function openHistory() {
  const d = $('history-drawer');
  if (!d.open) d.showModal();
  $('history-open').setAttribute('aria-expanded', 'true');
}
function closeHistory() {
  $('history-drawer').close();
  $('history-open').setAttribute('aria-expanded', 'false');
}
$('history-open').onclick = openHistory;
$('history-close').onclick = closeHistory;
$('history-drawer').addEventListener('click', (e) => {
  if (e.target === $('history-drawer')) closeHistory(); // backdrop
});
$('history-drawer').addEventListener('close', () => $('history-open').setAttribute('aria-expanded', 'false'));

/* ---------- events ---------- */

$('intent-form').onsubmit = (e) => {
  e.preventDefault();
  const intent = $('intent').value.trim();
  if (intent) propose(intent);
};
$('users').onclick = (e) => {
  const b = e.target.closest('button[data-user]');
  if (b) switchUser(b.dataset.user);
};
document.addEventListener('click', async (e) => {
  const tryBtn = e.target.closest('[data-try]');
  if (tryBtn) {
    $('intent').value = tryBtn.dataset.try;
    $('intent').focus();
    return propose(tryBtn.dataset.try);
  }
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'isolated') return switchUser(state.user === 'cy' ? 'ana' : 'cy');
  if (action === 'undo') {
    openHistory();
    return;
  }
  const scope = e.target.closest('[data-rollback]')?.dataset.rollback;
  if (scope) {
    await api('rollback', { scope });
    complete('undo');
    setEngine({});
    refresh();
  }
});

function renderScenario(id, { switchTo = true } = {}) {
  const s = SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];
  $('scenario').value = s.id;
  $('scenario-note').textContent = s.note;
  $('prompts').innerHTML = s.prompts
    .map((p, i) => `<button type="button" class="prompt" style="--i:${i}" data-try="${esc(p)}">${esc(p)}</button>`)
    .join('');
  $('intent').placeholder = `e.g. ${s.prompts[0].toLowerCase()}`;
  store.set('ss-scenario', s.id);
  if (switchTo) switchUser(s.user);
}

$('scenario').innerHTML = SCENARIOS.map((s) => `<option value="${s.id}">${esc(s.title)}</option>`).join('');
$('scenario').onchange = (e) => renderScenario(e.target.value);
renderScenario(store.get('ss-scenario', 'rep'), { switchTo: false });
state.user = SCENARIOS.find((s) => s.id === $('scenario').value).user;
$('users').style.setProperty('--at', ['ana', 'ben', 'cy'].indexOf(state.user));
for (const b of $('users').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.user === state.user));

if (!store.get('ss-coached', false)) $('coach').hidden = false;
renderMissions();
refresh();
