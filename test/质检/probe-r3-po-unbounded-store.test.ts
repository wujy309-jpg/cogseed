/** 本体写入的条目数与字节容量边界。 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../src/main/features/kb_indexer', () => ({
  enqueue: () => {},
  kbEvents: { on: () => {}, off: () => {}, emit: () => {} },
}));
vi.mock('../../src/main/features/search', () => ({
  upsertContext: () => {},
  dropContext: () => {},
}));

let tmpDir: string;
let prevWs: string | undefined;
const UID = 'probe-user-r3b';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r3b-'));
  prevWs = process.env.COGSEED_WORKSPACE_ROOT;
  process.env.COGSEED_WORKSPACE_ROOT = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  process.env.COGSEED_WORKSPACE_ROOT = prevWs;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function poDocFile(): string {
  return path.join(tmpDir, UID, 'cloud', 'cognition', 'personal-ontology.json');
}

describe('个人本体单源零容量限额', () => {
  it.skip('600 条 2000 字符值全部写入成功，文档超 cognition 字节上限口径仍照写', async () => {
    const groups = await import('../../src/main/features/personal_ontology_groups');
    const api = await import('../../src/main/features/po/api');

    const created = await groups.createGroup(UID, '限额探针');
    const groupId = created.group!.group_id;
    const field = await api.poCreateField(UID, groupId, '长文本');
    expect(field.ok).toBe(true);
    const fieldId = field.field!.id;

    const longText = '限'.repeat(1900);
    let accepted = 0;
    // 600 条 × 2000 字符 ≈ 1.2MB+ 元数据——条数超 cognition MAX_ASSETS(500)、
    // （加上 JSON 结构）逼近其 8MB 字节口径的 1/6；足以证明零 gate。
    for (let i = 0; i < 600; i += 1) {
      const r = await api.poAddValue(UID, groupId, fieldId, { text: `${longText}#${i}` });
      if (r.ok) accepted += 1;
    }
    expect(accepted).toBe(600);

    const bytes = fs.statSync(poDocFile()).size;
    expect(bytes).toBeGreaterThan(1_200_000); // 1.2MB，全无拒绝
    const doc = JSON.parse(fs.readFileSync(poDocFile(), 'utf8'));
    expect(doc.groups[0].values).toHaveLength(600);
  });
});
