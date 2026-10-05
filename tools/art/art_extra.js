// 星環電路 美術程式（補充）：子彈、粒子、晶體、光暈、列隊蟲各節、旗艦拆開的零件、牆面貼磚和邊緣裝飾、閘門、飛船噴焰、背包模組效果
// 跟 art_world.js 一起用（需要它的 faceted、eye、litEllipse、spike、polyPts、seeded、mix、rgba、glow、ADD…）
'use strict';

// ---------- 子彈（白色，遊戲裡照子彈顏色染色；加法混色） ----------
function artBulletDot(ctx) {  // 半徑 1 的圓（邊緣稍微柔和）
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.15); g.addColorStop(0, '#ffffff'); g.addColorStop(0.8, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1.15, 0, TAU); ctx.fill();
}
function artBulletHalo(ctx) {  // 光球的外圈光暈（半徑 1.8，30%）
  ctx.globalAlpha = 0.3; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
}
function artBulletLine(ctx) {  // 尾巴：長 1（往 -x）、寬 1 的圓頭線（遊戲裡照尾巴長度和寬度縮放）
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(0, -0.5); ctx.lineTo(-1, -0.5); ctx.lineTo(-1, 0.5); ctx.lineTo(0, 0.5); ctx.closePath(); ctx.fill();
}
function artBulletDart(ctx) {  // 飛鏢：半徑 1
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(2.2, 0); ctx.lineTo(-1.5, -1); ctx.lineTo(-1.5, 1); ctx.closePath(); ctx.fill();
}
function artBulletBlade(ctx) {  // 相刃：寬 1 的弧形刃片（中間往前凸）
  const w = 1; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.19; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, w); ctx.quadraticCurveTo(w * 0.9, 0, 0, -w); ctx.stroke();
}
function artRing(ctx) {  // 細圓圈（半徑 1，線寬 0.08）：帶觸發器的子彈外環、狀態圈
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(0, 0, 0.96, 0, TAU); ctx.stroke();
}
function artEnemyBullet(ctx) {  // 敵彈（半徑 1）：紅色實心＋深色外框＋淡紅外圈＋亮芯
  ctx.fillStyle = 'rgba(255,30,30,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff2a2a'; ctx.strokeStyle = '#2a0000'; ctx.lineWidth = 0.33; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd0d0'; ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, TAU); ctx.fill();
}
// 反彈的子彈：形狀照原本是誰的，顏色照現在是誰的
function artEBRim(ctx) {  // 盾衛反彈的敵彈（半徑 1）：紅色外圈＋紅框（中間空的，遊戲裡另外疊一張染成原本子彈顏色的 eb_fill）
  ctx.fillStyle = 'rgba(255,30,30,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.arc(0, 0, 0.9, 0, TAU, true); ctx.fill();
  ctx.strokeStyle = '#2a0000'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(0, 0, 1.05, 0, TAU); ctx.stroke();
  ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(0, 0, 0.95, 0, TAU); ctx.stroke();
}
function artEBFill(ctx) {  // 盾衛反彈的敵彈的芯（半徑 1，白色，遊戲裡染成原本子彈的顏色；中間亮）
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.85); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#ffffff'); g.addColorStop(0.5, '#d8d8d8'); g.addColorStop(1, '#bcbcbc');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 0.85, 0, TAU); ctx.fill();
}
function artEBWhite(ctx) {  // 反射鏡反彈的我方子彈（半徑 1，白色，遊戲裡染綠、加法混色）：敵彈的圓球外形（外圈＋實心＋亮邊＋亮芯）
  ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.arc(0, 0, 0.9, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 0.4, 0, TAU); ctx.fill();
}
function artSquare(ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(-0.5, -0.5, 1, 1); }
function artGlow(ctx) {  // 光暈（半徑 1，白色，遊戲裡染色、加法混色）
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, TAU); ctx.fill();
}
function artPickup(ctx) {  // 晶體：金色菱形（半徑 5）
  faceted(ctx, polyPts(4, 5, 0), '#ffd166', { outline: 1.6 });
}

// ---------- 列隊蟲（每節是一隻敵人）：頭、身體、尾巴；腳的擺動 4 格動畫 ----------
function artWormSeg(ctx, c, r, kind, legPh, grow = 1) {
  for (const sg of [-1, 1]) { const sw = Math.sin(legPh + (sg > 0 ? Math.PI : 0)) * 0.5; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(0, sg * r * 0.5); ctx.lineTo(-r * 0.3 + Math.cos(sw) * 2, sg * r * 1.25); ctx.stroke(); ctx.strokeStyle = mix(c, '#000000', 0.4); ctx.lineWidth = 1.1; ctx.stroke(); }
  if (kind === 'tail') { ctx.fillStyle = '#5a6584'; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.35); ctx.lineTo(-r * 1.4, 0); ctx.lineTo(-r * 0.5, r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  const head = kind === 'head', hk = head ? grow : 0;
  chitin(ctx, 0, 0, r * (0.85 + 0.15 * hk), r * (0.75 + 0.1 * hk), c);
  if (!head) { ctx.strokeStyle = 'rgba(3,5,12,0.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-r * 0.15, -r * 0.6); ctx.lineTo(-r * 0.15, r * 0.6); ctx.stroke(); return; }
  for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.6, sg * r * 0.35); ctx.quadraticCurveTo(r * (0.6 + 0.9 * grow), sg * r * (0.35 + 0.25 * grow), r * (0.6 + 0.75 * grow), 0); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.strokeStyle = '#9aa6c4'; ctx.lineWidth = 1.2; ctx.stroke(); }
  for (const sg of [-1, 1]) { glow(ctx, r * 0.45, sg * r * 0.32, 4, '#eaff7a', 0.8 * grow); ctx.fillStyle = rgba('#f5ffc0', grow); ctx.beginPath(); ctx.arc(r * 0.45, sg * r * 0.32, 1.2, 0, TAU); ctx.fill(); }
}

// ---------- 旗艦拆開的零件（遊戲裡各自旋轉） ----------
function artBoss1Ring(ctx, c, r) {  // 星噬母艦外圈的螺旋砲環（不含亮點：亮點的明暗在遊戲裡另外畫）
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.save(); ctx.rotate(a); ctx.fillStyle = '#03050c'; ctx.fillRect(r * 0.95, -3, r * 0.22, 6); ctx.fillStyle = i % 3 ? '#5a6584' : '#9aa6c4'; ctx.fillRect(r * 0.96, -2, r * 0.2, 4); ctx.fillStyle = rgba(c, 0.85); ctx.beginPath(); ctx.arc(r * 1.17, 0, 1.6, 0, TAU); ctx.fill(); ctx.restore(); }
}
function artBoss1Body(ctx, c, r, t) {  // 星噬母艦本體（艙門、大眼；t 決定艙門開合）
  faceted(ctx, polyPts(8, r, Math.PI / 8), c, { outline: 4.5 });
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + Math.PI / 4, x = Math.cos(a) * r * 0.6, y = Math.sin(a) * r * 0.6, ph = (t / 2 + i / 4) % 1, op = ph < 0.3 ? Math.sin(ph / 0.3 * Math.PI) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#03050c'; ctx.fillRect(-r * 0.16, -r * 0.13, r * 0.32, r * 0.26);
    if (op > 0.05) { glow(ctx, 0, 0, r * 0.25, '#ff4d6d', op * 0.8); for (const dy of [-0.05, 0.05]) { ctx.fillStyle = rgba('#ff4d6d', op); ctx.beginPath(); ctx.moveTo(r * 0.08, dy * r); ctx.lineTo(-r * 0.04, dy * r - 3); ctx.lineTo(-r * 0.04, dy * r + 3); ctx.closePath(); ctx.fill(); } }
    ctx.fillStyle = '#5a6584'; const h = r * 0.13 * (1 - op); ctx.fillRect(-r * 0.16, -r * 0.13, r * 0.32, h); ctx.fillRect(-r * 0.16, r * 0.13 - h, r * 0.32, h);
    ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.strokeRect(-r * 0.16, -r * 0.13, r * 0.32, r * 0.26);
    ctx.restore();
  }
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, TAU); ctx.fill();
  ctx.fillStyle = mix(c, '#ffffff', 0.2); ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
  ctx.fillStyle = '#12030a'; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.05, r * 0.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(-r * 0.09, -r * 0.1, r * 0.06, r * 0.03, -0.5, 0, TAU); ctx.fill();
}
function artBoss3Ring(ctx, c, r, R, w, gap) {  // 終焉核心的裝甲環（六段、缺一格）
  for (let i = 0; i < 6; i++) {
    if (i === gap) continue;
    const a0 = i / 6 * TAU + 0.06, a1 = (i + 1) / 6 * TAU - 0.06;
    ctx.beginPath(); ctx.arc(0, 0, R + w / 2, a0, a1); ctx.arc(0, 0, R - w / 2, a1, a0, true); ctx.closePath();
    ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3; ctx.stroke();
    const g = ctx.createLinearGradient(0, -R, 0, R); g.addColorStop(0, mix(c, '#ffffff', 0.25)); g.addColorStop(1, mix(c, '#000000', 0.65)); ctx.fillStyle = g; ctx.fill();
    const m = (a0 + a1) / 2; glow(ctx, Math.cos(m) * R, Math.sin(m) * R, 7, c, 0.8); ctx.fillStyle = '#e6fff6'; ctx.beginPath(); ctx.arc(Math.cos(m) * R, Math.sin(m) * R, 1.8, 0, TAU); ctx.fill();
  }
}
function artBoss3Core(ctx, c, r, p) {  // 終焉核心中間（p：脈動 0～1）
  glow(ctx, 0, 0, r * 0.9, c, 0.4 + p * 0.4);
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, TAU); ctx.fill();
  faceted(ctx, polyPts(6, r * 0.55, 0), mix(c, '#000000', 0.2), { outline: 2.4 });
  const cg = ctx.createRadialGradient(-r * 0.08, -r * 0.08, 0, 0, 0, r * 0.3); cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.45, mix(c, '#ffffff', 0.4)); cg.addColorStop(1, c);
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, r * (0.24 + p * 0.04), 0, TAU); ctx.fill();
}

// ---------- 地圖物件（大小 1：遊戲裡照半徑縮放） ----------
function artPlanetTex(ctx, r) { drawPlanet(ctx, 0, 0, 0, r); }
function artHoleCore(ctx, r) {
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(230,200,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r + 1, 0, TAU); ctx.stroke();
}
function artHoleDisk(ctx, r) {  // 吸積盤（平放；遊戲裡壓扁成橢圓、旋轉、分前後兩半）
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * TAU, rr = r * (1.35 + (i % 4) * 0.22);
    ctx.strokeStyle = i % 3 ? 'rgba(200,160,255,0.55)' : 'rgba(255,200,255,0.85)'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 0.5); ctx.stroke();
  }
}
function artRockTex(ctx, r, seed) { ctx.save(); faceted(ctx, polyPts(7, r, seed, [1, 0.82, 0.95, 1.08, 0.78, 0.98, 0.88]), '#7d7264', { outline: 3, dark: 0.75, bright: 0.3 }); ctx.fillStyle = 'rgba(3,5,12,0.3)'; ctx.beginPath(); ctx.arc(r * 0.25, r * 0.15, r * 0.18, 0, TAU); ctx.fill(); ctx.restore(); }
function artCometHead(ctx, r) { faceted(ctx, polyPts(6, r, 0.4, [1, 0.85, 1, 0.9, 1.05, 0.88]), '#d8f1ff', { outline: 2.4, dark: 0.5, bright: 0.5 }); }

// ---------- 牆：牆面貼磚（無縫：每個元素在四個方向各畫一份）、邊緣裝飾、閘門發射器 ----------
function tileWrap(ctx, T, fn) { for (const dx of [-T, 0, T]) for (const dy of [-T, 0, T]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); } }
function artWallTile(ctx, sty, T) {  // T：貼磚邊長（世界單位），座標 0～T
  const S = WALL_STYLES[sty];
  ctx.fillStyle = mix(S.top, S.bot, 0.55); ctx.fillRect(0, 0, T, T);
  if (sty === 'metal') {
    for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
      const w = T / 6, h = T / 6, x = col * w + (row % 2) * w / 2, y = row * h;
      tileWrap(ctx, T, () => { ctx.fillStyle = (row + col) % 3 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y, w - 1, h - 1); ctx.strokeStyle = 'rgba(3,5,12,0.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w - 1, h - 1); ctx.fillStyle = 'rgba(160,175,215,0.35)'; for (const [rx, ry] of [[4, 4], [w - 5, 4], [4, h - 5], [w - 5, h - 5]]) { ctx.beginPath(); ctx.arc(x + rx, y + ry, 1.2, 0, TAU); ctx.fill(); } });
    }
    for (const py of [0.35, 0.7]) { ctx.strokeStyle = '#03050c'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, T * py); ctx.lineTo(T, T * py); ctx.stroke(); ctx.strokeStyle = '#3a4466'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = 'rgba(200,215,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, T * py - 1.5); ctx.lineTo(T, T * py - 1.5); ctx.stroke(); }
    for (const [vx, vy] of [[0.3, 0.88], [0.75, 0.15], [0.55, 0.52]]) { const x = T * vx, y = T * vy; ctx.fillStyle = '#05070f'; ctx.fillRect(x - 16, y - 8, 32, 16); ctx.strokeStyle = '#5a6584'; ctx.lineWidth = 1.2; ctx.strokeRect(x - 16, y - 8, 32, 16); ctx.strokeStyle = 'rgba(120,135,175,0.6)'; for (let k = -12; k <= 12; k += 4) { ctx.beginPath(); ctx.moveTo(x + k, y - 6); ctx.lineTo(x + k + 2, y + 6); ctx.stroke(); } }
  }
  if (sty === 'rock' || sty === 'lava') {
    for (let i = 0; i < 14; i++) { const x = seeded(i) * T, y = seeded(i + 50) * T, r = 8 + seeded(i + 99) * 18; tileWrap(ctx, T, () => { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); polyPts(6, r, i).forEach(([a, b], j) => j ? ctx.lineTo(x + a, y + b) : ctx.moveTo(x + a, y + b)); ctx.closePath(); ctx.fill(); }); }
    if (sty === 'rock') {
      ctx.strokeStyle = 'rgba(220,200,170,0.18)'; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) tileWrap(ctx, T, () => { let x = seeded(i + 200) * T, y = 0; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (seeded(i * 7 + k + 210) - 0.5) * 40; y += T / 5; ctx.lineTo(x, y); } ctx.stroke(); });
      for (let i = 0; i < 3; i++) { const x = seeded(i + 300) * T, y = seeded(i + 301) * T, c = i % 2 ? '#7fe3ff' : '#ffd166'; glow(ctx, x, y, 12, c, 0.4); for (let k = 0; k < 3; k++) { ctx.save(); ctx.translate(x + (k - 1) * 4, y); ctx.rotate(-0.4 + k * 0.4); ctx.beginPath(); ctx.moveTo(-2.2, 0); ctx.lineTo(0, -7 - k % 2 * 3); ctx.lineTo(2.2, 0); ctx.closePath(); ctx.fillStyle = mix(c, '#ffffff', 0.3); ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore(); } }
    }
  }
  if (sty === 'ice') {
    ctx.strokeStyle = 'rgba(200,240,255,0.3)'; ctx.lineWidth = 0.8;
    for (let i = 0; i < 18; i++) { const x = seeded(i + 600) * T, y = seeded(i + 601) * T, r = 1 + seeded(i + 602) * 2.5; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 3; i++) { const x = seeded(i + 500) * T, y = seeded(i + 501) * T; ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.35; faceted(ctx, polyPts(6, 6 + seeded(i + 502) * 8, i), '#3a4a5a', { outline: 1 }); ctx.restore(); }
    ctx.strokeStyle = 'rgba(80,170,255,0.25)'; ctx.lineWidth = 2.5;
    for (let i = 0; i < 2; i++) tileWrap(ctx, T, () => { let x = seeded(i + 700) * T, y = 0; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (seeded(i * 5 + k + 710) - 0.5) * 40; y += T / 5; ctx.lineTo(x, y); } ctx.stroke(); });
  }
  if (sty === 'lava') {
    const river = (x0, amp, n, w) => {  // 從上到下的岩漿河（上下接得起來）
      const path = () => { ctx.beginPath(); for (let y = 0; y <= T; y += 8) { const x = x0 + Math.sin(y / T * TAU * n) * amp + Math.sin(y / T * TAU * 3 + x0) * amp * 0.25; y ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const dx of [-T, 0, T]) { ctx.save(); ctx.translate(dx, 0);
        path(); ctx.strokeStyle = 'rgba(255,110,30,0.16)'; ctx.lineWidth = w * 3.4; ctx.stroke();
        path(); ctx.strokeStyle = '#3a0e04'; ctx.lineWidth = w + 6; ctx.stroke();
        path(); ctx.strokeStyle = '#8a2406'; ctx.lineWidth = w + 2; ctx.stroke();
        path(); ctx.strokeStyle = '#ff6e1e'; ctx.lineWidth = w; ctx.stroke();
        path(); ctx.strokeStyle = '#ffc85a'; ctx.lineWidth = w * 0.35; ctx.setLineDash([w * 1.6, w * 1.2]); ctx.stroke(); ctx.setLineDash([]);
        ctx.restore(); }
    };
    river(T * 0.22, 26, 1, 11); river(T * 0.7, 34, 2, 8);
    for (const [px, py, rx] of [[0.45, 0.3, 46], [0.88, 0.78, 34]]) {  // 岩漿池
      const x = px * T, y = py * T;
      const gg = ctx.createRadialGradient(x, y, 0, x, y, rx * 1.8); gg.addColorStop(0, 'rgba(255,110,30,0.35)'); gg.addColorStop(1, 'rgba(255,110,30,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, rx * 1.8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#3a0e04'; ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.32, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff6e1e'; ctx.beginPath(); ctx.ellipse(x, y, rx * 0.86, rx * 0.24, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.ellipse(x - rx * 0.15, y - 1, rx * 0.43, rx * 0.09, 0, 0, TAU); ctx.fill();
    }
  }
  if (sty === 'organic') {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < 5; i++) {  // 發光血管（上下接得起來）＋分岔
      const x0 = (i + 0.3 + seeded(i + 980) * 0.4) / 5 * T, amp = 14 + seeded(i + 981) * 12, n = 1 + (i % 2);
      const X = y => x0 + Math.sin(y / T * TAU * n + i) * amp;
      for (const dx of [-T, 0, T]) { ctx.save(); ctx.translate(dx, 0);
        ctx.beginPath(); for (let y = 0; y <= T; y += 8) y ? ctx.lineTo(X(y), y) : ctx.moveTo(X(y), y);
        ctx.strokeStyle = 'rgba(255,93,115,0.18)'; ctx.lineWidth = 12; ctx.stroke(); ctx.strokeStyle = '#7a1e2a'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 2.2; ctx.stroke();
        for (let j = 1; j < 4; j++) { const y = j / 4 * T, d = j % 2 ? 1 : -1, bx = X(y); ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx + d * 18, y - 6, bx + d * 30, y - 20); ctx.strokeStyle = '#7a1e2a'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = '#ff5d73'; ctx.lineWidth = 1.2; ctx.stroke(); }
        ctx.restore(); }
    }
    for (let i = 0; i < 16; i++) { const x = seeded(i + 900) * T, y = seeded(i + 901) * T, r = 10 + seeded(i + 902) * 14; tileWrap(ctx, T, () => { ctx.fillStyle = 'rgba(120,30,40,0.25)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(10,2,4,0.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }); }
    for (let i = 0; i < 4; i++) { const x = seeded(i + 950) * T, y = seeded(i + 951) * T; ctx.fillStyle = '#5a1a20'; ctx.beginPath(); ctx.ellipse(x, y, 7, 4.5, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.fillStyle = '#12030a'; ctx.beginPath(); ctx.ellipse(x, y, 4, 2.2, 0, 0, TAU); ctx.fill(); }
  }
  if (sty === 'ruins') {
    for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) {
      const w = T / 6, h = T / 6, x = col * w + (row % 2) * w * 0.5 - w * 0.25, y = row * h, k = row * 6 + col;
      if (seeded(k + 400) < 0.3) { ctx.fillStyle = '#030406'; ctx.fillRect(x, y, w - 1, h - 1); ctx.strokeStyle = '#3c4048'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke(); }
      else { ctx.fillStyle = seeded(k) < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y, w - 1, h - 1); ctx.strokeStyle = 'rgba(3,5,12,0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w - 1, h - 1); }
    }
    for (let i = 0; i < 5; i++) { const x = seeded(70 + i * 3) * T, y = seeded(71 + i * 3) * T, r = 24 + seeded(72 + i * 3) * 40; tileWrap(ctx, T, () => { const gg = ctx.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, 'rgba(0,0,0,0.6)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }); }
    for (let i = 0; i < 3; i++) { const y = (0.2 + i * 0.3) * T, x0 = seeded(i + 60) * T * 0.5, x1 = x0 + T * (0.3 + seeded(i + 61) * 0.3);  // 斷掉的管線
      ctx.strokeStyle = '#03050c'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); ctx.strokeStyle = '#3c4048'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = 'rgba(220,225,235,0.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y - 1.5); ctx.lineTo(x1, y - 1.5); ctx.stroke(); }
  }
}
// 邊緣裝飾：在原點、朝 +y 是空地（遊戲裡照邊緣的法線轉）
function artWallDeco(ctx, sty, k) {
  if (sty === 'rock') { const r = 9 + seeded(k) * 12; faceted(ctx, polyPts(6 + (k % 2), r, k, [1, 0.8, 1.05, 0.85, 0.95, 0.9, 1]), k % 3 ? '#7d7264' : '#5e554a', { outline: 2.6, dark: 0.75, bright: 0.3 }); }
  if (sty === 'lava') { const r = 9 + seeded(k) * 8; faceted(ctx, polyPts(6, r, k, [1, 0.82, 1.05, 0.86, 0.95, 0.9]), '#4a4450', { outline: 2.6, dark: 0.8, bright: 0.25 }); }
  if (sty === 'organic') {
    if (k % 3 === 1) {  // 觸鬚（往空地伸）
      const L = 16 + seeded(k + 61) * 12, sw = (seeded(k + 62) - 0.5) * 0.8;
      ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.sin(sw) * L * 0.6, L * 0.55, Math.sin(sw * 2) * L, L); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#8a3a3c'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = 'rgba(255,170,170,0.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineCap = 'butt';
    }
    if (k % 3 === 2) for (let j = 0; j < 3; j++) {  // 卵囊（在邊緣內側）
      const ex = (j - 1) * 7, ey = -14 + (j % 2) * 4; glow(ctx, ex, ey, 9, '#ffb36b', 0.5);
      ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(ex, ey, 4.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffc98a'; ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, TAU); ctx.fill(); ctx.fillStyle = '#5a2010'; ctx.beginPath(); ctx.arc(ex + 0.5, ey + 0.5, 1.2, 0, TAU); ctx.fill();
    }
    const r = 7 + seeded(k) * 8; litEllipse(ctx, 0, 0, r, r * 0.8, '#a8484a'); if (k % 3 === 0) { glow(ctx, 0, 0, r, '#ff5d73', 0.6); ctx.fillStyle = '#2a0a0e'; ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.fill(); }
  }
  if (sty === 'ice') {
    const n = 2 + (k % 2), crystal = (x, y, a, h, w) => {
      const tip = [x + Math.cos(a) * h, y + Math.sin(a) * h], l = [x + Math.cos(a + 1.57) * w, y + Math.sin(a + 1.57) * w], r = [x + Math.cos(a - 1.57) * w, y + Math.sin(a - 1.57) * w];
      ctx.beginPath(); ctx.moveTo(...l); ctx.lineTo(...tip); ctx.lineTo(...r); ctx.closePath(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.fillStyle = '#e4f8ff'; ctx.beginPath(); ctx.moveTo(...l); ctx.lineTo(...tip); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5f9fc4'; ctx.beginPath(); ctx.moveTo(...r); ctx.lineTo(...tip); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    };
    glow(ctx, 0, 12, 22, '#8fdcff', 0.35);
    for (let j = 0; j < n; j++) { const a = Math.PI / 2 + (j - (n - 1) / 2) * 0.45 + (seeded(k * 3 + j) - 0.5) * 0.25, h = (j === 1 || n === 2 ? 22 : 13) + seeded(k + j + 50) * 12; crystal((j - 1) * 3, 0, a, h, 3.5 + seeded(k + j) * 2.5); }
  }
  if (sty === 'metal') {  // 一片立體裝甲板（沿 x 方向，寬 28）＋航行燈（燈由遊戲另外畫明暗）
    const hw = 14, out = 6;
    ctx.beginPath(); ctx.moveTo(-hw, out); ctx.lineTo(hw, out); ctx.lineTo(hw, -6); ctx.lineTo(-hw, -6); ctx.closePath(); ctx.fillStyle = '#3a4466'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#8f9bb8'; ctx.fillRect(-hw, out - 3, hw * 2, 3);
    ctx.fillStyle = '#2a3a6a'; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
  }
  if (sty === 'ruins') {
    const kind = k % 3;
    if (kind === 0) {  // 彎折的鋼樑
      const l1 = 12 + seeded(k + 13) * 10, b = Math.PI / 2 + (seeded(k + 14) - 0.5) * 1.6, l2 = 8 + seeded(k + 15) * 8, j = [0, l1], e = [j[0] + Math.cos(b) * l2, j[1] + Math.sin(b) * l2];
      ctx.lineCap = 'square'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(...j); ctx.lineTo(...e); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#6a6f7c'; ctx.lineWidth = 3.5; ctx.stroke(); ctx.strokeStyle = 'rgba(220,225,235,0.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineCap = 'butt';
    } else if (kind === 1) {  // 撕裂的金屬板
      ctx.beginPath(); ctx.moveTo(-12, -6); for (let i = 0; i <= 6; i++) ctx.lineTo(-12 + i * 4, (seeded(k * 7 + i) - 0.3) * 10); ctx.lineTo(12, -6); ctx.closePath(); ctx.fillStyle = '#4a4f5c'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2; ctx.stroke();
    } else {  // 垂下的斷電纜
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(8, 16, 2, 26); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = k % 2 ? '#7a3a2a' : '#2a3a5a'; ctx.lineWidth = 1.6; ctx.stroke();
    }
  }
}
function artGateEmitter(ctx, sty) {  // 閘門發射器：鏡頭朝 +y（遊戲裡照屏障方向轉）
  const S = WALL_STYLES[sty];
  ctx.beginPath(); ctx.moveTo(-10, -6); ctx.lineTo(10, -6); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath();
  const gg = ctx.createLinearGradient(-10, 0, 10, 0); gg.addColorStop(0, mix(S.post, '#ffffff', 0.25)); gg.addColorStop(1, mix(S.post, '#000000', 0.45));
  ctx.fillStyle = gg; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#e8eef8'; ctx.beginPath(); ctx.ellipse(0, 7, 4, 1.6, 0, 0, TAU); ctx.fill();
}

// ---------- 飛船：噴焰（從噴嘴出口往 -x，長 1、寬 1；遊戲裡照長度縮放）、背包模組效果 ----------
function artFlame(ctx) {
  ctx.fillStyle = 'rgba(140,210,255,0.85)'; ctx.beginPath(); ctx.moveTo(0, -0.5); ctx.lineTo(-1, 0); ctx.lineTo(0, 0.5); ctx.fill();
  ctx.fillStyle = 'rgba(235,248,255,0.9)'; ctx.beginPath(); ctx.moveTo(0, -0.22); ctx.lineTo(-0.45, 0); ctx.lineTo(0, 0.22); ctx.fill();
}
function artModuleFx(ctx, id, front) { moduleFx(ctx, MODS.find(m => m.id === id), 0, front); }
function artDrone(ctx) {
  const c = '#9dff6b'; glow(ctx, 0, 0, 7, c, 0.7);
  faceted(ctx, polyPts(4, 4, Math.PI / 4), '#9aa6c4', { outline: 1.5 }); ctx.fillStyle = c; ctx.fillRect(-1, -3.5, 2, 7); ctx.fillRect(-3.5, -1, 7, 2);
}

// ---------- 牆面的流動亮光（疊在貼磚上、加法混色；ph = 0～1 動畫進度，8 格一輪）：岩漿河的亮芯往下流、血管的脈動往上傳 ----------
//   路徑跟 artWallTile 裡的岩漿河、血管一樣（同樣的公式），才對得上
function artWallFlow(ctx, sty, T, ph) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const wrapX = fn => { for (const dx of [-T, 0, T]) { ctx.save(); ctx.translate(dx, 0); fn(); ctx.restore(); } };
  if (sty === 'lava') {
    for (const [x0, amp, n, w] of [[T * 0.22, 26, 1, 11], [T * 0.7, 34, 2, 8]]) {
      const path = () => { ctx.beginPath(); for (let y = 0; y <= T; y += 8) { const x = x0 + Math.sin(y / T * TAU * n) * amp + Math.sin(y / T * TAU * 3 + x0) * amp * 0.25; y ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } };
      const period = w * 2.8;  // 亮段＋間隔的長度
      wrapX(() => { path(); ctx.strokeStyle = 'rgba(255,225,140,0.95)'; ctx.lineWidth = w * 0.42; ctx.setLineDash([w * 1.6, w * 1.2]); ctx.lineDashOffset = -ph * period * 4; ctx.stroke(); ctx.setLineDash([]); });
    }
  }
  if (sty === 'organic') {
    for (let i = 0; i < 5; i++) {
      const x0 = (i + 0.3 + seeded(i + 980) * 0.4) / 5 * T, amp = 14 + seeded(i + 981) * 12, n = 1 + (i % 2);
      const X = y => x0 + Math.sin(y / T * TAU * n + i) * amp;
      wrapX(() => {
        ctx.beginPath(); for (let y = 0; y <= T; y += 8) y ? ctx.lineTo(X(y), y) : ctx.moveTo(X(y), y);
        ctx.setLineDash([60, T / 2 - 60]); ctx.lineDashOffset = (ph + i * 0.37) * T / 2;  // 一段亮光沿著血管往上走
        ctx.strokeStyle = 'rgba(255,120,140,0.35)'; ctx.lineWidth = 9; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,190,200,0.85)'; ctx.lineWidth = 2.6; ctx.stroke(); ctx.setLineDash([]);
      });
    }
  }
}
