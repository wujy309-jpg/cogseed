#!/usr/bin/env node
/* 把原型打成「单文件版」prototype.standalone.html：外层导览条 + 里层页面（iframe srcdoc），
   客户端真实的 CSS / ui*.js / logo 全部内联，双击即可打开，可直接发给别人。
   用法（在仓库根目录）：node specs/009-agent-skill-pages/prototype/build-standalone.cjs
   源文件（app.html / app.js / app.css / prototype.*）变更后需重新生成；生成物不要手改。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const read = (p) => fs.readFileSync(p, 'utf8');
const rel = (p) => path.resolve(dir, p);
const inlineScript = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

let app = read(rel('app.html'));
const scripts = [];
app = app.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => `<style>/* ${href} */\n${read(rel(href))}\n</style>`);
app = app.replace(/<script src="([^"]+)"[^>]*><\/script>\n?/g, (m, src) => { scripts.push(`/* ${src} */\n${read(rel(src))}`); return ''; });
app = app.replace(/src="([^"]+logo\.png)"/g, (m, src) => `src="data:image/png;base64,${fs.readFileSync(rel(src)).toString('base64')}"`);
app = app.replace('</body>', `${scripts.map(inlineScript).join('\n')}\n</body>`);
const srcdoc = app.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

let outer = read(rel('prototype.html'));
outer = outer.replace('<head>', '<head>\n<!-- 由 prototype.html + app.html 与客户端 src/renderer 的真实样式/组件脚本打包生成的单文件版本，请勿手改；源文件变更后需重新生成（build-standalone.cjs）。 -->');
outer = outer.replace(/<link rel="stylesheet" href="\.\/prototype\.css">/, () => `<style>/* ./prototype.css */\n${read(rel('prototype.css'))}\n</style>`);
outer = outer.replace(/<script src="\.\/prototype\.js" defer><\/script>/, () => inlineScript(`/* ./prototype.js */\n${read(rel('prototype.js'))}`).replace('<script>', '<script defer>'));
outer = outer.replace('src="./app.html"', () => `srcdoc="${srcdoc}"`);
const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
outer = outer.replace('模拟数据 · 点击阶段直达', () => `模拟数据 · 点击阶段直达 · 构建 ${stamp}`);
const out = rel('prototype.standalone.html');
fs.writeFileSync(out, outer);
console.log(`${path.relative(process.cwd(), out)}: ${(outer.length / 1024 / 1024).toFixed(1)} MB`);
