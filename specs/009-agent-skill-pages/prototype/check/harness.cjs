// 假 DOM 运行器：用 HTML 解析器 + node:vm 在命令行里跑原型（app.html + 客户端真实 src/renderer/modules/ui-*.js）。
// 本机无法驱动真实浏览器，原型的交互检查都走这里；视觉以截图为准。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// 仓库自带依赖 htmlparser2（从仓库根目录解析），本机无需额外安装。
const { Parser } = require(require.resolve('htmlparser2', { paths: [path.resolve(__dirname, '../../../..')] }));

function createEnv(protoDir, { search = '' } = {}) {
  const errors = [];
  let doc = null;
  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  function parseCompound(sel) {
    const m = { tag: null, id: null, classes: [], attrs: [] };
    const re = /^[a-zA-Z][\w-]*|#[\w-]+|\.[\w-]+|\[([\w-]+)(?:(\^|\$|\*)?=["']?([^"'\]]*)["']?)?\]|:[\w-]+(?:\([^)]*\))?/g;
    let x; while ((x = re.exec(sel))) {
      const t = x[0];
      if (t[0] === '#') m.id = t.slice(1); else if (t[0] === '.') m.classes.push(t.slice(1)); else if (t[0] === '[') m.attrs.push([x[1], x[2], x[3]]); else if (t[0] === ':') { /* pseudo ignored */ } else m.tag = t.toLowerCase();
    }
    return m;
  }
  function matchCompound(n, m) {
    if (n.nodeType !== 1) return false;
    if (m.tag && n.nodeName.toLowerCase() !== m.tag) return false;
    if (m.id && n.attrs.id !== m.id) return false;
    if (m.classes.some((c) => !n.className.split(/\s+/).includes(c))) return false;
    return m.attrs.every(([k, op, v]) => { if (!(k in n.attrs)) return false; if (v === undefined) return true; const a = n.attrs[k]; return op === '^' ? a.startsWith(v) : op === '$' ? a.endsWith(v) : op === '*' ? a.includes(v) : a === v; });
  }
  function matches(n, sel) {
    return sel.split(',').some((part) => {
      const chain = part.trim().split(/\s+/).map(parseCompound);
      let cur = n;
      if (!matchCompound(cur, chain[chain.length - 1])) return false;
      let i = chain.length - 2; cur = cur.parentNode;
      while (i >= 0 && cur) { if (matchCompound(cur, chain[i])) i--; cur = cur.parentNode; }
      return i < 0;
    });
  }
  class N {
    constructor(type, name) { this.nodeType = type; this.nodeName = name; this.childNodes = []; this.parentNode = null; this.attrs = {}; this.listeners = {}; this.ownerDocument = doc; this._style = {}; this.hidden = false; this.value = ''; this.checked = false; this.disabled = false; }
    get className() { return this.attrs.class || ''; } set className(v) { this.attrs.class = String(v); }
    get id() { return this.attrs.id || ''; } set id(v) { this.attrs.id = String(v); }
    get dataset() { const self = this; return new Proxy({}, { get: (_, k) => self.attrs['data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())], set: (_, k, v) => { self.attrs['data-' + String(k).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(v); return true; } }); }
    get style() { return this._style; }
    get tagName() { return this.nodeName.toUpperCase(); }
    get firstChild() { return this.childNodes[0] || null; } get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
    get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
    get offsetParent() { return this.isConnected ? doc.body : null; }
    get isConnected() { let n = this; while (n) { if (n === doc.documentElement) return true; n = n.parentNode; } return false; }
    get classList() { const self = this; return { add: (c) => { const l = self.className.split(/\s+/).filter(Boolean); if (!l.includes(c)) l.push(c); self.className = l.join(' '); }, remove: (c) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); }, contains: (c) => self.className.split(/\s+/).includes(c), toggle: (c, f) => { const has = self.className.split(/\s+/).includes(c); const want = f === undefined ? !has : f; if (want && !has) self.classList.add(c); if (!want && has) self.classList.remove(c); } }; }
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
    insertBefore(c, ref) { if (!ref) return this.appendChild(c); if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); c.parentNode = this; return c; }
    removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
    get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; if (v) this.appendChild(doc.createTextNode(String(v))); }
    get innerHTML() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.outer())).join(''); }
    set innerHTML(html) { this.childNodes.forEach((c) => { c.parentNode = null; }); this.childNodes = []; parseInto(this, String(html)); }
    outer() { const a = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join(''); return `<${this.nodeName}${a}>${this.innerHTML}</${this.nodeName}>`; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } removeAttribute(k) { delete this.attrs[k]; if (k === 'hidden') this.hidden = false; } hasAttribute(k) { return k in this.attrs; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); } removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
    dispatchEvent(e) { if (!e.target) e.target = this; for (let n = this; n; n = n.parentNode) { e.currentTarget = n; (n.listeners[e.type] || []).slice().forEach((f) => f.call(n, e)); if (e._stop) break; } return true; }
    focus() { doc.activeElement = this; } blur() {} scrollIntoView() {}
    closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
    matches(sel) { return matches(this, sel); }
    querySelectorAll(sel) { const out = []; const walk = (n) => n.childNodes.forEach((c) => { if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); } }); walk(this); return out; }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 20, right: 100, bottom: 20 }; }
  }
  function parseInto(parent, html) {
    const stack = [parent];
    const p = new Parser({
      onopentag(name, attribs) { const n = doc.createElement(name); Object.entries(attribs).forEach(([k, v]) => n.setAttribute(k, v)); stack[stack.length - 1].appendChild(n); if (!VOID.has(name)) stack.push(n); },
      ontext(t) { if (t) stack[stack.length - 1].appendChild(doc.createTextNode(t)); },
      onclosetag(name) { if (!VOID.has(name) && stack.length > 1) stack.pop(); },
    }, { decodeEntities: true });
    p.write(html); p.end();
  }
  doc = new N(9, '#document');
  doc.ownerDocument = doc;
  doc.createElement = (t) => new N(1, String(t).toLowerCase());
  doc.createTextNode = (t) => { const n = new N(3, '#text'); n.nodeValue = String(t); return n; };
  doc.documentElement = doc.createElement('html'); doc.head = doc.createElement('head'); doc.body = doc.createElement('body');
  doc.appendChild(doc.documentElement); doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  // body markup from app.html (everything between <body> and </body>, scripts stripped)
  const html = fs.readFileSync(path.join(protoDir, 'app.html'), 'utf8');
  const inlineScripts = [...html.slice(html.lastIndexOf('</head>')).matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1].replace(/<\\\/script/gi, '</script'));
  const tail = html.slice(html.lastIndexOf('</head>'));
  const bodyHtml = ((/<body>([\s\S]*)<\/body>/.exec(tail) || [0, ''])[1]).replace(/<script>[\s\S]*?<\/script>/g, '');
  parseInto(doc.body, bodyHtml);
  doc.getElementById = (id) => doc.querySelector('#' + id);
  const win = {
    document: doc, location: { search, href: 'file:///proto/app.html' + search, hash: '' }, history: { replaceState() {}, pushState() {} },
    navigator: { userAgent: 'node-harness', platform: 'MacIntel', language: 'zh-CN' }, innerWidth: 1280, innerHeight: 800,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    console: { log() {}, warn() {}, info() {}, error: (...a) => errors.push(a.map(String).join(' ')) }, Promise, URL, URLSearchParams, Date, JSON, Math, Map, Set, Symbol, Object, Array, Error, TypeError, RegExp, Intl,
    queueMicrotask, Event: class { constructor(t) { this.type = t; } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } }, parent: null,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener(t, fn) { doc.addEventListener(t, fn); }, removeEventListener(t, fn) { doc.removeEventListener(t, fn); },
    HTMLElement: N, Node: N, Element: N, atob, btoa,
  };
  win.window = win; win.self = win; win.globalThis = win; win.parent = { postMessage() {} };
  doc.defaultView = win;
  doc.addEventListener = N.prototype.addEventListener.bind(doc); doc.removeEventListener = N.prototype.removeEventListener.bind(doc);
  const ctx = vm.createContext(win);
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  for (const src of scripts) {
    try { vm.runInContext(fs.readFileSync(path.join(protoDir, src), 'utf8'), ctx, { filename: src }); } catch (e) { errors.push(`LOAD ${src}: ${e.message}`); }
  }
  for (const code of inlineScripts) { try { vm.runInContext(code, ctx, { filename: 'inline' }); } catch (e) { errors.push('INLINE: ' + e.message); } }
  // fire DOMContentLoaded
  win.__fire = (t) => { (win._wl && win._wl[t] || []).forEach((f) => f({ type: t })); };
  // window.addEventListener('DOMContentLoaded') registers on doc via shim above; run them
  (doc.listeners.DOMContentLoaded || []).slice().forEach((f) => { try { f({ type: 'DOMContentLoaded' }); } catch (e) { errors.push('DCL ' + e.stack); } });
  const all = (scope, pred) => scope.querySelectorAll('*').filter(pred);
  const text = () => doc.body.textContent.replace(/\s+/g, ' ');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (node) => { const e = { type: 'click', target: node, bubbles: true, button: 0, preventDefault() {}, stopPropagation() { this._stop = true; } }; node.dispatchEvent(e); };
  const type = (node, v) => { node.value = v; node.dispatchEvent({ type: 'input', target: node, bubbles: true }); };
  const btnByText = (label, scope = doc.body) => all(scope, (n) => n.nodeName === 'button' && n.textContent.replace(/\s+/g, '').trim() === label.replace(/\s+/g, ''));
  const modal = () => doc.querySelector('.ui-modal-overlay');
  return { win, doc, errors, text, sleep, click, type, all, btnByText, modal, s4: () => win.__s4 };
}
module.exports = { createEnv };
