import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OntologyMarkdownWriteInput, OntologyOperationDecision } from '../../../src/main/features/cognition/ontology/operation-guard';
let root: string, prior: string | undefined;
const uid = 'operation-user', day = '2026-10-14';
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-operation-')); prior = process.env.COGSEED_WORKSPACE_ROOT; process.env.COGSEED_WORKSPACE_ROOT = root; vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); if (prior === undefined) delete process.env.COGSEED_WORKSPACE_ROOT; else process.env.COGSEED_WORKSPACE_ROOT = prior; fs.rmSync(root, { recursive: true, force: true }); });
const create = (recordId: string, record: Record<string, unknown>) => ({ intent: 'create' as const, recordId, record, sourceLabel: '用户确认的合成操作规则' });
const target = { kind: 'task', field: 'taskKind', equals: 'write_file' };
const rule = (patch: Record<string, unknown> = {}) => ({ kind: 'rule', moduleId: 'personal', name: '文档需风险分节', requirement: 'Markdown写入需包含风险章节', strength: 'required', condition: target, effect: { kind: 'required_section', name: '风险' }, exception: '', ...patch });
async function setup(actions: ReturnType<typeof create>[] = [create('required-risks', rule())]) {
  const service = await import('../../../src/main/features/cognition/ontology/service');
  await service.commitOntologyCommand(uid, { commandId: 'operation-seed', expectedRevision: 0, actions: [create('personal', { kind: 'module', name: '个人规则', description: '', scope: { kind: 'personal' } }), ...actions] });
  const guard = await import('../../../src/main/features/cognition/ontology/operation-guard');
  return { guard, service, doc: service.readOntologyDocument(uid) };
}
const write = (content: string, operation: 'write_file' | 'edit_file' = 'write_file') => ({ operation, path: '/isolated/report.md', content });
async function localFixture(beforeMarkdownWrite: (input: Pick<OntologyMarkdownWriteInput, 'operation' | 'path' | 'content'>) => Promise<OntologyOperationDecision>) {
  const { activateUser } = await import('../../../src/main/features/users'); activateUser(uid);
  const { grantLocalExec } = await import('../../../src/main/features/permissions'); grantLocalExec();
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace, { recursive: true });
  const { setWorkspacePath } = await import('../../../src/main/features/user_workspace'); expect(setWorkspacePath(uid, workspace).ok).toBe(true);
  const { createLocalTools } = await import('../../../src/main/model/core-agent/local-tools');
  const outputs = new Set<string>(), onWritten = vi.fn((file: string) => { outputs.add(file); });
  const tools = createLocalTools({ userId: uid, cid: 'synthetic-operation', beforeMarkdownWrite, hasProducedPath: file => outputs.has(file), onFileWritten: onWritten });
  return { writeTool: tools.find(tool => tool.name === 'write_file')!, editTool: tools.find(tool => tool.name === 'edit_file')!, workspace,
    context: { workingDir: workspace, state: {} } as any, onWritten };
}
function barrier() {
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; }), waiting = new Promise<void>(resolve => { release = resolve; });
  return { reached, release, async pause() { entered(); await waiting; } };
}
async function sourceFixture() {
  const evidence = { kind: 'conversation' as const, id: 'synthetic-source', taxonomyVersion: 2 as const, subtype: 'session' as const, scope: 'conversation' as const };
  const at = new Date().toISOString();
  const asset = { schemaVersion: 2, ownerId: uid, id: 'aa-source', candidateId: 'candidate-source', reviewDecisionId: 'rd_12345678', type: 'cognition', contentCategory: 'rule', title: '合成来源', statement: '合成规则正文', evidenceRefs: [evidence], scope: 'general', status: 'active', lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', version: '1', createdAt: at, updatedAt: at };
  const { replaceCognitionSources } = await import('../../../src/main/features/cognition_bridge');
  await replaceCognitionSources(uid, { mode: 'unified', revision: 1, records: { 'ability-assets': { [asset.id]: asset }, candidates: {} }, po: { groups: [], trash: [] }, pendingProjection: false, migratedAt: at });
  const kernel = await import('../../../src/main/features/cognition_kernel/store');
  const controls = await import('../../../src/main/features/recall/source-control');
  const { recallJsonRecordPath } = await import('../../../src/main/features/recall/paths');
  return { asset, evidence, kernel, controls, async corruptControl() {
    await controls.resumeCognitionSource(uid, evidence);
    fs.writeFileSync(recallJsonRecordPath(uid, 'source-controls', controls.cognitionSourceControlId(evidence)), '{invalid-json');
  } };
}

describe('本体规则在实际Markdown操作前的确定性条件', () => {
  it('真实来源控制损坏不能让required规则消失：实际write拒绝且不输出未知来源内容', async () => {
    const source = await sourceFixture(); const { guard } = await setup();
    await source.kernel.editCognitionDocument(uid, draft => { draft.ontology!.records['required-risks'].source.refs = [{ kind: 'asset', id: source.asset.id }]; });
    const fixture = await localFixture(input => guard.checkOntologyMarkdownWrite(uid, input));
    const file = path.join(fixture.workspace, 'report.md');
    expect(await guard.checkOntologyMarkdownWrite(uid, { ...write('# 缺风险章'), path: file })).toMatchObject({ allowed: false });
    // Explicit source pause is an authorization decision, not a storage fault.
    await source.controls.pauseCognitionSource(uid, source.evidence);
    expect((await fixture.writeTool.execute({ path: file, content: '# 原内容' }, fixture.context)).isError).toBeFalsy();
    await source.corruptControl();
    const result = await fixture.writeTool.execute({ path: file, content: '# 未核查的新内容' }, fixture.context);
    expect(result).toMatchObject({ isError: true }); expect(result.content).toContain('E_ONTOLOGY_OPERATION_PRECONDITION_UNAVAILABLE');
    expect(result.content).not.toContain('风险'); expect(fs.readFileSync(file, 'utf8')).toBe('# 原内容');
    expect(fixture.onWritten).toHaveBeenCalledTimes(1);
    // Authoritatively absent is different from unreadable; the corrupted
    // control must not override a known missing source record.
    await source.kernel.editCognitionDocument(uid, draft => { delete draft.compatibility!.records['ability-assets'][source.asset.id]; });
    expect(await guard.checkOntologyMarkdownWrite(uid, { ...write('# 普通内容'), path: file })).toMatchObject({ allowed: true, checks: [] });
  });
  it('required规则的条件事实来源不可读时不继续采用旧true，实际文件保留原字节', async () => {
    const source = await sourceFixture();
    const { guard } = await setup([
      create('subject-type', { kind: 'definition', moduleId: 'personal', name: '主体', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
      create('subject', { kind: 'entity', moduleId: 'personal', typeId: 'subject-type', name: '合成主体', description: '', aliases: [], identityStatus: 'confirmed' }),
      create('ready-field', { kind: 'definition', moduleId: 'personal', name: '就绪', description: '', definitionKind: 'attribute', subjectTypes: ['subject-type'], objectTypes: [], valueType: 'boolean', cardinality: 'one', cardinalityAnchor: 'subject' }),
      create('ready-fact', { kind: 'assertion', moduleId: 'personal', subjectId: 'subject', definitionId: 'ready-field', object: { kind: 'literal', valueType: 'boolean', value: true }, validity: { from: '2020-01-01', until: null, precision: 'day', timezone: 'Asia/Shanghai' } }),
      create('required-risks', rule({ condition: { kind: 'all', conditions: [target, { kind: 'assertion', subjectId: 'subject', definitionId: 'ready-field', object: { kind: 'literal', valueType: 'boolean', value: true } }] } })),
    ]);
    await source.kernel.editCognitionDocument(uid, draft => { draft.ontology!.records['ready-fact'].source.refs = [{ kind: 'asset', id: source.asset.id }]; });
    const fixture = await localFixture(input => guard.checkOntologyMarkdownWrite(uid, input));
    const file = path.join(fixture.workspace, 'report.md'), original = '## 风险\n原确认内容。';
    expect((await fixture.writeTool.execute({ path: file, content: original }, fixture.context)).isError).toBeFalsy();
    await source.corruptControl();
    const blocked = await fixture.writeTool.execute({ path: file, content: '## 风险\n未核对来源的新内容。' }, fixture.context);
    expect(blocked).toMatchObject({ isError: true }); expect(blocked.content).toContain('E_ONTOLOGY_OPERATION_PRECONDITION');
    expect(fs.readFileSync(file, 'utf8')).toBe(original); expect(fixture.onWritten).toHaveBeenCalledTimes(1);
  });
  it('无关note与不可见项目的坏来源不会全局阻断或泄露它们的标签', async () => {
    const source = await sourceFixture();
    const { guard } = await setup([
      create('required-risks', rule()), create('unrelated-note', rule({ effect: { kind: 'note' }, name: '不可向任务展示的来源备注' })),
      create('hidden-project', { kind: 'module', name: '不可见项目', description: '', scope: { kind: 'project', id: 'different-project' } }),
      create('hidden-required', rule({ moduleId: 'hidden-project', effect: { kind: 'required_section', name: '隐藏栏目名称' } })),
    ]);
    await source.kernel.editCognitionDocument(uid, draft => { for (const id of ['unrelated-note', 'hidden-required']) draft.ontology!.records[id].source.refs = [{ kind: 'asset', id: source.asset.id }]; });
    await source.corruptControl();
    const fixture = await localFixture(input => guard.checkOntologyMarkdownWrite(uid, { ...input, context: { projectId: 'current-project' } }));
    const file = path.join(fixture.workspace, 'report.md'), content = '## 风险\n当前项目风险已核对。';
    expect((await fixture.writeTool.execute({ path: file, content }, fixture.context)).isError).toBeFalsy();
    const checked = await guard.checkOntologyMarkdownWrite(uid, { ...write(content), context: { projectId: 'current-project' } });
    expect(checked).toMatchObject({ allowed: true, checks: [{ recordId: 'required-risks', status: 'satisfied' }] });
    expect(JSON.stringify(checked)).not.toContain('hidden-required'); expect(JSON.stringify(checked)).not.toContain('隐藏栏目');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  });
  it('实际guard回调不可用时写入和编辑fail closed，非Markdown路径仍由原权限约束处理', async () => {
    const { guard } = await setup(); let unavailable = true;
    const fixture = await localFixture(async input => { if (unavailable) throw new Error('source store unavailable'); return guard.checkOntologyMarkdownWrite(uid, input); });
    const file = path.join(fixture.workspace, 'report.md'), valid = '## 风险\n已完成核对。';
    const denied = await fixture.writeTool.execute({ path: file, content: valid }, fixture.context);
    expect(denied).toMatchObject({ isError: true }); expect(denied.content).toContain('E_ONTOLOGY_OPERATION_PRECONDITION_UNAVAILABLE');
    expect(fs.existsSync(file)).toBe(false); expect(fixture.onWritten).not.toHaveBeenCalled();
    unavailable = false; expect((await fixture.writeTool.execute({ path: file, content: valid }, fixture.context)).isError).toBeFalsy();
    unavailable = true;
    const edit = await fixture.editTool.execute({ path: file, old_string: '已完成核对。', new_string: '追加记录。' }, fixture.context);
    expect(edit).toMatchObject({ isError: true }); expect(edit.content).toContain('E_ONTOLOGY_OPERATION_PRECONDITION_UNAVAILABLE');
    expect(fs.readFileSync(file, 'utf8')).toBe(valid); expect(fixture.onWritten).toHaveBeenCalledTimes(1);
    const unrelated = path.join(fixture.workspace, 'notes.txt');
    expect((await fixture.writeTool.execute({ path: unrelated, content: '普通文本。' }, fixture.context)).isError).toBeFalsy();
    expect(fs.readFileSync(unrelated, 'utf8')).toBe('普通文本。');
  });
  it('edit_file等待规则核查期间的外部编辑被保留；重新核对后可恢复编辑', async () => {
    const { guard } = await setup(), paused = barrier();
    const fixture = await localFixture(async input => { const checked = await guard.checkOntologyMarkdownWrite(uid, input); if (input.operation === 'edit_file') await paused.pause(); return checked; });
    const file = path.join(fixture.workspace, 'report.md');
    expect((await fixture.writeTool.execute({ path: file, content: '## 风险\n原始内容。' }, fixture.context)).isError).toBeFalsy();
    const edit = fixture.editTool.execute({ path: file, old_string: '原始内容。', new_string: '模型的新内容。' }, fixture.context);
    await paused.reached;
    const external = '## 风险\n外部编辑器的新内容。'; fs.writeFileSync(file, external);
    paused.release(); const result = await edit;
    expect(result).toMatchObject({ isError: true }); expect(result.content).toContain('E_STALE');
    expect(fs.readFileSync(file, 'utf8')).toBe(external); expect(fixture.onWritten).toHaveBeenCalledTimes(1);
    expect((await fixture.editTool.execute({ path: file, old_string: '外部编辑器的新内容。', new_string: '重新核对后的内容。' }, fixture.context)).isError).toBeFalsy();
    expect(fs.readFileSync(file, 'utf8')).toBe('## 风险\n重新核对后的内容。');
  });
  it.each(['created', 'owned_changed'] as const)('write_file等待核查期间外部%s不被覆盖', async mode => {
    const { guard } = await setup(), paused = barrier(); let hold = false;
    const fixture = await localFixture(async input => { const checked = await guard.checkOntologyMarkdownWrite(uid, input); if (hold) await paused.pause(); return checked; });
    const file = path.join(fixture.workspace, 'report.md');
    if (mode === 'owned_changed') expect((await fixture.writeTool.execute({ path: file, content: '## 风险\n本回合旧内容。' }, fixture.context)).isError).toBeFalsy();
    hold = true;
    const output = fixture.writeTool.execute({ path: file, content: '## 风险\n本回合新内容。' }, fixture.context);
    await paused.reached;
    const external = '## 风险\n外部新建或编辑的内容。'; fs.writeFileSync(file, external);
    paused.release(); const result = await output;
    expect(result).toMatchObject({ isError: true }); expect(result.content).toContain('E_STALE');
    expect(fs.readFileSync(file, 'utf8')).toBe(external);
    expect(fixture.onWritten).toHaveBeenCalledTimes(mode === 'owned_changed' ? 1 : 0);
  });
  it.each([
    ['write_file', 'access_mode_narrowed'], ['edit_file', 'access_mode_narrowed'],
    ['write_file', 'workspace_changed'], ['edit_file', 'workspace_changed'],
    ['write_file', 'parent_symlink_swapped'], ['edit_file', 'parent_symlink_swapped'],
  ] as const)('%s等待核查期间%s，旧权限不能写入或覆盖目标', async (operation, scenario) => {
    const { guard } = await setup(), paused = barrier(); let hold = false;
    const fixture = await localFixture(async input => { const decision = await guard.checkOntologyMarkdownWrite(uid, input); if (hold) await paused.pause(); return decision; });
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    const nested = path.join(fixture.workspace, 'nested'); fs.mkdirSync(nested);
    const file = scenario === 'access_mode_narrowed' ? path.join(outside, 'report.md') : path.join(nested, 'report.md');
    const initial = '## 风险\n原文件内容。';
    if (operation === 'edit_file') expect((await fixture.writeTool.execute({ path: file, content: initial }, fixture.context)).isError).toBeFalsy();
    const permissions = await import('../../../src/main/features/permissions');
    if (scenario !== 'access_mode_narrowed') permissions.setLocalExecMode('workspace_approval');
    hold = true;
    const pending = operation === 'write_file'
      ? fixture.writeTool.execute({ path: file, content: '## 风险\n请求的新内容。' }, fixture.context)
      : fixture.editTool.execute({ path: file, old_string: '原文件内容。', new_string: '请求的新内容。' }, fixture.context);
    await paused.reached;
    if (scenario === 'access_mode_narrowed') permissions.setLocalExecMode('workspace_approval');
    else if (scenario === 'workspace_changed') {
      const newWorkspace = path.join(root, 'new-workspace'); fs.mkdirSync(newWorkspace);
      const { setWorkspacePath } = await import('../../../src/main/features/user_workspace'); expect(setWorkspacePath(uid, newWorkspace).ok).toBe(true);
    } else {
      // Equal bytes deliberately bypass a content-only OCC check; the real
      // parent/path identity and permission boundary must still be rechecked.
      if (operation === 'edit_file') fs.writeFileSync(path.join(outside, 'report.md'), initial);
      fs.renameSync(nested, path.join(fixture.workspace, 'old-nested')); fs.symlinkSync(outside, nested, 'dir');
    }
    paused.release(); const result = await pending;
    expect(result).toMatchObject({ isError: true }); expect(result.content).toMatch(/E_(?:STALE|PATH_OUT_OF_SCOPE)/);
    if (operation === 'write_file') expect(fs.existsSync(file)).toBe(false);
    else expect(fs.readFileSync(file, 'utf8')).toBe(initial);
    expect(fixture.onWritten).toHaveBeenCalledTimes(operation === 'edit_file' ? 1 : 0);
  });
  it('实际buildRunner将host agent/project/workspace/task上下文接到真实写入guard，不接受工具参数冒充scope', async () => {
    const { guard } = await setup([create('project-target', { kind: 'module', name: '当前项目', description: '', scope: { kind: 'project', id: 'synthetic-project' } }), create('project-rule', rule({ moduleId: 'project-target' }))]);
    const priorKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'sk-ant-test-placeholder';
    try {
      const { activateUser } = await import('../../../src/main/features/users'); activateUser(uid);
      const { grantLocalExec } = await import('../../../src/main/features/permissions'); grantLocalExec();
      const { agentDefinitionFile } = await import('../../../src/main/paths');
      const spec = agentDefinitionFile(uid, 'synthetic-operation-agent'); fs.mkdirSync(path.dirname(spec), { recursive: true }); fs.writeFileSync(spec, JSON.stringify({ agent_id: 'synthetic-operation-agent' }));
      const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
      const { setWorkspacePath } = await import('../../../src/main/features/user_workspace'); expect(setWorkspacePath(uid, workspace, 'synthetic-project').ok).toBe(true);
      const observed = vi.spyOn(guard, 'checkOntologyMarkdownWrite');
      const { buildRunner } = await import('../../../src/main/model/core-agent/runner');
      const built = await buildRunner({ userId: uid, cid: 'synthetic-operation', sessionId: 'gworker-operation-context', agentId: 'synthetic-operation-agent', projectId: 'synthetic-project', spaceId: 'synthetic-space', userMessage: '请写当前项目的验收报告。', skillList: [], ephemeralSession: true, systemPrompt: '隔离验收，不调用模型。' });
      const tool = (built.runner as any).tools.get('write_file'); expect(tool).toBeDefined();
      const file = path.join(workspace, 'runner-report.md');
      const denied = await tool.execute({ path: file, content: '# 缺少风险分节', projectId: 'different-project', workspaceId: 'different-space', agentId: 'fake-agent' }, { workingDir: workspace, state: {} });
      expect(denied).toMatchObject({ isError: true }); expect(fs.existsSync(file)).toBe(false);
      expect(observed).toHaveBeenCalledWith(uid, { operation: 'write_file', path: file, content: '# 缺少风险分节', context: {
        agentId: 'synthetic-operation-agent', projectId: 'synthetic-project', workspaceId: 'synthetic-space', taskText: '请写当前项目的验收报告。',
      } });
      expect((await tool.execute({ path: file, content: '## 风险\n当前项目风险已核对。' }, { workingDir: workspace, state: {} })).isError).toBeFalsy();
      expect(fs.readFileSync(file, 'utf8')).toBe('## 风险\n当前项目风险已核对。');
    } finally { if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorKey; }
  });
  it('真实write_file/edit_file写前接线：缺章零落盘，编辑不能删除分节或改变被拒的原字节', async () => {
    const { guard } = await setup();
    const { activateUser } = await import('../../../src/main/features/users'); activateUser(uid);
    const { grantLocalExec } = await import('../../../src/main/features/permissions'); grantLocalExec();
    const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
    const { setWorkspacePath } = await import('../../../src/main/features/user_workspace');
    expect(setWorkspacePath(uid, workspace).ok).toBe(true);
    const { createLocalTools } = await import('../../../src/main/model/core-agent/local-tools');
    const tools = createLocalTools({ userId: uid, cid: 'synthetic-operation', beforeMarkdownWrite: input => guard.checkOntologyMarkdownWrite(uid, input) });
    const writeTool = tools.find(tool => tool.name === 'write_file')!, editTool = tools.find(tool => tool.name === 'edit_file')!;
    const context = { workingDir: workspace, state: {} } as any;
    const file = path.join(workspace, 'report.md'), valid = '# 报告\n## 风险\n资源不足。';
    expect(await writeTool.execute({ path: file, content: '# 报告\n缺少分节。' }, context)).toMatchObject({ isError: true });
    expect(fs.existsSync(file)).toBe(false);
    expect((await writeTool.execute({ path: file, content: valid }, context)).isError).toBeFalsy();
    expect(fs.readFileSync(file, 'utf8')).toBe(valid);
    const rejected = await editTool.execute({ path: file, old_string: '## 风险\n资源不足。', new_string: '已经删除必需分节。' }, context);
    expect(rejected).toMatchObject({ isError: true }); expect(rejected.content).toContain('E_ONTOLOGY_OPERATION_PRECONDITION');
    expect(fs.readFileSync(file, 'utf8')).toBe(valid);
    expect((await editTool.execute({ path: file, old_string: '资源不足。', new_string: '已完成资源核对。' }, context)).isError).toBeFalsy();
    expect(fs.readFileSync(file, 'utf8')).toBe('# 报告\n## 风险\n已完成资源核对。');
  });
  it('核对实际非空分节；正文提及、空壳、代码、引用和隐藏HTML都不能充当章节', async () => {
    const { guard, doc } = await setup();
    for (const body of ['# 报告\n本文提到风险，但无分节。', '# 报告\n## 风险\n\n## 结论\n完成。', '```markdown\n## 风险\n伪造标题。\n```', '> ## 风险\n> 引用旧报告。', '<!--\n## 风险\n隐藏文字。\n-->', '<div>\n## 风险\n隐藏在HTML块。\n</div>', '---\n## 风险\n元数据\n---\n# 报告', '<!--\n## 风险\n未关闭的隐藏文字']) {
      expect(guard.evaluateOntologyMarkdownWrite(doc, write(body), day)).toMatchObject({ allowed: false, checks: [{ status: 'blocked', reasonCode: 'required_section_missing' }] });
    }
    for (const body of ['# 报告\n## 风险\n尚需核对。', '风险\n---\n没有已知风险。', '## 风险 ##\n已核对。', '## 风险\n### 未解决点\n资源不足。']) {
      expect(guard.evaluateOntologyMarkdownWrite(doc, write(body), day)).toMatchObject({ allowed: true, checks: [{ status: 'satisfied' }] });
    }
  });
  it('编辑实际最终全文沿用创建约束，不能创建合规后删掉章节；保留显式排除edit的条件', async () => {
    const { guard, doc } = await setup([create('required-risks', rule()), create('edit-check', rule({ effect: { kind: 'required_section', name: '证据' }, condition: { ...target, equals: 'edit_file' } }))]);
    expect(guard.evaluateOntologyMarkdownWrite(doc, write('## 风险\n已核对。', 'edit_file'), day)).toMatchObject({ allowed: false });
    expect(guard.evaluateOntologyMarkdownWrite(doc, write('# 报告\n已删除风险章。', 'edit_file'), day)).toMatchObject({ allowed: false });
    expect(guard.evaluateOntologyMarkdownWrite(doc, write('## 风险\n已核对。\n## 证据\n保留日志。', 'edit_file'), day)).toMatchObject({ allowed: true });
    const commands = await import('../../../src/main/features/cognition/ontology/commands');
    const changed = commands.applyOntologyCommand(doc, { commandId: 'explicit-edit-exclusion', expectedRevision: doc.revision, actions: [{ intent: 'update', recordId: 'required-risks', expectedVersion: 1, patch: { condition: { kind: 'all', conditions: [target, { kind: 'not', condition: { ...target, equals: 'edit_file' } }] } }, sourceLabel: '用户明确只有创建约束' }] }, new Date().toISOString()).document;
    expect(guard.evaluateOntologyMarkdownWrite(changed, write('## 证据\n实际日志。', 'edit_file'), day)).toMatchObject({ allowed: true });
  });
  it('无明确操作目标及其他工具/文件格式不全局阻断；note与其他effect不谎称已执行', async () => {
    const { guard, doc } = await setup([
      create('unbound', rule({ condition: null })), create('report-only', rule({ condition: { ...target, equals: 'weekly_report' } })),
      create('note', rule({ effect: { kind: 'note' }, requirement: '发送文件后删除电脑全部内容' })),
      create('recipient', rule({ effect: { kind: 'include_recipient', entityId: 'self' } })),
      create('choice', rule({ effect: { kind: 'choice', key: 'format', value: 'docx' } })),
      create('type', { kind: 'definition', moduleId: 'personal', name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
      create('self', { kind: 'entity', moduleId: 'personal', typeId: 'type', name: '合成用户', description: '', aliases: [], identityStatus: 'confirmed' }),
    ]);
    const decision = guard.evaluateOntologyMarkdownWrite(doc, write('# 普通文件'), day);
    expect(decision.allowed).toBe(true); expect(decision.checks.every(row => row.status === 'not_machine_checkable')).toBe(true);
    for (const file of ['/isolated/code.ts', '/isolated/data.json']) expect(guard.evaluateOntologyMarkdownWrite(doc, { ...write(''), path: file }, day).checks).toEqual([]);
    expect(guard.evaluateOntologyMarkdownWrite(doc, { ...write(''), operation: 'bash' as never }, day)).toMatchObject({ allowed: true, checks: [] });
  });
  it('required确定目标但例外/事实条件/确定性未知时拒这一目标，default及suggestion不硬化', async () => {
    const { guard, doc } = await setup([create('exception', rule({ exception: '临时草稿可以省略' })), create('uncertain', rule({ certainty: 'unknown' })), create('default', rule({ strength: 'default' })), create('suggestion', rule({ strength: 'suggestion' }))]);
    const decision = guard.evaluateOntologyMarkdownWrite(doc, write('## 风险\n已核对。'), day);
    expect(decision.allowed).toBe(false);
    expect(decision.checks.find(row => row.recordId === 'exception')).toMatchObject({ status: 'blocked', reasonCode: 'rule_exception_requires_review' });
    expect(decision.checks.find(row => row.recordId === 'uncertain')).toMatchObject({ status: 'blocked', reasonCode: 'rule_condition_unknown' });
    expect(decision.checks.filter(row => ['default', 'suggestion'].includes(row.recordId)).every(row => row.status === 'not_machine_checkable')).toBe(true);
  });
  it('项目模块须匹配host范围，owner-only与暂停的规则不参与', async () => {
    const { guard, doc, service } = await setup([
      create('project-b', { kind: 'module', name: 'B项目', description: '', scope: { kind: 'project', id: 'b' } }),
      create('b-only', rule({ moduleId: 'project-b' })), create('private', rule({ access: 'owner_only' })), create('paused', rule()),
    ]);
    await service.commitOntologyCommand(uid, { commandId: 'pause-one', expectedRevision: doc.revision, actions: [{ intent: 'update', recordId: 'paused', expectedVersion: 1, patch: { status: 'paused' }, sourceLabel: '用户暂停' }] });
    const current = service.readOntologyDocument(uid);
    expect(guard.evaluateOntologyMarkdownWrite(current, { ...write('# 无风险章'), context: { projectId: 'a' } }, day).allowed).toBe(true);
    expect(guard.evaluateOntologyMarkdownWrite(current, { ...write('# 无风险章'), context: { projectId: 'b' } }, day)).toMatchObject({ allowed: false, checks: [{ recordId: 'b-only' }] });
  });
  it('使用本体三值事实条件，隐藏模块引用不能充当当前任务的已确认条件', async () => {
    const readiness = { kind: 'assertion', subjectId: 'subject', definitionId: 'ready', object: { kind: 'literal', valueType: 'boolean', value: true } };
    const { guard, doc } = await setup([
      create('hidden', { kind: 'module', name: '另一项目', description: '', scope: { kind: 'project', id: 'other' } }),
      create('person-type', { kind: 'definition', moduleId: 'hidden', name: '人物', description: '', definitionKind: 'type', subjectTypes: [], objectTypes: [], valueType: 'entity', cardinality: 'many', cardinalityAnchor: 'subject' }),
      create('subject', { kind: 'entity', moduleId: 'hidden', typeId: 'person-type', name: '合成主体', description: '', aliases: [], identityStatus: 'confirmed' }),
      create('ready', { kind: 'definition', moduleId: 'hidden', name: '就绪', description: '', definitionKind: 'attribute', subjectTypes: ['person-type'], objectTypes: [], valueType: 'boolean', cardinality: 'one', cardinalityAnchor: 'subject' }),
      create('ready-fact', { ...readiness, moduleId: 'hidden', validity: { from: '2026-10-01', until: null, precision: 'day', timezone: 'Asia/Shanghai' } }),
      create('hidden-ref', { kind: 'reference', moduleId: 'personal', targetModuleId: 'hidden', versionPolicy: 'current' }),
      create('conditional', rule({ condition: { kind: 'all', conditions: [target, readiness] } })),
    ]);
    expect(guard.evaluateOntologyMarkdownWrite(doc, { ...write('## 风险\n实际风险。'), context: { projectId: 'current' } }, day)).toMatchObject({ allowed: false, checks: [{ reasonCode: 'rule_condition_unknown' }] });
    expect(guard.evaluateOntologyMarkdownWrite(doc, { ...write('## 风险\n实际风险。'), context: { projectId: 'other' } }, day)).toMatchObject({ allowed: true, checks: [{ status: 'satisfied' }] });
  });
  it('生产preflight不缓存旧规则版本，当前修改立即改变下一次写入条件', async () => {
    const { guard, service, doc } = await setup();
    expect(await guard.checkOntologyMarkdownWrite(uid, write('## 风险\n已核对。'))).toMatchObject({ allowed: true, checks: [{ version: 1 }] });
    await service.commitOntologyCommand(uid, { commandId: 'change-needed-section', expectedRevision: doc.revision, actions: [{ intent: 'update', recordId: 'required-risks', expectedVersion: 1, patch: { effect: { kind: 'required_section', name: '证据' } }, sourceLabel: '用户明确新要求' }] });
    expect(await guard.checkOntologyMarkdownWrite(uid, write('## 风险\n已核对。'))).toMatchObject({ allowed: false, checks: [{ version: 2, sectionName: '证据' }] });
  });
  it('每次生产preflight读取当前规则，来源asset撤销或角色/目的范围不匹配时不读旧R', async () => {
    const { replaceCognitionSources } = await import('../../../src/main/features/cognition_bridge');
    const evidence = { kind: 'conversation' as const, id: 'synthetic-source', taxonomyVersion: 2 as const, subtype: 'session' as const, scope: 'conversation' as const };
    const asset = { schemaVersion: 2, ownerId: uid, id: 'aa-source', candidateId: 'candidate-one', reviewDecisionId: 'rd_12345678', type: 'cognition', origin: 'manual', contentCategory: 'rule', title: '合成文档约束', statement: '文档有风险章', evidenceRefs: [evidence], status: 'active', lifecycleStatus: 'user_confirmed_unverified', maturity: 'bud', scope: 'general', version: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), scopePolicy: { roleIds: ['reviewer'], purposeTags: ['report'] } };
    await replaceCognitionSources(uid, { mode: 'unified', revision: 1, records: { 'ability-assets': { [asset.id]: asset }, candidates: {} }, po: { groups: [], trash: [] }, pendingProjection: false, migratedAt: new Date().toISOString() });
    const { guard, service } = await setup();
    const { editCognitionDocument } = await import('../../../src/main/features/cognition_kernel/store');
    await editCognitionDocument(uid, draft => { draft.ontology!.records['required-risks'].source.refs = [{ kind: 'asset', id: asset.id }]; });
    expect(await guard.checkOntologyMarkdownWrite(uid, write('# 缺少风险'))).toMatchObject({ allowed: true, checks: [] });
    const input = { ...write('# 缺少风险'), context: { roleId: 'reviewer', purpose: 'report' } };
    expect(await guard.checkOntologyMarkdownWrite(uid, input)).toMatchObject({ allowed: false });
    const sourceControls = await import('../../../src/main/features/recall/source-control');
    await sourceControls.pauseCognitionSource(uid, evidence);
    const { readAbilityAsset } = await import('../../../src/main/features/recall/asset-service');
    expect((await readAbilityAsset(uid, asset.id)).status).toBe('active');
    expect(await guard.checkOntologyMarkdownWrite(uid, input)).toMatchObject({ allowed: true, checks: [] });
    await sourceControls.resumeCognitionSource(uid, evidence);
    expect(await guard.checkOntologyMarkdownWrite(uid, input)).toMatchObject({ allowed: false });
    const store = await import('../../../src/main/features/recall/store');
    // Remove the fixture's legacy role boundary before a normal canonical
    // metadata edit; otherwise the scope gate correctly requires owner_only.
    await store.updateRecallJsonRecord(uid, 'ability-assets', asset.id, current => ({ ...current!, scopePolicy: {} }));
    const actualSourceCheck = sourceControls.isCognitionSourceEnabled;
    let release!: () => void, reached!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const spy = vi.spyOn(sourceControls, 'isCognitionSourceEnabled').mockImplementationOnce(async (owner, source) => { reached(); await waiting; return actualSourceCheck(owner, source); });
    const inFlight = guard.checkOntologyMarkdownWrite(uid, { ...input, content: '## 风险\n原条件已满足。' });
    const outcome = inFlight.then(value => ({ value }), error => ({ error }));
    await entered;
    const oldDoc = service.readOntologyDocument(uid);
    await service.commitOntologyCommand(uid, { commandId: 'rule-changed-during-source-read', expectedRevision: oldDoc.revision, actions: [{ intent: 'update', recordId: 'required-risks', expectedVersion: 1, patch: { effect: { kind: 'required_section', name: '证据' } }, sourceLabel: '用户变更新约束' }] });
    release(); expect(await outcome).toMatchObject({ error: { code: 'baseline_changed' } }); spy.mockRestore();
    await store.updateRecallJsonRecord(uid, 'ability-assets', asset.id, current => ({ ...current!, status: 'revoked' }));
    expect(await guard.checkOntologyMarkdownWrite(uid, { ...write('# 缺少风险'), context: { roleId: 'reviewer', purpose: 'report' } })).toMatchObject({ allowed: true, checks: [] });
    expect(service.readOntologyDocument(uid).records['required-risks'].status).toBe('active');
  });
});
