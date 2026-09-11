export type FilterOperator =
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'eq'
  | 'ne'
  | 'contains'
  | 'exists'
  | 'not_exists'
  | 'in'
  | 'nin';

export interface FilterRule {
  field: 'amount' | 'asset' | 'fromAddress' | 'memo' | string;
  operator: FilterOperator;
  value?: string | number | boolean | Array<string | number | boolean>;
}

export interface FilterRuleGroup {
  operator: 'AND' | 'OR';
  rules: (FilterRule | FilterRuleGroup)[];
}

export interface PaymentContext {
  amount: number | string;
  asset: string;
  fromAddress?: string;
  memo?: string | null;
  [key: string]: unknown;
}

function isRuleGroup(rule: FilterRule | FilterRuleGroup): rule is FilterRuleGroup {
  return 'rules' in rule && Array.isArray(rule.rules);
}

function parseJsonPath(path: string): Array<string | number | '*'> {
  const normalized = path.startsWith('$.') ? path.slice(2) : path.startsWith('$') ? path.slice(1) : path;
  const tokens: Array<string | number | '*'> = [];
  const matcher = /\.?(?<key>[^.\[\]]+)|\[(?<index>\d+|\*|"[^"]+"|'[^']+')\]/g;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(normalized)) !== null) {
    const key = match.groups?.key;
    const index = match.groups?.index;

    if (key) {
      tokens.push(key);
      continue;
    }

    if (!index) continue;
    if (index === '*') {
      tokens.push('*');
    } else if (/^\d+$/.test(index)) {
      tokens.push(Number(index));
    } else {
      tokens.push(index.slice(1, -1));
    }
  }

  return tokens;
}

export function resolveJsonPath(context: PaymentContext, path: string): unknown[] {
  const tokens = parseJsonPath(path);
  let values: unknown[] = [context];

  for (const token of tokens) {
    const next: unknown[] = [];

    for (const value of values) {
      if (value === null || value === undefined) continue;

      if (token === '*') {
        if (Array.isArray(value)) next.push(...value);
        continue;
      }

      if (Array.isArray(value) && typeof token === 'number') {
        if (token in value) next.push(value[token]);
        continue;
      }

      if (typeof value === 'object' && token in (value as Record<string, unknown>)) {
        next.push((value as Record<string, unknown>)[String(token)]);
      }
    }

    values = next;
  }

  return values;
}

function getFieldValues(rule: FilterRule, context: PaymentContext): unknown[] {
  if (rule.field.startsWith('$')) {
    return resolveJsonPath(context, rule.field);
  }

  const value = context[rule.field];
  return value === undefined ? [] : [value];
}

function normalizeComparable(value: unknown, numeric: boolean): string | number | boolean {
  if (numeric) return Number(value);
  if (typeof value === 'boolean') return value;
  return String(value);
}

function evaluateValue(fieldValue: unknown, rule: FilterRule): boolean {
  const hasValue = fieldValue !== null && fieldValue !== undefined;

  if (rule.operator === 'exists') return hasValue;
  if (rule.operator === 'not_exists') return !hasValue;
  if (!hasValue) return false;

  const isNumeric = typeof fieldValue === 'number' || rule.field === 'amount';
  const contextValue = normalizeComparable(fieldValue, isNumeric);
  const ruleValue = normalizeComparable(rule.value, isNumeric);

  switch (rule.operator) {
    case 'gt':
      return Number(contextValue) > Number(ruleValue);
    case 'gte':
      return Number(contextValue) >= Number(ruleValue);
    case 'lt':
      return Number(contextValue) < Number(ruleValue);
    case 'lte':
      return Number(contextValue) <= Number(ruleValue);
    case 'eq':
      return contextValue === ruleValue;
    case 'ne':
      return contextValue !== ruleValue;
    case 'contains':
      return String(contextValue).toLowerCase().includes(String(ruleValue).toLowerCase());
    case 'in':
      return Array.isArray(rule.value) && rule.value.map(String).includes(String(contextValue));
    case 'nin':
      return Array.isArray(rule.value) && !rule.value.map(String).includes(String(contextValue));
    default:
      throw new Error(`Unknown operator: ${rule.operator}`);
  }
}

export function evaluateRule(rule: FilterRule, context: PaymentContext): boolean {
  const fieldValues = getFieldValues(rule, context);

  if (fieldValues.length === 0) {
    return evaluateValue(undefined, rule);
  }

  if (rule.operator === 'ne' || rule.operator === 'nin' || rule.operator === 'not_exists') {
    return fieldValues.every((value) => evaluateValue(value, rule));
  }

  return fieldValues.some((value) => evaluateValue(value, rule));
}

export function evaluateRuleGroup(group: FilterRuleGroup, context: PaymentContext): boolean {
  if (group.rules.length === 0) {
    return true; // Empty group means no restrictions
  }

  const results = group.rules.map((rule) =>
    isRuleGroup(rule) ? evaluateRuleGroup(rule, context) : evaluateRule(rule, context),
  );

  return group.operator === 'AND'
    ? results.every((result) => result)
    : results.some((result) => result);
}

export function shouldAlert(filterRules: FilterRuleGroup | null, payment: PaymentContext): boolean {
  // If no filter rules are defined, alert on all payments
  if (!filterRules || filterRules.rules.length === 0) {
    return true;
  }

  try {
    return evaluateRuleGroup(filterRules, payment);
  } catch (error) {
    console.error('[RulesEngine] Error evaluating filter rules:', error);
    // Fail open: if rules evaluation fails, still alert to avoid missing payments
    return true;
  }
}

export function createAmountThresholdRule(minAmount: number): FilterRuleGroup {
  return {
    operator: 'AND',
    rules: [
      {
        field: 'amount',
        operator: 'gte',
        value: minAmount,
      },
    ],
  };
}

export function createAssetFilterRule(allowedAssets: string[]): FilterRuleGroup {
  if (allowedAssets.length === 0) {
    return { operator: 'OR', rules: [] };
  }

  if (allowedAssets.length === 1) {
    return {
      operator: 'AND',
      rules: [
        {
          field: 'asset',
          operator: 'eq',
          value: allowedAssets[0],
        },
      ],
    };
  }

  return {
    operator: 'OR',
    rules: allowedAssets.map(asset => ({
      field: 'asset' as const,
      operator: 'eq' as const,
      value: asset,
    })),
  };
}

export function createCombinedFilter(minAmount?: number, allowedAssets?: string[]): FilterRuleGroup {
  const rules: (FilterRule | FilterRuleGroup)[] = [];

  if (minAmount !== undefined && minAmount > 0) {
    rules.push(createAmountThresholdRule(minAmount));
  }

  if (allowedAssets && allowedAssets.length > 0) {
    rules.push(createAssetFilterRule(allowedAssets));
  }

  if (rules.length === 0) {
    return { operator: 'AND', rules: [] };
  }

  if (rules.length === 1) {
    return rules[0] as FilterRuleGroup;
  }

  return {
    operator: 'AND',
    rules,
  };
}