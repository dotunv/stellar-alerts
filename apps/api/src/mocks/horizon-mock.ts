import http, { IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface MockPaymentRecord {
  id: string;
  paging_token: string;
  successful: boolean;
  type: string;
  type_i: number;
  created_at: string;
  transaction_hash: string;
  starting_balance?: string;
  funder?: string;
  account?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  from?: string;
  to?: string;
  amount?: string;
}

export class HorizonMockServer {
  private server: http.Server | null = null;
  private payments: MockPaymentRecord[] = [];
  private port: number = 0;

  constructor() {
    this.server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res);
    });
  }

  public addPayment(record: Partial<MockPaymentRecord>): MockPaymentRecord {
    const fullRecord: MockPaymentRecord = {
      id: record.id || `mock-pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      paging_token: record.paging_token || `${Date.now()}`,
      successful: record.successful ?? true,
      type: record.type || 'payment',
      type_i: record.type_i ?? 1,
      created_at: record.created_at || new Date().toISOString(),
      transaction_hash:
        record.transaction_hash ||
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      asset_type: record.asset_type || 'native',
      asset_code: record.asset_code || 'XLM',
      asset_issuer: record.asset_issuer || undefined,
      from: record.from || 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
      to: record.to || 'GDS6OIGNYZTBIQPZF5XUWZ5JTEBFTAQYYEIWPI4IMVS67DGE6I7D6KYA',
      amount: record.amount || '10.0000000',
    };

    this.payments.push(fullRecord);
    return fullRecord;
  }

  public clearPayments(): void {
    this.payments = [];
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Horizon Account Payments: GET /accounts/:pubkey/payments
    if (req.method === 'GET' && url.pathname.includes('/payments')) {
      const records = this.payments;
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          _embedded: {
            records,
          },
          _links: {
            self: { href: url.href },
            next: { href: `${url.pathname}?cursor=next` },
            prev: { href: `${url.pathname}?cursor=prev` },
          },
        })
      );
      return;
    }

    // Horizon Transaction: GET /transactions/:hash
    if (req.method === 'GET' && url.pathname.startsWith('/transactions/')) {
      const hash = url.pathname.split('/transactions/')[1];
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          id: hash,
          successful: true,
          hash,
          ledger: 100000,
          created_at: new Date().toISOString(),
          source_account: 'GBPDX2DPUHABCGNHXQRNK5A6NGV5R7T244HJ5CXAWSWVRTZR4WMADE72',
          fee_charged: '100',
        })
      );
      return;
    }

    // Soroban RPC Mock (POST /)
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const json = JSON.parse(body || '{}');
          const method = json.method;

          let result: any = { status: 'HEALTHY' };
          if (method === 'getHealth') {
            result = { status: 'HEALTHY' };
          } else if (method === 'getEvents') {
            result = {
              events: [
                {
                  id: 'evt-1',
                  type: 'contract',
                  ledger: 100001,
                  contractId: 'CA12345678901234567890123456789012345678901234567890123456',
                  topic: ['transfer', 'GBPDX2DP...', 'GDS6OIGN...'],
                  value: { amount: '50000000' },
                },
              ],
            };
          } else if (method === 'getTransaction') {
            result = {
              status: 'SUCCESS',
              latestLedger: 100005,
            };
          }

          res.statusCode = 200;
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: json.id || 1,
              result,
            })
          );
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Invalid JSON-RPC request' }));
        }
      });
      return;
    }

    // Default Horizon Root Health
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        horizon_version: '2.28.0-mock',
        core_version: '20.1.0-mock',
        ingest_latest_ledger: 100000,
        history_latest_ledger: 100000,
      })
    );
  }

  public async start(requestedPort: number = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server?.listen(requestedPort, '127.0.0.1', () => {
        const address = this.server?.address() as AddressInfo;
        this.port = address.port;
        const url = `http://127.0.0.1:${this.port}`;
        resolve(url);
      });
      this.server?.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  public getUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }
}

export async function createHorizonMock(port: number = 0): Promise<HorizonMockServer> {
  const server = new HorizonMockServer();
  await server.start(port);
  return server;
}
