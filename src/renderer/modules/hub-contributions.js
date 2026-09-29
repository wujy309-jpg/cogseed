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

  function statusTone(status) {
    const normalized = String(status || '').toUpperCase();
    if (['ACCEPTED', 'PUBLISHED', 'WITHDRAWN', 'APPROVED'].includes(normalized)) return 'success';
    if (['PENDING', 'PENDING_REVIEW', 'PENDING_WITHDRAWAL'].includes(normalized)) return 'attention';
    if (['RETURNED', 'REJECTED', 'FAILED', 'DISABLED'].includes(normalized)) return 'critical';
    return 'neutral';
  }

  function statusDescriptor(status, namespace = 'skills.contribute_status') {
    const normalized = String(status || tr('skills.contribute_status_unknown', 'Unknown')).toUpperCase();
    return {
      label: tr(`${namespace}.${normalized}`, String(status || tr('skills.contribute_status_unknown', 'Unknown'))),
      tone: statusTone(normalized),
      check: ['ACCEPTED', 'PUBLISHED', 'WITHDRAWN', 'APPROVED'].includes(normalized),
    };
  }

  function admissionDetails(state) {
    const admission = state?.admission || {};
    const issues = [
      ...(Array.isArray(admission.issues) ? admission.issues.map((issue) =>
        [issue.path || issue.file || issue.rule || issue.rule_id, issue.rule || issue.rule_id, issue.message].filter(Boolean).join(' · ')) : []),
      ...(Array.isArray(admission.declaration?.findings) ? admission.declaration.findings.map((finding) =>
        [finding.ruleId, finding.message].filter(Boolean).join(' · ')) : []),
      ...(Array.isArray(admission.componentsBlocking) ? admission.componentsBlocking : []),
    ].filter(Boolean);
    return [tr(`skills.contribute_reason.${admission.reason}`, tr('skills.contribute_blocked', 'Local checks blocked contribution.')), ...issues].join('\n');
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
      const needsSecurity = (current.completion.missing || []).includes('security_manifest');
      const fieldLabels = {
        skill_md: tr('skills.contribute_skill_md', 'SKILL.md'),
        name: tr('skills.contribute_meta_name', 'Name'),
        description: tr('skills.contribute_meta_desc', 'Description'),
        version: tr('skills.contribute_meta_version', 'Version'),
        security_manifest: tr('skills.contribute_security_manifest', 'Security declaration'),
      };
      const issueRows = (current.completion.missing || []).map((field) => ({
        field: fieldLabels[field] || field,
        issue: tr('skills.contribute_required', 'Required'),
      }));
      issueRows.push(...(current.completion.conflicts || []).map((conflict) => {
        const values = (conflict.values || []).map((item) => `${item.source}: ${item.value}`).join(' · ');
        return {
          field: fieldLabels[conflict.field] || conflict.field,
          issue: tr('skills.contribute_conflicting_values', 'Conflicting values: {values}').replace('{values}', values),
        };
      }));
      const issues = root.uiDataTable({
        label: tr('skills.contribute_metadata_issues', 'Submission metadata issues'),
        columns: [
          { key: 'field', label: tr('skills.contribute_issue_field', 'Field'), primary: true },
          { key: 'issue', label: tr('skills.contribute_issue_detail', 'Issue') },
        ],
        rows: issueRows,
      });
      const securityFields = needsSecurity ? [
        { html: root.uiField({
          id: 'contrib-network-access', label: tr('skills.contribute_security_network', 'External network access'), required: true,
          hint: tr('skills.contribute_security_network_hint', 'Choose restricted access only when the Skill contacts specific services.'),
          control: { kind: 'select', value: '', placeholder: tr('skills.contribute_security_choose', 'Choose one'), options: [
            { value: 'none', label: tr('skills.contribute_security_network_none', 'Does not access external networks') },
            { value: 'restricted', label: tr('skills.contribute_security_network_restricted', 'Accesses declared domains only') },
          ] },
        }) },
        { html: root.uiField({
          id: 'contrib-network-allowlist', label: tr('skills.contribute_security_network_allowlist', 'Allowed domains'),
          hint: tr('skills.contribute_security_network_allowlist_hint', 'Required only for restricted network access. Enter one domain or HTTPS address per line.'),
          control: { kind: 'textarea', value: '', attrs: { rows: 3, spellcheck: 'false' } },
        }) },
        { html: root.uiField({
          id: 'contrib-file-access', label: tr('skills.contribute_security_files', 'Local file access'), required: true,
          control: { kind: 'select', value: '', placeholder: tr('skills.contribute_security_choose', 'Choose one'), options: [
            { value: 'none', label: tr('skills.contribute_security_files_none', 'Does not directly read or write local files') },
            { value: 'read_selected', label: tr('skills.contribute_security_files_read', 'Reads only files selected by the user') },
            { value: 'read_write_selected', label: tr('skills.contribute_security_files_write', 'Reads and writes only files selected by the user') },
          ] },
        }) },
        { html: root.uiField({
          id: 'contrib-command-access', label: tr('skills.contribute_security_commands', 'Commands and external tools'), required: true,
          control: { kind: 'select', value: '', placeholder: tr('skills.contribute_security_choose', 'Choose one'), options: [
            { value: 'none', label: tr('skills.contribute_security_commands_none', 'Does not execute commands or external tools') },
            { value: 'declared_tools', label: tr('skills.contribute_security_commands_declared', 'Uses the tools listed below') },
          ] },
        }) },
        { html: root.uiField({
          id: 'contrib-external-tools', label: tr('skills.contribute_security_tool_names', 'Tool names'),
          hint: tr('skills.contribute_security_tool_names_hint', 'Required only when tools are used. Enter executable or package names, one per line.'),
          control: { kind: 'textarea', value: '', attrs: { rows: 3, spellcheck: 'false' } },
        }) },
        { html: root.uiField({
          id: 'contrib-sensitive-data', label: tr('skills.contribute_security_data', 'Sensitive data'), required: true,
          control: { kind: 'select', value: '', placeholder: tr('skills.contribute_security_choose', 'Choose one'), options: [
            { value: 'none', label: tr('skills.contribute_security_data_none', 'Not intended to process personal information or credentials') },
            { value: 'personal', label: tr('skills.contribute_security_data_personal', 'May process personal information') },
            { value: 'credentials', label: tr('skills.contribute_security_data_credentials', 'May process credentials or secrets') },
          ] },
        }) },
      ] : [];
      const form = root.uiForm({
        ariaLabel: tr('skills.contribute_metadata', 'Submission metadata'),
        fields: [
          { html: root.uiField({ id: 'contrib-name', label: tr('skills.contribute_meta_name', 'Name'), required: true, control: { kind: 'input', value: present.name || '' } }) },
          { html: root.uiField({ id: 'contrib-description', label: tr('skills.contribute_meta_desc', 'Description'), required: true, control: { kind: 'textarea', value: present.description || '', attrs: { rows: 4 } } }) },
          { html: root.uiField({ id: 'contrib-version', label: tr('skills.contribute_meta_version', 'Version'), required: true, control: { kind: 'input', value: present.version || '', placeholder: '1.0.0' } }) },
          ...securityFields,
        ],
      });
      const dialog = modal({
        title: tr('skills.contribute_metadata', 'Submission metadata'),
        description: tr('skills.contribute_metadata_hint', 'Changes apply only to the submission copy.'),
        bodyHtml: `<div class="contribution-metadata">${issues}${form}</div>`,
        actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }, { id: 'save', label: tr('common.continue', 'Continue'), role: 'primary' }],
      });
      const securitySelects = needsSecurity && typeof root.hydrateUiFormSelects === 'function'
        ? root.hydrateUiFormSelects(dialog.overlay)
        : [];
      const answer = await dialog;
      if (answer.value !== 'save') return null;
      const securityDeclaration = needsSecurity ? {
        network_access: securitySelects[0]?.getValue?.() || '',
        network_allowlist: dialog.overlay.querySelector('#contrib-network-allowlist')?.value || '',
        file_access: securitySelects[1]?.getValue?.() || '',
        command_access: securitySelects[2]?.getValue?.() || '',
        external_tools: dialog.overlay.querySelector('#contrib-external-tools')?.value || '',
        sensitive_data: securitySelects[3]?.getValue?.() || '',
      } : null;
      if (securityDeclaration && (!securityDeclaration.network_access || !securityDeclaration.file_access
        || !securityDeclaration.command_access || !securityDeclaration.sensitive_data)) {
        await root.uiAlert(tr('skills.contribute_security_required', 'Choose an answer for every security item.'));
        continue;
      }
      if (securityDeclaration?.network_access === 'restricted' && !securityDeclaration.network_allowlist.trim()) {
        await root.uiAlert(tr('skills.contribute_security_network_required', 'List at least one allowed domain.'));
        continue;
      }
      if (securityDeclaration?.command_access === 'declared_tools' && !securityDeclaration.external_tools.trim()) {
        await root.uiAlert(tr('skills.contribute_security_tools_required', 'List at least one command or external tool.'));
        continue;
      }
      const next = await root.cogseed.invoke('contribution.complete', {
        token,
        name: dialog.overlay.querySelector('#contrib-name')?.value || '',
        description: dialog.overlay.querySelector('#contrib-description')?.value || '',
        version: dialog.overlay.querySelector('#contrib-version')?.value || '',
        ...(securityDeclaration ? { security_declaration: securityDeclaration } : {}),
      });
      current = next;
      if (current?.admission?.outcome !== 'pass') return current;
    }
    return current;
  }

  async function chooseOrigin(token, state, previousOrigin) {
    if (state.originPrefill?.locked) {
      const source = state.originPrefill.forked_from;
      if (!source?.content_id || !source?.version) return null;
      const note = await root.uiPrompt(tr('skills.contribute_origin_derived_note',
        'Derived from Hub content {content_id} v{version}. Add an optional note.')
        .replace('{content_id}', source.content_id).replace('{version}', source.version), '');
      if (note === null) return null;
      await root.cogseed.invoke('contribution.declare', {
        token, kind: 'origin', origin_type: 'derived_from_hub', note,
      });
      state.originNote = note;
      state.originForkedFrom = source;
      return 'derived_from_hub';
    }
    const origin = await root.uiChoice({
      title: tr('skills.contribute_origin_title', 'Origin declaration'),
      message: previousOrigin?.type
        ? tr('skills.contribute_origin_previous', 'Previous declaration: {origin}. Confirm or change it.').replace('{origin}', previousOrigin.type)
        : tr('skills.contribute_origin_choose', 'Select the true origin.'),
      choices: [
        { id: 'original', label: tr('skills.contribute_origin.original', 'Original') },
        { id: 'derived_from_hub', label: tr('skills.contribute_origin.derived_from_hub', 'Derived from Hub content') },
        { id: 'third_party', label: tr('skills.contribute_origin.third_party', 'Third-party material') },
      ].sort((a, b) => (a.id === previousOrigin?.type ? -1 : b.id === previousOrigin?.type ? 1 : 0)),
    });
    if (!origin) return null;
    let note = '';
    let forkedFrom = null;
    if (origin === 'derived_from_hub') {
      const contentId = await root.uiPrompt(tr('skills.contribute_origin_content_id', 'Enter the Hub content ID (12 lowercase hex characters).'),
        previousOrigin?.forked_from?.content_id || '');
      if (contentId === null) return null;
      const version = await root.uiPrompt(tr('skills.contribute_origin_source_version', 'Enter the Hub source version (SemVer).'),
        previousOrigin?.forked_from?.version || '');
      if (version === null) return null;
      if (!/^[0-9a-f]{12}$/.test(contentId.trim()) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version.trim())) {
        await root.uiAlert(tr('skills.contribute_origin_invalid_ref', 'Enter a valid Hub content ID and SemVer source version.'));
        return null;
      }
      forkedFrom = { content_id: contentId.trim(), version: version.trim() };
      const enteredNote = await root.uiPrompt(tr('skills.contribute_origin_derived_note',
        'Derived from Hub content {content_id} v{version}. Add an optional note.')
        .replace('{content_id}', forkedFrom.content_id).replace('{version}', forkedFrom.version),
      previousOrigin?.type === 'derived_from_hub' ? String(previousOrigin.note || '') : '');
      if (enteredNote === null) return null;
      note = enteredNote;
    }
    if (origin === 'third_party') {
      note = await root.uiPrompt(tr('skills.contribute_origin_note_ph', 'Describe the third-party source.'), previousOrigin?.type === 'third_party' ? String(previousOrigin.note || '') : '');
      if (!note) return null;
    }
    await root.cogseed.invoke('contribution.declare', {
      token, kind: 'origin', origin_type: origin, note,
      ...(forkedFrom ? { forked_from: forkedFrom } : {}),
    });
    state.originNote = note;
    state.originForkedFrom = forkedFrom;
    return origin;
  }

  async function confirmPreview(token, name, state, terms, origin, displayName) {
    const preview = state.preview || { files: [] };
    const metadata = state.completion?.present || {};
    const metadataTable = root.uiDataTable({
      label: tr('skills.contribute_preview_metadata', 'Submission metadata'),
      columns: [
        { key: 'field', label: tr('skills.contribute_issue_field', 'Field'), primary: true },
        { key: 'value', label: tr('skills.contribute_preview_value', 'Value') },
      ],
      rows: [
        { field: tr('skills.contribute_meta_name', 'Name'), value: metadata.name || name || '' },
        { field: tr('skills.contribute_meta_desc', 'Description'), value: metadata.description || '' },
        { field: tr('skills.contribute_meta_version', 'Version'), value: metadata.version || '' },
        { field: tr('skills.contribute_origin_title', 'Origin declaration'), value: tr(`skills.contribute_origin.${origin}`, origin) },
        ...(state.originForkedFrom ? [{
          field: tr('skills.contribute_origin_derived_from', 'Derived from Hub content'),
          value: `${state.originForkedFrom.content_id} v${state.originForkedFrom.version}`,
        }] : []),
        ...(state.originNote ? [{ field: tr('skills.contribute_origin_note', 'Origin note'), value: state.originNote }] : []),
        { field: tr('skills.contribute_terms_version', 'Terms version'), value: terms.version || '' },
        { field: tr('skills.contribute_contributor', 'Contributor'), value: displayName || '' },
      ],
    });
    const files = Array.isArray(preview.files) ? preview.files : [];
    const filesAccordion = files.length ? root.uiAccordion({
      defaultOpen: [],
      items: files.map((file, index) => ({
        title: file.path,
        meta: `${Number(file.size) || 0} B`,
        bodyHtml: `<div class="contribution-file-details">${[
          `<code class="contribution-file-hash">${esc(file.sha256)}</code>`,
          root.uiButton({
            label: tr('skills.contribute_view_file', 'View file'),
            size: 'sm',
            attrs: { 'data-contribution-file-index': index },
          }),
          `<pre class="contribution-file-content" data-contribution-file-content="${index}" hidden></pre>`,
        ].join('')}</div>`,
      })),
    }) : root.uiEmptyState({ title: tr('skills.contribute_preview_files_empty', 'No files in this submission') });
    const choice = modal({
      title: tr('skills.contribute_preview_title', 'Submission preview').replace('{name}', name || ''),
      description: tr('skills.contribute_files_note', 'Only the listed files and metadata will be sent.'),
      size: 'lg',
      bodyHtml: `<div class="contribution-preview" data-contribution-preview>${metadataTable}${filesAccordion}</div>`,
      actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }, { id: 'continue', label: tr('common.continue', 'Continue'), role: 'primary' }],
    });
    choice.overlay.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-contribution-file-index]');
      if (!button) return;
      const file = files[Number(button.dataset.contributionFileIndex)];
      if (!file) return;
      try {
        const result = await root.cogseed.invoke('contribution.readFile', { token, path: file.path });
        const content = choice.overlay.querySelector(`[data-contribution-file-content="${button.dataset.contributionFileIndex}"]`);
        if (!content) return;
        content.textContent = result.binary
          ? tr('skills.contribute_binary_file', 'Binary file ({size} bytes)').replace('{size}', String(result.size || file.size))
          : result.content || '';
        content.hidden = false;
      } catch (error) {
        await root.uiAlert(tr('skills.contribute_file_read_failed', 'Could not read this file. Please restart the preview.'));
      }
    });
    const previewResult = await choice;
    if (previewResult.value !== 'continue') return false;

    const declarationsForm = root.uiForm({
      ariaLabel: tr('skills.contribute_declarations', 'Contribution declarations'),
      fields: [
        { html: root.uiField({
          id: 'contribution-accept-terms',
          label: tr('skills.contribute_terms_accept', 'I accept the contribution terms'),
          required: true,
          control: { kind: 'checkbox', accessibleLabel: tr('skills.contribute_terms_accept', 'I accept the contribution terms') },
        }) },
        { html: root.uiField({
          id: 'contribution-confirm-maintenance',
          label: tr('skills.contribute_maint_note', 'I confirm maintenance responsibility.'),
          required: true,
          control: { kind: 'checkbox', accessibleLabel: tr('skills.contribute_maint_note', 'I confirm maintenance responsibility.') },
        }) },
      ],
    });
    if (typeof renderMarkdown !== 'function') throw new Error('contribution requires renderMarkdown');
    const termsHtml = renderMarkdown(terms.body_markdown);
    const termsDialog = modal({
      title: tr('skills.contribute_terms_title', 'Community Contribution Terms'),
      description: `${tr('skills.contribute_terms_version', 'Version')} ${terms.version}`,
      size: 'lg', bodyHtml: `<div class="contribution-declarations"><article class="markdown-body">${termsHtml}</article>${declarationsForm}</div>`,
      actions: [{ id: 'cancel', label: tr('common.cancel', 'Cancel') }, { id: 'accept', label: tr('common.confirm', 'Confirm'), role: 'primary' }],
    });
    if ((await termsDialog).value !== 'accept') return false;
    const acceptedTerms = termsDialog.overlay.querySelector('#contribution-accept-terms')?.checked === true;
    const acceptedMaintenance = termsDialog.overlay.querySelector('#contribution-confirm-maintenance')?.checked === true;
    if (!acceptedTerms || !acceptedMaintenance) {
      await root.uiAlert(tr('skills.contribute_declarations_required', 'Accept the terms and confirm maintenance responsibility before continuing.'));
      return false;
    }
    await root.cogseed.invoke('contribution.declare', { token, kind: 'terms' });
    await root.cogseed.invoke('contribution.declare', { token, kind: 'maintenance' });
    const confirmed = await root.cogseed.invoke('contribution.confirm', { token, digest: preview.digest });
    return confirmed?.confirmed === true;
  }

  async function startSkillContribution(skillId, name, targetContentId, previousOrigin) {
    let token = null;
    try {
      const preflight = await ensureIdentity(name);
      if (!preflight) return;
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
        bodyHtml: root.uiSkeleton({ ariaLabel: tr('skills.contribute_checking', 'Running local checks'), lines: [54, 92, 78] }),
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
        if (state) await root.uiAlert(admissionDetails(state));
        return;
      }
      const origin = await chooseOrigin(token, state, previousOrigin);
      if (!origin) return;
      if (!await confirmPreview(token, name, state, termsResponse.state.terms, origin,
        state.identity?.displayName || preflight.identity?.displayName)) return;
      let replaceConfirmed = false;
      for (;;) {
        const upload = modal({
          title: tr('skills.contribute_uploading', 'Uploading contribution'),
          description: tr('skills.contribute_uploading_hint', 'Keep this window open until Hub confirms receipt.'),
          dismissible: false,
          bodyHtml: root.uiSkeleton({ ariaLabel: tr('skills.contribute_uploading', 'Uploading contribution'), lines: [62, 88] }),
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
          ? tr('skills.contribute_lifecycle_recovery_notice', 'This content is {status}. A higher-version submission still requires a governance role to restore availability after publication.')
            .replace('{status}', tr(`skills.contribute_lifecycle.${contentStatus}`, contentStatus))
          : '';
        const actions = [
          contentId ? { label: status.toUpperCase() === 'RETURNED'
            ? tr('skills.contribute_resubmit', 'Revise and resubmit')
            : tr('skills.contribute_new_version', 'Submit new version'), attrs: { 'data-contribution-new-version': contentId, 'data-contribution-index': index } } : null,
          !contentId && status.toUpperCase() === 'RETURNED'
            ? { label: tr('skills.contribute_resubmit', 'Revise and resubmit'), attrs: { 'data-contribution-resubmit': true } } : null,
          submissionId && status.toUpperCase() === 'PENDING_REVIEW'
            ? { label: tr('skills.contribute_withdraw_pending', 'Withdraw submission'), role: 'danger', attrs: { 'data-contribution-withdraw-pending': submissionId } } : null,
          contentId && contentStatus === 'published' && String(withdrawal.status || '').toUpperCase() !== 'PENDING'
            ? { label: tr('skills.contribute_request_withdrawal', 'Request withdrawal'), role: 'danger', attrs: { 'data-contribution-request-withdrawal': contentId } } : null,
          contentId ? { label: tr('skills.contribute_withdrawal_history', 'Withdrawal history'), attrs: { 'data-contribution-withdrawal-history': contentId } } : null,
        ].filter(Boolean);
        return root.uiResourceCard({
          title,
          description: [
            String(item.entry_id || contentId || submissionId || ''),
            item.current_published_version ? `${tr('skills.contribute_published_version', 'Published version')}: ${String(item.current_published_version)}` : '',
            withdrawal.status ? `${tr('skills.contribute_withdrawal_status', 'Withdrawal')}: ${tr(`skills.contribute_withdrawal_state.${String(withdrawal.status).toUpperCase()}`, String(withdrawal.status))}` : '',
            lifecycleNote,
            String(withdrawal.rejected_reason || latest.returned_reason || item.reason || item.review_reason || item.description || ''),
          ].filter(Boolean).join(' '),
          status: statusDescriptor(status),
          actions,
        });
      }).join(''),
    }) : root.uiEmptyState({ title: tr('skills.contribute_mine_empty', 'No contributions yet') });
    const dialog = modal({
      title: tr('skills.contribute_mine', 'My contributions'),
      description: response?.stale
        ? `${tr('skills.contribute_mine_stale', 'Showing the last saved result because Hub could not be refreshed.')} ${String(response?.cache?.generated_at || '')}`.trim()
        : '',
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
        dialog.close('new-version', 'programmatic');
        return chooseLocalSkill(newVersion.dataset.contributionNewVersion, item?.latest_submission?.declarations_origin || null);
      }
      const resubmit = event.target.closest('[data-contribution-resubmit]');
      if (resubmit) {
        dialog.close('resubmit', 'programmatic');
        return chooseLocalSkill();
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
          title: tr('skills.contribute_withdrawal_record', 'Withdrawal request'),
          description: [String(row.requested_at || ''), String(row.rejected_reason || row.reason || '')].filter(Boolean).join(' · '),
          status: statusDescriptor(row.status, 'skills.contribute_withdrawal_state'),
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
