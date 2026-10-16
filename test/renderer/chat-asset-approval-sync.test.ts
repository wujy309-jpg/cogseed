import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const source = readFileSync(resolve(__dirname, '../../src/renderer/modules/chat-asset-approval.js'), 'utf8');
function setup() {
  let state = 'pending', fail = false;
  let push: (notice: unknown) => void = () => {};
  const labels = [{ textContent: '' }, { textContent: '' }];
  const refs = labels.map(label => ({ dataset: { proposalCitation: 'ap-one' } as Record<string, string>, isConnected: true, querySelector: () => label }));
  const invoke = vi.fn(async () => {
    if (fail) throw new Error('not readable');
    return { ok: true, proposal: { id: 'ap-one', state } };
  });
  const root: any = {
    t: (key: string) => key,
    cogseed: { invoke, onPushEvent: (channel: string, callback: (notice: unknown) => void) => { expect(channel).toBe('cognition:changed'); push = callback; } },
    document: { querySelectorAll: () => refs, addEventListener: () => {} },
  };
  runInNewContext(source, { window: root });
  return { root, refs, labels, invoke, push: (notice: unknown) => push(notice), setState: (next: string) => { state = next; }, fail: () => { fail = true; } };
}
describe('host-read proposal state in existing conversation references', () => {
  it('coalesces repeated message references, re-reads after a merged event, and does not trust event state', async () => {
    const env = setup();
    await env.root.ChatAssetApproval.refreshVisible();
    expect(env.invoke).toHaveBeenCalledExactlyOnceWith('recall.assets.approval.read', { proposalId: 'ap-one' });
    expect(env.refs.map(ref => ref.dataset.proposalState)).toEqual(['pending', 'pending']);
    env.setState('rejected');
    env.push({ collection: 'asset-approvals', recordId: 'some-other-coalesced-id', state: 'confirmed' });
    await env.root.ChatAssetApproval.refreshVisible();
    expect(env.refs.map(ref => ref.dataset.proposalState)).toEqual(['rejected', 'rejected']);
    expect(env.labels[0].textContent).toContain('已拒绝');
  });
  it('failed source reads show unknown state, never infer saved status or disclose contents', async () => {
    const env = setup();
    env.setState('confirmed');
    await env.root.ChatAssetApproval.refreshVisible();
    expect(env.labels[0].textContent).toContain('已保存更新');
    expect(env.labels[0].textContent).not.toMatch(/v\d/);
    env.fail();
    await env.root.ChatAssetApproval.refreshVisible();
    expect(env.refs[0].dataset.proposalState).toBe('unavailable');
    expect(env.labels[0].textContent).toContain('状态待核对');
  });
});
