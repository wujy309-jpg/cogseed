/** restricted 本体值进入渲染副本及知识索引时的授权边界。 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const kbEnqueue = vi.fn();
const searchUpsert = vi.fn();
const searchDrop = vi.fn();

vi.mock('../../src/main/features/kb_indexer', () => ({
  enqueue: (...args: unknown[]) => kbEnqueue(...args),
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../src/main/features/search', () => ({
  upsertContext: (...args: unknown[]) => searchUpsert(...args),
  dropContext: (...args: unknown[]) => searchDrop(...args),
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-user-002';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1b-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  kbEnqueue.mockClear();
  searchUpsert.mockClear();
  searchDrop.mockClear();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function renderCopy(groupId: string): string {
  return path.join(tmpDir, UID, 'cloud', 'contexts', '.personal_ontology_groups', `${groupId}.md`);
}

async function loadGroups() {
  return import('../../src/main/features/personal_ontology_groups');
}
async function loadApi() {
  return import('../../src/main/features/po/api');
}

describe('restricted 值进入渲染副本与 KB 索引钩子', () => {
  it.skip('restricted 值原文写入 md 副本，且 search/kb 索引钩子被调用', async () => {
    const groups = await loadGroups();
    const api = await loadApi();
    const created = await groups.createGroup(UID, '隐私探针组');
    const groupId = created.group!.group_id;

    const field = await api.poCreateField(UID, groupId, '健康状况');
    expect(field.ok).toBe(true);
    const fieldId = field.field!.id;

    // 正常通道写入两条：一条普通、一条标记 restricted（仅自己可见）。
    const plain = await api.poAddValue(UID, groupId, fieldId, { text: '常驻城市上海' });
    expect(plain.ok).toBe(true);
    const secret = await api.poAddValue(UID, groupId, fieldId, { text: '有慢性病史仅自己可知' });
    expect(secret.ok).toBe(true);
    const secretId = secret.value!.id;
    // 官方语义：restricted 值「不进任务注入与世界模型」。
    const mark = await api.poUpdateValue(UID, groupId, secretId, { sensitivity: 'restricted' });
    expect(mark.ok).toBe(true);

    // 读渲染副本（kb 索引 / transcript 术语桥 / 会议引用检索消费的那份文件）。
    const copy = fs.readFileSync(renderCopy(groupId), 'utf8');
    expect(copy).toContain('常驻城市上海');
    // 若副本侧有过滤，下面两条应失败——restricted 值的原文与标记都进了副本：
    expect(copy).toContain('有慢性病史仅自己可知');
    expect(copy).toMatch(/@restricted/);
    // 再验证标记确实挂在 restricted 值上（不是普通值）：
    const doc = JSON.parse(fs.readFileSync(
      path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json'), 'utf8'));
    const group = doc.groups.find((g: any) => g.id === groupId);
    expect(group.values.find((v: any) => v.restricted === true).text).toBe('有慢性病史仅自己可知');

    // 索引钩子：editPoDoc 写路径对副本调用 search.upsertContext + kbIndexer.enqueue。
    const upsertCalls = searchUpsert.mock.calls.map((c) => String(c[1]));
    const kbCalls = kbEnqueue.mock.calls.map((c) => String(c[1]));
    expect(upsertCalls).toContain(`.personal_ontology_groups/${groupId}.md`);
    expect(kbCalls).toContain(`.personal_ontology_groups/${groupId}.md`);
  });
});
