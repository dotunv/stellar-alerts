import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RuleBuilder, RuleAST } from './RuleBuilder';

describe('RuleBuilder', () => {
  it('exports a JSON AST payload for a single condition', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RuleBuilder onSave={onSave} />);

    await user.type(screen.getByLabelText('Condition value'), '100');
    await user.click(screen.getByRole('button', { name: 'Save Rule' }));

    const expected: RuleAST = {
      logic: 'AND',
      conditions: [{ field: 'amount', operator: 'gt', value: '100' }],
    };
    expect(onSave).toHaveBeenCalledWith(expected);
    expect(screen.getByText(/JSON AST Preview/i)).toBeInTheDocument();
  });

  it('supports adding a second condition and switching to OR logic', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RuleBuilder onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'OR' }));
    await user.click(screen.getByRole('button', { name: '+ Add Condition' }));

    const values = screen.getAllByLabelText('Condition value');
    await user.type(values[0], '50');
    await user.type(values[1], 'USDC');

    const fields = screen.getAllByLabelText('Condition field');
    await user.selectOptions(fields[1], 'asset');

    await user.click(screen.getByRole('button', { name: 'Save Rule' }));

    expect(onSave).toHaveBeenCalledWith({
      logic: 'OR',
      conditions: [
        { field: 'amount', operator: 'gt', value: '50' },
        { field: 'asset', operator: 'eq', value: 'USDC' },
      ],
    });
  });

  it('validates that a numeric amount is required before saving', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RuleBuilder onSave={onSave} />);

    await user.type(screen.getByLabelText('Condition value'), 'not-a-number');
    await user.click(screen.getByRole('button', { name: 'Save Rule' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Amount must be a number.')).toBeInTheDocument();
  });

  it('rejects saving when a required value is left empty', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RuleBuilder onSave={onSave} />);

    await user.click(screen.getByRole('button', { name: 'Save Rule' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Value is required.')).toBeInTheDocument();
  });
});
