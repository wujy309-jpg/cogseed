import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/modules/hub-contributions.js'), 'utf8');

type ModalResult = { value: string };
type ModalField = string | { value?: string; checked?: boolean };

function modalPromise(
  value?: string,
  fields: Record<string, ModalField> = {},
) {
  let settle: ((result: ModalResult) => void) | undefined;
  const clickHandlers: Array<(event: any) => unknown> = [];
  const previewNodes = new Map<string, { textContent: string; hidden: boolean }>();
  const promise: any = new Promise<ModalResult>((resolve) => {
    settle = resolve;
    if (value !== undefined) queueMicrotask(() => resolve({ value }));
  });
  promise.overlay = {
    addEventListener(type: string, handler: (event: any) => unknown) {
      if (type === 'click') clickHandlers.push(handler);
    },
    querySelector(selector: string) {
      if (selector.startsWith('[data-contribution-file-')) {
        if (!previewNodes.has(selector)) previewNodes.set(selector, { textContent: '', hidden: true });
        return previewNodes.get(selector);
      }
      const id = selector.replace(/^#/, '');
      if (!Object.hasOwn(fields, id)) return null;
      return typeof fields[id] === 'string' ? { value: fields[id] } : fields[id];
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
  const renderMarkdown = vi.fn((markdown: string) => `<p data-rendered-markdown>${markdown}</p>`);
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
    hydrateUiFormSelects: vi.fn((container: any) => [
      'contrib-network-access',
      'contrib-file-access',
      'contrib-command-access',
      'contrib-sensitive-data',
    ].map((id) => ({ getValue: () => container.querySelector(`#${id}`)?.value || '' }))),
    uiProgressBar: vi.fn(() => '<progress></progress>'),
    uiSkeleton: vi.fn(() => '<div role="status"></div>'),
    uiStatusPill: vi.fn(({ label }: any) => `<span role="status">${label}</span>`),
    uiDataTable: vi.fn(({ rows }: any) => `<table>${rows.map((row: any) => Object.values(row).join(' ')).join(' ')}</table>`),
    uiAccordion: vi.fn(({ items }: any) => `<div>${items.map((item: any) => item.bodyHtml).join('')}</div>`),
    uiResourceCard: vi.fn(({ title }: any) => `<article>${title}</article>`),
    uiResourceGrid: vi.fn(({ bodyHtml }: any) => `<section>${bodyHtml}</section>`),
    uiEmptyState: vi.fn(({ title }: any) => `<p>${title}</p>`),
    renderMarkdown,
  };
  const document = { querySelector: () => null };
  vm.runInNewContext(source, { window: root, document, renderMarkdown, setTimeout, clearTimeout, Promise, queueMicrotask });
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
    completion: { missing: [], conflicts: [], present: { name: 'Skill A', description: 'Preview description', version: '1.1.0' } },
    preview: { digest: 'a'.repeat(64), files: [{ path: 'SKILL.md', size: 8, sha256: 'b'.repeat(64) }] },
    originPrefill: { locked: false, type: null, forked_from: null },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Hub contribution real-page flow integration', () => {
  it('offers a manual Hub-derived origin and includes its association in the preview', async () => {
    const calls: Array<{ channel: string; payload: any }> = [];
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), token: 'abc123def456' };
      if (channel === 'contribution.recheck') return passState();
      return { ok: true };
    }, {
      choice: async () => 'derived_from_hub',
      modal: (options) => options.title === 'Submission preview' ? modalPromise('cancel') : modalPromise(),
    });
    root.uiPrompt.mockResolvedValueOnce('22f1238eb8e5').mockResolvedValueOnce('1.0.0').mockResolvedValueOnce('source note');

    await root.startSkillContribution('skill-a', 'Skill A');

    expect(root.uiChoice.mock.calls[0][0].choices.map((choice: any) => choice.id))
      .toEqual(expect.arrayContaining(['original', 'derived_from_hub', 'third_party']));
    expect(calls).toContainEqual({ channel: 'contribution.declare', payload: {
      token: 'abc123def456', kind: 'origin', origin_type: 'derived_from_hub', note: 'source note',
      forked_from: { content_id: '22f1238eb8e5', version: '1.0.0' },
    } });
    const preview = root.uiModal.mock.calls.find(([options]: any) => options.title === 'Submission preview')[0];
    expect(preview.bodyHtml).toContain('22f1238eb8e5');
    expect(preview.bodyHtml).toContain('v1.0.0');
  });

  it('locks a derived Hub origin and shows its immutable link in the preview', async () => {
    const calls: Array<{ channel: string; payload: any }> = [];
    const derived = {
      ...passState(),
      originPrefill: {
        locked: true, type: 'derived_from_hub',
        forked_from: { content_id: 'hub-content-1', version: '1.0.0' },
      },
    };
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready', displayName: 'Test contributor' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...derived, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return derived;
      return { ok: true };
    }, {
      modal: (options) => options.title === 'Submission preview' ? modalPromise('cancel') : modalPromise(),
    });
    await root.startSkillContribution('skill-a', 'Skill A');
    expect(root.uiChoice).not.toHaveBeenCalled();
    expect(root.uiPrompt).toHaveBeenCalledWith(expect.stringContaining('hub-content-1 v1.0.0'), '');
    expect(calls).toContainEqual({ channel: 'contribution.declare', payload: {
      token: 'abc123def456', kind: 'origin', origin_type: 'derived_from_hub', note: 'fixture reason',
    } });
    const preview = root.uiModal.mock.calls.find(([options]: any) => options.title === 'Submission preview')[0];
    expect(preview.bodyHtml).toContain('hub-content-1');
    expect(preview.bodyHtml).toContain('v1.0.0');
    expect(preview.bodyHtml).toContain('fixture reason');
  });

  it('closes My contributions before starting a selected new-version flow', async () => {
    let mineDialog: any;
    const { root } = loadRoot(async (channel) => {
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.mine') return { cache: { items: { content: {
        content_id: 'content-1', name: 'Skill A', current_published_version: '1.0.0',
        latest_submission: { status: 'ACCEPTED', declarations_origin: { type: 'original' } },
      } } } };
      if (channel === 'contribution.terms') return { state: { status: 'closed' } };
      return {};
    }, {
      modal: (options) => {
        const dialog = modalPromise();
        if (options.title === 'My contributions') {
          mineDialog = dialog;
          dialog.close = vi.fn(dialog.close);
        }
        return dialog;
      },
      choice: async () => 'skill-a',
    });
    root.getCustomContributionSkills = () => [{ id: 'skill-a', name: 'Skill A' }];
    const mine = root.openMyContributions();
    await vi.waitFor(() => expect(mineDialog).toBeTruthy());
    await mineDialog.overlay.click('[data-contribution-new-version]', {
      contributionNewVersion: 'content-1', contributionIndex: '0',
    });
    await mine;
    expect(mineDialog.close).toHaveBeenCalledWith('new-version', 'programmatic');
    expect(root.uiChoice).toHaveBeenCalled();
  });

  it('labels the new-version action as resubmission after Hub returns a content submission', async () => {
    let mineDialog: any;
    const { root } = loadRoot(async (channel) => {
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.mine') return { cache: { items: { content: {
        content_id: 'content-1', name: 'Skill A', content_status: 'disabled',
        latest_submission: { status: 'RETURNED', returned_reason: 'Add a version note' },
      } } } };
      return {};
    }, { modal: (options) => {
      const dialog = modalPromise();
      if (options.title === 'My contributions') mineDialog = dialog;
      return dialog;
    } });
    const flow = root.openMyContributions();
    await vi.waitFor(() => expect(mineDialog).toBeTruthy());
    const card = root.uiResourceCard.mock.calls[0][0];
    expect(card).toEqual(expect.objectContaining({
      description: expect.stringContaining('Add a version note'),
      status: expect.objectContaining({ label: 'RETURNED', tone: 'critical' }),
      actions: expect.arrayContaining([
        expect.objectContaining({
          label: 'Revise and resubmit',
          attrs: expect.objectContaining({ 'data-contribution-new-version': 'content-1' }),
        }),
      ]),
    }));
    expect(card.bodyHtml).toBeUndefined();
    mineDialog.close();
    await flow;
  });

  it('opens each preview file read-only and shows the submitted metadata', async () => {
    let previewDialog: any;
    const calls: Array<{ channel: string; payload: any }> = [];
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready', displayName: 'Test contributor' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), admission: null, preview: null, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return passState();
      if (channel === 'contribution.readFile') return { binary: false, content: '# Read-only Skill', size: 17 };
      return { ok: true };
    }, {
      modal: (options) => {
        const dialog = options.title === 'Submission preview' ? modalPromise() : modalPromise('close');
        if (options.title === 'Submission preview') previewDialog = dialog;
        return dialog;
      },
    });
    const flow = root.startSkillContribution('skill-a', 'Skill A');
    await vi.waitFor(() => expect(previewDialog).toBeTruthy());
    const preview = root.uiModal.mock.calls.find(([options]: any) => options.title === 'Submission preview')[0];
    expect(preview.bodyHtml).toContain('Preview description');
    expect(preview.bodyHtml).toContain('Test contributor');
    expect(preview.bodyHtml).toContain('2026-09-24');
    await previewDialog.overlay.click('[data-contribution-file-index]', { contributionFileIndex: '0' });
    expect(calls).toContainEqual({ channel: 'contribution.readFile', payload: { token: 'abc123def456', path: 'SKILL.md' } });
    expect(previewDialog.overlay.querySelector('[data-contribution-file-content="0"]').textContent).toBe('# Read-only Skill');
    expect(previewDialog.overlay.querySelector('[data-contribution-file-content="0"]').hidden).toBe(false);
    previewDialog.close('cancel');
    await flow;
    expect(calls.some(({ channel }) => channel === 'contribution.submit')).toBe(false);
  });
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

  it('collects simple security choices instead of raw YAML and rechecks before preview', async () => {
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
            'contrib-network-access': 'none',
            'contrib-file-access': 'none',
            'contrib-command-access': 'none',
            'contrib-sensitive-data': 'none',
            'contrib-network-allowlist': '',
            'contrib-external-tools': '',
          });
        }
        if (modalOptions.title === 'Submission preview') return modalPromise('continue');
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept', {
          'contribution-accept-terms': { checked: true },
          'contribution-confirm-maintenance': { checked: true },
        });
        return modalPromise();
      },
    });

    await root.startSkillContribution('skill-a', 'Skill A');

    const complete = calls.find((entry) => entry.channel === 'contribution.complete');
    expect(complete?.payload).toMatchObject({
      token: 'abc123def456',
      security_declaration: {
        network_access: 'none',
        network_allowlist: '',
        file_access: 'none',
        command_access: 'none',
        external_tools: '',
        sensitive_data: 'none',
      },
    });
    expect(complete?.payload).not.toHaveProperty('security_manifest');
    expect(root.uiField).toHaveBeenCalledWith(expect.objectContaining({
      id: 'contrib-network-access', control: expect.objectContaining({ kind: 'select' }),
    }));
    expect(root.uiField).toHaveBeenCalledWith(expect.objectContaining({
      id: 'contrib-file-access', control: expect.objectContaining({ kind: 'select' }),
    }));
    expect(root.uiField).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'contrib-security-manifest' }));
    expect(calls.findIndex((entry) => entry.channel === 'contribution.recheck'))
      .toBeLessThan(calls.findIndex((entry) => entry.channel === 'contribution.complete'));
    expect(calls.map((entry) => entry.channel)).toContain('contribution.submit');
    expect(root.uiField).toHaveBeenCalledWith(expect.objectContaining({
      id: 'contribution-accept-terms', control: expect.objectContaining({ kind: 'checkbox' }),
    }));
    expect(root.uiField).toHaveBeenCalledWith(expect.objectContaining({
      id: 'contribution-confirm-maintenance', control: expect.objectContaining({ kind: 'checkbox' }),
    }));
    expect(root.renderMarkdown).toHaveBeenCalledWith('Terms');
    const termsModal = root.uiModal.mock.calls.find(([options]: any) => options.title === 'Community Contribution Terms')[0];
    expect(termsModal.bodyHtml).toContain('<p data-rendered-markdown>Terms</p>');
  });

  it('does not record declarations until both shared confirmation checkboxes are selected', async () => {
    const calls: Array<{ channel: string; payload: any }> = [];
    const { root } = loadRoot(async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'contribution.preflight') return { identity: { outcome: 'ready' } };
      if (channel === 'contribution.terms') return openTerms();
      if (channel === 'contribution.start') return { ...passState(), admission: null, preview: null, token: 'abc123def456' };
      if (channel === 'contribution.recheck') return passState();
      return { ok: true };
    }, {
      modal: (modalOptions) => {
        if (modalOptions.title === 'Submission preview') return modalPromise('continue');
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept', {
          'contribution-accept-terms': { checked: true },
          'contribution-confirm-maintenance': { checked: false },
        });
        return modalPromise();
      },
    });

    await root.startSkillContribution('skill-a', 'Skill A');

    expect(root.uiAlert).toHaveBeenCalledWith(expect.stringContaining('Accept the terms'));
    expect(calls.filter(({ channel }) => channel === 'contribution.declare').map(({ payload }) => payload.kind))
      .toEqual(['origin']);
    expect(calls.some(({ channel }) => channel === 'contribution.confirm')).toBe(false);
    expect(calls.some(({ channel }) => channel === 'contribution.submit')).toBe(false);
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
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept', {
          'contribution-accept-terms': { checked: true },
          'contribution-confirm-maintenance': { checked: true },
        });
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
        if (modalOptions.title === 'Community Contribution Terms') return modalPromise('accept', {
          'contribution-accept-terms': { checked: true },
          'contribution-confirm-maintenance': { checked: true },
        });
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
    const card = root.uiResourceCard.mock.calls[0][0];
    expect(card).toEqual(expect.objectContaining({
      title: 'Cached Skill', description: expect.stringContaining('review note'),
      status: expect.objectContaining({ label: 'PENDING_REVIEW', tone: 'attention' }),
      actions: expect.arrayContaining([
        expect.objectContaining({ attrs: expect.objectContaining({ 'data-contribution-withdraw-pending': 'submission_1' }) }),
      ]),
    }));
    expect(card.bodyHtml).toBeUndefined();

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
    const card = root.uiResourceCard.mock.calls[0][0];
    expect(card.actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Request withdrawal' }),
    ]));

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
