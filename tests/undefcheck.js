'use strict';
// 掃「用了不存在的名字」：照 index.html 的順序解析遊戲的 js（共用同一個全域範圍），再加上模擬電腦（bot/，包在一個函式裡），
//   列出有用到、但哪一層範圍都沒有宣告的名字（JavaScript 要等跑到那一行才會當掉，這裡事先抓）。
//   瀏覽器內建、外部套件（PIXI、Peer）的名字在 BUILTIN；遊戲在別處用 window.xxx／globalThis.xxx 掛上去的也算宣告過。
//   用法：node undefcheck.js（沒問題印「沒有」，有問題列出 檔案:行 名字，exit 1）；release.js 會跑
const fs = require('fs'), path = require('path');
let acorn, walk;
try { acorn = require('acorn'); walk = require('acorn-walk'); } catch (e) {
  console.log('沒有 acorn：在 tests 跑一次 npm install'); process.exit(1);
}
const { readGame } = require('./load_game');

const BUILTIN = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  // 瀏覽器
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame',
  'matchMedia', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'getComputedStyle', 'Image', 'Audio', 'AudioContext', 'webkitAudioContext',
  'HTMLElement', 'HTMLCanvasElement', 'CanvasRenderingContext2D', 'Path2D', 'DOMParser', 'XMLSerializer', 'Blob', 'FileReader', 'alert', 'confirm', 'prompt',
  'addEventListener', 'removeEventListener', 'screen', 'history', 'Event', 'KeyboardEvent', 'MouseEvent', 'TouchEvent', 'PointerEvent', 'ResizeObserver',
  'OffscreenCanvas', 'ImageData', 'createImageBitmap', 'open', 'close', 'scrollTo', 'visualViewport', 'ontouchstart', 'Notification',
  // 外部套件（index.html 用 <script> 載入）
  'PIXI', 'Peer', 'ATLAS_DATA', 'caches',
]);

// 一份程式：收集每一層範圍的宣告，回傳用到但沒宣告的 [名字, 行]；top：最外層宣告了什麼（遊戲檔共用）
function scan(code, file, globals) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true, allowReturnOutsideFunction: true });
  // 先收集最外層（含 var、function 提前）的宣告，給所有檔案共用
  const top = new Set();
  const names = (p, out) => {  // 解構、預設值、... 裡的名字
    if (!p) return;
    if (p.type === 'Identifier') out.add(p.name);
    else if (p.type === 'ObjectPattern') p.properties.forEach(q => names(q.type === 'RestElement' ? q.argument : q.value, out));
    else if (p.type === 'ArrayPattern') p.elements.forEach(e => names(e, out));
    else if (p.type === 'AssignmentPattern') names(p.left, out);
    else if (p.type === 'RestElement') names(p.argument, out);
  };
  for (const n of ast.body) {
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') top.add(n.id.name);
    if (n.type === 'VariableDeclaration') n.declarations.forEach(d => names(d.id, top));
  }
  // 掛在 window／globalThis 上的：window.xxx = ...
  walk.simple(ast, { AssignmentExpression(n) {
    const L = n.left;
    if (L.type === 'MemberExpression' && !L.computed && L.object.type === 'Identifier' && ['window', 'globalThis', 'self'].includes(L.object.name)) top.add(L.property.name);
  } });
  return { top, check: all => {
    const bad = [];
    // 範圍：函式（參數、var、function）＋區塊（let／const／class）；簡化：一個函式裡所有宣告都算整個函式看得到（不會誤報，最多漏抓）
    const scopes = [];
    const declIn = (node, set) => {  // 這個函式（或程式）裡宣告的所有名字（不進到內層函式）
      walk.recursive(node, null, {
        Function(f, st, c) { if (f !== node) { if (f.type === 'FunctionDeclaration' && f.id) set.add(f.id.name); return; } f.params.forEach(p => names(p, set)); if (f.id) set.add(f.id.name); c(f.body, st); },
        VariableDeclaration(v, st, c) { v.declarations.forEach(d => { names(d.id, set); if (d.init) c(d.init, st); }); },
        ClassDeclaration(k, st, c) { if (k.id) set.add(k.id.name); if (k.superClass) c(k.superClass, st); c(k.body, st); },
        ClassExpression(k, st, c) { if (k.id) set.add(k.id.name); c(k.body, st); },
        CatchClause(k, st, c) { names(k.param, set); c(k.body, st); },
      });
      return set;
    };
    const visible = name => all.has(name) || BUILTIN.has(name) || scopes.some(s => s.has(name));
    const visit = (node, ancestorsOk) => {
      walk.recursive(node, null, {
        Function(f, st, c) {
          scopes.push(declIn(f, new Set(['arguments'])));
          if (f.body.type === 'BlockStatement') f.body.body.forEach(b => c(b, st)); else c(f.body, st);
          f.params.forEach(p => { for (const def of patternDefaults(p)) c(def, st); });  // 參數的預設值（含解構裡的）
          scopes.pop();
        },
        Identifier(id) { if (!visible(id.name)) bad.push([id.name, id.loc.start.line]); },
        MemberExpression(m, st, c) { c(m.object, st); if (m.computed) c(m.property, st); },
        Property(p, st, c) { if (p.computed) c(p.key, st); c(p.value, st); },
        PropertyDefinition(p, st, c) { if (p.computed) c(p.key, st); if (p.value) c(p.value, st); },
        MethodDefinition(m, st, c) { if (m.computed) c(m.key, st); c(m.value, st); },
        VariableDeclarator(d, st, c) { if (d.init) c(d.init, st); for (const def of patternDefaults(d.id)) c(def, st); },
        LabeledStatement(l, st, c) { c(l.body, st); }, BreakStatement() {}, ContinueStatement() {},
        CatchClause(k, st, c) { scopes.push(new Set()); names(k.param, scopes[scopes.length - 1]); c(k.body, st); scopes.pop(); },
        ClassDeclaration(k, st, c) { if (k.superClass) c(k.superClass, st); c(k.body, st); },
        ClassExpression(k, st, c) { if (k.superClass) c(k.superClass, st); c(k.body, st); },
      });
    };
    const patternDefaults = p => {  // 解構裡的預設值（要檢查），名字本身不用
      const out = [];
      const go = q => { if (!q) return; if (q.type === 'AssignmentPattern') { out.push(q.right); go(q.left); } else if (q.type === 'ObjectPattern') q.properties.forEach(r => { if (r.computed) out.push(r.key); go(r.type === 'RestElement' ? r.argument : r.value); }); else if (q.type === 'ArrayPattern') q.elements.forEach(go); else if (q.type === 'RestElement') go(q.argument); };
      go(p); return out;
    };
    scopes.push(declIn(ast, new Set()));
    visit(ast);
    return bad.map(([n, line]) => `${file}:${line} ${n}`);
  } };
}

function run() {
  const { files } = readGame();
  const parsed = files.map(f => ({ f, s: scan(f.code, f.name) }));
  const all = new Set(parsed.flatMap(p => [...p.s.top]));
  const bad = parsed.flatMap(p => p.s.check(all));
  // 模擬電腦：bot/load.js 組出來的那一段（包在函式裡，看得到遊戲的全域）
  const { botSource } = require('./bot/load');
  const src = botSource(false), bs = scan(src, 'bot');
  // 行號換回原本的檔案：找每個檔的內容在合起來的程式裡從第幾行開始
  const lineOf = i => src.slice(0, i).split('\n').length;
  const parts = ['fight.js', 'value.js', 'pick.js'].map(n => {
    const code = fs.readFileSync(path.join(__dirname, 'bot', n), 'utf8'), i = src.indexOf(code);
    return { n, line: i < 0 ? Infinity : lineOf(i), end: i < 0 ? -1 : lineOf(i + code.length) };
  });
  bad.push(...bs.check(all).map(x => {
    const [, line, nm] = x.match(/^bot:(\d+) (.*)$/), p = parts.find(q => q.line <= +line && +line <= q.end);
    return p ? `tests/bot/${p.n}:${+line - p.line + 1} ${nm}` : `tests/bot/load.js（組合的那段） ${nm}`;
  }));
  return [...new Set(bad)];
}

// 自我測試：該抓的抓到、不該報的不報（node undefcheck.js --selftest）
function selftest() {
  const cases = [
    ['function f() { return gone(); }', ['gone']],
    ['const a = 1; function f(b, { c, d = e } = {}) { return a + b + c + d; }', ['e']],
    ['function f() { for (const [k, v] of Object.entries({})) use(k, v); }', ['use']],
    ['const o = { x: missing, y: 1 }; o.zzz; o[key];', ['missing', 'key']],
    ['class K { m() { return this.q + q2; } }', ['q2']],
    ['try { a1(); } catch (err) { log(err); }', ['a1', 'log']],
    ['const f = (x = y) => x; label: for (;;) { break label; }', ['y']],
    ['function g() { var h = 1; { let i = h; } return typeof i; }', []],
    ['window.hook = 1; hook;', []],
  ];
  let bad = 0;
  for (const [code, want] of cases) {
    const s = scan(code, 't'), got = s.check(s.top).map(x => x.split(' ')[1]).sort();
    const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
    if (!ok) bad++;
    console.log((ok ? 'ok  ' : 'FAIL') + ' ' + code + ' → ' + (got.join(',') || '（沒有）'));
  }
  return bad;
}
if (process.argv.includes('--selftest')) { process.exitCode = selftest() ? 1 : 0; }
else if (require.main === module) {
  const bad = run();
  console.log(bad.length ? `用了不存在的名字 ${bad.length} 處：\n` + bad.join('\n') : '沒有用到不存在的名字');
  process.exitCode = bad.length ? 1 : 0;
}
module.exports = { run };
