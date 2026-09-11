import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  evaluateRuleGroup,
  shouldAlert,
  createAmountThresholdRule,
  createAssetFilterRule,
  createCombinedFilter,
  FilterRule,
  FilterRuleGroup,
  PaymentContext,
} from '../rules-engine';

describe('Rules Engine - Individual Rule Evaluation', () => {
  const context: PaymentContext = {
    amount: 100,
    asset: 'XLM',
    fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
    memo: 'test payment',
  };

  describe('Amount comparisons', () => {
    it('should evaluate gt operator correctly', () => {
      const rule: FilterRule = { field: 'amount', operator: 'gt', value: 50 };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'amount', operator: 'gt', value: 100 };
      expect(evaluateRule(rule2, context)).toBe(false);
    });

    it('should evaluate gte operator correctly', () => {
      const rule: FilterRule = { field: 'amount', operator: 'gte', value: 100 };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'amount', operator: 'gte', value: 101 };
      expect(evaluateRule(rule2, context)).toBe(false);
    });

    it('should evaluate lt operator correctly', () => {
      const rule: FilterRule = { field: 'amount', operator: 'lt', value: 150 };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'amount', operator: 'lt', value: 100 };
      expect(evaluateRule(rule2, context)).toBe(false);
    });

    it('should evaluate lte operator correctly', () => {
      const rule: FilterRule = { field: 'amount', operator: 'lte', value: 100 };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'amount', operator: 'lte', value: 99 };
      expect(evaluateRule(rule2, context)).toBe(false);
    });
  });

  describe('String comparisons', () => {
    it('should evaluate eq operator correctly', () => {
      const rule: FilterRule = { field: 'asset', operator: 'eq', value: 'XLM' };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'asset', operator: 'eq', value: 'USDC' };
      expect(evaluateRule(rule2, context)).toBe(false);
    });

    it('should evaluate ne operator correctly', () => {
      const rule: FilterRule = { field: 'asset', operator: 'ne', value: 'USDC' };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'asset', operator: 'ne', value: 'XLM' };
      expect(evaluateRule(rule2, context)).toBe(false);
    });

    it('should evaluate contains operator correctly', () => {
      const rule: FilterRule = { field: 'fromAddress', operator: 'contains', value: 'GAIH3ULLFQ' };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'fromAddress', operator: 'contains', value: 'gaih3ullfq' };
      expect(evaluateRule(rule2, context)).toBe(true); // case insensitive
      
      const rule3: FilterRule = { field: 'fromAddress', operator: 'contains', value: 'NOTFOUND' };
      expect(evaluateRule(rule3, context)).toBe(false);
    });

    it('should evaluate contains on memo field', () => {
      const rule: FilterRule = { field: 'memo', operator: 'contains', value: 'test' };
      expect(evaluateRule(rule, context)).toBe(true);
      
      const rule2: FilterRule = { field: 'memo', operator: 'contains', value: 'TEST' };
      expect(evaluateRule(rule2, context)).toBe(true); // case insensitive
    });
  });

  describe('Null/undefined handling', () => {
    it('should return false for null field values', () => {
      const contextWithoutMemo: PaymentContext = {
        amount: 100,
        asset: 'XLM',
        fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
        memo: null,
      };
      
      const rule: FilterRule = { field: 'memo', operator: 'contains', value: 'test' };
      expect(evaluateRule(rule, contextWithoutMemo)).toBe(false);
    });

    it('should return false for undefined field values', () => {
      const contextWithoutFrom: PaymentContext = {
        amount: 100,
        asset: 'XLM',
      };
      
      const rule: FilterRule = { field: 'fromAddress', operator: 'contains', value: 'GAIH' };
      expect(evaluateRule(rule, contextWithoutFrom)).toBe(false);
    });
  });

  describe('Amount as string conversion', () => {
    it('should handle amount as string and convert to number', () => {
      const contextWithStringAmount: PaymentContext = {
        amount: '100.5',
        asset: 'XLM',
      };
      
      const rule: FilterRule = { field: 'amount', operator: 'gte', value: 100 };
      expect(evaluateRule(rule, contextWithStringAmount)).toBe(true);
    });
  });
});

describe('Rules Engine - Rule Group Evaluation', () => {
  const context: PaymentContext = {
    amount: 500,
    asset: 'USDC',
    fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
    memo: 'invoice payment',
  };

  describe('AND operator', () => {
    it('should return true when all rules match', () => {
      const group: FilterRuleGroup = {
        operator: 'AND',
        rules: [
          { field: 'amount', operator: 'gte', value: 100 },
          { field: 'asset', operator: 'eq', value: 'USDC' },
        ],
      };
      expect(evaluateRuleGroup(group, context)).toBe(true);
    });

    it('should return false when any rule does not match', () => {
      const group: FilterRuleGroup = {
        operator: 'AND',
        rules: [
          { field: 'amount', operator: 'gte', value: 100 },
          { field: 'asset', operator: 'eq', value: 'XLM' },
        ],
      };
      expect(evaluateRuleGroup(group, context)).toBe(false);
    });

    it('should return true for empty rule group', () => {
      const group: FilterRuleGroup = {
        operator: 'AND',
        rules: [],
      };
      expect(evaluateRuleGroup(group, context)).toBe(true);
    });
  });

  describe('OR operator', () => {
    it('should return true when any rule matches', () => {
      const group: FilterRuleGroup = {
        operator: 'OR',
        rules: [
          { field: 'amount', operator: 'gte', value: 1000 },
          { field: 'asset', operator: 'eq', value: 'USDC' },
        ],
      };
      expect(evaluateRuleGroup(group, context)).toBe(true);
    });

    it('should return false when no rules match', () => {
      const group: FilterRuleGroup = {
        operator: 'OR',
        rules: [
          { field: 'amount', operator: 'gte', value: 1000 },
          { field: 'asset', operator: 'eq', value: 'XLM' },
        ],
      };
      expect(evaluateRuleGroup(group, context)).toBe(false);
    });

    it('should return false for empty rule group', () => {
      const group: FilterRuleGroup = {
        operator: 'OR',
        rules: [],
      };
      expect(evaluateRuleGroup(group, context)).toBe(true);
    });
  });

  describe('Nested rule groups', () => {
    it('should evaluate nested AND/OR groups correctly', () => {
      const group: FilterRuleGroup = {
        operator: 'AND',
        rules: [
          {
            operator: 'OR',
            rules: [
              { field: 'asset', operator: 'eq', value: 'USDC' },
              { field: 'asset', operator: 'eq', value: 'XLM' },
            ],
          },
          { field: 'amount', operator: 'gte', value: 100 },
        ],
      };
      expect(evaluateRuleGroup(group, context)).toBe(true);
    });

    it('should handle complex nested structures', () => {
      const group: FilterRuleGroup = {
        operator: 'OR',
        rules: [
          {
            operator: 'AND',
            rules: [
              { field: 'asset', operator: 'eq', value: 'USDC' },
              { field: 'amount', operator: 'gte', value: 1000 },
            ],
          },
          {
            operator: 'AND',
            rules: [
              { field: 'asset', operator: 'eq', value: 'XLM' },
              { field: 'amount', operator: 'gte', value: 100 },
            ],
          },
        ],
      };
      expect(evaluateRuleGroup(group, context)).toBe(false);
    });
  });
});

describe('Rules Engine - shouldAlert function', () => {
  const payment: PaymentContext = {
    amount: 50,
    asset: 'XLM',
    fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
  };

  it('should return true when no filter rules are defined', () => {
    expect(shouldAlert(null, payment)).toBe(true);
  });

  it('should return true when filter rules are empty', () => {
    const emptyRules: FilterRuleGroup = { operator: 'AND', rules: [] };
    expect(shouldAlert(emptyRules, payment)).toBe(true);
  });

  it('should return true when payment matches filter rules', () => {
    const rules: FilterRuleGroup = {
      operator: 'AND',
      rules: [
        { field: 'amount', operator: 'gte', value: 10 },
        { field: 'asset', operator: 'eq', value: 'XLM' },
      ],
    };
    expect(shouldAlert(rules, payment)).toBe(true);
  });

  it('should return false when payment does not match filter rules', () => {
    const rules: FilterRuleGroup = {
      operator: 'AND',
      rules: [
        { field: 'amount', operator: 'gte', value: 100 },
        { field: 'asset', operator: 'eq', value: 'XLM' },
      ],
    };
    expect(shouldAlert(rules, payment)).toBe(false);
  });

  it('should fail open and return true on evaluation error', () => {
    const invalidRules: FilterRuleGroup = {
      operator: 'AND',
      rules: [
        { field: 'amount', operator: 'gt' as any, value: 10 },
      ],
    };
    expect(shouldAlert(invalidRules, payment)).toBe(true);
  });
});

describe('Rules Engine - Helper Functions', () => {
  describe('createAmountThresholdRule', () => {
    it('should create a valid amount threshold rule', () => {
      const rule = createAmountThresholdRule(500);
      expect(rule.operator).toBe('AND');
      expect(rule.rules).toHaveLength(1);
      expect(rule.rules[0]).toEqual({
        field: 'amount',
        operator: 'gte',
        value: 500,
      });
    });

    it('should evaluate correctly with created rule', () => {
      const rule = createAmountThresholdRule(500);
      const highAmountPayment: PaymentContext = { amount: 600, asset: 'XLM' };
      const lowAmountPayment: PaymentContext = { amount: 400, asset: 'XLM' };
      
      expect(evaluateRuleGroup(rule, highAmountPayment)).toBe(true);
      expect(evaluateRuleGroup(rule, lowAmountPayment)).toBe(false);
    });
  });

  describe('createAssetFilterRule', () => {
    it('should create single asset filter rule', () => {
      const rule = createAssetFilterRule(['USDC']);
      expect(rule.operator).toBe('AND');
      expect(rule.rules).toHaveLength(1);
      expect(rule.rules[0]).toEqual({
        field: 'asset',
        operator: 'eq',
        value: 'USDC',
      });
    });

    it('should create multiple asset filter rule with OR', () => {
      const rule = createAssetFilterRule(['USDC', 'XLM']);
      expect(rule.operator).toBe('OR');
      expect(rule.rules).toHaveLength(2);
    });

    it('should create empty rule for empty asset list', () => {
      const rule = createAssetFilterRule([]);
      expect(rule.operator).toBe('OR');
      expect(rule.rules).toHaveLength(0);
    });

    it('should evaluate correctly with created rule', () => {
      const rule = createAssetFilterRule(['USDC', 'XLM']);
      const usdcPayment: PaymentContext = { amount: 100, asset: 'USDC' };
      const xlmPayment: PaymentContext = { amount: 100, asset: 'XLM' };
      const btcPayment: PaymentContext = { amount: 100, asset: 'BTC' };
      
      expect(evaluateRuleGroup(rule, usdcPayment)).toBe(true);
      expect(evaluateRuleGroup(rule, xlmPayment)).toBe(true);
      expect(evaluateRuleGroup(rule, btcPayment)).toBe(false);
    });
  });

  describe('createCombinedFilter', () => {
    it('should create empty rule when no parameters provided', () => {
      const rule = createCombinedFilter();
      expect(rule.operator).toBe('AND');
      expect(rule.rules).toHaveLength(0);
    });

    it('should create amount-only filter', () => {
      const rule = createCombinedFilter(500);
      expect(rule.rules).toHaveLength(1);
      expect(evaluateRuleGroup(rule, { amount: 600, asset: 'XLM' })).toBe(true);
      expect(evaluateRuleGroup(rule, { amount: 400, asset: 'XLM' })).toBe(false);
    });

    it('should create asset-only filter', () => {
      const rule = createCombinedFilter(undefined, ['USDC']);
      expect(rule.rules).toHaveLength(1);
      expect(evaluateRuleGroup(rule, { amount: 100, asset: 'USDC' })).toBe(true);
      expect(evaluateRuleGroup(rule, { amount: 100, asset: 'XLM' })).toBe(false);
    });

    it('should create combined filter with both amount and asset', () => {
      const rule = createCombinedFilter(100, ['USDC', 'XLM']);
      expect(rule.operator).toBe('AND');
      expect(rule.rules).toHaveLength(2);
      
      const validPayment: PaymentContext = { amount: 150, asset: 'USDC' };
      const invalidAmount: PaymentContext = { amount: 50, asset: 'USDC' };
      const invalidAsset: PaymentContext = { amount: 150, asset: 'BTC' };
      
      expect(evaluateRuleGroup(rule, validPayment)).toBe(true);
      expect(evaluateRuleGroup(rule, invalidAmount)).toBe(false);
      expect(evaluateRuleGroup(rule, invalidAsset)).toBe(false);
    });

    it('should handle zero amount threshold', () => {
      const rule = createCombinedFilter(0, ['USDC']);
      expect(rule.rules).toHaveLength(1); // Only asset filter should be included
    });
  });
});

describe('Rules Engine - Real-world Scenarios', () => {
  describe('Dust transaction filtering', () => {
    it('should suppress alerts for payments below threshold', () => {
      const dustFilter = createAmountThresholdRule(500);
      
      const dustPayment: PaymentContext = { amount: 0.5, asset: 'XLM' };
      const normalPayment: PaymentContext = { amount: 1000, asset: 'XLM' };
      
      expect(shouldAlert(dustFilter, dustPayment)).toBe(false);
      expect(shouldAlert(dustFilter, normalPayment)).toBe(true);
    });
  });

  describe('Asset-specific filtering', () => {
    it('should only alert for specific assets', () => {
      const assetFilter = createAssetFilterRule(['USDC', 'EURC']);
      
      const usdcPayment: PaymentContext = { amount: 100, asset: 'USDC' };
      const eurcPayment: PaymentContext = { amount: 100, asset: 'EURC' };
      const xlmPayment: PaymentContext = { amount: 100, asset: 'XLM' };
      
      expect(shouldAlert(assetFilter, usdcPayment)).toBe(true);
      expect(shouldAlert(assetFilter, eurcPayment)).toBe(true);
      expect(shouldAlert(assetFilter, xlmPayment)).toBe(false);
    });
  });

  describe('Combined amount and asset filtering', () => {
    it('should require both conditions to be met', () => {
      const combinedFilter = createCombinedFilter(100, ['USDC', 'XLM']);
      
      const validPayment: PaymentContext = { amount: 150, asset: 'USDC' };
      const lowAmount: PaymentContext = { amount: 50, asset: 'USDC' };
      const wrongAsset: PaymentContext = { amount: 150, asset: 'BTC' };
      
      expect(shouldAlert(combinedFilter, validPayment)).toBe(true);
      expect(shouldAlert(combinedFilter, lowAmount)).toBe(false);
      expect(shouldAlert(combinedFilter, wrongAsset)).toBe(false);
    });
  });

  describe('Complex filtering with sender address', () => {
    it('should filter based on sender address patterns', () => {
      const complexFilter: FilterRuleGroup = {
        operator: 'AND',
        rules: [
          { field: 'amount', operator: 'gte', value: 10 },
          {
            operator: 'OR',
            rules: [
              { field: 'fromAddress', operator: 'contains', value: 'GAIH3ULLFQ' },
              { field: 'fromAddress', operator: 'contains', value: 'GCKF65D4' },
            ],
          },
        ],
      };
      
      const payment1: PaymentContext = {
        amount: 100,
        asset: 'XLM',
        fromAddress: 'GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR',
      };
      
      const payment2: PaymentContext = {
        amount: 100,
        asset: 'XLM',
        fromAddress: 'GD5W3B7643R3WK4G5B7V3G5B7V3G5B7V3G5B7V3G5B7V3G5B7V3G5B',
      };
      
      expect(shouldAlert(complexFilter, payment1)).toBe(true);
      expect(shouldAlert(complexFilter, payment2)).toBe(false);
    });
  });
});