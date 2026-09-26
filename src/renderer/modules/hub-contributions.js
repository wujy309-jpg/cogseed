// Hub Skill contribution flow. Business sequencing stays page-owned while all
// actions, prompts, decisions, focus management and forms use shared UI seams.
(function initHubContributions(root) {
  'use strict';

  function tr(key, fallback) {
    const value = typeof root.t === 'function' ? root.t(key) : '';
    return value && value !== key ? value : fallback;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function modal(options) {
    if (typeof root.uiModal !== 'function') throw new Error('contribution requires uiModal');
    return root.uiModal({ closeLabel: tr('common.close', 'Close'), ...options });
  }

  async function ensureIdentity(name) {
    const preflight = await root.cogseed.invoke('contribution.preflight', {});
    if (preflight?.identity?.outcome === 'ready') return preflight;
    if (preflight?.identity?.reason !== 'not_signed_in') {
      await root.uiAlert(tr(`skills.contribute_reason.${preflight?.identity?.reason}`, tr('skills.contribute_unavailable', 'Contribution is unavailable.')));
      return null;
    }
    const proceed = await root.uiConfirm({
      message: tr('skills.login_required_hint', 'Sign in to continue.').replace('{target}', name || ''),
      okLabel: tr('skills.login_goto_web', 'Go to web sign-in'),
    });
    if (!proceed) return null;
    const loginResult = new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (typeof unsubscribe === 'function') unsubscribe();
        resolve(value);
      };
      const unsubscribe = root.cogseed.onPushEvent('hub-account:login-result', (outcome) => {
        finish(outcome?.result === 'success');
      });
      const timeout = setTimeout(() => finish(false), 5 * 60_000);
    });
    await root.cogseed.invoke('hub-account.start_login', {});
    if (!await loginResult) return null;
    const resumed = await root.cogseed.invoke('contribution.preflight', {});
    return resumed?.identity?.outcome === 'ready' ? resumed : null;
  }

  async function collectMissing(token, result) {
    let current = result;
    while (current?.completion?.missing?.length || current?.completion?.conflicts?.length) {
      const present = current.completion.present || {};
      const form = root.uiForm({
        ariaLabel: tr('skills.contribute_metadata', 'Submission metadata'),
        fields: [
          { html: root.uiField({ id: 'contrib-name', label: tr('skills.contribute_meta_name', 'Name'), required: true, control: { kind: 'input', value: present.name || '' } }) },
          { html: root.uiField({ id: 'contrib-description', label: tr('skills.contribute_meta_desc', 'Description'), required: true, control: { kind: 'textarea', value: present.description || '', attrs: { rows: 4 } } }) },
          { html: root.uiField({ id: 'contrib-version', label: tr('skills.contribute_meta_version', 'Version'), required: true, control: { kind: 'input', value: present.version || '', placeholder: '1.0.0' } }) },
          { html: root.uiField({ id: 'contrib-security-manifest', label: tr('skills.contribute_security_manifest', 'Security declaration'), required: true, control: { kind: 'textarea', value: present.security_manifest || '', attrs: { rows: 12, spellcheck: 'false' } } }) },
        ],
      });
      const dialog = modal({
        title: tr('skills.contribute_metadata', 'Submission metadata'),
        description: tr('skills.contribute_metadata_hint', 'Changes apply only to the submission copy.'),
        bodyHtml: form,
        actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }, { id: 'save', label: tr('common.continue', 'Continue'), role: 'primary' }],
      });
      const answer = await dialog;
      if (answer.value !== 'save') return null;
      const next = await root.cogseed.invoke('contribution.complete', {
        token,
        name: dialog.overlay.querySelector('#contrib-name')?.value || '',
        description: dialog.overlay.querySelector('#contrib-description')?.value || '',
        version: dialog.overlay.querySelector('#contrib-version')?.value || '',
        security_manifest: dialog.overlay.querySelector('#contrib-security-manifest')?.value || '',
      });
      current = next;
      if (current?.admission?.outcome !== 'pass') return current;
    }
    return current;
  }

  async function confirmPreview(token, name, state, terms, previousOrigin) {
    const preview = state.preview || { files: [] };
    const fileRows = (preview.files || []).map((file) => `<li><code>${esc(file.path)}</code> · ${Number(file.size) || 0} B · <code>${esc(file.sha256)}</code></li>`).join('');
    const choice = await modal({
      title: tr('skills.contribute_preview_title', 'Submission preview').replace('{name}', name || ''),
      description: tr('skills.contribute_files_note', 'Only the listed files and metadata will be sent.'),
      size: 'lg',
      bodyHtml: `<div class="contribution-preview" data-contribution-preview><p><strong>${esc(state.completion?.present?.name || name)}</strong> · ${esc(state.completion?.present?.version || '')}</p><ul>${fileRows}</ul></div>`,
      actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }, { id: 'continue', label: tr('common.continue', 'Continue'), role: 'primary' }],
    });
    const previewResult = await choice;
    if (previewResult.value !== 'continue') return false;

    if (!state.originPrefill?.locked) {
      const origin = await root.uiChoice({
        title: tr('skills.contribute_origin_title', 'Origin declaration'),
        message: previousOrigin?.type
          ? tr('skills.contribute_origin_previous', 'Previous declaration: {origin}. Confirm or change it.').replace('{origin}', previousOrigin.type)
          : tr('skills.contribute_origin_choose', 'Select the true origin.'),
        choices: [
          { id: 'original', label: tr('skills.contribute_origin.original', 'Original') },
          { id: 'third_party', label: tr('skills.contribute_origin.third_party', 'Third-party material') },
        ].sort((a, b) => (a.id === previousOrigin?.type ? -1 : b.id === previousOrigin?.type ? 1 : 0)),
      });
      if (!origin) return false;
      let note = '';
      if (origin === 'third_party') {
        note = await root.uiPrompt(tr('skills.contribute_origin_note_ph', 'Describe the third-party source.'), previousOrigin?.type === 'third_party' ? String(previousOrigin.note || '') : '');
        if (!note) return false;
      }
      await root.cogseed.invoke('contribution.declare', { token, kind: 'origin', origin_type: origin, note });
    }

    const termsResult = await modal({
      title: tr('skills.contribute_terms_title', 'Community Contribution Terms'),
      description: `${tr('skills.contribute_terms_version', 'Version')} ${terms.version}`,
      size: 'lg', bodyHtml: `<article class="markdown-body">${esc(terms.body_markdown).replace(/\n/g, '<br>')}</article>`,
      actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }, { id: 'accept', label: tr('skills.contribute_terms_accept', 'I accept'), role: 'primary' }],
    });
    if ((await termsResult).value !== 'accept') return false;
    await root.cogseed.invoke('contribution.declare', { token, kind: 'terms' });
    if (!await root.uiConfirm({ message: tr('skills.contribute_maint_note', 'I confirm maintenance responsibility.'), okLabel: tr('common.confirm', 'Confirm') })) return false;
    await root.cogseed.invoke('contribution.declare', { token, kind: 'maintenance' });
    const confirmed = await root.cogseed.invoke('contribution.confirm', { token, digest: preview.digest });
    return confirmed?.confirmed === true;
  }

  async function startSkillContribution(skillId, name, targetContentId, previousOrigin) {
    let token = null;
    try {
      if (!await ensureIdentity(name)) return;
      const termsResponse = await root.cogseed.invoke('contribution.terms', {});
      if (termsResponse?.state?.status !== 'open') {
        await root.uiAlert(termsResponse?.state?.status === 'closed'
          ? tr('skills.contribute_terms_closed', 'Contribution is not open right now.')
          : tr('skills.contribute_terms_unavailable', 'Could not load the current terms.'));
        return;
      }
      let state = await root.cogseed.invoke('contribution.start', { skill_id: skillId, defer_check: true });
      token = state?.token || null;
      if (!token) return;
      const originPrefill = state.originPrefill;
      state = await collectMissing(token, state);
      if (!state) return;
      state.originPrefill = originPrefill;
      const progress = modal({
        title: tr('skills.contribute_checking', 'Running local checks'),
        description: tr('skills.contribute_checking_hint', 'No package bytes are sent while local checks run.'),
        dismissible: false,
        bodyHtml: root.uiProgressBar({ ariaLabel: tr('skills.contribute_checking', 'Running local checks'), value: 1, max: 1 }),
        actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }],
      });
      const check = root.cogseed.invoke('contribution.recheck', { token })
        .then((result) => ({ kind: 'result', result }), (error) => ({ kind: 'error', error }));
      const outcome = await Promise.race([check, progress.then(() => ({ kind: 'cancel' }))]);
      if (outcome.kind === 'cancel') {
        await root.cogseed.invoke('contribution.cancel', { token });
        token = null;
        return;
      }
      progress.close('complete', 'programmatic');
      if (outcome.kind === 'error') throw outcome.error;
      state = outcome.result;
      state.originPrefill = originPrefill;
      if (state?.admission?.outcome !== 'pass') {
        const declarationReason = state?.admission?.declaration?.reason;
        if (['declaration_absent', 'declaration_needs_input', 'declaration_mismatch'].includes(declarationReason)) {
          state.completion.missing = Array.from(new Set([...(state.completion.missing || []), 'security_manifest']));
          state = await collectMissing(token, state);
          if (state) state.originPrefill = originPrefill;
        }
      }
      if (!state || state?.admission?.outcome !== 'pass') {
        if (state) await root.uiAlert(tr(`skills.contribute_reason.${state?.admission?.reason}`, tr('skills.contribute_blocked', 'Local checks blocked contribution.')));
        return;
      }
      if (!await confirmPreview(token, name, state, termsResponse.state.terms, previousOrigin)) return;
      let replaceConfirmed = false;
      for (;;) {
        const upload = modal({
          title: tr('skills.contribute_uploading', 'Uploading contribution'),
          description: tr('skills.contribute_uploading_hint', 'Keep this window open until Hub confirms receipt.'),
          dismissible: false,
          bodyHtml: root.uiProgressBar({ ariaLabel: tr('skills.contribute_uploading', 'Uploading contribution'), value: 1, max: 1 }),
          actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }],
        });
        const submitAttempt = root.cogseed.invoke('contribution.submit', {
          token,
          ...(targetContentId ? { target_content_id: targetContentId } : {}),
          ...(replaceConfirmed ? { replace_confirmed: true } : {}),
        }).then((result) => ({ kind: 'result', result }), (error) => ({ kind: 'error', error }));
        const uploadOutcome = await Promise.race([submitAttempt, upload.then(() => ({ kind: 'cancel' }))]);
        if (uploadOutcome.kind === 'cancel') {
          await root.cogseed.invoke('contribution.abortUpload', { token });
          await submitAttempt;
          break;
        }
        upload.close('complete', 'programmatic');
        if (uploadOutcome.kind === 'error') throw uploadOutcome.error;
        const submitted = uploadOutcome.result;
        if (submitted?.reason === 'replacement_confirmation_required') {
          replaceConfirmed = await root.uiConfirm({
            message: tr('skills.contribute_replace_confirm', 'This will replace your pending submission for the same content. Continue?'),
            okLabel: tr('common.continue', 'Continue'),
          });
          if (replaceConfirmed) continue;
          break;
        }
        if (submitted?.ok) {
          token = null;
          await root.uiAlert(tr('skills.contribute_submitted', 'Submitted for review.'));
          break;
        }
        const retryable = submitted?.error?.retryable === true || submitted?.retryable === true || submitted?.reason === 'snapshot_drift';
        if (!retryable) {
          const localMessage = submitted?.reason === 'version_not_higher'
            ? tr('skills.contribute_version_not_higher', 'The version must be higher than {version}.').replace('{version}', submitted.current_version || '')
            : submitted?.reason === 'invalid_semver'
              ? tr('skills.contribute_invalid_semver', 'Enter a valid semantic version, for example 1.2.0.')
              : submitted?.reason === 'target_version_unavailable'
                ? tr('skills.contribute_target_refresh', 'Refresh My contributions before submitting a new version.')
                : '';
          await root.uiAlert(localMessage || submitted?.error?.message || tr('skills.contribute_submit_failed', 'Submission was not confirmed.'));
          break;
        }
        const retry = await root.uiConfirm({
          message: submitted?.error?.message || tr('skills.contribute_submit_retry', 'Hub did not confirm receipt. Retry the exact same package?'),
          okLabel: tr('common.retry', 'Retry'),
        });
        if (!retry) break;
      }
    } catch (error) {
      if (root.createLogger) root.createLogger('hub-contributions').warn('flow failed', { error: String(error) });
      await root.uiAlert(tr('skills.contribute_start_failed', 'Could not start contribution.'));
    } finally {
      if (token) await root.cogseed.invoke('contribution.cancel', { token }).catch(() => {});
    }
  }

  async function chooseLocalSkill(targetContentId, previousOrigin) {
    const skills = typeof root.getCustomContributionSkills === 'function' ? root.getCustomContributionSkills() : [];
    if (!skills.length) {
      await root.uiAlert(tr('skills.contribute_no_local_skill', 'Create or import a local Skill before submitting a new version.'));
      return;
    }
    const selected = await root.uiChoice({
      title: tr('skills.contribute_new_version', 'Submit new version'),
      message: tr('skills.contribute_choose_local', 'Choose the local Skill that contains the new version.'),
      choices: skills.map((skill) => ({ id: skill.id, label: skill.name || skill.id })),
    });
    const skill = skills.find((entry) => entry.id === selected);
    if (skill) await startSkillContribution(skill.id, skill.name || skill.id, targetContentId, previousOrigin);
  }

  async function openMyContributions() {
    if (!await ensureIdentity(tr('skills.contribute_mine', 'My contributions'))) return;
    const response = await root.cogseed.invoke('contribution.mine', { refresh: true });
    const items = Object.values(response?.cache?.items || {}).filter((item) => item && typeof item === 'object');
    const bodyHtml = items.length ? root.uiResourceGrid({
      attrs: { 'data-contribution-mine-grid': true },
      bodyHtml: items.map((item, index) => {
        const title = String(item.name || item.title || item.content_id || item.submission_id || `#${index + 1}`);
        const latest = item.latest_submission && typeof item.latest_submission === 'object' ? item.latest_submission : {};
        const withdrawal = item.withdrawal_request && typeof item.withdrawal_request === 'object' ? item.withdrawal_request : {};
        const status = String(latest.status || item.status || item.review_status || item.submission_status || item.content_status || tr('skills.contribute_status_unknown', 'Unknown'));
        const contentId = String(item.content_id || '');
        const submissionId = String(latest.submission_id || item.submission_id || '');
        const contentStatus = String(item.content_status || '').toLowerCase();
        const lifecycleNote = ['disabled', 'withdrawn'].includes(contentStatus)
          ? tr('skills.contribute_lifecycle_recovery_notice', 'This content is {status}. A higher-version submission can restore availability only after Hub review.')
            .replace('{status}', contentStatus)
          : '';
        const actions = [
          contentId ? root.uiButton({ label: tr('skills.contribute_new_version', 'Submit new version'), size: 'sm', attrs: { 'data-contribution-new-version': contentId, 'data-contribution-index': index } }) : '',
          submissionId && ['pending', 'submitted', 'reviewing'].includes(status.toLowerCase())
            ? root.uiButton({ label: tr('skills.contribute_withdraw_pending', 'Withdraw submission'), role: 'danger', size: 'sm', attrs: { 'data-contribution-withdraw-pending': submissionId } }) : '',
          contentId && contentStatus === 'published' && String(withdrawal.status || '').toUpperCase() !== 'PENDING'
            ? root.uiButton({ label: tr('skills.contribute_request_withdrawal', 'Request withdrawal'), role: 'danger', size: 'sm', attrs: { 'data-contribution-request-withdrawal': contentId } }) : '',
          contentId ? root.uiButton({ label: tr('skills.contribute_withdrawal_history', 'Withdrawal history'), size: 'sm', attrs: { 'data-contribution-withdrawal-history': contentId } }) : '',
        ].filter(Boolean).join(' ');
        return root.uiResourceCard({
          title,
          description: [
            lifecycleNote,
            String(withdrawal.rejected_reason || latest.returned_reason || item.reason || item.review_reason || item.description || ''),
          ].filter(Boolean).join(' '),
          status,
          bodyHtml: `<div class="contribution-mine-actions">${actions}</div>`,
        });
      }).join(''),
    }) : root.uiEmptyState({ title: tr('skills.contribute_mine_empty', 'No contributions yet') });
    const dialog = modal({
      title: tr('skills.contribute_mine', 'My contributions'),
      description: response?.stale ? tr('skills.contribute_mine_stale', 'Showing the last saved result because Hub could not be refreshed.') : '',
      size: 'lg', bodyHtml,
      actions: [
        { id: 'close', label: tr('common.close', 'Close') },
        { id: 'refresh', label: tr('common.refresh', 'Refresh'), role: 'primary' },
      ],
    });
    dialog.overlay.addEventListener('click', async (event) => {
      const newVersion = event.target.closest('[data-contribution-new-version]');
      if (newVersion) {
        const item = items[Number(newVersion.dataset.contributionIndex)];
        return chooseLocalSkill(newVersion.dataset.contributionNewVersion, item?.latest_submission?.declarations_origin || null);
      }
      const withdraw = event.target.closest('[data-contribution-withdraw-pending]');
      if (withdraw && await root.uiConfirmDanger({ message: tr('skills.contribute_withdraw_pending_confirm', 'Withdraw this pending submission?') })) {
        const result = await root.cogseed.invoke('contribution.withdrawPending', { submission_id: withdraw.dataset.contributionWithdrawPending });
        if (!result?.ok) await root.uiAlert(result?.error?.message || tr('skills.contribute_action_failed', 'The action could not be completed.'));
        else dialog.close('updated');
      }
      const request = event.target.closest('[data-contribution-request-withdrawal]');
      if (request) {
        const understood = await root.uiConfirm({
          message: tr('skills.contribute_withdrawal_notice', 'A withdrawal request takes effect only after governance review. The content remains published while pending.'),
          okLabel: tr('common.continue', 'Continue'),
        });
        if (!understood) return;
        const reason = await root.uiPrompt(tr('skills.contribute_withdrawal_reason', 'Explain why this published content should be withdrawn.'), '');
        if (!reason) return;
        const result = await root.cogseed.invoke('contribution.requestWithdrawal', { content_id: request.dataset.contributionRequestWithdrawal, reason });
        if (!result?.ok) await root.uiAlert(result?.error?.message || tr('skills.contribute_action_failed', 'The action could not be completed.'));
        else dialog.close('updated');
      }
      const history = event.target.closest('[data-contribution-withdrawal-history]');
      if (history) {
        const result = await root.cogseed.invoke('contribution.withdrawalHistory', { content_id: history.dataset.contributionWithdrawalHistory });
        if (!result?.ok) {
          await root.uiAlert(result?.error?.message || tr('skills.contribute_action_failed', 'The action could not be completed.'));
          return;
        }
        const rows = Array.isArray(result.result?.items) ? result.result.items : [];
        const historyBody = rows.length ? rows.map((row) => root.uiResourceCard({
          title: String(row.status || tr('skills.contribute_status_unknown', 'Unknown')),
          description: String(row.rejected_reason || row.reason || ''),
          status: String(row.requested_at || ''),
        })).join('') : root.uiEmptyState({ title: tr('skills.contribute_withdrawal_history_empty', 'No withdrawal requests') });
        await modal({
          title: tr('skills.contribute_withdrawal_history', 'Withdrawal history'),
          bodyHtml: root.uiResourceGrid({ bodyHtml: historyBody }),
          actions: [{ id: 'close', label: tr('common.close', 'Close') }],
        });
      }
    });
    // Refresh only while the foreground modal exists; closing it stops polling.
    const foregroundRefresh = setTimeout(() => dialog.close('poll', 'programmatic'), 55_000);
    const result = await dialog;
    clearTimeout(foregroundRefresh);
    if (result.value === 'refresh' || result.value === 'poll') await openMyContributions();
  }

  function mountMineAction() {
    const actions = document.querySelector('#skills-grid-view .skills-resource-toolbar-controls .header-actions');
    if (!actions || actions.querySelector('[data-contribution-mine]') || typeof root.uiButton !== 'function') return;
    actions.insertAdjacentHTML('afterbegin', root.uiButton({ label: tr('skills.contribute_mine', 'My contributions'), size: 'sm', attrs: { 'data-contribution-mine': true } }));
    actions.querySelector('[data-contribution-mine]').addEventListener('click', () => openMyContributions().catch(async () => {
      await root.uiAlert(tr('skills.contribute_start_failed', 'Could not load contributions.'));
    }));
  }

  root.startSkillContribution = startSkillContribution;
  root.openMyContributions = openMyContributions;
  mountMineAction();
})(window);
