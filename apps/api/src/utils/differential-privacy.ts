/**
 * Differential Privacy Anonymizer Engine using Laplace Mechanism.
 * Adds calibrated Laplace noise to aggregate query outputs (e.g. payment volume statistics)
 * to guarantee epsilon-differential privacy against statistical inference attacks.
 */

/**
 * Generates random noise drawn from a Laplace distribution L(0, scale)
 * where scale b = sensitivity / epsilon.
 * 
 * @param epsilon Privacy loss parameter (epsilon > 0). Smaller epsilon means more privacy/noise.
 * @param sensitivity Global sensitivity delta_f (default: 1.0).
 * @returns Calibrated Laplace noise float.
 */
export function generateLaplaceNoise(epsilon: number = 0.5, sensitivity: number = 1.0): number {
  if (epsilon <= 0) {
    throw new Error('Epsilon must be greater than 0');
  }
  if (sensitivity <= 0) {
    throw new Error('Sensitivity must be greater than 0');
  }

  const scale = sensitivity / epsilon;
  // Draw uniform random number u in (-0.5, 0.5)
  const u = Math.random() - 0.5;

  // Inverse CDF of Laplace distribution L(0, scale)
  const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  return noise;
}

/**
 * Applies epsilon-differentially private Laplace noise to a numerical aggregate total (e.g. volume).
 * Ensures the noisy result is non-negative.
 * 
 * @param value Raw aggregate total volume or count.
 * @param epsilon Privacy loss parameter epsilon (default: 0.5).
 * @param sensitivity Maximum influence of a single transaction (default: 1.0).
 * @returns Noisy aggregate total.
 */
export function addDifferentialPrivacyNoise(
  value: number,
  epsilon: number = 0.5,
  sensitivity: number = 1.0
): number {
  const noise = generateLaplaceNoise(epsilon, sensitivity);
  const noisyValue = value + noise;
  return Math.max(0, Number(noisyValue.toFixed(4)));
}
