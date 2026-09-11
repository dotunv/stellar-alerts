import React, { useState } from 'react';

export type RuleField = 'amount' | 'asset' | 'sender';
export type RuleLogic = 'AND' | 'OR';
export type RuleOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';

export interface RuleCondition {
  id: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
}

export interface RuleAST {
  logic: RuleLogic;
  conditions: {
    field: RuleField;
    operator: RuleOperator;
    value: string;
  }[];
}

interface RuleBuilderProps {
  onSave: (ast: RuleAST) => void;
}

const FIELD_LABELS: Record<RuleField, string> = {
  amount: 'Amount',
  asset: 'Asset',
  sender: 'Sender',
};

const OPERATORS_BY_FIELD: Record<RuleField, { value: RuleOperator; label: string }[]> = {
  amount: [
    { value: 'gt', label: '>' },
    { value: 'gte', label: '≥' },
    { value: 'lt', label: '<' },
    { value: 'lte', label: '≤' },
    { value: 'eq', label: '=' },
  ],
  asset: [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
  ],
  sender: [
    { value: 'eq', label: 'is' },
    { value: 'neq', label: 'is not' },
    { value: 'contains', label: 'contains' },
  ],
};

let nextId = 0;
const makeId = () => `cond-${Date.now()}-${nextId++}`;

const makeCondition = (): RuleCondition => ({
  id: makeId(),
  field: 'amount',
  operator: 'gt',
  value: '',
});

export const validateConditions = (conditions: RuleCondition[]): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (conditions.length === 0) {
    errors._root = 'Add at least one condition.';
    return errors;
  }

  for (const condition of conditions) {
    if (!condition.value.trim()) {
      errors[condition.id] = 'Value is required.';
      continue;
    }
    if (condition.field === 'amount' && Number.isNaN(Number(condition.value))) {
      errors[condition.id] = 'Amount must be a number.';
    }
  }

  return errors;
};

export const RuleBuilder: React.FC<RuleBuilderProps> = ({ onSave }) => {
  const [logic, setLogic] = useState<RuleLogic>('AND');
  const [conditions, setConditions] = useState<RuleCondition[]>([makeCondition()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<RuleAST | null>(null);

  const updateCondition = (id: string, updates: Partial<RuleCondition>) => {
    setConditions((prev) =>
      prev.map((condition) => {
        if (condition.id !== id) return condition;
        const next = { ...condition, ...updates };
        if (updates.field && updates.field !== condition.field) {
          next.operator = OPERATORS_BY_FIELD[updates.field][0].value;
        }
        return next;
      }),
    );
  };

  const addCondition = () => {
    setConditions((prev) => [...prev, makeCondition()]);
  };

  const removeCondition = (id: string) => {
    setConditions((prev) => prev.filter((condition) => condition.id !== id));
  };

  const handleExport = () => {
    const validationErrors = validateConditions(conditions);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setPreview(null);
      return;
    }

    const ast: RuleAST = {
      logic,
      conditions: conditions.map(({ field, operator, value }) => ({ field, operator, value })),
    };
    setPreview(ast);
    onSave(ast);
  };

  return (
    <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur-xl shadow-xl space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span>🧩</span> Alert Rule Builder
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Combine conditions on Amount, Asset, or Sender to trigger an alert.
          </p>
        </div>

        <div className="flex items-center gap-2 p-1 rounded-xl bg-slate-950 border border-slate-800">
          {(['AND', 'OR'] as RuleLogic[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setLogic(option)}
              aria-pressed={logic === option}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${
                logic === option
                  ? 'bg-purple-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {errors._root && (
        <p className="text-sm text-red-400" role="alert">
          {errors._root}
        </p>
      )}

      <div className="space-y-3">
        {conditions.map((condition, index) => (
          <div key={condition.id} className="flex flex-col gap-2">
            {index > 0 && (
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pl-1">
                {logic}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
              <select
                aria-label="Condition field"
                value={condition.field}
                onChange={(e) =>
                  updateCondition(condition.id, { field: e.target.value as RuleField })
                }
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-purple-500"
              >
                {(Object.keys(FIELD_LABELS) as RuleField[]).map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABELS[field]}
                  </option>
                ))}
              </select>

              <select
                aria-label="Condition operator"
                value={condition.operator}
                onChange={(e) =>
                  updateCondition(condition.id, { operator: e.target.value as RuleOperator })
                }
                className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-purple-500"
              >
                {OPERATORS_BY_FIELD[condition.field].map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              <input
                aria-label="Condition value"
                type="text"
                placeholder={condition.field === 'amount' ? 'e.g. 100' : 'e.g. USDC'}
                value={condition.value}
                onChange={(e) => updateCondition(condition.id, { value: e.target.value })}
                className="flex-1 px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white placeholder-slate-500 text-sm font-mono focus:outline-none focus:border-purple-500"
              />

              <button
                type="button"
                onClick={() => removeCondition(condition.id)}
                disabled={conditions.length === 1}
                aria-label="Remove condition"
                className="px-3 py-2 rounded-lg text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ✕
              </button>
            </div>
            {errors[condition.id] && (
              <p className="text-xs text-red-400 pl-1" role="alert">
                {errors[condition.id]}
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <button
          type="button"
          onClick={addCondition}
          className="px-4 py-2 rounded-xl text-sm font-medium text-purple-400 hover:text-purple-300 border border-slate-800 hover:border-purple-500/50 transition-colors self-start"
        >
          + Add Condition
        </button>

        <button
          type="button"
          onClick={handleExport}
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-all duration-200 shadow-md shadow-purple-600/20"
        >
          Save Rule
        </button>
      </div>

      {preview && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            JSON AST Preview
          </div>
          <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 overflow-x-auto">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
