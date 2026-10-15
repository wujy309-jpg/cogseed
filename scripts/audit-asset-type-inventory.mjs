#!/usr/bin/env node
/**
 * P-r3-12 存量巡检：ability-assets 记录的 type 枚举存量盘点。
 *
 * 写侧五枚举闸上线后（updateAbilityAsset），此前可能已落盘的非法 type
 * 不会自己消失——读侧刻意不补枚举（存量非法值要读得出才可修复），发现
 * 存量靠巡检：扫一个 workspace root 下全部用户的 ability-assets 记录，
 * 报告 type 不在五枚举（personal/rule/template/skill_method/fact）里的条目。
 *
 * 用法：node scripts/audit-asset-type-inventory.mjs [workspaceRoot]
 *   workspaceRoot 缺省时依次尝试 ~/.cogseed/data 与 ~/.cogseed-dev/data。
 *   扫描只读，不写任何文件。
 *
 * 发现非法 type 的处置：资产仍可读、可改其他字段；把 type 改回五枚举
 * 之一即可自愈（写闸只拦非法新值，不拦修复）。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const VALID_TYPES = new Set(['personal', 'rule', 'template', 'skill_method', 'fact']);

function candidateRoots() {
  return [
    path.join(os.homedir(), '.cogseed', 'data'),
    path.join(os.homedir(), '.cogseed-dev', 'data'),
  ].filter((dir) => fs.existsSync(dir));
}

function main() {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : candidateRoots()[0];
  if (!root || !fs.existsSync(root)) {
    console.error('workspace root not found (pass one explicitly):', root || '(none)');
    process.exitCode = 2;
    return;
  }
  const recordsDirOf = (uid) => path.join(root, uid, 'cloud', 'recall', 'records', 'ability-assets');
  const uids = fs.readdirSync(root).filter((uid) => {
    try { return fs.statSync(recordsDirOf(uid)).isDirectory(); } catch { return false; }
  });
  let scanned = 0;
  const invalid = [];
  for (const uid of uids) {
    for (const file of fs.readdirSync(recordsDirOf(uid))) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(recordsDirOf(uid), file);
      try {
        const record = JSON.parse(fs.readFileSync(full, 'utf8'));
        scanned += 1;
        if (!VALID_TYPES.has(record.type)) {
          invalid.push({ uid, file, id: record.id, type: record.type, status: record.status });
        }
      } catch (error) {
        invalid.push({ uid, file, parseError: String(error) });
      }
    }
  }
  console.log(`workspace root: ${root}`);
  console.log(`users with ability-assets: ${uids.length}, records scanned: ${scanned}`);
  if (!invalid.length) {
    console.log('invalid type records: 0 — 存量干净，写侧闸无需善后。');
    return;
  }
  console.log(`invalid type records: ${invalid.length}`);
  for (const row of invalid) console.log(JSON.stringify(row));
  process.exitCode = 1;
}

main();
