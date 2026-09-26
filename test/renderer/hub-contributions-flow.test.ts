import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/modules/hub-contributions.js'), 'utf8');

type ModalResult = { value: string };

function modalPromise(
  value?: string,
  fields: Record<string, string> = {},
) {
  let settle: ((result: ModalResult) => void) | undefined;
  const clickHandlers: Array<(event: any) => unknown> = [];
  const promise: any = new Promise<ModalResult>((resolve) => {
    settle = resolve;
    if (value !== undefined) queueMicrotask(() => resolve({ value }));
  });
  promise.overlay = {
    addEventListener(type: string, handler: (event: any) => unknown) {
      if (type === 'click') clickHandlers.push(handler);
    },
    querySelector(selector: string) {
      const id = selector.replace(/^#/, '');
      return Object.hasOwn(fields, id) ? { value: fields[id] } : null;
    },
    async click(selector: string, dataset: Record<string, string>) {
      const target = {
        closest(candidate: string) {
          return candidate === selector ? { dataset } : null;
        },
      };
      await Promise.all(clickHandlers.map((handler) => handler({ target })));
    },
  };
  promise.close = (next = 'close') => settle?.({ value: next });
  return promise;
}

function loadRoot(
  invoke: (channel: string, payload: any) => Promise<any>,
  options: {
    modal?: (options: any) => any;
    confirm?: (options: any) => Promise<boolean>;
    choice?: (options: any) => Promise<string | null>;
  } = {},
) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const modals: Array<{ options: any; dialog: any }> = [];
  const root: Record<string, any> = {
    cogseed: {
      invoke,
      onPushEvent(channel: string, handler: (payload: unknown) => void) {
        listeners.set(channel, handler);
        return () => listeners.delete(channel);
      },
    },
    t: (key: string) => key,
    uiConfirm: vi.fn(options.confirm ?? (async () => true)),
    uiConfirmDanger: vi.fn(async () => true),
    uiAlert: vi.fn(async () => undefined),
    uiChoice: vi.fn(options.choice ?? (async () => 'original')),
    uiPrompt: vi.fn(async () => 'fixture reason'),
    uiModal: vi.fn((modalOptions: any) => {
      const dialog = options.modal?.(modalOptions) ?? modalPromise('cancel');
      modals.push({ options: modalOptions, dialog });
      return dialog;
    }),
    uiButton: vi.fn(() => '<button></button>'),
    uiForm: vi.fn(() => '<form></form>'),
    uiField: vi.fn(() => '<label></label>'),
    uiProgressBar: vi.fn(() => '<progress></progress>'),
    uiResourceCard: vi.fn(({ title }: any) => `<article>${title}</article>`),
    uiResourceGrid: vi.fn(({ bodyHtml }: any) => `<section>${bodyHtml}</section>`),
    uiEmptyState: vi.fn(({ title }: any) => `<p>${title}</p>`),
  };
  const document = { querySelector: () => null };
  vm.runInNewContext(source, { window: root, document, setTimeout, clearTimeout, Promise, queueMicrotask });
  return {
    root,
    modals,
    emit: (channel: string, payload: unknown) => listeners.get(channel)?.(payload),
  };
}

function openTerms() {
  return { state: { status: 'open', terms: { version: '2026-09-24', body_markdown: 'Terms' } } };
}

function passState() {
  return {
    admission: { outcome: 'pass' },
    completion: { missing: [], conflicts: [], present: { name: 'Skill A', version: '1.1.0' } },
    preview: { digest: 'a'.repeat(64), files: [{ path: 'SKILL.md', size: 8, sha256: 'b'.repeat(64) }] },
    originPrefill: { locked: true },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Hub contribution real-page flow integration', () => {
  it('keeps the selected Skill context and resumes after a successful web login callback', async () => {
    const calls: string[] = [];
    let preflight = 0;
    const { root, emit } = loadRoot(async (channel) => {
      calls.push(channel);
      if (channel === 'contribution.preflight') {
        preflight += 1;
        return preflight === 1
          ? { identity: { outcome: 'blocked', reason: 'not_signed_in' } }
          : { identity: { outcome: 'ready' } };
      }
      if (channel === 'contribution.terms') return { state: { status: 'closed' } };
      return { started: true };
    });

    const flow = root.startSkillContribution('skill-a', 'Skill A');
    await vi.waitFor(() => expect(calls).toContain('hub-account.start_login'));
    emit('hub-account:login-result', { result: 'success' });
    await flow;

    expect(calls.filter((c) => c === 'contribution.preflight')).toHaveLength(2);
    expect(calls).toContain('contribution.terms');
    expect(root.uiAlert).toHaveBeenCalledWith('Contribution is not open right now.');
  });

  it('does not continue contribution when login is cancelled or fails', async () => {
    const calls: string[] = [];
    const { root, emit } = loadRoot(async (channel) => {
      calls.push(channel);
      if (channel === 'contribution.preflight') return { identity: { outcome: 'blocked', reason: 'not_signed_in' } };
      return { started: true };
    });
    const flow = root.startSkillContribution('skill-b', 'Skill B');
    await vi.waitFor(() => expect(calls).toContain('hub-account.start_login'));
    emit('hub-account:login-result', { result: 'cancelled' });
    await flow;
    expect(calls).not.toContain('contribution.terms');
    expect(calls).not.toContain('contribution.start');
  });

  it('supplements a missing security declaration in the staging copy and rechecks before preview', async () => {
    const calls: Array<{ channel: string; payload: any }> = [];
    const checked = {
      admission: { outcome: 'blocked', reason: 'declaration_invalid', declaration: { reason: 'declaration_absent' } },
      completion: { missing: [], conflicts: [], present: { name: 'Skill A', description: 'Description', version: '1.1.0' } },
      preview: null,
    };
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), admission: null, preview: null, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return checked;
      if (channel === 'contribution.complete') return passState();
      if (channel === 'contribution.confirm') return { confirmed: true };
      if (channel === 'contribution.submit') return { ok: true };
      return { ok: true };
    }, {
      modal: (modalOptions) => {
        if (modalOptions.title === 'Submission metadata') {
          return modalPromise('save', {
            'contrib-name': 'Skill A',
            'contrib-description': 'Description',
            'contrib-version': '1.1.0',
            'contrib-security-manifest': 'permissions:\n  network: false\n',
          });
        }
        if (modalOptions.title === 'Submission preview') return modalPromise('continue');
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept');
        return modalPromise();
      },
    });

    await root.startSkillContribution('skill-a', 'Skill A');

    const complete = calls.find((entry) => entry.channel === 'contribution.complete');
    expect(complete?.payload).toMatchObject({
      token: 'abc123def456',
      security_manifest: 'permissions:\n  network: false\n',
    });
    expect(calls.findIndex((entry) => entry.channel === 'contribution.recheck'))
      .toBeLessThan(calls.findIndex((entry) => entry.channel === 'contribution.complete'));
    expect(calls.map((entry) => entry.channel)).toContain('contribution.submit');
  });

  it('cancels local checks without previewing or submitting', async () => {
    const calls: string[] = [];
    const { root } = loadRoot(async (channel) => {
      calls.push(channel);
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), admission: null, preview: null, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return new Promise(() => {});
      return { cancelled: true };
    }, {
      modal: (modalOptions) => modalOptions.title === 'Running local checks' ? modalPromise('cancel') : modalPromise(),
    });

    await root.startSkillContribution('skill-a', 'Skill A');

    expect(calls.filter((channel) => channel === 'contribution.cancel')).toHaveLength(1);
    expect(calls).not.toContain('contribution.confirm');
    expect(calls).not.toContain('contribution.submit');
  });

  it('aborts an in-flight upload and keeps cancellation separate from session cleanup', async () => {
    const calls: Array<{ channel: string; payload: any }> = [];
    let finishSubmit: ((value: any) => void) | undefined;
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), admission: null, preview: null, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return passState();
      if (channel === 'contribution.confirm') return { confirmed: true };
      if (channel === 'contribution.submit') return new Promise((resolve) => { finishSubmit = resolve; });
      if (channel === 'contribution.abortUpload') {
        finishSubmit?.({ ok: false, reason: 'aborted', retryable: true });
        return { aborted: true };
      }
      return { cancelled: true };
    }, {
      modal: (modalOptions) => {
        if (modalOptions.title === 'Submission preview') return modalPromise('continue');
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept');
        if (modalOptions.title === 'Uploading contribution') return modalPromise('cancel');
        return modalPromise();
      },
    });

    await root.startSkillContribution('skill-a', 'Skill A');

    expect(calls.find((entry) => entry.channel === 'contribution.abortUpload')?.payload)
      .toEqual({ token: 'abc123def456' });
    expect(calls.filter((entry) => entry.channel === 'contribution.cancel')).toHaveLength(1);
    expect(root.uiAlert).not.toHaveBeenCalledWith('Submitted for review.');
  });

  it('confirms pending replacement and retries the same session with an explicit acknowledgement', async () => {
    const submits: any[] = [];
    const { root } = loadRoot(async (channel, payload) => {
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), admission: null, preview: null, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return passState();
      if (channel === 'contribution.confirm') return { confirmed: true };
      if (channel === 'contribution.submit') {
        submits.push(payload);
        return submits.length === 1 ? { ok: false, reason: 'replacement_confirmation_required' } : { ok: true };
      }
      return { ok: true };
    }, {
      modal: (modalOptions) => {
        if (modalOptions.title === 'Submission preview') return modalPromise('continue');
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept');
        return modalPromise();
      },
    });

    await root.startSkillContribution('skill-a', 'Skill A', 'content-1');

    expect(submits).toEqual([
      { token: 'abc123def456', target_content_id: 'content-1' },
      { token: 'abc123def456', target_content_id: 'content-1', replace_confirmed: true },
    ]);
    expect(root.uiAlert).toHaveBeenCalledWith('Submitted for review.');
  });

  it('refreshes My Contributions while the modal remains foregrounded and stops after close', async () => {
    vi.useFakeTimers();
    let mineCalls = 0;
    const mineDialogs: any[] = [];
    const { root } = loadRoot(async (channel) => {
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.mine') {
        mineCalls += 1;
        return { cache: { items: {} }, stale: false };
      }
      return { ok: true };
    }, {
      modal: (modalOptions) => {
        const dialog = modalPromise();
        if (modalOptions.title === 'My contributions') mineDialogs.push(dialog);
        return dialog;
      },
    });

    const flow = root.openMyContributions();
    await vi.waitFor(() => expect(mineCalls).toBe(1));
    await vi.advanceTimersByTimeAsync(55_000);
    await vi.waitFor(() => expect(mineCalls).toBe(2));
    mineDialogs[1].close('close');
    await flow;
    await vi.advanceTimersByTimeAsync(55_000);

    expect(mineCalls).toBe(2);
  });

  it('renders stale My Contributions data and withdraws only the selected pending submission', async () => {
    let mineDialog: any;
    const calls: Array<{ channel: string; payload: any }> = [];
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.mine') {
        return {
          stale: true,
          cache: {
            items: {
              entry_1: {
                entry_id: 'entry_1', content_id: 'content_1', name: 'Cached Skill', content_status: 'published',
                latest_submission: { submission_id: 'submission_1', status: 'PENDING_REVIEW', returned_reason: 'review note' },
              },
            },
          },
        };
      }
      if (channel === 'contribution.withdrawPending') return { ok: true };
      return { ok: true };
    }, {
      modal: (modalOptions) => {
        const dialog = modalPromise();
        if (modalOptions.title === 'My contributions') mineDialog = dialog;
        return dialog;
      },
    });

    const flow = root.openMyContributions();
    await vi.waitFor(() => expect(mineDialog).toBeTruthy());
    expect(root.uiModal.mock.calls[0][0].description)
      .toBe('Showing the last saved result because Hub could not be refreshed.');
    expect(root.uiResourceCard).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Cached Skill', status: 'PENDING_REVIEW', description: 'review note',
    }));

    await mineDialog.overlay.click('[data-contribution-withdraw-pending]', {
      contributionWithdrawPending: 'submission_1',
    });
    await flow;

    expect(calls.find((entry) => entry.channel === 'contribution.withdrawPending')?.payload)
      .toEqual({ submission_id: 'submission_1' });
  });

  it('sends a content-level governance withdrawal without a version field', async () => {
    let mineDialog: any;
    const calls: Array<{ channel: string; payload: any }> = [];
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.mine') {
        return {
          cache: {
            items: {
              entry_1: { entry_id: 'entry_1', content_id: 'content_1', name: 'Published Skill', content_status: 'published' },
            },
          },
        };
      }
      if (channel === 'contribution.requestWithdrawal') return { ok: true };
      return { ok: true };
    }, {
      modal: (modalOptions) => {
        const dialog = modalPromise();
        if (modalOptions.title === 'My contributions') mineDialog = dialog;
        return dialog;
      },
    });

    const flow = root.openMyContributions();
    await vi.waitFor(() => expect(mineDialog).toBeTruthy());
    await mineDialog.overlay.click('[data-contribution-request-withdrawal]', {
      contributionRequestWithdrawal: 'content_1',
    });
    await flow;

    const request = calls.find((entry) => entry.channel === 'contribution.requestWithdrawal');
    expect(request?.payload).toEqual({ content_id: 'content_1', reason: 'fixture reason' });
    expect(request?.payload).not.toHaveProperty('version');
    expect(root.uiConfirm).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('governance review'),
    }));
  });

  it('shows disabled-content recovery guidance and starts a new version from the selected local Skill', async () => {
    let mineDialog: any;
    const calls: Array<{ channel: string; payload: any }> = [];
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.mine') {
        return {
          cache: {
            items: {
              entry_1: {
                entry_id: 'entry_1', content_id: 'content_1', name: 'Disabled Skill', content_status: 'disabled',
                latest_submission: { declarations_origin: { type: 'original' } },
              },
            },
          },
        };
      }
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { token: null };
      return { ok: true };
    }, {
      choice: async () => 'local-skill',
      modal: (modalOptions) => {
        const dialog = modalPromise();
        if (modalOptions.title === 'My contributions') mineDialog = dialog;
        return dialog;
      },
    });
    root.getCustomContributionSkills = () => [{ id: 'local-skill', name: 'Local Skill' }];

    const flow = root.openMyContributions();
    await vi.waitFor(() => expect(mineDialog).toBeTruthy());
    expect(root.uiResourceCard).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('higher-version submission'),
    }));
    expect(root.uiButton).not.toHaveBeenCalledWith(expect.objectContaining({
      label: 'Request withdrawal',
    }));

    await mineDialog.overlay.click('[data-contribution-new-version]', {
      contributionNewVersion: 'content_1',
      contributionIndex: '0',
    });
    mineDialog.close('close');
    await flow;

    expect(root.uiChoice).toHaveBeenCalledWith(expect.objectContaining({
      choices: [{ id: 'local-skill', label: 'Local Skill' }],
    }));
    expect(calls.find((entry) => entry.channel === 'contribution.start')?.payload)
      .toEqual({ skill_id: 'local-skill', defer_check: true });
  });
});
