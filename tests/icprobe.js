// 攔截合併回射：每次回射合了幾顆（0.1 秒內擋下的敵彈數）。用自動對戰模擬的依難度配裝（每組都含攔截）打仗，照武器統計
// 用法：node icprobe.js --boss=boss|boss2|boss3 --n=20   （打那隻旗艦，難度 6 的配裝）
//       node icprobe.js --n=20                          （一般戰＋精英戰，難度 1／3／6 的配裝）
//       其他參數照 botsim.js（--hold 等）
'use strict';
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const BOSS = arg('boss');
globalThis.__icHook = () => {
  const G = Game, out = {};
  if (BOSS) CFG.BOSS_ORDER = [BOSS, ...CFG.BOSS_ORDER.filter(b => b !== BOSS)];
  const tc = G.tickCounter;
  G.tickCounter = function (p, dt) {
    const before = (p.icWs || []).slice(), r = tc.call(this, p, dt);
    for (const W of before) if (!p.icWs.includes(W)) (out[G.weapon.id] = out[G.weapon.id] || []).push(W.n);
    return r;
  };
  process.on('exit', () => {
    const NAME = { laser: '雷射', scatter: '散彈', plasma: '電漿', railgun: '軌道', blade: '相刃' };
    const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
    const C = CFG.COUNTER, full = Math.ceil(1 + (C.max - 1) / C.per - 1e-9);  // 幾顆到上限
    console.error(`\n每次回射合了幾顆（${BOSS ? '旗艦 ' + ENEMY_TYPES[BOSS].name : '一般戰＋精英戰'}；集氣 ${C.win} 秒、每顆 +${Math.round(C.per * 100)}%、上限 ×${C.max}（${full} 顆）、${C.join} 外另開）`);
    console.error('武器'.padEnd(6) + '回射次數'.padStart(8) + '平均'.padStart(7) + '一半以內'.padStart(8) + '九成以內'.padStart(8) + '最多'.padStart(6) + '  ≥2 顆' + '  平均倍率' + `  到上限`);
    for (const w of Object.keys(NAME)) {
      const a = (out[w] || []).sort((x, y) => x - y);
      if (!a.length) { console.error(NAME[w].padEnd(6) + '0'.padStart(8)); continue; }
      const pct = f => (a.filter(f).length / a.length * 100).toFixed(1).padStart(6) + '%';
      console.error(NAME[w].padEnd(6) + String(a.length).padStart(8) + (a.reduce((s, x) => s + x, 0) / a.length).toFixed(2).padStart(7)
        + String(q(a, 0.5)).padStart(8) + String(q(a, 0.9)).padStart(8) + String(a[a.length - 1]).padStart(6)
        + pct(x => x >= 2) + ('×' + (a.reduce((s, x) => s + Math.min(C.max, 1 + C.per * (x - 1)), 0) / a.length).toFixed(2)).padStart(9) + pct(x => x >= full).padStart(9));
    }
  });
};
process.argv.push('--build', '--force=intercept', '--tweak=__icHook()');
if (BOSS) process.argv.push('--boss');
require('./botsim.js');
