import { describe, it, expect } from 'vitest';
import https from 'https';
import { createMTLSAgent } from '../mtls';

describe('mTLS Client Certificate Auth Utility (#142)', () => {
  it('should create an https.Agent instance', () => {
    const agent = createMTLSAgent({ rejectUnauthorized: true });
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent.options.rejectUnauthorized).toBe(true);
  });

  it('should configure client certificate and private key on agent options', () => {
    const sampleCert = '-----BEGIN CERTIFICATE-----\nTEST_CERT\n-----END CERTIFICATE-----';
    const sampleKey = '-----BEGIN PRIVATE KEY-----\nTEST_KEY\n-----END PRIVATE KEY-----';

    const agent = createMTLSAgent({
      clientCert: sampleCert,
      clientKey: sampleKey,
    });

    expect(agent.options.cert).toBe(sampleCert);
    expect(agent.options.key).toBe(sampleKey);
  });

  it('should configure user-provided CA bundle on agent options', () => {
    const sampleCA = '-----BEGIN CERTIFICATE-----\nTEST_CA_BUNDLE\n-----END CERTIFICATE-----';

    const agent = createMTLSAgent({
      caBundle: sampleCA,
      rejectUnauthorized: true,
    });

    expect(agent.options.ca).toBe(sampleCA);
    expect(agent.options.rejectUnauthorized).toBe(true);
  });
});
