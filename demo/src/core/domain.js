// The immutable core: the domain model and its records.
// A shape may reference anything defined here, but can never redefine it.

export const STAGES = deepFreeze(['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost']);

export const DEAL_FIELDS = deepFreeze({
  name: { type: 'string', label: 'Name', aliases: ['title'] },
  company: { type: 'string', label: 'Company', aliases: ['account', 'customer'] },
  owner: { type: 'string', label: 'Owner', aliases: ['rep', 'assignee'] },
  region: { type: 'string', label: 'Region' },
  stage: { type: 'enum', label: 'Stage', values: STAGES },
  value: { type: 'number', label: 'Value', aliases: ['amount', 'size', 'revenue'] },
  closeDate: { type: 'date', label: 'Close date', aliases: ['close', 'closing date', 'due date'] },
  // Sensitive: only admins may read it, whatever the shape says.
  margin: { type: 'number', label: 'Margin', readRoles: ['admin'] },
});

export const DEALS = deepFreeze([
  { id: 'd1', name: 'Fleet renewal', company: 'Nordwind', owner: 'Ana', region: 'EMEA', stage: 'proposal', value: 48000, closeDate: '2026-11-14', margin: 0.31 },
  { id: 'd2', name: 'Pilot expansion', company: 'Kestrel Labs', owner: 'Ana', region: 'EMEA', stage: 'qualified', value: 12500, closeDate: '2026-12-02', margin: 0.44 },
  { id: 'd3', name: 'Data platform', company: 'Orchard Bank', owner: 'Ben', region: 'NA', stage: 'negotiation', value: 210000, closeDate: '2026-10-30', margin: 0.22 },
  { id: 'd4', name: 'Support tier upgrade', company: 'Halcyon', owner: 'Ben', region: 'NA', stage: 'lead', value: 9000, closeDate: '2027-01-15', margin: 0.58 },
  { id: 'd5', name: 'Warehouse rollout', company: 'Tidewater', owner: 'Cy', region: 'APAC', stage: 'proposal', value: 76000, closeDate: '2026-11-21', margin: 0.27 },
  { id: 'd6', name: 'Analytics add-on', company: 'Nordwind', owner: 'Ana', region: 'EMEA', stage: 'won', value: 18000, closeDate: '2026-09-28', margin: 0.49 },
  { id: 'd7', name: 'Global license', company: 'Meridian', owner: 'Ben', region: 'NA', stage: 'qualified', value: 134000, closeDate: '2026-12-19', margin: 0.35 },
  { id: 'd8', name: 'Retail POS', company: 'Lumen Foods', owner: 'Cy', region: 'APAC', stage: 'lead', value: 22000, closeDate: '2027-02-03', margin: 0.41 },
  { id: 'd9', name: 'Security audit', company: 'Kestrel Labs', owner: 'Ana', region: 'EMEA', stage: 'negotiation', value: 31000, closeDate: '2026-11-05', margin: 0.52 },
  { id: 'd10', name: 'Onboarding package', company: 'Orchard Bank', owner: 'Ben', region: 'NA', stage: 'lost', value: 15000, closeDate: '2026-09-12', margin: 0.38 },
]);

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
