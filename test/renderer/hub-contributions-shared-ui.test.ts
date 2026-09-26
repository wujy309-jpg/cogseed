import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/modules/hub-contributions.js'), 'utf8');

describe('Hub contribution real-page shared UI adoption', () => {
  it('uses shared overlays, forms, decisions and resource cards', () => {
    for (const seam of ['uiModal', 'uiForm', 'uiField', 'uiConfirm', 'uiConfirmDanger', 'uiChoice', 'uiPrompt', 'uiProgressBar', 'uiResourceCard', 'uiResourceGrid', 'uiEmptyState']) {
      expect(source).toContain(seam);
    }
  });

  it('resumes the selected contribution only after the Hub login result succeeds', () => {
    expect(source).toContain("onPushEvent('hub-account:login-result'");
    expect(source).toContain("outcome?.result === 'success'");
    expect(source).toContain("root.cogseed.invoke('contribution.preflight'");
  });

  it('does not introduce raw controls, inline SVG, emoji icons or literal z-index', () => {
    expect(source).not.toMatch(/<button\b|<input\b|<textarea\b|<select\b/i);
    expect(source).not.toMatch(/<svg\b|z-index\s*:/i);
  });

  it('retries uncertain delivery through the same contribution session', () => {
    expect(source).toContain("submitted?.error?.retryable === true");
    expect(source).toContain("root.cogseed.invoke('contribution.submit'");
  });

  it('shows cancellable local-check progress before preview or submission', () => {
    expect(source).toContain('defer_check: true');
    expect(source).toContain("contribution.recheck");
    expect(source).toContain("contribution.cancel");
    expect(source.indexOf('defer_check: true')).toBeLessThan(source.indexOf("contribution.submit"));
  });

  it('shows cancellable upload progress and refreshes only while My Contributions is foregrounded', () => {
    expect(source).toContain("contribution.abortUpload");
    expect(source).toContain("skills.contribute_uploading");
    expect(source).toContain('55_000');
    expect(source).toContain("dialog.close('poll'");
    expect(source).toContain('clearTimeout(foregroundRefresh)');
  });
});
