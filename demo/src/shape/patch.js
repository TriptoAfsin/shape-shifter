// A shape patch is a short, auditable list of operations on the shape.
// Only the paths below are reshapeable; everything else belongs to the core.

export const OPS = Object.freeze(['set', 'add', 'remove']);

export const RESHAPEABLE = Object.freeze([
  /^\/views\/[a-z]+\/(title|layout|groupBy|filters|sort|kpis|charts)$/,
  /^\/views\/[a-z]+\/filters\/(\d+|-)$/,
  /^\/views\/[a-z]+\/kpis\/(\d+|-)$/,
  /^\/views\/[a-z]+\/columns\/(\d+|-)$/,
  /^\/views\/[a-z]+\/charts\/(\d+|-)$/,
  /^\/views\/[a-z]+\/charts\/\d+\/type$/,
  /^\/workflow\/gates\/(\d+|-)$/,
]);

export const isReshapeable = (path) => RESHAPEABLE.some((re) => re.test(path));

// Pure: returns a new shape and leaves the input untouched.
export function applyPatch(shape, ops) {
  const next = structuredClone(shape);
  for (const { op, path, value } of ops) {
    const keys = path.split('/').slice(1);
    const last = keys.pop();
    const parent = keys.reduce((node, key) => node?.[key], next);
    if (parent == null || typeof parent !== 'object') throw new Error(`Path not found: ${path}`);

    if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : Number(last);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) throw new Error(`Bad index: ${path}`);
      if (op === 'add') parent.splice(index, 0, value);
      else if (op === 'remove') parent.splice(index, 1);
      else parent[index] = value;
    } else if (op === 'remove') {
      delete parent[last];
    } else {
      parent[last] = value;
    }
  }
  return next;
}
