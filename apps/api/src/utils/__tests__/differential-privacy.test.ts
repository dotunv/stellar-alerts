import { describe, it, expect } from 'vitest';
import { generateLaplaceNoise, addDifferentialPrivacyNoise } from '../differential-privacy';

describe('Differential Privacy Laplace Noise Generator', () => {
  it('should generate numeric Laplace noise', () => {
    const noise = generateLaplaceNoise(0.5, 1.0);
    expect(typeof noise).toBe('number');
    expect(Number.isNaN(noise)).toBe(false);
  });

  it('should throw error for invalid epsilon or sensitivity <= 0', () => {
    expect(() => generateLaplaceNoise(0, 1.0)).toThrow('Epsilon must be greater than 0');
    expect(() => generateLaplaceNoise(-1, 1.0)).toThrow('Epsilon must be greater than 0');
    expect(() => generateLaplaceNoise(0.5, 0)).toThrow('Sensitivity must be greater than 0');
  });

  it('should generate noise centered near 0 over large sample size', () => {
    const samples: number[] = [];
    for (let i = 0; i < 5000; i++) {
      samples.push(generateLaplaceNoise(1.0, 1.0));
    }
    const sum = samples.reduce((acc, val) => acc + val, 0);
    const mean = sum / samples.length;
    expect(Math.abs(mean)).toBeLessThan(0.15);
  });

  it('should add noise to aggregate volume while enforcing non-negativity', () => {
    const rawVolume = 1000.5;
    const noisyVolume = addDifferentialPrivacyNoise(rawVolume, 0.5, 1.0);

    expect(typeof noisyVolume).toBe('number');
    expect(noisyVolume).toBeGreaterThanOrEqual(0);
  });

  it('should handle zero raw volume without returning negative numbers', () => {
    const noisyZero = addDifferentialPrivacyNoise(0, 0.5, 1.0);
    expect(noisyZero).toBeGreaterThanOrEqual(0);
  });
});
