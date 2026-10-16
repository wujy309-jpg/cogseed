/** 本体写入边界：时间锚、控制字符、删除幂等、重复值、导入计数与 Unicode 安全截断。 */
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
const UID = 'probe-r1-boundary';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cogseed-probe-r1b-'));
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

async function loadApi() {
  return import('../../src/main/features/po/api');
}

/** 孤立代理项检测（高代理后不跟低代理 / 低代理前无高代理）。 */
const LONE_SURROGATE = /(?:[\uD800-\uDBFF](?![\uDC00-\uDFFF]))|((?:[^\uD800-\uDBFF])|^)[\uDC00-\uDFFF]/;

describe('po 写路径边界', () => {
  // 未来时间锚的接受边界；该历史观察暂不作为目标回归启用。
  it.skip('asOf 未来年月 2099-12 被接受（1899-12 被拒）——时间锚无上界校验', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '时间锚组');
    const gid = g.group!.group_id;
    const f = await api.poCreateField(UID, gid, '字段');
    const future = await api.poAddValue(UID, gid, f.field!.id, { text: 'v', asOf: '2099-12' });
    expect(future.ok).toBe(true);
    expect(api.getPoSnapshot(UID).groups[0].values[0].asOf).toBe('2099-12');
    // 反例：19 世纪被正则拒绝，证明校验只看格式不看合理范围
    const past = await api.poAddValue(UID, gid, f.field!.id, { text: 'v2', asOf: '1899-12' });
    expect(past.ok).toBe(false);
  });

  // 控制字符与零宽字符的存储及呈现边界，保留完整输入字节。
  it.skip('控制字符/零宽字符原样写入单一事实源 JSON 与渲染副本（sanitize 只压换行制表）', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '脏字符组');
    const gid = g.group!.group_id;
    const f = await api.poCreateField(UID, gid, '字段');
    // NUL、BEL、ESC、零宽空格、行分隔符 U+2028（用 fromCharCode 构造，避免文件本身带控制字节）
    const withCtrl = 'a' + String.fromCharCode(0) + 'b' + String.fromCharCode(7) + 'c'
      + String.fromCharCode(27) + 'd' + String.fromCharCode(0x200b) + 'e' + String.fromCharCode(0x2028) + 'f';
    const added = await api.poAddValue(UID, gid, f.field!.id, { text: withCtrl });
    expect(added.ok).toBe(true);
    const onDisk = fs.readFileSync(poDocFile(), 'utf8');
    expect(onDisk).toContain('\\u0000');
    // U+2028 是合法 JSON 字符串字符，V8 的 stringify 原样输出（不转义）——解析回读验证
    const parsedDoc = JSON.parse(onDisk);
    const storedText = parsedDoc.groups[0].values[0].text;
    expect(storedText).toContain(String.fromCharCode(0));
    expect(storedText).toContain(String.fromCharCode(0x2028));
    expect(storedText).toContain(String.fromCharCode(0x200b));
    // 渲染副本（kb 检索索引源）也带这些字符
    const renderDir = path.join(tmpDir, UID, 'cloud', 'contexts', '.personal_ontology_groups');
    const md = fs.readFileSync(path.join(renderDir, `${gid}.md`), 'utf8');
    expect(md).toContain(String.fromCharCode(0));
    expect(md).toContain(String.fromCharCode(0x2028));
  });

  // 比较值、字段与流水删除不存在对象时的幂等返回语义。
  it.skip('删除幂等口径不一致：值/字段删不存在 id 静默 ok，流水删除报 entry not found', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '幂等组');
    const gid = g.group!.group_id;
    const f = await api.poCreateField(UID, gid, '字段');
    expect(f.ok).toBe(true);
    const delValue = await api.poDeleteValue(UID, gid, 'no-such-value');
    expect(delValue.ok).toBe(true); // 静默成功
    const delField = await api.poDeleteField(UID, gid, 'no-such-field');
    expect(delField.ok).toBe(true); // 静默成功
    const delEntry = await api.poDeleteEntry(UID, gid, 'no-such-entry');
    expect(delEntry.ok).toBe(false);
    expect(delEntry.error).toBe('entry not found');
  });

  // 比较流水升格和直接添加值对重复文本的处理。
  it.skip('流水升格绕过同文本去重门：同字段同文本可产生两条值（poAddValue 会拒）', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '升格组');
    const gid = g.group!.group_id;
    // 两条同文水流（poAddEntry 不去重，允许）
    await api.poAddEntry(UID, gid, '每周三例会');
    await api.poAddEntry(UID, gid, '每周三例会');
    const snap0 = api.getPoSnapshot(UID);
    const [e1, e2] = snap0.groups[0].entries;
    expect(e1.text).toBe(e2.text);
    // 直接 addValue 第一次成功，第二次同文本被去重门拒绝
    const field = await api.poCreateField(UID, gid, '例会');
    expect((await api.poAddValue(UID, gid, field.field!.id, { text: '每周三例会' })).ok).toBe(true);
    const direct = await api.poAddValue(UID, gid, field.field!.id, { text: '每周三例会' });
    expect(direct.ok).toBe(false);
    expect(direct.error).toBe('duplicate value');
    // promote 两条同文水流：都绕过同一道门落成值
    expect((await api.poPromoteEntry(UID, gid, e1.id, '例会')).ok).toBe(true);
    expect((await api.poPromoteEntry(UID, gid, e2.id, '例会')).ok).toBe(true);
    const values = api.getPoSnapshot(UID).groups[0].values.filter((v) => v.text === '每周三例会');
    expect(values.length).toBe(3); // 1 条 addValue + 2 条 promote，去重门被绕过
  });

  // 重复导入时，applied 计数应与实际写入效果可区分。
  it.skip('导入同一份导出两次：第二次零写入但 applied 计数照样虚高', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '回灌组');
    const gid = g.group!.group_id;
    const f = await api.poCreateField(UID, gid, '字段');
    await api.poAddValue(UID, gid, f.field!.id, { text: 'A' });
    await api.poAddEntry(UID, gid, '一条流水');
    const exported = api.poExportMarkdown(UID);
    const preview = api.poImportPreview(UID, exported);
    expect(preview.items.length).toBe(1);

    const first = await api.poImportApply(UID, preview.items);
    expect(first.applied).toBe(2); // 1 值 + 1 流水
    const second = await api.poImportApply(UID, preview.items);
    // 实际写入 0 条（值与流水都已存在），但 applied 仍计 2
    expect(second.applied).toBe(2);
    const snap = api.getPoSnapshot(UID);
    const values = snap.groups[0].values.filter((v) => v.text === 'A');
    const entries = snap.groups[0].entries.filter((e) => e.text === '一条流水');
    expect(values.length).toBe(1);
    expect(entries.length).toBe(1); // 落盘确实没重复——只是计数虚高
  });

  // 截断后的末尾孤立高代理不得进入持久化 JSON。
  it('超长 emoji 文本截断不再劈开代理对：末位无孤立高代理、磁盘无 \\ud83d 转义', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '超长组');
    const gid = g.group!.group_id;
    const f = await api.poCreateField(UID, gid, '字段');
    // 1997 个 x + 10 个 emoji：sanitize 的 slice(0,2000) 恰好劈开第 2 个 emoji
    const text = 'x'.repeat(1997) + '😀'.repeat(10);
    const added = await api.poAddValue(UID, gid, f.field!.id, { text });
    expect(added.ok).toBe(true);
    const stored = added.value!.text;
    // 1997 ASCII + 完整保留 1 个 emoji（2 码元）= 1999，被劈开的高代理已剔除
    expect(stored.length).toBe(1999);
    expect(LONE_SURROGATE.test(stored)).toBe(false); // 末尾不再是孤立高代理
    // 且已落盘（JSON 单源不再保留 \\ud83d 转义，UTF-8 往返无损）
    const onDisk = fs.readFileSync(poDocFile(), 'utf8');
    expect(onDisk).not.toContain('\\ud83d');
  });

  it('空串/纯空白边界：字段名与值文本的空值守卫生（应全拒）', async () => {
    const api = await loadApi();
    const g = await api.poCreateGroup(UID, '空值组');
    const gid = g.group!.group_id;
    expect((await api.poCreateField(UID, gid, '   ')).ok).toBe(false);
    expect((await api.poCreateGroup(UID, '')).ok).toBe(false);
    const f = await api.poCreateField(UID, gid, '字段');
    expect((await api.poAddValue(UID, gid, f.field!.id, { text: '\t\n  ' })).ok).toBe(false);
    expect((await api.poAddEntry(UID, gid, '   ')).ok).toBe(false);
  });
});
