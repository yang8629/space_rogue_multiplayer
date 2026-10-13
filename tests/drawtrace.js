'use strict';
// 記錄 drawBullet 的實際繪圖指令：比較「開火的刃（帶觸發）」和「回響的刃」
const vm = require('vm');
const { runFiles } = require('./load_game');
const calls = [];
const ctx2d = new Proxy({}, {
  get(t, k) { if (k in t) return t[k]; return (...a) => calls.push([k, ...a.map(v => typeof v === 'number' ? Math.round(v * 10) / 10 : v)]); },
  set(t, k, v) { t[k] = v; calls.push(['set', k, v]); return true; },
});
const ctx = { console, setTimeout() {}, performance: { now: () => 0 }, navigator: {} };
vm.createContext(ctx);
ctx.__ctx2d = ctx2d;
runFiles((code, opt) => vm.runInContext(code, ctx, opt), `\nconst __canvas = { getContext: () => globalThis.__ctx2d, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };\ndocument.getElementById = id => id === 'game' ? __canvas : __mk();\n`);
vm.runInContext('globalThis.__T = { Game, runOps, compileChain, drawBullet, Bullet, weaponParams };', ctx);
const T = ctx.__T;
T.Game.newRun('range', 'vanguard', 'blade');
T.Game.weapon = { id: 'blade', path: 'B', final: null }; T.Game.refreshWeapon();
T.Game.chain = ['weapon', 'trigger', 'split', null, null, null]; T.Game.recalc();
const fired = T.runOps(T.Game.stats.ops, 0);
console.log('fired:', fired.length, 'shape', fired[0].shape, 'payload', !!fired[0].payload, 'r', fired[0].radius, 'life', fired[0].life);
const echo = T.runOps(fired[0].payload, 1);
console.log('echo :', echo.length, 'shape', echo[0].shape, 'payload', !!echo[0].payload);
for (const [name, s, d] of [['FIRED', fired[0], 0], ['ECHO', echo[0], 1]]) {
  calls.length = 0;
  const b = new T.Bullet(100, 100, 0, s, d, null);
  b.x += 30;  // 飛了一小段
  T.drawBullet(b);
  console.log(`\n== ${name} ==`);
  for (const c of calls) console.log(JSON.stringify(c));
}
