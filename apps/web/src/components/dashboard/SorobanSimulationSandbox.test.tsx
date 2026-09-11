import { describe, expect, it } from 'vitest';
import { simulateSorobanInvocation } from './SorobanSimulationSandbox';

describe('SorobanSimulationSandbox', () => {
  it('correctly simulates contract invocation and returns decoded events and footprint', () => {
    const result = simulateSorobanInvocation({
      contractId: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7C3Y',
      functionName: 'mint',
      argsJson: '{"to":"GUSER1","amount":"5000000"}',
      network: 'testnet',
    });

    expect(result.success).toBe(true);
    expect(result.contractId).toBe('CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7C3Y');
    expect(result.functionName).toBe('mint');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].topics[0].decodedValue).toBe('transfer');
    expect(result.footprint.estimatedFeeXlm).toBe('0.0034812');
    expect(result.footprint.cpuInstructions).toBeGreaterThan(0);
    expect(result.footprint.readOnlyEntries).toBe(3);
    expect(result.footprint.readWriteEntries).toBe(2);
  });

  it('handles invalid JSON arguments gracefully', () => {
    const result = simulateSorobanInvocation({
      contractId: 'CA3D5KRYM6CB7OWQ6TWYRR3Z4EK7C3Y',
      functionName: 'mint',
      argsJson: '{ invalid json }',
      network: 'testnet',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JSON');
    expect(result.events.length).toBe(0);
  });

  it('populates fallback default contract ID and function if omitted in simulation input', () => {
    const result = simulateSorobanInvocation({
      contractId: '',
      functionName: '',
      argsJson: '',
      network: 'mainnet',
    });

    expect(result.success).toBe(true);
    expect(result.contractId).toContain('CCONTRACTSIMULATIONTESTADDRESS');
    expect(result.functionName).toBe('transfer');
    expect(result.network).toBe('mainnet');
  });
});
