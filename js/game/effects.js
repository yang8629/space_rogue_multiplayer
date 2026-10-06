// 星環電路 雙人版 · effects.js：特效事件 burst（粒子）、floatText（浮動數字）、trail（殘影）；真正畫粒子的是 ui/fx.js
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// FX — 粒子與浮動數字
// =====================================================================
function burst(x, y, color, n, spd = 200, life = 0.5, size = 2) { Events.emit('burst', { x, y, color, n, spd, life, size }); }
// 留在原地的一顆粒子（衝刺、衝鋒的殘影）；chance：出現的機率
function trail(x, y, color, life, size, chance = 1) { Events.emit('trail', { x, y, color, life, size, chance }); }
// 命中數字的顏色照倍數（這發傷害 ÷ 武器基礎傷害）：1 倍以下灰、1～2 倍白、2～4 倍黃、4 倍以上紅＋大字
function dmgTextStyle(dmg, base) {
  const m = dmg / (base || 10);
  return m >= 4 ? ['#ff4d4d', true] : m >= 2 ? ['#ffe14d', false] : m >= 1 ? ['#ffffff', false] : ['#9aa3b8', false];
}
function floatText(x, y, text, color, big = false) { Events.emit('floatText', { x, y, text, color, big }); }
// 爆炸光圈
function ringFx(x, y, r, color) { Events.emit('ring', { x, y, r, color }); }
// 電弧線：o.life 持續時間、o.c 顏色、o.cap 同時最多幾條、o.jitter 終點抖動、o.share 轉給隊友的機率（太多條時只傳一部分）
function zapFx(x1, y1, x2, y2, o = {}) { Events.emit('zap', { x1, y1, x2, y2, life: o.life || 0.18, c: o.c || null, cap: o.cap || 60, jitter: o.jitter || 0, share: o.share }); }
// 彗星爆炸的閃光
function flashFx(x, y, r) { Events.emit('flash', { x, y, r }); }
// 畫面中央的大字（波次、區域肅清、救援…）；雙人時隊友那邊照房主的顯示（見 net.js 的 bn）
function bannerFx(text, sub = '', t = 2) { Events.emit('banner', { text, sub, t }); }
