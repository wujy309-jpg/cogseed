import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowsDir = path.resolve('.github/workflows');

function load(name: string): any {
  return parse(fs.readFileSync(path.join(workflowsDir, name), 'utf8'), { version: '1.2' });
}

function steps(job: any): any[] {
  return Array.isArray(job?.steps) ? job.steps : [];
}

function commands(job: any): string {
  return steps(job).map((step) => step.run ?? '').join('\n');
}

function isWorkflowFile(name: string): boolean {
  return name.endsWith('.yml') || name.endsWith('.yaml');
}

describe('release workflow contract', () => {
  it('uses controlled discovery fixtures instead of requiring Codex on the CI runner', () => {
    const workflow = fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8');
    expect(workflow).not.toContain('diagnose-local-agents.mjs --json --only codex');
  });

  // 2026-09-28 方案 C：私仓 ci.yml 收敛为限成本门禁（Ubuntu-only），Windows
  // 打包验证改由 public-release.yml 的 build-windows 承担。断言意图不变——构建之后
  // 必须执行启动冒烟与 STT 冒烟，且不许静默失败——只是落点跟着架构搬家：
  // 继续在 ci.yml 里找 verify-windows 会指向一个已不存在的 job。
  it('runs blocking packaged launch and STT verifiers after the Windows build', () => {
    const windowsSteps = steps(load('public-release.yml').jobs['build-windows']) as Array<{ run?: string; 'continue-on-error'?: boolean }>;
    const buildIndex = windowsSteps.findIndex((step) => step.run === 'npm run build:win');
    const launchIndex = windowsSteps.findIndex((step) => step.run === 'npm run verify:package:launch');
    const smokeIndex = windowsSteps.findIndex((step) => step.run === 'npm run verify:package:stt:win');

    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(launchIndex).toBeGreaterThan(buildIndex);
    expect(smokeIndex).toBe(launchIndex + 1);
    // YAML 的 `continue-on-error` 解析后就是这个带连字符的键名；写成
    // `continueOnError` 永远取到 undefined，会让这条断言变成空断言。
    expect(windowsSteps[smokeIndex]['continue-on-error']).toBeUndefined();
  });

  it('discovers both .yml and .yaml workflow files', () => {
    expect(['a.yml', 'b.yaml', 'notes.md'].filter(isWorkflowFile)).toEqual(['a.yml', 'b.yaml']);
  });

  it.each(['ci.yml', 'compliance.yml'])('%s runs automatically only for cicd PRs and pushes', (name) => {
    const workflow = load(name);
    expect(workflow.on).toEqual({
      pull_request: { branches: ['cicd'] },
      push: { branches: ['cicd'] },
    });
  });

  it('keeps private CI lightweight and Ubuntu-only', () => {
    const workflow = load('ci.yml');
    expect(Object.keys(workflow.jobs)).toEqual(['verify']);
    expect(workflow.jobs.verify['runs-on']).toBe('ubuntu-24.04');
    expect(commands(workflow.jobs.verify)).toContain('npm ci --ignore-scripts');
    expect(commands(workflow.jobs.verify)).not.toMatch(/run-tests|test:js|test:resources/);
    expect(commands(workflow.jobs.verify)).toContain('node --test scripts/opensource/*.test.mjs');
    expect(commands(workflow.jobs.verify)).not.toContain('package:dev:mac');
    expect(JSON.stringify(workflow.jobs)).not.toContain('windows-latest');
  });

  it('does not run packaged macOS launch in private CI', () => {
    const macos = commands(load('ci.yml').jobs.verify);
    expect(macos).not.toContain('npm run package:dev:mac && npm run verify:package:dev:mac');
  });

  it('keeps compliance to its one required job', () => {
    expect(Object.keys(load('compliance.yml').jobs)).toEqual(['compliance']);
  });

  it('triggers the release workflow only for v* tags', () => {
    const workflow = load('public-release.yml');
    expect(workflow.on).toEqual({ push: { tags: ['v*'] } });
    expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(workflow.concurrency).toEqual({
      group: 'release-${{ github.ref }}',
      'cancel-in-progress': false,
    });
  });

  it('uses gate -> two builds -> one publisher and checks out the peeled SHA', () => {
    const workflow = load('public-release.yml');
    expect(Object.keys(workflow.jobs).sort()).toEqual(['build-macos', 'build-windows', 'gate', 'publish']);
    expect(workflow.jobs.gate.outputs['peeled-sha']).toContain('steps.verify.outputs.peeled-sha');
    for (const name of ['build-macos', 'build-windows']) {
      expect(workflow.jobs[name].needs).toBe('gate');
      const checkout = steps(workflow.jobs[name]).find((step) => step.uses === 'actions/checkout@v4');
      expect(checkout?.with?.ref).toBe('${{ needs.gate.outputs.peeled-sha }}');
      expect(steps(workflow.jobs[name]).some((step) => step.uses === 'actions/upload-artifact@v4')).toBe(true);
      expect(commands(workflow.jobs[name])).toContain('npm run verify:package:launch');
    }
    expect(commands(workflow.jobs['build-windows'])).toContain('npm run verify:package:stt:win');
    expect(workflow.jobs.publish.needs).toEqual(['gate', 'build-macos', 'build-windows']);
  });

  it('grants contents: write only to the sole publisher and has one Release action repository-wide', () => {
    const files = fs.readdirSync(workflowsDir).filter(isWorkflowFile);
    const releaseActions: Array<{ file: string; job: string }> = [];
    const writers: Array<{ file: string; job: string }> = [];
    for (const file of files) {
      const workflow = load(file);
      for (const [jobName, job] of Object.entries<any>(workflow.jobs ?? {})) {
        if (job?.permissions?.contents === 'write') writers.push({ file, job: jobName });
        for (const step of steps(job)) {
          if (String(step.uses ?? '').startsWith('softprops/action-gh-release@')) releaseActions.push({ file, job: jobName });
        }
      }
      expect(workflow.permissions?.contents).not.toBe('write');
    }
    expect(writers).toEqual([{ file: 'public-release.yml', job: 'publish' }]);
    expect(releaseActions).toEqual([{ file: 'public-release.yml', job: 'publish' }]);
    expect(load('public-release.yml').jobs.publish.permissions).toEqual({ actions: 'read', contents: 'write' });
  });

  it('checks the remote tag and existing Release before the sole pinned publisher action', () => {
    const workflow = load('public-release.yml');
    const publishSteps = steps(workflow.jobs.publish);
    const preflightIndex = publishSteps.findIndex((step) => String(step.run ?? '').includes('--publish-target'));
    const artifactValidationIndex = publishSteps.findIndex((step) => step.name === 'Validate release artifact set');
    const releaseIndex = publishSteps.findIndex((step) => String(step.uses ?? '').startsWith('softprops/action-gh-release@'));
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(preflightIndex).toBeGreaterThan(artifactValidationIndex);
    expect(preflightIndex).toBe(releaseIndex - 1);
    expect(publishSteps[preflightIndex].env.EXPECTED_SHA).toBe('${{ needs.gate.outputs.peeled-sha }}');
    expect(publishSteps[releaseIndex].uses).toBe('softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65');
    const source = fs.readFileSync(path.join(workflowsDir, 'public-release.yml'), 'utf8');
    expect(source).toContain('softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65 # v2');
  });

  it('makes the publisher validate exactly four mac files and one win-x64 exe before publishing the draft', () => {
    const publish = load('public-release.yml').jobs.publish;
    const script = commands(publish);
    expect(script).toContain('expected_files');
    for (const suffix of ['mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip', 'win-x64.exe']) {
      expect(script).toContain(suffix);
    }
    const action = steps(publish).find((step) => String(step.uses ?? '').startsWith('softprops/action-gh-release@'));
    expect(action.with.draft).toBe(true);
    expect(script).toContain('draft=false');
  });

  it('leaves the legacy mac workflow manual, read-only, and release-free', () => {
    const legacy = load('build-macos-signed.yml');
    expect(legacy.on).toEqual({ workflow_dispatch: null });
    expect(legacy.permissions).toEqual({ contents: 'read' });
    expect(JSON.stringify(legacy)).not.toContain('action-gh-release');
  });
});
