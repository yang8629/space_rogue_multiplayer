// 星環電路 雙人版 · render_world.js：場地與地圖物件的繪圖（大地圖的牆、閘門、小地圖；行星、黑洞、小行星、彗星、星門、視野陰影）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
// 2026-10-05 從 objects.js、arena.js 搬出來：邏輯檔只留資料和規則，繪圖全部在 ui/（之後換 WebGL 繪圖層、移植到別的引擎時只換這邊）
'use strict';

const WorldView = {
  // ======== 地圖物件（Objects） ========
  // ---------- 畫面 ----------
  // 視野陰影：從飛船看出去，每顆小行星後面拖出一塊灰霧（死角；背景太暗，用變暗看不出來）；感測器 4 層看得穿，只留很淡的霧
  // 所有死角合成一個路徑一次填滿（重疊處不會疊得更深），邊緣模糊，不畫硬邊
  drawObjShadows(viewer) {
    if (!viewer) return;
    const seeAll = Game.mech.traits.mark, FAR = 3000;
    ctx.save();
    ctx.fillStyle = seeAll ? 'rgba(150, 160, 190, 0.05)' : 'rgba(150, 160, 190, 0.17)';
    ctx.filter = `blur(${Math.round(14 * ZOOM)}px)`;
    ctx.beginPath();
    for (const o of Game.objs) {
      if (o.type !== 'rock') continue;
      const dx = o.x - viewer.x, dy = o.y - viewer.y, d = Math.hypot(dx, dy);
      if (d <= o.r + 1) continue;
      const a = Math.atan2(dy, dx), w = Math.acos(o.r * 0.9 / d);  // 切點（半徑取 0.9，和擋視野的判定一樣）
      const t = [a + Math.PI + w, a + Math.PI - w].map(q => [o.x + Math.cos(q) * o.r * 0.9, o.y + Math.sin(q) * o.r * 0.9]);
      const far = ([x, y]) => { const ux = x - viewer.x, uy = y - viewer.y, l = Math.hypot(ux, uy) || 1; return [x + ux / l * FAR, y + uy / l * FAR]; };
      const [p1, p2] = t, q1 = far(p1), q2 = far(p2);
      ctx.moveTo(p1[0], p1[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath();
    }
    ctx.fill('nonzero');
    ctx.restore();
  },
  drawObjects(viewer) {
    const G = Game;
    WorldView.drawObjShadows(viewer);
    for (const o of G.objs) {
      if (o.type === 'planet') {
        const g = ctx.createRadialGradient(o.x - o.r * 0.4, o.y - o.r * 0.4, o.r * 0.1, o.x, o.y, o.r);
        g.addColorStop(0, '#6c7fb8'); g.addColorStop(1, '#1b2448');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(140, 170, 255, 0.5)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.strokeStyle = 'rgba(140, 170, 255, 0.10)'; ctx.setLineDash([4, 10]);
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 3.2, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      } else if (o.type === 'hole') {
        const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.R);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.95)'); g.addColorStop(o.r / o.R, 'rgba(40, 10, 70, 0.7)'); g.addColorStop(1, 'rgba(60, 20, 110, 0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.R, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#b388ff'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const a0 = G.time * 2 + i * TAU / 3;
          ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 6 + i * 4, a0, a0 + 1.6); ctx.stroke();
        }
        ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
      } else if (o.type === 'rock') {
        ctx.fillStyle = '#3a3530'; ctx.strokeStyle = '#8a7f70'; ctx.lineWidth = 2;
        polygon(o.x, o.y, o.r, 7, o.x * 0.01); ctx.fill(); ctx.stroke();
        if (o.hp < o.maxHp) {
          ctx.fillStyle = '#300'; ctx.fillRect(o.x - o.r, o.y - o.r - 8, o.r * 2, 3);
          ctx.fillStyle = '#c9b79c'; ctx.fillRect(o.x - o.r, o.y - o.r - 8, o.r * 2 * Math.max(0, o.hp / o.maxHp), 3);
        }
      } else if (o.type === 'comet') {
        const s = Math.hypot(o.vx, o.vy) || 1, ux = o.vx / s, uy = o.vy / s;
        if (o.warn > 0) {  // 預警線：藍白色（敵人的預警線是紅色）
          ctx.globalAlpha = 0.25 + 0.4 * Math.sin(G.time * 25) ** 2;
          ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = o.r * 2;
          // 沿著之後的路線跑動的箭頭（箭頭大小 = 彗星大小；越大越慢，箭頭也跑得越慢）
          const pts = Objects.cometPath(o), gap = 70, off = (G.time * s * 0.8) % gap;
          ctx.lineWidth = Math.max(2, o.r * 0.25); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          let acc = 0, next = off;
          for (let i = 1; i < pts.length && next < 2400; i++) {
            const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], seg = Math.hypot(x1 - x0, y1 - y0);
            while (next <= acc + seg) {
              const t = (next - acc) / (seg || 1), px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t, dx = (x1 - x0) / (seg || 1), dy = (y1 - y0) / (seg || 1), w = o.r;
              ctx.beginPath(); ctx.moveTo(px - dx * w * 0.7 - dy * w, py - dy * w * 0.7 + dx * w); ctx.lineTo(px, py);
              ctx.lineTo(px - dx * w * 0.7 + dy * w, py - dy * w * 0.7 - dx * w); ctx.stroke();
              next += gap;
            }
            acc += seg;
          }
          ctx.lineCap = 'butt';
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.globalAlpha = 0.5; ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = o.r * 1.4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x - ux * 90, o.y - uy * 90); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = '#e8f7ff';
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
      }
    }
    for (const q of G.portals) {  // 星門
      const a = Math.min(1, q.t * 2);
      for (const [x, y] of [[q.ax, q.ay], [q.bx, q.by]]) {
        ctx.globalAlpha = a; ctx.strokeStyle = q.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, 22, 0, TAU); ctx.stroke();
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 14, G.time * 4, G.time * 4 + 4); ctx.stroke();
      }
      ctx.globalAlpha = 0.12 * a; ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(q.ax, q.ay); ctx.lineTo(q.bx, q.by); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  },

  // ======== 場地（Arena） ========
  // 牆（填滿＋發光的邊）與閘門；viewer = 畫面跟著的飛船（閘門顏色：能過 = 綠、關著 = 紅）
  drawArena(viewer) {
    if (Arena.rect || !Arena.wallPath) return;
    ctx.fillStyle = '#131a33';
    ctx.fill(Arena.wallPath, 'evenodd');
    ctx.strokeStyle = 'rgba(110, 140, 230, 0.10)'; ctx.lineWidth = 14; ctx.stroke(Arena.path);
    ctx.strokeStyle = 'rgba(130, 160, 240, 0.65)'; ctx.lineWidth = 3; ctx.stroke(Arena.path);
    const t = Game.time;
    for (const g of Arena.gates) {
      const pass = viewer && viewer.zone === g.i && g.open, behind = viewer && viewer.zone > g.i;
      const color = pass ? '#2ee6a6' : '#ff4d6d', ex = -g.ny * g.L, ey = g.nx * g.L;
      ctx.globalAlpha = behind ? 0.35 : pass ? 0.55 + 0.25 * Math.sin(t * 5) : 0.8;
      ctx.strokeStyle = color; ctx.lineWidth = pass ? 3 : 6;
      if (pass) ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(g.x - ex, g.y - ey); ctx.lineTo(g.x + ex, g.y + ey); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.12; ctx.lineWidth = 22; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
  // 小地圖（畫面右上角，螢幕座標）：整張地圖、閘門、飛船
  drawMinimap(x, y, maxW, maxH, left = false) {  // x = 右邊緣（left：左邊緣）
    if (Arena.rect || !Arena.path) return;
    const s = Math.min(maxW / Arena.W, maxH / Arena.H), w = Arena.W * s, h = Arena.H * s;
    if (left) x += w;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(5, 8, 20, 0.7)'; ctx.fillRect(x - w, y, w, h);
    ctx.strokeStyle = 'rgba(130, 160, 240, 0.4)'; ctx.lineWidth = 1; ctx.strokeRect(x - w, y, w, h);
    ctx.translate(x - w, y); ctx.scale(s, s);
    const C = Game.combat, cur = C ? Math.max(0, (C.wave || 1) - 1) : 0;
    ctx.fillStyle = 'rgba(70, 90, 160, 0.55)'; ctx.fill(Arena.path);
    for (const g of Arena.gates) {
      ctx.strokeStyle = g.open ? '#2ee6a6' : '#ff4d6d'; ctx.lineWidth = 3 / s * 0.8;
      ctx.beginPath(); ctx.moveTo(g.x + g.ny * g.L, g.y - g.nx * g.L); ctx.lineTo(g.x - g.ny * g.L, g.y + g.nx * g.L); ctx.stroke();
    }
    const A = Arena.areas[cur];
    if (A) { ctx.fillStyle = 'rgba(255, 209, 102, 0.9)'; ctx.font = `bold ${Math.round(14 / s)}px Microsoft JhengHei`; ctx.textAlign = 'center'; }
    for (const e of Game.enemies) { if (e.dead) continue; ctx.fillStyle = '#ff4d6d'; ctx.fillRect(e.x - 1.5 / s, e.y - 1.5 / s, 3 / s, 3 / s); }
    for (const p of [Game.player, Game.mate]) {
      if (!p || p.gone) continue;
      ctx.fillStyle = p.dead ? '#888' : p === Game.player ? '#fff' : (p.ship && p.ship.color) || '#4cc9f0';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 / s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  },
};
