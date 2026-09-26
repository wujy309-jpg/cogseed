import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '1.2.3' } }));
vi.mock('../../../../src/main/system_info', () => ({ desktopPlatform: () => 'macos' }));
vi.mock('../../../../src/main/i18n', () => ({ getCurrentLang: () => 'zh-CN' }));
vi.mock('../../../../src/main/features/marketplace', () => ({ apiBase: () => 'https://hub.example' }));
vi.mock('../../../../src/main/features/hub_account', () => ({ ensureFreshSession: async () => ({ access_token: 'secret-token' }) }));

import {
  ContributionApiError, createSubmission, createWithdrawalRequest, getSubmission,
  listMine, listWithdrawalRequests, readTerms, withdrawSubmission,
} from '../../../../src/main/features/contribution/hub-client';

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init || {} });
    return new Response(JSON.stringify({ code: 0, msg: '', request_id: 'req', items: [] }), { status: 200, headers: { ETag: '"1"' } });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe('current Hub contribution adapter', () => {
  it('uses the exact current routes and common authenticated headers', async () => {
    await getSubmission('uid', 'sub_1');
    await withdrawSubmission('uid', 'sub_1');
    await listMine('uid', { size: 500, updatedSince: '2026-09-25T00:00:00Z' });
    await createWithdrawalRequest('uid', 'abcdef123456', 'reason');
    await listWithdrawalRequests('uid', 'abcdef123456');
    expect(calls.map((call) => call.url)).toEqual([
      'https://hub.example/marketplace/contributions/submissions/sub_1',
      'https://hub.example/marketplace/contributions/submissions/sub_1/withdraw',
      'https://hub.example/marketplace/contributions/mine?size=100&updated_since=2026-09-25T00%3A00%3A00Z',
      'https://hub.example/marketplace/contributions/withdrawal-requests',
      'https://hub.example/marketplace/contributions/withdrawal-requests?content_id=abcdef123456',
    ]);
    for (const { init } of calls) {
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer secret-token');
      expect(headers['X-CogSeed-Client-Version']).toBe('1.2.3');
      expect(headers['X-CogSeed-Platform']).toBe('macos');
      expect(headers['X-CogSeed-Request-ID']).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(JSON.parse(String(calls[3].init.body))).toEqual({ content_id: 'abcdef123456', reason: 'reason' });
    expect(JSON.parse(String(calls[3].init.body))).not.toHaveProperty('version');
  });

  it('sends manifest first, package second, and rejects unfrozen fields', async () => {
    const manifest = {
      content_type: 'skill' as const, local_skill_id: '00000000-0000-4000-8000-000000000000', target_content_id: null,
      package_digest: 'a'.repeat(64), package_size: 3, file_list: [], metadata: { name: 'n', description: 'd', version: '1.0.0' },
      declarations: {}, local_check: { checker: { side: 'client', version: '1' }, blocking: [], warnings: [] },
    };
    await createSubmission('uid', { idempotencyKey: '10000000-0000-4000-8000-000000000000', manifest, packageBytes: Buffer.from('zip') });
    const body = calls[0].init.body as FormData;
    expect([...body.keys()]).toEqual(['manifest', 'package']);
    expect((calls[0].init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    await expect(createSubmission('uid', { ...({ idempotencyKey: 'x', manifest: { ...manifest, local_check: { components: [] } }, packageBytes: Buffer.alloc(0) }) as never })).rejects.toThrow('components_contract_not_frozen');
  });

  it('preserves one idempotency key and exact package bytes across ten uncertain retries', async () => {
    const keys: string[] = [];
    const packages: Buffer[] = [];
    globalThis.fetch = vi.fn(async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      keys.push(headers['Idempotency-Key']);
      const form = init?.body as FormData;
      packages.push(Buffer.from(await (form.get('package') as Blob).arrayBuffer()));
      throw new Error('network');
    }) as typeof fetch;
    const args = {
      idempotencyKey: '10000000-0000-4000-8000-000000000000',
      manifest: {
        content_type: 'skill' as const, local_skill_id: '00000000-0000-4000-8000-000000000000', target_content_id: null,
        package_digest: 'a'.repeat(64), package_size: 3, file_list: [], metadata: { name: 'n', description: 'd', version: '1.0.0' },
        declarations: {}, local_check: { checker: { side: 'client', version: '1' }, blocking: [], warnings: [] },
      },
      packageBytes: Buffer.from('zip'),
    };
    for (let i = 0; i < 10; i += 1) await expect(createSubmission('uid', args)).rejects.toMatchObject({ retryable: true });
    expect(new Set(keys)).toEqual(new Set([args.idempotencyKey]));
    expect(packages.every((value) => value.equals(args.packageBytes))).toBe(true);
  });

  it('supports terms ETag/304 without authentication', async () => {
    globalThis.fetch = vi.fn(async (input, init) => {
      calls.push({ url: String(input), init: init || {} });
      return new Response(null, { status: 304 });
    }) as typeof fetch;
    await expect(readTerms('"1"')).resolves.toEqual({ notModified: true, etag: '"1"', body: null });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['If-None-Match']).toBe('"1"');
    expect(headers.Authorization).toBeUndefined();
  });

  it('maps known errors and rejects malformed envelopes safely', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 1, request_id: 'req', error: { code: 'VERSION_NOT_HIGHER', message: 'no', retryable: false } }), { status: 409 })) as typeof fetch;
    await expect(getSubmission('uid', 'sub')).rejects.toMatchObject({ code: 'VERSION_NOT_HIGHER', requestId: 'req', retryable: false });
    globalThis.fetch = vi.fn(async () => new Response('{"unexpected":true}', { status: 200 })) as typeof fetch;
    await expect(getSubmission('uid', 'sub')).rejects.toBeInstanceOf(ContributionApiError);
  });
});
