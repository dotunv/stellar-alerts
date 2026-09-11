import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SorobanEventInspector, SAMPLE_SOROBAN_EVENTS } from './SorobanEventInspector';

describe('SorobanEventInspector Component', () => {
  it('renders correctly with default sample events', () => {
    render(<SorobanEventInspector />);

    expect(screen.getByTestId('soroban-event-inspector')).toBeInTheDocument();
    expect(screen.getByText('Soroban Contract Event Explorer')).toBeInTheDocument();
    expect(screen.getByText(/3 Events Found/i)).toBeInTheDocument();
    expect(screen.getAllByText('evt_sac_transfer_001')[0]).toBeInTheDocument();
  });

  it('renders decoded XDR topic structure and JSON data payload', () => {
    render(<SorobanEventInspector events={SAMPLE_SOROBAN_EVENTS} />);

    expect(screen.getByText(/Topic\[0\]: transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/AAAAEAAAAAh0cmFuc2Zlcg==/i)).toBeInTheDocument();
    
    const payloadTree = screen.getByTestId('json-payload-tree');
    expect(payloadTree.textContent).toContain('500.0000000');
    expect(payloadTree.textContent).toContain('USDC');
  });

  it('filters events dynamically by contract ID', () => {
    render(<SorobanEventInspector events={SAMPLE_SOROBAN_EVENTS} />);

    const contractInput = screen.getByTestId('contract-id-input');
    fireEvent.change(contractInput, { target: { value: 'CCONTRACTAMMDEX33333333333333333333333333333333333333' } });

    expect(screen.getAllByText('evt_swap_003')[0]).toBeInTheDocument();
    expect(screen.queryByText('evt_sac_transfer_001')).not.toBeInTheDocument();
    expect(screen.getByText(/1 Event Found/i)).toBeInTheDocument();
  });

  it('filters events dynamically by topic symbol keyword', () => {
    render(<SorobanEventInspector events={SAMPLE_SOROBAN_EVENTS} />);

    const topicInput = screen.getByTestId('topic-symbol-input');
    fireEvent.change(topicInput, { target: { value: 'mint' } });

    expect(screen.getAllByText('evt_mint_002')[0]).toBeInTheDocument();
    expect(screen.queryByText('evt_sac_transfer_001')).not.toBeInTheDocument();
    expect(screen.getByText(/1 Event Found/i)).toBeInTheDocument();
  });

  it('allows switching selected events to view detailed decoded XDR topics', () => {
    render(<SorobanEventInspector events={SAMPLE_SOROBAN_EVENTS} />);

    const swapButton = screen.getAllByTestId('event-item-evt_swap_003')[0];
    fireEvent.click(swapButton);

    expect(screen.getAllByText('evt_swap_003')[0]).toBeInTheDocument();
    expect(screen.getByText(/Topic\[0\]: swap/i)).toBeInTheDocument();
    expect(screen.getByTestId('json-payload-tree').textContent).toContain('100.0000000');
  });
});
