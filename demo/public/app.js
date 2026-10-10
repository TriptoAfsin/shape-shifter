// The renderer: it draws whatever shape the server hands it, and nothing else.
// Filtering here is presentation only. Redaction already happened in the core.

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const LABELS = { name: 'Name', company: 'Company', owner: 'Owner', region: 'Region', stage: 'Stage', value: 'Value', closeDate: 'Close date', margin: 'Margin' };
const EXAMPLES = [
  'Show only my region',
  'Switch to a table and sort by close date, ascending',
  'Add manager approval before won',
  'Hide owner and show close date',
  'Show the margin column',
  'Skip the compliance check for everyone',
  'Make the pipeline a table for everyone',
  'Add an approval step',
];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let state = { user: 'ana', view: null };

async function api(path, body) {
  const res = await fetch(`/api/${path}?user=${state.user}`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return res.json();
}

const format = (field, value) => {
  if (value == null) return '';
  if (field === 'value') return `$${value.toLocaleString()}`;
  if (field === 'margin') return `${Math.round(value * 100)}%`;
  return value;
};

function rows(view, deals, me) {
  let out = deals;
  if (view.filter) {
    const target = view.filter.eq === '$me.region' ? me.region : view.filter.eq;
    out = out.filter((d) => d[view.filter.field] === target);
  }
  if (view.sort) {
    const { field, dir } = view.sort;
    out = [...out].sort((a, b) => (a[field] > b[field] ? 1 : -1) * (dir === 'asc' ? 1 : -1));
  }
  return out;
}

function renderView() {
  const { shape, deals, user } = state.view;
  const view = shape.views.pipeline;
  const list = rows(view, deals, user);
  $('title').textContent = view.title + (view.filter ? ` · ${user.region}` : '');

  const gates = shape.workflow.gates;
  $('flow').innerHTML = STAGES.filter((s) => s !== 'lost')
    .map((s) => gates.filter((g) => g.before === s).map((g) => `<span class="gate">${esc(g.label)}</span>`).join('') + `<span class="stage">${s}</span>`)
    .join('<span class="arrow">→</span>');

  if (view.layout === 'table') {
    $('view').innerHTML = `<table><thead><tr>${view.columns.map((c) => `<th>${LABELS[c]}</th>`).join('')}<th>Stage</th></tr></thead>
      <tbody>${list.map((d) => `<tr>${view.columns.map((c) => `<td>${esc(format(c, d[c]))}</td>`).join('')}<td><span class="pill">${d.stage}</span></td></tr>`).join('')}</tbody></table>`;
  } else {
    $('view').innerHTML = `<div class="board">${STAGES.map((s) => {
      const cards = list.filter((d) => d[view.groupBy] === s);
      return `<div class="lane"><h3>${s} <span>${cards.length}</span></h3>${cards
        .map((d) => `<article class="card">${view.columns.map((c, i) => `<div class="${i === 0 ? 'lead' : ''}"><small>${i === 0 ? '' : LABELS[c]}</small> ${esc(format(c, d[c]))}</div>`).join('')}</article>`)
        .join('')}</div>`;
    }).join('')}</div>`;
  }
}

function renderHistory() {
  const { history, canShapeOrg } = state.view;
  const entry = (h, extra = '') => `<li><b>v${h.version}</b> ${esc(h.intent)} ${h.stale ? '<em class="stale">stale, skipped</em>' : ''}${extra}</li>`;
  $('history').innerHTML = `
    <h3>Personal <button data-rollback="personal" ${history.personal.length ? '' : 'disabled'}>Undo last</button></h3>
    <ol>${history.personal.map((h) => entry(h)).join('') || '<li class="muted">No personal changes yet</li>'}</ol>
    <h3>Organization ${canShapeOrg ? `<button data-rollback="org" ${history.org.length > 1 ? '' : 'disabled'}>Undo last</button>` : ''}</h3>
    <ol>${history.org.map((h) => entry(h, ` <small class="muted">by ${esc(h.author)}</small>`)).join('')}</ol>`;
}

function renderProposal(p) {
  const box = $('proposal');
  if (!p) return (box.innerHTML = '');
  if (p.kind === 'clarify') {
    box.innerHTML = `<div class="note ask"><b>Need a detail:</b> ${esc(p.question)}</div>`;
  } else if (p.kind === 'rejected') {
    box.innerHTML = `<div class="note no"><b>Blocked by the core.</b><ul>${p.violations.map((v) => `<li><code>${esc(v.rule)}</code> ${esc(v.message)}</li>`).join('')}</ul></div>`;
  } else {
    box.innerHTML = `<div class="note ok">
      <b>Preview (${p.scope})</b><ul>${p.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      <details><summary>Shape patch</summary><pre>${esc(JSON.stringify(p.ops, null, 2))}</pre></details>
      <div class="actions"><button id="apply">Apply</button><button id="discard" class="ghost">Discard</button></div></div>`;
    $('apply').onclick = async () => {
      const res = await api('apply', { id: p.id });
      renderProposal(res.ok ? null : { kind: 'rejected', violations: res.violations });
      refresh();
    };
    $('discard').onclick = () => renderProposal(null);
  }
}

async function refresh() {
  state.view = await api('view');
  renderView();
  renderHistory();
}

$('intent-form').onsubmit = async (e) => {
  e.preventDefault();
  const intent = $('intent').value.trim();
  if (intent) renderProposal(await api('propose', { intent }));
};
$('user').onchange = (e) => {
  state.user = e.target.value;
  renderProposal(null);
  refresh();
};
$('history').onclick = async (e) => {
  const scope = e.target.dataset?.rollback;
  if (scope) {
    await api('rollback', { scope });
    refresh();
  }
};
$('chips').innerHTML = EXAMPLES.map((x) => `<button type="button" class="chip">${x}</button>`).join('');
$('chips').onclick = (e) => {
  if (e.target.classList.contains('chip')) {
    $('intent').value = e.target.textContent;
    $('intent-form').requestSubmit();
  }
};

refresh();
