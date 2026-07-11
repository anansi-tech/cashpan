/**
 * Retry semantics for the GraphQL read layer — transient "returned no data"
 * and network blips must vanish inside the retries; exhaustion must throw
 * (the state route then 503s rather than fabricating zeros).
 */

import { jest } from '@jest/globals';
import { gqlPost } from '../lib/gql-fetch.js';

const NO_DELAYS = [0, 0]; // keep tests instant

const ok = (data: unknown) => ({ json: async () => ({ data }) }) as Response;
const noData = () => ({ json: async () => ({}) }) as Response;
const gqlErr = (message: string) => ({ json: async () => ({ errors: [{ message }] }) }) as Response;

afterEach(() => { jest.restoreAllMocks(); });

describe('gqlPost retries', () => {
  test('null data twice, then success — caller never sees the blips', async () => {
    const fetchMock = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(noData())
      .mockResolvedValueOnce(noData())
      .mockResolvedValueOnce(ok({ epoch: { epochId: '99' } }));
    global.fetch = fetchMock as typeof fetch;

    await expect(gqlPost('{ epoch { epochId } }', 'test', NO_DELAYS))
      .resolves.toEqual({ epoch: { epochId: '99' } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('network error once, then success', async () => {
    const fetchMock = jest.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok({ x: 1 }));
    global.fetch = fetchMock as typeof fetch;

    await expect(gqlPost('{ x }', 'test', NO_DELAYS)).resolves.toEqual({ x: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('exhausted retries throw the last error (never a fabricated payload)', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(noData());
    global.fetch = fetchMock as typeof fetch;

    await expect(gqlPost('{ x }', 'balances', NO_DELAYS))
      .rejects.toThrow('GraphQL balances: returned no data');
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  test('GraphQL errors surface with their real message after retries', async () => {
    global.fetch = jest.fn<typeof fetch>().mockResolvedValue(gqlErr('rate limited')) as typeof fetch;
    await expect(gqlPost('{ x }', 'events', NO_DELAYS))
      .rejects.toThrow('GraphQL events: rate limited');
  });

  test('immediate success does not retry', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(ok({ fine: true }));
    global.fetch = fetchMock as typeof fetch;
    await gqlPost('{ x }', 'test', NO_DELAYS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
