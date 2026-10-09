// 星環電路 美術程式（介面）：數值圖示（最大 HP、移動速度、衝刺冷卻、受到的傷害、射速、子彈速度、零件格、能量容量）
// 跟 art_world.js 一起用（faceted、polyPts、mix、glow）；畫風照新畫面：切面上色、#03050c 描邊、光從左上來
// 產生：node mp_tests/perf/builduiicons.mjs → multiplayer/assets/ui/stat_*.png
'use strict';

const STAT_ART = {
  // 愛心：最大 HP
  hp(ctx) {
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const t = i / 18 * TAU, x = 16 * Math.sin(t) ** 3, y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push([x * 1.55, y * 1.55 + 2]);
    }
    faceted(ctx, pts, '#ff4d6d', { outline: 3.4 });
  },
  // 兩個往右的箭頭：移動速度
  speed(ctx) {
    for (const ox of [-11, 9]) {
      ctx.save(); ctx.translate(ox, 0);
      faceted(ctx, [[19, 0], [-10, -24], [-3, 0], [-10, 24]], '#4cc9f0', { outline: 3.4 });
      ctx.restore();
    }
  },
  // 時鐘：衝刺冷卻
  dashCd(ctx) {
    faceted(ctx, polyPts(12, 25, 0), '#b388ff', { outline: 3.4 });
    ctx.fillStyle = '#16102e'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#e6dcff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -11); ctx.moveTo(0, 0); ctx.lineTo(8, 4); ctx.stroke();
    ctx.fillStyle = '#e6dcff'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, TAU); ctx.fill();
  },
  // 有裂痕的盾：受到的傷害
  taken(ctx) {
    faceted(ctx, [[0, -26], [21, -18], [19, 6], [0, 27], [-19, 6], [-21, -18]], '#ff9f1c', { outline: 3.4 });
    ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-3, -24); ctx.lineTo(4, -10); ctx.lineTo(-4, 1); ctx.lineTo(5, 13); ctx.lineTo(1, 24); ctx.stroke();
  },
  // 三顆並排的子彈：射速
  rate(ctx) {
    for (const [ox, oy] of [[5, -17], [-5, 0], [5, 17]]) {
      ctx.save(); ctx.translate(ox, oy);
      faceted(ctx, [[22, 0], [12, -7], [-20, -7], [-20, 7], [12, 7]], '#ffd166', { outline: 3.2 });
      ctx.restore();
    }
  },
  // 子彈＋速度線：子彈速度
  bspeed(ctx) {
    ctx.strokeStyle = '#03050c'; ctx.lineCap = 'round';
    for (const [y, l] of [[-10, 18], [0, 24], [10, 18]]) { ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(-27, y); ctx.lineTo(-27 + l, y); ctx.stroke(); }
    ctx.strokeStyle = '#7fdc5a';
    for (const [y, l] of [[-10, 18], [0, 24], [10, 18]]) { ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(-27, y); ctx.lineTo(-27 + l, y); ctx.stroke(); }
    ctx.save(); ctx.translate(8, 0);
    faceted(ctx, [[20, 0], [8, -11], [-12, -11], [-12, 11], [8, 11]], '#9dff6b', { outline: 3.2 });
    ctx.restore();
  },
  // 閃電：能量容量
  cap(ctx) {
    faceted(ctx, [[12, -28], [-19, 5], [-3, 5], [-12, 28], [19, -6], [3, -6]], '#2ee6a6', { outline: 3.4 });
  },
  // 齒輪：零件格
  slots(ctx) {
    const pts = [];  // 8 齒、平頭（齒寬一點，小尺寸才看得出是齒輪）
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; for (const [da, r] of [[-0.39, 21], [-0.2, 29], [0.2, 29], [0.39, 21]]) pts.push([Math.cos(a + da) * r, Math.sin(a + da) * r]); }
    faceted(ctx, pts, '#9aa6c4', { outline: 3.4 });
    ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a3150'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
  },
};
const STAT_ICON_IDS = Object.keys(STAT_ART);
// 畫成 size×size 的圖（原點在中間，圖示大約半徑 28 的範圍）
function statIconCanvas(id, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'); ctx.translate(size / 2, size / 2); ctx.scale(size / 64, size / 64);
  STAT_ART[id](ctx);
  return c;
}
