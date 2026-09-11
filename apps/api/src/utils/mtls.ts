import https from 'https';

export interface MTLSAgentOptions {
  clientCert?: string;
  clientKey?: string;
  caBundle?: string;
  rejectUnauthorized?: boolean;
}

/**
 * Creates a custom HTTPS Agent configured with client TLS certificate and CA bundle
 * for Mutual TLS (mTLS) authentication on enterprise webhook dispatches.
 * 
 * @param options mTLS options (clientCert, clientKey, caBundle, rejectUnauthorized)
 * @returns https.Agent instance configured for mTLS.
 */
export function createMTLSAgent(options: MTLSAgentOptions): https.Agent {
  const { clientCert, clientKey, caBundle, rejectUnauthorized = true } = options;

  const agentOptions: https.AgentOptions = {
    keepAlive: true,
    rejectUnauthorized: rejectUnauthorized,
  };

  if (clientCert) {
    agentOptions.cert = clientCert;
  }

  if (clientKey) {
    agentOptions.key = clientKey;
  }

  if (caBundle) {
    agentOptions.ca = caBundle;
  }

  return new https.Agent(agentOptions);
}
