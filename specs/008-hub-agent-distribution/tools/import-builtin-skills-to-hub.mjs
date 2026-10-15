#!/usr/bin/env node
// 批量把客户端随包的平台预置技能"接管导入"到 Hub，并发布（版本号取各自 _meta.json）。
// 默认只做本地检查（不连 Hub、不写入）；加 --apply 才真正导入。
//
// 用法（在客户端仓库根目录执行）:
//   node specs/008-hub-agent-distribution/tools/import-builtin-skills-to-hub.mjs                       # 预演，不连 Hub
//   HUB_EMAIL=.. HUB_PASSWORD=.. node specs/008-hub-agent-distribution/tools/import-builtin-skills-to-hub.mjs \
//     --hub http://127.0.0.1:3000 --apply
// 账号密码只走环境变量，不要写进命令行或文件。需要 Hub 运营（管理员）角色；先在本机 Hub 验证，再对共用环境执行。
// 版本号取各技能自己的 _meta.json，保证 Hub 与随包同版本同字节（客户端不降级，版本错位会造成同编号内容不一致）。
// 可选: --only <id,id> 只处理指定编号; --no-publish 只导入草稿不发布; --source-tier official|community|unspecified
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d }

const skillsDir = opt('skills-dir', fileURLToPath(new URL('../../../resources/builtin/marketplace/skills', import.meta.url)))
const hub = (opt('hub', '') || '').replace(/\/$/, '')
const apply = flag('apply')
const publish = !flag('no-publish')
const only = opt('only') ? new Set(opt('only').split(',')) : null
const sourceTier = opt('source-tier', 'official')
if (apply && !hub) { console.error('--apply 必须同时给 --hub'); process.exit(2) }

const HEX12 = /^[0-9a-f]{12}$/
const ids = readdirSync(skillsDir).filter((n) => HEX12.test(n) && (!only || only.has(n))).sort()
const rows = []

const nameOf = (dir) => {
  const md = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  return /^name:\s*(.+)$/m.exec(md)?.[1]?.trim() ?? '(无 name)'
}

const work = mkdtempSync(join(tmpdir(), 'presets-'))
const zipOf = (id) => {
  const out = join(work, `${id}.zip`)
  execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: join(skillsDir, id) })
  return out
}

let token = null
const call = async (path, init = {}) => {
  const res = await fetch(`${hub}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `JWT ${token}` } : {}) } })
  let body = null
  try { body = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, body }
}

if (apply) {
  const email = process.env.HUB_EMAIL, password = process.env.HUB_PASSWORD
  if (!email || !password) { console.error('请用环境变量 HUB_EMAIL / HUB_PASSWORD 提供账号（不要写在命令行里）'); process.exit(2) }
  const r = await call('/api/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (r.status !== 200 || !r.body?.token) { console.error(`登录失败 HTTP ${r.status}`); process.exit(1) }
  token = r.body.token
}

for (const id of ids) {
  const dir = join(skillsDir, id)
  const row = { id, name: '', version: '', files: 0, kb: 0, result: '' }
  try {
    if (!existsSync(join(dir, 'SKILL.md')) || !existsSync(join(dir, '_meta.json'))) throw new Error('缺 SKILL.md 或 _meta.json')
    row.name = nameOf(dir)
    row.version = JSON.parse(readFileSync(join(dir, '_meta.json'), 'utf8')).version
    if (!row.version) throw new Error('_meta.json 没有 version')
    const zip = zipOf(id)
    row.kb = Math.round(statSync(zip).size / 1024)
    row.files = execFileSync('zipinfo', ['-1', zip]).toString().trim().split('\n').filter((l) => !l.endsWith('/')).length
    if (!apply) { row.result = '预演：打包正常'; rows.push(row); continue }

    const form = new FormData()
    form.append('file', new Blob([readFileSync(zip)], { type: 'application/zip' }), `${id}.zip`)
    form.append('contentId', id)
    form.append('version', row.version)
    form.append('sourceTier', sourceTier)
    form.append('source', '客户端随包预置技能（接管导入）')
    const imp = await call('/api/skills/import', { method: 'POST', body: form })
    if (imp.status !== 200 || !imp.body?.result) {
      const issues = (imp.body?.issues ?? []).map((i) => i.rule ?? i.message).join(',')
      const raw = JSON.stringify(imp.body ?? null).slice(0, 600)
      throw new Error(`导入失败 HTTP ${imp.status} ${issues || raw}`.trim())
    }
    const got = imp.body.result
    if (got.version !== row.version) throw new Error(`导入后版本 ${got.version} 与 _meta 不一致`)
    if (!publish) { row.result = `已导入草稿（扫描:${got.scan?.verdict ?? got.scan?.status ?? '?'}）`; rows.push(row); continue }
    const pub = await call('/api/skills/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: got.versionRef, contentId: id, version: row.version }) })
    if (pub.status !== 200) throw new Error(`已导入但发布失败 HTTP ${pub.status} ${pub.body?.code ?? ''} ${pub.body?.message ?? ''}`.trim())
    row.result = '已导入并发布'
  } catch (e) {
    row.result = `失败：${e.message}`
  }
  rows.push(row)
}

rmSync(work, { recursive: true, force: true })
const ok = rows.filter((r) => /^(已|预演)/.test(r.result)).length
console.log(`模式: ${apply ? '真实导入 ' + hub : '本地预演（未连 Hub）'}  共 ${rows.length} 个，成功 ${ok}，失败 ${rows.length - ok}`)
for (const r of rows) console.log(`${r.id}  ${r.version.padEnd(16)} ${String(r.files).padStart(3)}文件 ${String(r.kb).padStart(5)}KB  ${r.name.padEnd(28)} ${r.result}`)
process.exit(ok === rows.length ? 0 : 1)
