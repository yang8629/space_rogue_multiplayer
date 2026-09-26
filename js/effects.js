// 星環電路 雙人版 · effects.js：粒子 burst、浮動數字 floatText
// 所有 js/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// FX — 粒子與浮動數字
// =====================================================================
function burst(x, y, color, n, spd = 200, life = 0.5, size = 2) {
  if (Net.role === 'host') Net.fx(['b', Math.round(x), Math.round(y), color, n, Math.round(spd), life, size]);
  const P = Game.particles;
  for (let i = 0; i < n && P.length < 1500; i++) {
    const a = rand(0, TAU), s = rand(0.2, 1) * spd, l = rand(0.5, 1) * life;
    P.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, color, size });
  }
}
function floatText(x, y, text, color, big = false) {
  if (Net.role === 'host') Net.fx(['t', Math.round(x), Math.round(y), text, color, big ? 1 : 0]);
  if (Game.texts.length > 120) return;
  Game.texts.push({ x: x + rand(-6, 6), y: y - 8, text, color, life: 0.7, big });
}
