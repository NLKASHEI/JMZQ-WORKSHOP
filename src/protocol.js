export const PROTOCOL_VERSION = 1;
export const REGISTRY_ENTRY_NAME = '[jmzq_workshop]扩展注册表';

const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
export const OPERATORS = Object.freeze([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in',
  'contains', 'starts_with', 'ends_with', 'exists', 'truthy', 'falsy',
]);
const OPERATOR_SET = new Set(OPERATORS);

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function pathSegments(path) {
  const source = Array.isArray(path) ? path : String(path ?? '').split('.');
  const segments = source.map(part => String(part).trim()).filter(Boolean);
  if (segments[0] === 'stat_data') segments.shift();
  if (!segments.length || segments.some(part => BLOCKED_PATH_SEGMENTS.has(part))) return null;
  return segments;
}

export function readPath(statData, path) {
  const segments = pathSegments(path);
  if (!segments) return undefined;
  let current = statData;
  for (const segment of segments) {
    if (!isObject(current) && !Array.isArray(current)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function compare(actual, operator, expected) {
  if (!OPERATOR_SET.has(operator)) return false;
  if (operator === 'exists') return expected === false ? actual === undefined : actual !== undefined;
  if (operator === 'truthy') return !!actual;
  if (operator === 'falsy') return !actual;
  if (operator === 'eq') return actual === expected;
  if (operator === 'neq') return actual !== expected;
  if (operator === 'gt') return Number(actual) > Number(expected);
  if (operator === 'gte') return Number(actual) >= Number(expected);
  if (operator === 'lt') return Number(actual) < Number(expected);
  if (operator === 'lte') return Number(actual) <= Number(expected);
  if (operator === 'in') return Array.isArray(expected) && expected.includes(actual);
  if (operator === 'not_in') return Array.isArray(expected) && !expected.includes(actual);
  if (operator === 'contains') return Array.isArray(actual)
    ? actual.includes(expected)
    : String(actual ?? '').includes(String(expected ?? ''));
  if (operator === 'starts_with') return String(actual ?? '').startsWith(String(expected ?? ''));
  if (operator === 'ends_with') return String(actual ?? '').endsWith(String(expected ?? ''));
  return false;
}

export function evaluateCondition(condition, statData, depth = 0) {
  if (condition === undefined || condition === null) return true;
  if (!isObject(condition) || depth > 12) return false;
  if (Array.isArray(condition.all)) return condition.all.every(item => evaluateCondition(item, statData, depth + 1));
  if (Array.isArray(condition.any)) return condition.any.some(item => evaluateCondition(item, statData, depth + 1));
  if (condition.not !== undefined) return !evaluateCondition(condition.not, statData, depth + 1);
  const path = pathSegments(condition.path);
  const operator = String(condition.operator || 'eq');
  if (!path || !OPERATOR_SET.has(operator)) return false;
  return compare(readPath(statData, path), operator, condition.value);
}

export function buildEntryStates(registry, statData) {
  const states = new Map();
  const errors = [];
  if (!isObject(registry) || registry.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(registry.packages)) {
    return { states, errors: ['注册表协议版本或 packages 字段无效'] };
  }
  for (const pkg of registry.packages) {
    if (!isObject(pkg) || !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(String(pkg.id || ''))) {
      errors.push('发现缺少合法作品ID的兼容扩展');
      continue;
    }
    const runtimeState = statData?.工坊扩展?.[pkg.id];
    const enabled = pkg.enabled !== false && runtimeState?.启用 !== false;
    for (const route of Array.isArray(pkg.entries) ? pkg.entries : []) {
      const name = String(route?.name || '').trim();
      if (!name) continue;
      if (states.has(name)) {
        errors.push(`条目“${name}”被多个扩展重复接管`);
        continue;
      }
      states.set(name, enabled && (route.activeWhen === undefined
        ? route.enabledByDefault === true
        : evaluateCondition(route.activeWhen, statData)));
    }
  }
  return { states, errors };
}

