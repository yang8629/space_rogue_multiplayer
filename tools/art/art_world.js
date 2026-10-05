// 星環電路 美術程式（世界：敵人、地圖物件、牆、背包模組）：用 Canvas 2D 畫，產生工具（tools/art/build.html）用它畫成圖集 → assets/
// 來源：art_lab/world_preview.html（2026-10-05 使用者確認的畫風）。改美術就改這裡，再跑 mp_tests/perf/buildatlas.mjs 重產圖集
// 需要先載入 js/core/config.js（TAU、rand、clamp）
'use strict';

const opt = { glow: true, spin: true, old: false };
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const rgba = (c, a) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
const mix = (c, d, k) => { const a = hex(c), b = hex(d); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, '0')).join(''); };
const LIGHT = -Math.PI * 0.75;  // 光從左上來（世界座標，不跟著物件轉）

// ---------- 發光：預先畫好的光暈貼圖（加法混色） ----------
const GLOW = new Map();
function glowSprite(color) {
  if (GLOW.has(color)) return GLOW.get(color);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, rgba(color, 0.9)); g.addColorStop(0.25, rgba(color, 0.45)); g.addColorStop(0.6, rgba(color, 0.12)); g.addColorStop(1, rgba(color, 0));
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  GLOW.set(color, c); return c;
}
function glow(ctx, x, y, r, color, a = 1) {
  if (!opt.glow) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a;
  ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2); ctx.restore();
}

// ---------- 多面切割的實心多邊形（D 版敵人的基本形） ----------
function polyPts(n, r, rot, wob = null) {
  return Array.from({ length: n }, (_, i) => { const a = rot + i / n * TAU, rr = r * (wob ? wob[i % wob.length] : 1); return [Math.cos(a) * rr, Math.sin(a) * rr]; });
}
function faceted(ctx, pts, col, { outline = 3.2, dark = 0.72, bright = 0.38 } = {}) {
  // 深色描邊
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  ctx.strokeStyle = '#03050c'; ctx.lineWidth = outline; ctx.lineJoin = 'round'; ctx.stroke();
  // 每一面（中心 → 兩個頂點）照面的方向和光的夾角上色
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const fa = Math.atan2((y0 + y1) / 2, (x0 + x1) / 2), k = Math.cos(fa - LIGHT);  // 1 = 正對光
    ctx.fillStyle = k > 0 ? mix(col, '#ffffff', k * bright) : mix(col, '#000000', -k * dark);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x0, y0); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
  }
  // 稜線（中心到頂點的細線）
  ctx.strokeStyle = 'rgba(3,5,12,0.35)'; ctx.lineWidth = 0.7;
  for (const [x, y] of pts) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x, y); ctx.stroke(); }
}
function eye(ctx, x, y, r, tint = '#0a1430') {
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(x, y, r + 1, 0, TAU); ctx.fill();
  ctx.fillStyle = tint; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.35, r * 0.4, r * 0.22, -0.5, 0, TAU); ctx.fill();
}
function oldPoly(ctx, n, r, rot, col, w = 2) {  // 對照：現在遊戲的畫法（半透明填色＋船色外框）
  ctx.beginPath(); polyPts(n, r, rot).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  ctx.fillStyle = col + '33'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
}

// ---------- 敵人 ----------
const ENEMIES = [
  { id: 'swarmer', name: '蟲群', col: '#ff4d6d', n: 3, r: 10, note: '小飛蟲：箭頭身體、拍動的半透明翅膀、分節腹部、觸角、紅眼', face: true },
  { id: 'brute', name: '刺殼', col: '#ff9f1c', n: 6, r: 22, note: '六角甲殼（外殼＋錯開的內層甲片）、六根長刺、前方大顎和發光小眼', face: true },
  { id: 'brute_ball', name: '刺殼（攻擊：旋轉滾動）', col: '#ff9f1c', n: 6, r: 22, note: '頭和大顎收進殼裡，六角殼帶著刺旋轉衝過來', face: true },
  { id: 'spitter', name: '噴吐者', col: '#f72585', n: 4, r: 13, note: '酸液囊：半透明肚子裡發光的酸液、肉質噴管（開火前鼓起）、背上一隻眼', face: true },
  { id: 'elite', name: '虛空獵手', col: '#ffd400', n: 5, r: 26, note: '吸光的虛空黑身體、只有邊緣透金光；鐮刀刃翼（拖出金色殘光）、發光眼縫、環繞碎晶', face: true },
  { id: 'gunboat', name: '彈幕艇', col: '#ff6b9d', n: 7, r: 16, note: '砲台碟：轉動的砲塔環、7 根砲管朝外、中央圓頂；蓄力時砲管由內往外亮' },
  { id: 'worm', name: '列隊蟲', col: '#c0ff4d', n: 4, r: 9, note: '蜈蚣：頭有大顎、每節圓甲殼＋划動的腳、尾刺', face: true },
  { id: 'worm_cut', name: '列隊蟲（頭被打掉）', col: '#c0ff4d', n: 4, r: 9, note: '頭爆開 → 下一節長出大顎和眼睛（0.3 秒）、整條變快；尾刺永遠在最後一節', face: true },
  { id: 'shield', name: '盾衛', col: '#5ec8ff', n: 6, r: 20, note: '實體弧形塔盾用兩支機械臂固定在身上、外側能量光膜；裝甲身體＋肩甲＋護目鏡縫', face: true },
  { id: 'splitter', name: '分裂體', col: '#ffb347', n: 5, r: 18, note: '3 塊碎片拼成、接縫發光，每塊一隻眼（死了就分成這 3 塊）', face: true },
  { id: 'splitling', name: '碎裂體', col: '#ffb347', n: 3, r: 10, note: '就是分裂體的其中一塊：斷面發光', face: true },
  { id: 'lurker', name: '潛伏者', col: '#9d8cff', n: 3, r: 12, note: '光學迷彩：幾乎透明、折射的彩色輪廓、一對發光的眼、兩把前伸的利爪', face: true },
  { id: 'hive', name: '母巢', col: '#e05d2e', n: 9, r: 30, note: '活的巢穴：觸根抓地、脈動血管、4 個孵化口輪流張開（看得到蟲群）、中央跳動的心臟' },
  { id: 'dummy', name: '標靶', col: '#9fb4ff', n: 8, r: 18, note: '練習用無人機：靶面＋三腳支架＋彈痕' },
  { id: 'boss', name: '星噬母艦', col: '#ff4d6d', n: 8, r: 50, note: '有機機械母艦：機庫艙門輪流打開（看得到蟲群）、外圈螺旋砲環、中央豎瞳大眼', boss: 4 },
  { id: 'boss2', name: '裂界獵艦', col: '#b388ff', n: 3, r: 42, note: '刀刃狀戰艦：中線發光的裂界縫、長狙擊炮管、兩側推進器和吊艙', boss: 3 },
  { id: 'boss3', name: '終焉核心', col: '#2ee6a6', n: 6, r: 56, note: '機械核心球：兩圈反向轉、有缺口的六角裝甲環（節點發光），裡面發光的核心', boss: 6 },
];
function artEnemy(ctx, E, t) {
  const spin = opt.spin ? t : 0, rot = E.face ? -0.4 + Math.sin(spin * 0.8) * 0.5 : spin * 0.35;
  if (opt.old) {
    oldPoly(ctx, E.n, E.r, rot, E.col, E.boss || E.id === 'elite' ? 3 : 2);
    if (E.boss) { ctx.strokeStyle = E.col; ctx.lineWidth = 2; oldPoly(ctx, E.boss, E.r * 0.62, -spin * 0.6, E.col); ctx.fillStyle = E.col; ctx.globalAlpha = 0.5 + 0.4 * Math.sin(spin * 5); ctx.beginPath(); ctx.arc(0, 0, E.r * 0.28, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    return;
  }
  const c = E.col;
  const NEWDRAW = { swarmer: drawSwarmer, spitter: drawSpitter, gunboat: drawGunboat, worm: drawWorm, worm_cut: drawWormCut, lurker: drawLurker, dummy: drawDummy, boss: drawBoss1, boss2: drawBoss2, boss3: drawBoss3 };
  if (NEWDRAW[E.id]) { ctx.save(); if (E.id !== 'boss3') ctx.rotate(E.id === 'boss' || E.id === 'gunboat' ? 0 : rot); NEWDRAW[E.id](ctx, c, E.r, spin); ctx.restore(); return; }
  if (E.id === 'worm') {  // 6 節：後面的跟著前一節蛇行
    for (let i = 5; i >= 0; i--) {
      const x = -i * 15, y = Math.sin(spin * 4 - i * 0.9) * 6;
      ctx.save(); ctx.translate(x, y); faceted(ctx, polyPts(4, E.r * (i ? 0.9 : 1), Math.PI / 4), c, { outline: 2.6 }); if (!i) eye(ctx, 2, 0, 2.6); ctx.restore();
    }
    return;
  }
  if (E.id === 'brute' || E.id === 'brute_ball') { ctx.save(); ctx.rotate(rot); drawBrute(ctx, c, E.r, spin, E.id === 'brute_ball'); ctx.restore(); return; }
  if (E.id === 'elite') { ctx.save(); ctx.rotate(rot); drawElite(ctx, c, E.r, spin); ctx.restore(); return; }
  if (E.id === 'splitter') { ctx.save(); ctx.rotate(rot); drawSplitter(ctx, c, E.r, spin); ctx.restore(); return; }
  if (E.id === 'shield') { ctx.save(); ctx.rotate(rot); drawShieldGuard(ctx, c, E.r, spin); ctx.restore(); return; }
  if (E.id === 'hive') { ctx.save(); drawHiveNest(ctx, c, E.r, spin); ctx.restore(); return; }
  if (E.id === 'splitling') { ctx.save(); ctx.rotate(rot); drawShard(ctx, c, E.r * 1.8, 0, spin, true); ctx.restore(); return; }
  if (E.id === 'lurker') {  // 殘影＋半透明身體
    for (let k = 3; k >= 1; k--) { ctx.save(); ctx.globalAlpha = 0.08 * (4 - k); ctx.translate(-k * 9, 0); faceted(ctx, polyPts(3, E.r * (1 - k * 0.1), 0), c); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = 0.35; faceted(ctx, polyPts(3, E.r, 0), c); ctx.restore();
    glow(ctx, 3, 0, 14, '#c9bfff', 0.9); eye(ctx, 3, 0, 2.4, '#e9e4ff');
    return;
  }
  ctx.save(); ctx.rotate(rot);
  if (E.id === 'elite') {  // 外圈金色光環（不跟身體同向轉）
    ctx.save(); ctx.rotate(-rot - spin * 0.7); ctx.strokeStyle = rgba(c, 0.55); ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.arc(0, 0, E.r * 1.45, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    glow(ctx, 0, 0, E.r * 1.8, c, 0.35);
  }
  if (E.id === 'boss3') {  // 外層護環
    ctx.save(); ctx.rotate(spin * 0.25); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 9;
    ctx.beginPath(); polyPts(6, E.r * 1.32, 0).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = mix(c, '#000000', 0.35); ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = rgba(c, 0.8); ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
  }
  if (E.id === 'boss2') {  // 兩側推進器噴焰（船尾）
    for (const sg of [-1, 1]) { ctx.fillStyle = `rgba(200,170,255,${0.55 + Math.random() * 0.3})`; ctx.beginPath(); ctx.moveTo(-E.r * 0.45, sg * E.r * 0.55 - 5); ctx.lineTo(-E.r * 0.45 - 22 - Math.random() * 8, sg * E.r * 0.55); ctx.lineTo(-E.r * 0.45, sg * E.r * 0.55 + 5); ctx.fill(); }
  }
  if (E.id === 'brute') {  // 刺：每個角一根金屬刺
    for (const [x, y] of polyPts(6, E.r, 0)) { const a = Math.atan2(y, x); ctx.fillStyle = '#5a6584'; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x + Math.cos(a + 1.6) * 4, y + Math.sin(a + 1.6) * 4); ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9); ctx.lineTo(x + Math.cos(a - 1.6) * 4, y + Math.sin(a - 1.6) * 4); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  }
  const wob = E.id === 'hive' ? [1, 0.86, 1.05, 0.9, 1, 0.84, 1.06, 0.92, 0.97] : null;
  // 身體（光從左上來：在世界座標算，轉回去）
  ctx.rotate(-rot);
  const pts = polyPts(E.n, E.r, rot + (E.id === 'dummy' ? Math.PI / 8 : 0), wob);
  faceted(ctx, pts, c, { outline: E.boss ? 4.5 : E.r > 20 ? 3.6 : 3 });
  ctx.rotate(rot);
  if (E.id === 'spitter') {  // 前方金屬噴口
    const g = ctx.createLinearGradient(0, -3, 0, 3); g.addColorStop(0, '#9aa6c4'); g.addColorStop(1, '#2a3150');
    ctx.fillStyle = g; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(6, -2.5); ctx.lineTo(13, -3.6); ctx.lineTo(13, 3.6); ctx.lineTo(6, 2.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    glow(ctx, 14, 0, 10, c, 0.8 + 0.2 * Math.sin(spin * 6)); ctx.fillStyle = '#ffd6ea'; ctx.beginPath(); ctx.ellipse(13, 0, 1, 3, 0, 0, TAU); ctx.fill();
    eye(ctx, -2, 0, 3);
  } else if (E.id === 'gunboat') {  // 一圈砲口
    const charge = 0.5 + 0.5 * Math.sin(spin * 3);
    for (const [x, y] of polyPts(7, E.r * 0.72, 0)) { glow(ctx, x, y, 6, '#ff2a6a', charge * 0.9); ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, TAU); ctx.fill(); ctx.fillStyle = mix('#ff2a6a', '#ffffff', charge * 0.5); ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU); ctx.fill(); }
    eye(ctx, 0, 0, 4);
  } else if (E.id === 'shield') {  // 120° 能量盾（加法發光）
    ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over';
    ctx.strokeStyle = rgba('#bfefff', 0.25); ctx.lineWidth = 10; ctx.beginPath(); ctx.arc(0, 0, E.r + 7, -Math.PI / 3, Math.PI / 3); ctx.stroke();
    ctx.strokeStyle = '#d9f6ff'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    eye(ctx, -2, 0, 4);
  } else if (E.id === 'splitter') {  // 發光裂縫
    ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; ctx.strokeStyle = '#ffe2a8'; ctx.lineWidth = 1.4;
    for (const [a, l] of [[0.3, 13], [2.4, 11], [4.3, 12]]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * l * 0.5 + 2, Math.sin(a) * l * 0.5 - 1); ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l); ctx.stroke(); }
    ctx.restore(); glow(ctx, 0, 0, 12, '#ffb347', 0.5); eye(ctx, 0, 0, 3.4);
  } else if (E.id === 'hive') {  // 脈動核心
    const p = 0.5 + 0.5 * Math.sin(spin * 4);
    glow(ctx, 0, 0, E.r * 1.1, '#ff7a3d', 0.4 + p * 0.5);
    ctx.fillStyle = '#2a0e06'; ctx.beginPath(); ctx.arc(0, 0, E.r * 0.42, 0, TAU); ctx.fill();
    ctx.fillStyle = mix('#ff7a3d', '#ffd6a8', p * 0.6); ctx.beginPath(); ctx.arc(0, 0, E.r * (0.22 + p * 0.06), 0, TAU); ctx.fill();
  } else if (E.id === 'dummy') {  // 靶心
    for (const [r, w] of [[11, 2], [6, 2]]) { ctx.strokeStyle = '#03050c'; ctx.lineWidth = w + 1.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = w; ctx.stroke(); }
    ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();
  } else if (E.boss) {  // 旗艦：反轉內環＋脈動核心
    ctx.save(); ctx.rotate(-spin * 0.9);
    const ip = polyPts(E.boss, E.r * 0.62, 0);
    ctx.beginPath(); ip.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
    ctx.strokeStyle = '#03050c'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = mix(c, '#ffffff', 0.25); ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    const p = 0.5 + 0.5 * Math.sin(spin * 5);
    glow(ctx, 0, 0, E.r * 0.9, c, 0.45 + p * 0.45);
    ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, E.r * 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = mix(c, '#ffffff', 0.35 + p * 0.4); ctx.beginPath(); ctx.arc(0, 0, E.r * (0.18 + p * 0.05), 0, TAU); ctx.fill();
  } else if (E.id === 'elite') {
    glow(ctx, 6, 0, 16, '#fff3a0', 0.6); eye(ctx, 6, 0, 6.5, '#1a1400');
  } else {
    eye(ctx, E.n === 3 ? 2 : 0, 0, Math.max(2.4, E.r * 0.24));
    if (E.id === 'splitling') { ctx.strokeStyle = mix(c, '#ffffff', 0.5); ctx.lineWidth = 1.5; ctx.beginPath(); const p = polyPts(3, E.r, 0); ctx.moveTo(p[1][0], p[1][1]); ctx.lineTo(p[2][0], p[2][1]); ctx.stroke(); }
  }
  ctx.restore();
}

// 光從左上來的實心橢圓（甲片用）
function litEllipse(ctx, x, y, rx, ry, col, rotAbs = 0) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2.6; ctx.stroke();
  const L = LIGHT - rotAbs, g = ctx.createLinearGradient(x + Math.cos(L) * rx, y + Math.sin(L) * ry, x - Math.cos(L) * rx, y - Math.sin(L) * ry);
  g.addColorStop(0, mix(col, '#ffffff', 0.35)); g.addColorStop(0.55, col); g.addColorStop(1, mix(col, '#000000', 0.6));
  ctx.fillStyle = g; ctx.fill();
}
function spike(ctx, x, y, a, len, w = 3.5) {
  ctx.beginPath(); ctx.moveTo(x + Math.cos(a + 1.57) * w, y + Math.sin(a + 1.57) * w); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.lineTo(x + Math.cos(a - 1.57) * w, y + Math.sin(a - 1.57) * w); ctx.closePath();
  const g = ctx.createLinearGradient(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len); g.addColorStop(0, '#2a3150'); g.addColorStop(1, '#c9d2ea');
  ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.stroke();
}
// 刺殼：甲殼生物（重疊甲片＋背上一排長刺＋前方大顎）；curled：縮成球，甲片合起來、刺朝外
// 刺殼：六角甲殼（外殼一圈、內層甲片一圈），六個角各一根長刺；平常前方露出頭和大顎
//   curled（攻擊前）：頭和大顎收進殼裡，整個六角殼帶著刺旋轉（形狀不變成圓）
function drawBrute(ctx, c, r, t, curled) {
  const spin = curled ? t * 6 : 0;
  if (!curled) {
    for (const sg of [-1, 1]) {  // 大顎
      ctx.beginPath(); ctx.moveTo(r * 0.7, sg * r * 0.22); ctx.quadraticCurveTo(r * 1.45, sg * r * 0.55, r * 1.3, sg * r * 0.05);
      ctx.lineTo(r * 1.1, sg * r * 0.12); ctx.quadraticCurveTo(r * 1.15, sg * r * 0.35, r * 0.68, sg * r * 0.38); ctx.closePath();
      ctx.fillStyle = '#5a6584'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.4; ctx.stroke();
    }
    litEllipse(ctx, r * 0.78, 0, r * 0.28, r * 0.26, mix(c, '#000000', 0.35));  // 頭
    for (const sg of [-1, 1]) { glow(ctx, r * 0.9, sg * r * 0.11, 5, '#ffcf6b', 0.9); ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.arc(r * 0.9, sg * r * 0.11, 1.4, 0, TAU); ctx.fill(); }
  }
  ctx.save(); ctx.rotate(spin);
  const outer = polyPts(6, r, 0);
  for (const [x, y] of outer) { const a = Math.atan2(y, x); spike(ctx, x * 0.85, y * 0.85, a, r * 0.75, 4); }  // 六根長刺
  ctx.rotate(-spin);
  faceted(ctx, polyPts(6, r, spin), c, { outline: 3.6 });  // 外殼（光從左上，跟著轉的時候亮面會換）
  faceted(ctx, polyPts(6, r * 0.62, spin + Math.PI / 6), mix(c, '#000000', 0.12), { outline: 2.4 });  // 內層甲片（錯開 30°）
  ctx.rotate(spin);
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.fill();  // 中心的鉚釘
  ctx.fillStyle = mix(c, '#ffffff', 0.3); ctx.beginPath(); ctx.arc(-r * 0.05, -r * 0.05, r * 0.11, 0, TAU); ctx.fill();
  ctx.restore();
  if (curled) {  // 旋轉的速度線
    ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; ctx.strokeStyle = rgba(c, 0.35); ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const a = t * 6 + i * TAU / 3; ctx.beginPath(); ctx.arc(0, 0, r * 1.75, a, a + 0.9); ctx.stroke(); }
    ctx.restore();
  }
}
// 虛空獵手：吸光的虛空黑身體、只有邊緣透金光；前方兩把鐮刀刃翼、中間一條發光眼縫、身邊環繞碎晶
function drawElite(ctx, c, r, t) {
  glow(ctx, 0, 0, r * 2.2, c, 0.28);
  ADD(ctx, () => { for (const sg of [-1, 1]) for (let k = 1; k <= 4; k++) { ctx.strokeStyle = rgba(c, 0.22 / k); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(r * 1.2 - k * 9, sg * r * 0.75); ctx.quadraticCurveTo(-r * 0.4 - k * 9, sg * r * 1.45, -r * 0.4 - k * 12, sg * r * 0.5); ctx.stroke(); } });  // 刃翼的金色殘光
  for (let i = 0; i < 4; i++) {  // 碎晶
    const a = t * 1.1 + i * TAU / 4, x = Math.cos(a) * r * 1.65, y = Math.sin(a) * r * 1.65;
    ctx.save(); ctx.translate(x, y); faceted(ctx, polyPts(3, 5, a * 2), mix(c, '#ffffff', 0.15), { outline: 2 }); ctx.restore();
  }
  const blade = sg => {  // 鐮刀刃翼：從身體兩側往外彎、刃尖朝前
    ctx.beginPath(); ctx.moveTo(-r * 0.3, sg * r * 0.45);
    ctx.quadraticCurveTo(-r * 0.2, sg * r * 1.55, r * 1.45, sg * r * 0.7);
    ctx.quadraticCurveTo(r * 0.35, sg * r * 0.95, r * 0.2, sg * r * 0.4); ctx.closePath();
  };
  for (const sg of [-1, 1]) {
    blade(sg); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3.5; ctx.stroke(); ctx.fillStyle = '#0d0b17'; ctx.fill();
    ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; blade(sg); ctx.strokeStyle = rgba(c, 0.85); ctx.lineWidth = 1.3; ctx.stroke(); ctx.restore();
  }
  const pts = polyPts(5, r, 0);
  ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  ctx.strokeStyle = '#03050c'; ctx.lineWidth = 4; ctx.stroke(); ctx.fillStyle = '#0d0b17'; ctx.fill();
  ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over';
  ctx.strokeStyle = rgba(c, 0.9); ctx.lineWidth = 1.5; ctx.stroke();  // 金色邊緣光
  ctx.strokeStyle = rgba(c, 0.5); ctx.lineWidth = 1;  // 身上的金色裂紋
  for (const [a, l] of [[2.2, 0.75], [3.6, 0.7], [4.6, 0.6]]) { ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25); ctx.lineTo(Math.cos(a + 0.25) * r * l * 0.6, Math.sin(a + 0.25) * r * l * 0.6); ctx.lineTo(Math.cos(a) * r * l, Math.sin(a) * r * l); ctx.stroke(); }
  ctx.restore();
  const p = 0.6 + 0.4 * Math.sin(t * 4);  // 眼縫
  glow(ctx, r * 0.35, 0, r * 0.9, '#fff3a0', 0.5 + p * 0.4);
  ctx.fillStyle = mix('#fff3a0', '#ffffff', p * 0.5); ctx.beginPath(); ctx.ellipse(r * 0.35, 0, 2.2, r * 0.42, 0, 0, TAU); ctx.fill();
}
// 分裂體：3 塊碎片拼成，接縫發光；每塊各一隻小眼（死掉就分成這 3 塊＝碎裂體）
const SPLIT_TRI = r => polyPts(3, r, 0);
function shardPts(r, i) {  // 大三角形切成 3 塊：頂點 i、兩邊中點、中心
  const T = SPLIT_TRI(r), v = T[i], a = T[(i + 1) % 3], b = T[(i + 2) % 3];
  return [v, [(v[0] + a[0]) / 2, (v[1] + a[1]) / 2], [0, 0], [(v[0] + b[0]) / 2, (v[1] + b[1]) / 2]];
}
function drawShard(ctx, c, R, i, t, alone = false) {
  const pts = shardPts(R, i), cx = pts[0][0] * 0.45, cy = pts[0][1] * 0.45;
  ctx.save();
  if (alone) ctx.translate(-cx, -cy);  // 單獨一塊（碎裂體）：以自己為中心
  else { const k = 1.6 + Math.sin(t * 3) * 0.6; ctx.translate(pts[0][0] / R * k, pts[0][1] / R * k); }  // 拼在一起時稍微分開，接縫看得到
  ctx.translate(cx, cy);
  faceted(ctx, pts.map(([x, y]) => [x - cx, y - cy]), c, { outline: 2.8 });
  if (alone) { ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; ctx.strokeStyle = '#ffe2a8'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(pts[1][0] - cx, pts[1][1] - cy); ctx.lineTo(-cx, -cy); ctx.lineTo(pts[3][0] - cx, pts[3][1] - cy); ctx.stroke(); ctx.restore(); }  // 斷面發光
  eye(ctx, 0, 0, Math.max(2, R * 0.11));
  ctx.restore();
}
function drawSplitter(ctx, c, r, t) {
  const R = r * 1.45, p = 0.5 + 0.5 * Math.sin(t * 3);
  glow(ctx, 0, 0, R * 0.9, '#ffb347', 0.35 + p * 0.3);
  ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; ctx.strokeStyle = mix('#ffe2a8', '#ffffff', p * 0.4); ctx.lineWidth = 3;  // 接縫的光（在碎片底下）
  const T = SPLIT_TRI(R); for (let i = 0; i < 3; i++) { const a = T[i], b = T[(i + 1) % 3]; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.stroke(); }
  ctx.restore();
  for (let i = 0; i < 3; i++) drawShard(ctx, c, R, i, t);
}

// 盾衛：厚重裝甲六角身體＋肩甲＋橫向護目鏡縫；實體弧形塔盾用兩支機械臂固定在身上，盾外側一層能量光膜（會反彈子彈）
function drawShieldGuard(ctx, c, r, t) {
  const A = Math.PI / 3, R0 = r + 6, R1 = r + 13;  // 盾：120°、內緣 R0、外緣 R1
  for (const sg of [-1, 1]) {  // 機械臂：身體邊緣 → 盾的內側
    const a = sg * A * 0.55, x0 = Math.cos(a) * r * 0.7, y0 = Math.sin(a) * r * 0.7, x1 = Math.cos(a) * (R0 + 1), y1 = Math.sin(a) * (R0 + 1);
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 7; ctx.stroke(); ctx.strokeStyle = '#5a6584'; ctx.lineWidth = 4.5; ctx.stroke(); ctx.strokeStyle = 'rgba(220,230,255,0.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = '#2a3150'; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x0, y0, 3, 0, TAU); ctx.fill(); ctx.stroke();  // 關節
  }
  // 身體
  faceted(ctx, polyPts(6, r, 0), c, { outline: 3.8 });
  for (const sg of [-1, 1]) { ctx.save(); ctx.translate(-r * 0.15, sg * r * 0.72); faceted(ctx, polyPts(4, r * 0.38, Math.PI / 4), mix(c, '#000000', 0.25), { outline: 2.4 }); ctx.restore(); }  // 肩甲
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.roundRect(r * 0.05, -r * 0.42, r * 0.34, r * 0.84, 3); ctx.fill();  // 護目鏡縫
  glow(ctx, r * 0.24, 0, r * 0.7, '#7fe3ff', 0.7);
  ctx.fillStyle = '#bff3ff'; ctx.beginPath(); ctx.roundRect(r * 0.14, -r * 0.32, r * 0.16, r * 0.64, 2); ctx.fill();
  // 實體塔盾：金屬弧板（上亮下暗）＋鉚釘＋邊框
  const plate = () => { ctx.beginPath(); ctx.arc(0, 0, R1, -A, A); ctx.arc(0, 0, R0, A, -A, true); ctx.closePath(); };
  plate(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  const g = ctx.createLinearGradient(0, -R1, 0, R1); g.addColorStop(0, '#b4bfd9'); g.addColorStop(0.5, '#5a6584'); g.addColorStop(1, '#232a45');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(3,5,12,0.6)'; ctx.lineWidth = 1; for (const a of [-A * 0.5, 0, A * 0.5]) { ctx.beginPath(); ctx.moveTo(Math.cos(a) * R0, Math.sin(a) * R0); ctx.lineTo(Math.cos(a) * R1, Math.sin(a) * R1); ctx.stroke(); }  // 板接縫
  ctx.fillStyle = 'rgba(220,230,255,0.6)'; for (const a of [-A * 0.75, -A * 0.25, A * 0.25, A * 0.75]) { ctx.beginPath(); ctx.arc(Math.cos(a) * (R0 + R1) / 2, Math.sin(a) * (R0 + R1) / 2, 1, 0, TAU); ctx.fill(); }  // 鉚釘
  // 外側能量光膜
  ADD(ctx, () => {
    const p = 0.6 + 0.4 * Math.sin(t * 4);
    ctx.strokeStyle = rgba('#bfefff', 0.25 * p); ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(0, 0, R1 + 4, -A * 0.95, A * 0.95); ctx.stroke();
    ctx.strokeStyle = rgba('#e6faff', 0.75); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, R1 + 2, -A * 0.95, A * 0.95); ctx.stroke();
    const lim = A * 0.95 - 0.14, a = Math.sin(t * 1.6) * lim;  // 光掃過：只在盾的範圍內來回（兩端留 0.14 給光的長度）
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, R1 + 2, a - 0.12, a + 0.12); ctx.stroke();
  });
}
// 母巢：活的巢穴：不規則肉質外殼＋觸根抓地＋脈動血管＋4 個輪流張開的孵化口（看得到裡面的蟲群）＋中央跳動的心臟
function drawHiveNest(ctx, c, r, t) {
  for (let i = 0; i < 7; i++) {  // 觸根
    const a = i / 7 * TAU + 0.3, L = r * (0.25 + seeded(i + 40) * 0.2), sw = Math.sin(t * 0.8 + i) * 0.12;
    const x0 = Math.cos(a) * r * 0.8, y0 = Math.sin(a) * r * 0.8, x1 = Math.cos(a + 0.25 + sw) * (r + L * 0.6), y1 = Math.sin(a + 0.25 + sw) * (r + L * 0.6), x2 = Math.cos(a + 0.1 + sw) * (r + L), y2 = Math.sin(a + 0.1 + sw) * (r + L);
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x1, y1, x2, y2); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 7; ctx.stroke(); ctx.strokeStyle = mix(c, '#000000', 0.45); ctx.lineWidth = 4.5; ctx.stroke(); ctx.strokeStyle = rgba('#ffb08a', 0.3); ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineCap = 'butt';
  }
  const beat = Math.max(0, Math.sin(t * 3)) ** 3, wob = [1, 0.86, 1.05, 0.9, 1, 0.84, 1.06, 0.92, 0.97];
  ctx.save(); ctx.scale(1 + beat * 0.03, 1 + beat * 0.03);
  // 外殼：一團團肉瘤堆成（外圈 9 顆、中間一大團），每顆光從左上來
  ctx.fillStyle = '#03050c'; ctx.beginPath(); for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.2, rr = r * 0.62 * wob[i]; ctx.moveTo(Math.cos(a) * rr + r * 0.42, Math.sin(a) * rr); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, r * 0.42 + 2, 0, TAU); } ctx.fill();
  for (let i = 0; i < 9; i++) { const a = i / 9 * TAU + 0.2, rr = r * 0.62 * wob[i], s = 0.38 + seeded(i + 77) * 0.08; litEllipse(ctx, Math.cos(a) * rr, Math.sin(a) * rr, r * s, r * s * 0.9, mix(c, '#000000', seeded(i + 78) * 0.2)); }
  litEllipse(ctx, 0, 0, r * 0.62, r * 0.6, c);
  ADD(ctx, () => {  // 外殼上的脈動血管
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.6; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3); ctx.quadraticCurveTo(Math.cos(a + 0.4) * r * 0.6, Math.sin(a + 0.4) * r * 0.6, Math.cos(a + 0.2) * r * 0.88, Math.sin(a + 0.2) * r * 0.88); ctx.strokeStyle = rgba('#ff5d73', 0.25 + beat * 0.4); ctx.lineWidth = 2.2; ctx.stroke(); }
  });
  for (let i = 0; i < 4; i++) {  // 孵化口：輪流張開（4 秒一輪，跟生蟲群的節奏一樣）
    const a = i / 4 * TAU + Math.PI / 4, x = Math.cos(a) * r * 0.62, y = Math.sin(a) * r * 0.62;
    const ph = ((t / 4 + i / 4) % 1), open = ph < 0.25 ? Math.sin(ph / 0.25 * Math.PI) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 5.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = mix(c, '#000000', 0.3); ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 4.6, 0, 0, TAU); ctx.fill();
    if (open > 0.05) {
      glow(ctx, 0, 0, 12, '#ff8a5e', open * 0.8);
      ctx.fillStyle = '#16050a'; ctx.beginPath(); ctx.ellipse(0, 0, 5.5 * open, 3.6 * open, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('#ff4d6d', open); ctx.beginPath(); ctx.moveTo(3 * open, 0); ctx.lineTo(-2 * open, -2 * open); ctx.lineTo(-2 * open, 2 * open); ctx.closePath(); ctx.fill();  // 裡面的蟲群
    } else { ctx.strokeStyle = 'rgba(3,5,12,0.8)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(5, 0); ctx.stroke(); }  // 閉合的縫
    ctx.restore();
  }
  // 中央心臟
  glow(ctx, 0, 0, r * 0.75, '#ff7a3d', 0.35 + beat * 0.6);
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, TAU); ctx.fill();
  const hr = r * (0.2 + beat * 0.06);
  const hg = ctx.createRadialGradient(-hr * 0.3, -hr * 0.3, 0, 0, 0, hr); hg.addColorStop(0, '#ffd6a8'); hg.addColorStop(0.5, '#ff7a3d'); hg.addColorStop(1, '#8a1e0a');
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(0, 0, hr, 0, TAU); ctx.fill();
  ctx.restore();
}

// ===== 敵人個性化（刺殼、母巢、盾衛以外）：每種照牠在遊戲裡的行為設計 =====
function chitin(ctx, x, y, rx, ry, col) { litEllipse(ctx, x, y, rx, ry, col); }
// 蟲群：小飛蟲（箭頭身體、拍動的半透明翅膀、分節腹部、觸角、紅眼）
function drawSwarmer(ctx, c, r, t) {
  const flap = Math.sin(t * 40);
  ADD(ctx, () => { for (const sg of [-1, 1]) { ctx.save(); ctx.rotate(sg * (0.9 + flap * 0.35)); ctx.fillStyle = rgba('#ffd0da', 0.22); ctx.strokeStyle = rgba('#ffd0da', 0.5); ctx.lineWidth = 0.6; ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 0.95, r * 0.32, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.restore(); } });
  for (let k = 2; k >= 1; k--) chitin(ctx, -r * 0.45 * k, 0, r * (0.42 - k * 0.07), r * (0.34 - k * 0.06), mix(c, '#000000', 0.15 * k));  // 腹部分節
  faceted(ctx, [[r * 1.05, 0], [-r * 0.35, -r * 0.55], [-r * 0.1, 0], [-r * 0.35, r * 0.55]], c, { outline: 2.2 });
  ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1; for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.7, sg * r * 0.15); ctx.quadraticCurveTo(r * 1.2, sg * r * 0.3, r * 1.45, sg * r * 0.55); ctx.stroke(); }  // 觸角
  glow(ctx, r * 0.45, 0, 5, '#ff2a4a', 0.9); ctx.fillStyle = '#ff6a7e'; ctx.beginPath(); ctx.arc(r * 0.45, 0, 1.6, 0, TAU); ctx.fill();
}
// 噴吐者：鼓脹的酸液囊（半透明肚子裡發光的酸液）、肉質噴管（環狀肌肉，開火前鼓起）、背上一隻眼
function drawSpitter(ctx, c, r, t) {
  const cyc = (t % 1.8) / 1.8, swell = cyc > 0.75 ? Math.sin((cyc - 0.75) / 0.25 * Math.PI) : 0;  // 開火前噴管鼓起
  for (const sg of [-1, 1]) for (const k of [-1, 0, 1]) { const a = sg * (1.7 + k * 0.35), x = Math.cos(a) * r * 0.85, y = Math.sin(a) * r * 0.85; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(x * 0.7, y * 0.7); ctx.lineTo(x * 1.35, y * 1.35 + Math.sin(t * 8 + k) * 1.5); ctx.stroke(); ctx.strokeStyle = mix(c, '#000000', 0.5); ctx.lineWidth = 1.4; ctx.stroke(); }  // 小腳
  const nz = r * (0.55 + swell * 0.12);  // 噴管
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.ellipse(r * 0.95, 0, r * 0.62, nz * 0.62 + 1.5, 0, 0, TAU); ctx.fill();
  const ng = ctx.createLinearGradient(0, -nz, 0, nz); ng.addColorStop(0, mix(c, '#ffffff', 0.3)); ng.addColorStop(1, mix(c, '#000000', 0.5));
  ctx.fillStyle = ng; ctx.beginPath(); ctx.ellipse(r * 0.95, 0, r * 0.6, nz * 0.6, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(3,5,12,0.45)'; ctx.lineWidth = 1; for (const x of [0.7, 0.95, 1.2]) { ctx.beginPath(); ctx.ellipse(r * x, 0, 1.5, nz * 0.55, 0, 0, TAU); ctx.stroke(); }  // 環狀肌肉
  glow(ctx, r * 1.55, 0, 8 + swell * 8, '#b6ff3a', 0.5 + swell * 0.5); ctx.fillStyle = '#d9ff8a'; ctx.beginPath(); ctx.ellipse(r * 1.55, 0, 1.4, nz * 0.32, 0, 0, TAU); ctx.fill();
  chitin(ctx, -r * 0.1, 0, r * 0.95, r * 0.85, c);  // 囊
  ctx.save(); ctx.beginPath(); ctx.ellipse(-r * 0.2, r * 0.12, r * 0.6, r * 0.5, 0, 0, TAU); ctx.clip();  // 半透明肚子裡的酸液
  ctx.fillStyle = 'rgba(20,40,5,0.7)'; ctx.fill(); ADD(ctx, () => { const lv = r * 0.15 + Math.sin(t * 3) * 2; ctx.fillStyle = 'rgba(150,255,60,0.55)'; ctx.fillRect(-r, lv, r * 2, r); for (let i = 0; i < 3; i++) { const by = r * 0.4 - ((t * 0.6 + i / 3) % 1) * r * 0.6; ctx.beginPath(); ctx.arc(-r * 0.4 + i * r * 0.3, by, 1.5, 0, TAU); ctx.fill(); } });
  ctx.restore(); ctx.strokeStyle = rgba('#ffd0e6', 0.4); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(-r * 0.2, r * 0.12, r * 0.6, r * 0.5, 0, 0, TAU); ctx.stroke();
  eye(ctx, -r * 0.25, -r * 0.45, r * 0.2);
}
// 彈幕艇：砲台碟（會轉的砲塔環、7 根真的砲管朝外、中央圓頂；蓄力時砲管由內往外亮）
function drawGunboat(ctx, c, r, t, chOv = null, ringOv = null) {  // chOv：指定蓄力程度（0～1）、ringOv：指定砲塔角度（產生圖集用）
  const cyc = (t % 3) / 3, ch = chOv != null ? chOv : cyc > 0.8 ? (cyc - 0.8) / 0.2 : 0, ring = ringOv != null ? ringOv : t * 0.5;
  ctx.save(); ctx.rotate(ring);
  for (let i = 0; i < 7; i++) {  // 砲管
    const a = i / 7 * TAU; ctx.save(); ctx.rotate(a);
    ctx.fillStyle = '#03050c'; ctx.fillRect(r * 0.6, -3.2, r * 0.75, 6.4);
    const g = ctx.createLinearGradient(0, -2.6, 0, 2.6); g.addColorStop(0, '#9aa6c4'); g.addColorStop(1, '#2a3150'); ctx.fillStyle = g; ctx.fillRect(r * 0.62, -2.4, r * 0.7, 4.8);
    if (ch > 0) ADD(ctx, () => { ctx.fillStyle = rgba('#ff2a6a', ch); ctx.fillRect(r * 0.62, -1.2, r * 0.7 * ch, 2.4); });
    ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(r * 1.32, 0, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  faceted(ctx, polyPts(7, r * 0.82, ring), c, { outline: 3 });  // 碟身（跟著砲塔環轉）
  ctx.strokeStyle = 'rgba(3,5,12,0.5)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.stroke();  // 砲塔環的接縫
  litEllipse(ctx, 0, 0, r * 0.4, r * 0.4, mix(c, '#ffffff', 0.15));  // 圓頂
  glow(ctx, 0, 0, r * 0.5, '#ff2a6a', 0.3 + ch * 0.7); eye(ctx, 0, 0, r * 0.16, ch > 0 ? '#5a0a20' : '#0a1430');
}
// 列隊蟲：蜈蚣（頭有大顎、每節圓甲殼＋划動的腳、尾刺）
//   first：最前面還活著的是第幾節（頭被打掉 → 下一節變成頭）；grow：新頭的大顎長出來的進度（0～1）
//   遊戲裡：「前面沒有活著的節」那節畫頭（大顎、眼睛），「後面沒有節」那節畫尾刺
function drawWorm(ctx, c, r, t, first = 0, grow = 1, speed = 1) {
  const seg = i => [-i * r * 1.55, Math.sin(t * 4 * speed - i * 0.9) * r * 0.65];  // 頭被打掉時其他節留在原位（不往前補）
  const [tx, ty] = seg(6); ctx.fillStyle = '#5a6584'; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; const [px, py] = seg(5);  // 尾刺
  ctx.beginPath(); ctx.moveTo(px - r * 0.5, py - r * 0.35); ctx.lineTo(tx + r * 0.2, ty); ctx.lineTo(px - r * 0.5, py + r * 0.35); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (let i = 5; i >= first; i--) {
    const [x, y] = seg(i), head = i === first;
    for (const sg of [-1, 1]) { const sw = Math.sin(t * 12 * speed + i * 1.3 + (sg > 0 ? Math.PI : 0)) * 0.5; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(x, y + sg * r * 0.5); ctx.lineTo(x - r * 0.3 + Math.cos(sw) * 2, y + sg * (r * 1.25)); ctx.stroke(); ctx.strokeStyle = mix(c, '#000000', 0.4); ctx.lineWidth = 1.1; ctx.stroke(); }  // 腳
    const hk = head ? grow : 0;  // 新頭慢慢長大一點
    chitin(ctx, x, y, r * (0.85 + 0.15 * hk), r * (0.75 + 0.1 * hk), mix(c, '#000000', (i - first) * 0.04));
    if (!head || grow < 1) { ctx.strokeStyle = `rgba(3,5,12,${0.45 * (1 - hk)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - r * 0.15, y - r * 0.6); ctx.lineTo(x - r * 0.15, y + r * 0.6); ctx.stroke(); }  // 甲殼接縫
  }
  if (grow <= 0) return;
  const [hx, hy] = seg(first), [nx1, ny1] = seg(first + 1), ha = Math.atan2(hy - ny1, hx - nx1);  // 頭的位置和朝向：大顎、眼睛跟著頭
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(ha);
  const bite = Math.sin(t * 6) * 0.12, L = grow;  // 大顎一開一合；新頭的大顎從甲殼裡伸出來
  for (const sg of [-1, 1]) { ctx.save(); ctx.rotate(sg * bite); ctx.beginPath(); ctx.moveTo(r * 0.6, sg * r * 0.35); ctx.quadraticCurveTo(r * (0.6 + 0.9 * L), sg * r * (0.35 + 0.25 * L), r * (0.6 + 0.75 * L), 0); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2.4; ctx.stroke(); ctx.strokeStyle = '#9aa6c4'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore(); }
  for (const sg of [-1, 1]) { glow(ctx, r * 0.45, sg * r * 0.32, 4, '#eaff7a', 0.8 * grow); ctx.fillStyle = rgba('#f5ffc0', grow); ctx.beginPath(); ctx.arc(r * 0.45, sg * r * 0.32, 1.2, 0, TAU); ctx.fill(); }
  ctx.restore();
}
// 示範：頭被打掉 → 下一節長出大顎和眼睛、整條變快（4 秒一輪）
function drawWormCut(ctx, c, r, t) {
  const ph = t % 4;
  if (ph < 2) { drawWorm(ctx, c, r, t, 0, 1); if (ph > 1.75) glow(ctx, 0, 0, r * 2 * (ph - 1.75) * 4, '#ffffff', 0.6); return; }
  const k = ph - 2, grow = Math.min(1, k / 0.3);
  drawWorm(ctx, c, r, t, 1, grow, 1.16);
  if (k < 0.4) {  // 頭爆開的碎片
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU, d = r * (1 + k * 6); ctx.fillStyle = rgba(c, 1 - k / 0.4); ctx.beginPath(); ctx.arc(Math.cos(a) * d, Math.sin(t * 4) * r * 0.65 + Math.sin(a) * d, 2.2, 0, TAU); ctx.fill(); }
    glow(ctx, 0, Math.sin(t * 4) * r * 0.65, r * 2.5, c, 0.8 * (1 - k / 0.4));
  }
}
// 潛伏者：光學迷彩（身體幾乎透明，只看得到折射的彩色輪廓、一對發光的眼、兩把前伸的利爪）
function drawLurker(ctx, c, r, t) {
  const body = () => { ctx.beginPath(); ctx.moveTo(r * 1.1, 0); ctx.quadraticCurveTo(r * 0.2, -r * 0.9, -r * 1.1, -r * 0.5); ctx.quadraticCurveTo(-r * 0.6, 0, -r * 1.1, r * 0.5); ctx.quadraticCurveTo(r * 0.2, r * 0.9, r * 1.1, 0); ctx.closePath(); };
  for (let k = 3; k >= 1; k--) { ctx.save(); ctx.translate(-k * r * 0.7, 0); ctx.globalAlpha = 0.07 * (4 - k); body(); ctx.fillStyle = c; ctx.fill(); ctx.restore(); }  // 殘影
  ctx.save(); ctx.globalAlpha = 0.12; body(); ctx.fillStyle = c; ctx.fill(); ctx.restore();
  ADD(ctx, () => {  // 折射的彩色輪廓（紅、綠、藍錯開）
    for (const [dx, col] of [[-1.2, 'rgba(255,80,120,0.5)'], [0, 'rgba(120,255,180,0.35)'], [1.2, 'rgba(120,150,255,0.5)']]) { ctx.save(); ctx.translate(dx + Math.sin(t * 9) * 0.6, 0); body(); ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
  });
  for (const sg of [-1, 1]) {  // 利爪
    ctx.beginPath(); ctx.moveTo(r * 0.3, sg * r * 0.45); ctx.quadraticCurveTo(r * 1.1, sg * r * 0.9, r * 1.6, sg * r * 0.35); ctx.quadraticCurveTo(r * 1.1, sg * r * 0.6, r * 0.5, sg * r * 0.3); ctx.closePath();
    ctx.fillStyle = 'rgba(220,215,255,0.75)'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1; ctx.stroke();
  }
  for (const sg of [-1, 1]) { glow(ctx, r * 0.55, sg * r * 0.2, 7, '#c9bfff', 0.9); ctx.fillStyle = '#f0ecff'; ctx.beginPath(); ctx.ellipse(r * 0.55, sg * r * 0.2, 2.2, 1, sg * 0.4, 0, TAU); ctx.fill(); }
}
// 標靶：練習用無人機（靶面＋三腳支架＋彈痕）
function drawDummy(ctx, c, r, t) {
  for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + Math.PI / 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#5a6584'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineCap = 'butt'; ctx.fillStyle = '#2a3150'; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35, 3, 0, TAU); ctx.fill(); }
  faceted(ctx, polyPts(8, r, Math.PI / 8), c, { outline: 3 });
  for (const [rr, col] of [[0.78, '#f2f4fa'], [0.6, '#ff6b6b'], [0.42, '#f2f4fa'], [0.24, '#ff6b6b']]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r * rr, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#1a1c22'; for (const [x, y] of [[0.3, -0.2], [-0.15, 0.35], [0.05, 0.05], [-0.4, -0.25]]) { ctx.beginPath(); ctx.arc(x * r, y * r, 1.3, 0, TAU); ctx.fill(); }  // 彈痕
}
// 星噬母艦：有機機械母艦（機庫艙門開合看得到蟲群、外圈螺旋砲環會轉、中央大眼）
function drawBoss1(ctx, c, r, t) {
  ctx.save(); ctx.rotate(t * 0.6);  // 螺旋砲環
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; ctx.save(); ctx.rotate(a); ctx.fillStyle = '#03050c'; ctx.fillRect(r * 0.95, -3, r * 0.22, 6); ctx.fillStyle = i % 3 ? '#5a6584' : '#9aa6c4'; ctx.fillRect(r * 0.96, -2, r * 0.2, 4); ADD(ctx, () => { ctx.fillStyle = rgba(c, 0.5 + 0.5 * Math.sin(t * 6 - i * 0.8)); ctx.beginPath(); ctx.arc(r * 1.17, 0, 1.6, 0, TAU); ctx.fill(); }); ctx.restore(); }
  ctx.restore();
  faceted(ctx, polyPts(8, r, Math.PI / 8), c, { outline: 4.5 });
  for (let i = 0; i < 4; i++) {  // 機庫艙門（輪流打開）
    const a = i / 4 * TAU + Math.PI / 4, x = Math.cos(a) * r * 0.6, y = Math.sin(a) * r * 0.6, ph = (t / 2 + i / 4) % 1, op = ph < 0.3 ? Math.sin(ph / 0.3 * Math.PI) : 0;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#03050c'; ctx.fillRect(-r * 0.16, -r * 0.13, r * 0.32, r * 0.26);
    if (op > 0.05) { glow(ctx, 0, 0, r * 0.25, '#ff4d6d', op * 0.8); for (const dy of [-0.05, 0.05]) { ctx.fillStyle = rgba('#ff4d6d', op); ctx.beginPath(); ctx.moveTo(r * 0.08, dy * r); ctx.lineTo(-r * 0.04, dy * r - 3); ctx.lineTo(-r * 0.04, dy * r + 3); ctx.closePath(); ctx.fill(); } }
    ctx.fillStyle = '#5a6584'; const h = r * 0.13 * (1 - op); ctx.fillRect(-r * 0.16, -r * 0.13, r * 0.32, h); ctx.fillRect(-r * 0.16, r * 0.13 - h, r * 0.32, h);  // 上下兩片門
    ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.strokeRect(-r * 0.16, -r * 0.13, r * 0.32, r * 0.26);
    ctx.restore();
  }
  const p = 0.5 + 0.5 * Math.sin(t * 5);  // 中央大眼
  glow(ctx, 0, 0, r * 0.7, c, 0.35 + p * 0.4);
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.32, 0, TAU); ctx.fill();
  ctx.fillStyle = mix(c, '#ffffff', 0.2); ctx.beginPath(); ctx.arc(0, 0, r * 0.26, 0, TAU); ctx.fill();
  ctx.fillStyle = '#12030a'; ctx.beginPath(); ctx.ellipse(Math.sin(t * 0.7) * r * 0.06, 0, r * 0.05, r * 0.2, 0, 0, TAU); ctx.fill();  // 豎瞳
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(-r * 0.09, -r * 0.1, r * 0.06, r * 0.03, -0.5, 0, TAU); ctx.fill();
}
// 裂界獵艦：刀刃狀戰艦（中線發光的裂界縫、前方長狙擊炮管、兩側推進器和吊艙）
function drawBoss2(ctx, c, r, t) {
  for (const sg of [-1, 1]) { ctx.fillStyle = `rgba(200,170,255,${0.55 + Math.random() * 0.3})`; ctx.beginPath(); ctx.moveTo(-r * 0.55, sg * r * 0.62 - 6); ctx.lineTo(-r * 0.55 - 26 - Math.random() * 10, sg * r * 0.62); ctx.lineTo(-r * 0.55, sg * r * 0.62 + 6); ctx.fill(); }  // 推進器噴焰
  for (const sg of [-1, 1]) { ctx.save(); ctx.translate(-r * 0.3, sg * r * 0.62); const g = ctx.createLinearGradient(0, -7, 0, 7); g.addColorStop(0, '#9aa6c4'); g.addColorStop(1, '#2a3150'); ctx.fillStyle = g; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(-r * 0.28, -7, r * 0.5, 14, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = c; ctx.fillRect(-r * 0.28, -7, 2.5, 14); ctx.restore(); }  // 推進器
  ctx.fillStyle = '#03050c'; ctx.fillRect(r * 0.5, -4.5, r * 0.85, 9); const bg = ctx.createLinearGradient(0, -3.5, 0, 3.5); bg.addColorStop(0, '#b4bfd9'); bg.addColorStop(1, '#2a3150'); ctx.fillStyle = bg; ctx.fillRect(r * 0.5, -3.5, r * 0.82, 7);  // 狙擊炮管
  ctx.fillStyle = '#03050c'; ctx.fillRect(r * 1.28, -5.5, 6, 11);
  const blade = [[r * 1.05, 0], [-r * 0.6, -r * 0.95], [-r * 0.35, -r * 0.2], [-r * 0.55, 0], [-r * 0.35, r * 0.2], [-r * 0.6, r * 0.95]];
  faceted(ctx, blade, c, { outline: 4.5 });
  for (const sg of [-1, 1]) { ctx.save(); ctx.translate(-r * 0.05, sg * r * 0.5); faceted(ctx, polyPts(3, r * 0.2, sg > 0 ? Math.PI / 2 : -Math.PI / 2), mix(c, '#000000', 0.3), { outline: 2 }); ctx.restore(); }  // 吊艙（部署噴吐者）
  ADD(ctx, () => {  // 裂界縫
    const p = 0.6 + 0.4 * Math.sin(t * 7);
    ctx.strokeStyle = rgba('#e0c8ff', 0.25 * p); ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(r * 0.8, 0); ctx.lineTo(-r * 0.45, 0); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,220,255,0.9)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(r * 0.8, 0); for (let x = 0.7; x > -0.45; x -= 0.12) ctx.lineTo(r * x, Math.sin(x * 30 + t * 20) * 1.6); ctx.stroke();
  });
  eye(ctx, r * 0.25, 0, r * 0.1, '#1a0a30');
}
// 終焉核心：機械核心球（外面兩圈反向轉、有缺口的六角裝甲環，環上能量節點；裡面發光的核心）
function drawBoss3(ctx, c, r, t) {
  const ring = (R, w, rot, gaps) => {
    for (let i = 0; i < 6; i++) {
      if (gaps.includes(i)) continue;
      const a0 = rot + i / 6 * TAU + 0.06, a1 = rot + (i + 1) / 6 * TAU - 0.06;
      ctx.beginPath(); ctx.arc(0, 0, R + w / 2, a0, a1); ctx.arc(0, 0, R - w / 2, a1, a0, true); ctx.closePath();
      ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3; ctx.stroke();
      const g = ctx.createLinearGradient(0, -R, 0, R); g.addColorStop(0, mix(c, '#ffffff', 0.25)); g.addColorStop(1, mix(c, '#000000', 0.65)); ctx.fillStyle = g; ctx.fill();
      const m = (a0 + a1) / 2; glow(ctx, Math.cos(m) * R, Math.sin(m) * R, 7, c, 0.6 + 0.4 * Math.sin(t * 4 + i)); ctx.fillStyle = '#e6fff6'; ctx.beginPath(); ctx.arc(Math.cos(m) * R, Math.sin(m) * R, 1.8, 0, TAU); ctx.fill();  // 節點
    }
  };
  ring(r * 1.2, r * 0.2, t * 0.35, [1]);   // 外環（缺一格：環形波的缺口）
  ring(r * 0.88, r * 0.17, -t * 0.6, [4]); // 內環反轉
  const p = 0.5 + 0.5 * Math.sin(t * 3);
  glow(ctx, 0, 0, r * 0.9, c, 0.4 + p * 0.4);
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, TAU); ctx.fill();
  ctx.save(); ctx.rotate(-t * 0.2); faceted(ctx, polyPts(6, r * 0.55, 0), mix(c, '#000000', 0.2), { outline: 2.4 }); ctx.restore();  // 核心外殼
  const cg = ctx.createRadialGradient(-r * 0.08, -r * 0.08, 0, 0, 0, r * 0.3); cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.45, mix(c, '#ffffff', 0.4)); cg.addColorStop(1, c);
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(0, 0, r * (0.24 + p * 0.04), 0, TAU); ctx.fill();
}

// ---------- 地圖物件 ----------
function drawPlanet(ctx, t, x, y, r) {
  if (opt.old) {
    const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, '#6c7fb8'); g.addColorStop(1, '#1b2448');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(140,170,255,0.5)'; ctx.lineWidth = 2; ctx.stroke(); return;
  }
  if (!globalThis.ART_NO_ORBIT) { ctx.strokeStyle = 'rgba(140,170,255,0.12)'; ctx.setLineDash([4, 10]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r * 1.9, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }  // 產生圖集時不畫（引力範圍圈由遊戲畫）
  glow(ctx, x, y, r * 1.35, '#6f8cff', 0.35);  // 大氣
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.45, y - r * 0.45, r * 0.05, x, y, r * 1.05);
  g.addColorStop(0, '#a9b8ee'); g.addColorStop(0.45, '#5266a8'); g.addColorStop(0.85, '#1d2650'); g.addColorStop(1, '#0d1230');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();  // 雲帶＋坑
  ctx.strokeStyle = 'rgba(200,215,255,0.16)'; ctx.lineWidth = r * 0.09;
  for (const k of [-0.45, -0.1, 0.3]) { ctx.beginPath(); ctx.ellipse(x + Math.sin(t * 0.3 + k * 9) * r * 0.1, y + k * r, r * 1.1, r * 0.16, -0.25, 0, TAU); ctx.stroke(); }
  for (const [cx, cy, cr] of [[0.3, 0.25, 0.12], [-0.2, 0.5, 0.08], [0.45, -0.3, 0.07]]) { ctx.fillStyle = 'rgba(3,5,12,0.35)'; ctx.beginPath(); ctx.arc(x + cx * r, y + cy * r, cr * r, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(200,215,255,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x + cx * r, y + cy * r, cr * r, Math.PI, Math.PI * 1.6); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over';  // 邊緣光
  ctx.strokeStyle = 'rgba(150,180,255,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r - 1, Math.PI * 0.95, Math.PI * 1.75); ctx.stroke(); ctx.restore();
}
function drawHole(ctx, t, x, y, r) {
  if (opt.old) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4); g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.42, 'rgba(40,10,70,0.7)'); g.addColorStop(1, 'rgba(60,20,110,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, TAU); ctx.fill(); ctx.strokeStyle = '#b388ff'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) { const a = t * 2 + i * TAU / 3; ctx.beginPath(); ctx.arc(x, y, r + 6 + i * 4, a, a + 1.6); ctx.stroke(); }
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); return;
  }
  // 斜看的吸積盤：後半圈（畫面上方）先畫、被黑洞擋住；黑洞；前半圈（畫面下方）最後畫、蓋在黑洞前面
  //   裁切範圍固定在畫面座標（不跟著盤旋轉），後半圈才不會轉到黑洞前面
  const disk = (front) => {
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.rect(-r * 4, front ? 0 : -r * 4, r * 8, r * 4); ctx.clip();
    ctx.scale(1, 0.42); ctx.rotate(t * 0.6);
    ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over';
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * TAU, rr = r * (1.35 + (i % 4) * 0.22);
      ctx.strokeStyle = front ? (i % 3 ? 'rgba(200,160,255,0.45)' : 'rgba(255,200,255,0.7)') : (i % 3 ? 'rgba(179,136,255,0.3)' : 'rgba(255,190,255,0.45)');
      ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 0.5); ctx.stroke();
    }
    ctx.restore();
  };
  glow(ctx, x, y, r * 3.2, '#7a3dff', 0.45);
  disk(false);
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();  // 事件視界：擋住後半圈
  ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; ctx.strokeStyle = 'rgba(230,200,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 1, 0, TAU); ctx.stroke(); ctx.restore();  // 光環
  disk(true);
}
function drawRock(ctx, t, x, y, r, seed) {
  const wob = [1, 0.82, 0.95, 1.08, 0.78, 0.98, 0.88], rot = seed + (opt.spin ? t * 0.15 : 0);
  if (opt.old) { ctx.save(); ctx.translate(x, y); ctx.beginPath(); polyPts(7, r, rot).forEach(([a, b], i) => i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)); ctx.closePath(); ctx.fillStyle = '#3a3530'; ctx.fill(); ctx.strokeStyle = '#8a7f70'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); return; }
  ctx.save(); ctx.translate(x, y); faceted(ctx, polyPts(7, r, rot, wob), '#7d7264', { outline: 3, dark: 0.75, bright: 0.3 });
  ctx.fillStyle = 'rgba(3,5,12,0.3)'; ctx.beginPath(); ctx.arc(r * 0.25, r * 0.15, r * 0.18, 0, TAU); ctx.fill(); ctx.restore();
}
function drawComet(ctx, t, x, y, r) {
  const ux = Math.cos(-0.5), uy = Math.sin(-0.5);
  if (opt.old) { ctx.globalAlpha = 0.5; ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = r * 1.4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * 90, y - uy * 90); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = '#e8f7ff'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.lineCap = 'butt'; return; }
  ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over';  // 尾巴：漸淡的加法光
  for (let i = 0; i < 14; i++) { const k = i / 14, px = x - ux * k * 120 + Math.sin(t * 6 + i) * 2, py = y - uy * k * 120; glow(ctx, px, py, r * (1.7 - k * 0.9), '#9fe0ff', (1 - k) * 0.35); }
  ctx.restore();
  glow(ctx, x, y, r * 2.6, '#cfefff', 0.7);
  ctx.save(); ctx.translate(x, y); faceted(ctx, polyPts(6, r, 0.4, [1, 0.85, 1, 0.9, 1.05, 0.88]), '#d8f1ff', { outline: 2.4, dark: 0.5, bright: 0.5 }); ctx.restore();
}
// 牆：6 種風格（同一條邊界線，換材質）；閘門＝兩座發射器＋中間的能量屏障（關著＝紅、能過＝淡綠）
const WALL_STYLES = {
  metal:   { name: '金屬艙壁', note: '太空站內部：一片片立體裝甲板＋依序閃的航行燈，牆面有面板、鉚釘、管線、通風格柵、燈條', top: '#1d2650', bot: '#0a0e22', glowC: '#6e96ff', post: '#5a6584' },
  rock:    { name: '岩石洞壁', note: '小行星帶：岩塊疊兩層夾碎石；岩層紋理、礦脈、發光礦石結晶', top: '#2b2620', bot: '#110e0b', glowC: null, post: '#7d7264' },
  ice:     { name: '冰晶', note: '冰冷星域：冰晶一簇 2～3 根、霜邊、反光一閃；冰裡的氣泡、碎石、光束、發光裂縫', top: '#15304a', bot: '#081422', glowC: '#8fdcff', post: '#9fc8de' },
  organic: { name: '生物巢壁', note: '母巢區：細胞膜紋理、一開一合的氣孔、會分岔的粗血管；邊緣擺動的觸鬚、發光卵囊', top: '#3a1418', bot: '#16070a', glowC: '#ff5d73', post: '#a8484a' },
  lava:    { name: '熔岩玄武岩', note: '熾熱星域：粗的岩漿河（流動的亮芯）、玄武岩塊之間滲出岩漿光、低處岩漿池', top: '#26222a', bot: '#0d0b10', glowC: '#ff7a2e', post: '#4a4450' },
  ruins:   { name: '廢棄站體', note: '撕裂的金屬板邊緣、彎折鋼樑、垂下的斷電纜（冒火花）、脫落面板露出桁架、燒焦痕、殘燈閃爍', top: '#22252e', bot: '#0b0c10', glowC: null, post: '#6a6f7c' },
};
function edgeSamples(pts, step) {  // 沿著邊界線每隔 step 取一點，附上朝外（空地）的法線和切線
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    for (let d = (i === 1 ? 0 : step / 2); d < L; d += step) out.push({ x: x0 + ux * d, y: y0 + uy * d, nx: uy, ny: -ux, tx: ux, ty: uy, k: out.length });
  }
  return out;
}
function seeded(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
function wallPts(W, H) { return [[0, H * 0.58], [W * 0.18, H * 0.5], [W * 0.32, H * 0.64], [W * 0.5, H * 0.6], [W * 0.62, H * 0.45], [W * 0.82, H * 0.53], [W, H * 0.47]]; }
function lavaRiver(ctx, path, t, w) {  // 岩漿河：暗紅外緣 → 橘色主體 → 流動的亮黃芯
  path(); ctx.strokeStyle = '#3a0e04'; ctx.lineWidth = w + 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.strokeStyle = '#8a2406'; ctx.lineWidth = w + 2; ctx.stroke();
  ADD(ctx, () => {
    path(); ctx.strokeStyle = 'rgba(255,110,30,0.85)'; ctx.lineWidth = w; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,90,0.9)'; ctx.lineWidth = w * 0.35; ctx.setLineDash([w * 1.6, w * 1.2]); ctx.lineDashOffset = -t * 40; ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,120,40,0.18)'; ctx.lineWidth = w * 3.2; ctx.stroke();
  });
  ctx.lineCap = 'butt';
}
function drawWall(ctx, t, W, H, sty = 'metal') {
  const S = WALL_STYLES[sty], pts = wallPts(W, H);
  const path = () => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); };
  const edge = () => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); };
  if (opt.old) { path(); ctx.fillStyle = '#131a33'; ctx.fill(); edge(); ctx.strokeStyle = 'rgba(130,160,240,0.65)'; ctx.lineWidth = 3; ctx.stroke(); drawGates(ctx, t, W, H, sty); return; }
  path(); const g = ctx.createLinearGradient(0, H * 0.4, 0, H); g.addColorStop(0, S.top); g.addColorStop(1, S.bot); ctx.fillStyle = g; ctx.fill();
  // ---- 牆體內部 ----
  ctx.save(); path(); ctx.clip();
  if (sty === 'metal') {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 9; col++) {  // 大面板：接縫＋鉚釘
      const x = col * 58 + (row % 2) * 29 - 20, y = H * 0.48 + row * 40, w = 56, h = 38;
      ctx.fillStyle = (row + col) % 3 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(3,5,12,0.6)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = 'rgba(160,175,215,0.35)'; for (const [rx, ry] of [[4, 4], [w - 4, 4], [4, h - 4], [w - 4, h - 4]]) { ctx.beginPath(); ctx.arc(x + rx, y + ry, 1.2, 0, TAU); ctx.fill(); }
    }
    for (const y of [H * 0.78, H * 0.84]) {  // 管線
      ctx.strokeStyle = '#03050c'; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y - 12); ctx.stroke();
      ctx.strokeStyle = '#3a4466'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = 'rgba(200,215,255,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y - 1.5); ctx.lineTo(W, y - 13.5); ctx.stroke();
    }
    for (const x of [W * 0.12, W * 0.55, W * 0.88]) {  // 通風格柵
      const y = H * 0.9; ctx.fillStyle = '#05070f'; ctx.fillRect(x - 16, y - 8, 32, 16); ctx.strokeStyle = '#5a6584'; ctx.lineWidth = 1.2; ctx.strokeRect(x - 16, y - 8, 32, 16);
      ctx.strokeStyle = 'rgba(120,135,175,0.6)'; for (let k = -12; k <= 12; k += 4) { ctx.beginPath(); ctx.moveTo(x + k, y - 6); ctx.lineTo(x + k + 2, y + 6); ctx.stroke(); }
    }
    ADD(ctx, () => { const p = 0.5 + 0.5 * Math.sin(t * 2); ctx.strokeStyle = rgba('#6e96ff', 0.25 + p * 0.25); ctx.lineWidth = 2; for (const x of [W * 0.3, W * 0.72]) { ctx.beginPath(); ctx.moveTo(x, H * 0.72); ctx.lineTo(x, H); ctx.stroke(); } });  // 燈條
  }
  if (sty === 'rock' || sty === 'lava') for (let i = 0; i < 26; i++) { const x = seeded(i) * W, y = H * 0.55 + seeded(i + 50) * H * 0.45, r = 8 + seeded(i + 99) * 18; ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); polyPts(6, r, i).forEach(([a, b], j) => j ? ctx.lineTo(x + a, y + b) : ctx.moveTo(x + a, y + b)); ctx.closePath(); ctx.fill(); }
  if (sty === 'rock') rockInterior(ctx, t, W, H);
  if (sty === 'lava') {
    for (let i = 0; i < 3; i++) {  // 粗岩漿河：從底下往上分岔流
      const x0 = W * (0.15 + i * 0.33), rnd = k => seeded(i * 31 + k);
      const P = [[x0, H + 10]]; for (let k = 1; k < 6; k++) P.push([x0 + (rnd(k) - 0.5) * 70, H - k * H * 0.085]);
      lavaRiver(ctx, () => { ctx.beginPath(); P.forEach(([x, y], j) => j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); }, t + i, 9 - i);
    }
    const pool = [W * 0.32, H * 0.72];  // 低處岩漿池
    ctx.fillStyle = '#3a0e04'; ctx.beginPath(); ctx.ellipse(pool[0], pool[1], 46, 14, 0, 0, TAU); ctx.fill();
    ADD(ctx, () => { const p = 0.7 + 0.3 * Math.sin(t * 1.7); ctx.fillStyle = `rgba(255,110,30,${0.8 * p})`; ctx.beginPath(); ctx.ellipse(pool[0], pool[1], 40, 10, 0, 0, TAU); ctx.fill(); ctx.fillStyle = `rgba(255,210,110,${0.6 * p})`; ctx.beginPath(); ctx.ellipse(pool[0] - 6, pool[1] - 1, 20, 4, 0, 0, TAU); ctx.fill(); glow(ctx, pool[0], pool[1], 70, '#ff7a2e', 0.4); });
  }
  if (sty === 'organic') organicInterior(ctx, t, W, H);
  if (sty === 'ice') iceInterior(ctx, t, W, H);
  if (sty === 'ruins') {
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {  // 面板：有些脫落、露出桁架
      const x = col * 64 - 10, y = H * 0.5 + row * 42, w = 62, h = 40, k = row * 8 + col;
      if (seeded(k + 400) < 0.28) {
        ctx.fillStyle = '#030406'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#3c4048'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w / 2, y + h); ctx.stroke();
        ctx.strokeStyle = '#6a6f7c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w * 0.3, y + 4); ctx.lineTo(x + w * 0.42, y - 2); ctx.lineTo(x + w * 0.7, y + 5); ctx.lineTo(x + w, y); ctx.stroke();  // 撕裂的面板邊
      } else {
        ctx.fillStyle = seeded(k) < 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.15)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(3,5,12,0.7)'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
      }
    }
    for (let i = 0; i < 4; i++) { const x = seeded(i + 70) * W, y = H * (0.65 + seeded(i + 71) * 0.3), r = 20 + seeded(i + 72) * 25; const gg = ctx.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, 'rgba(0,0,0,0.6)'); gg.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }  // 燒焦痕
  }
  ctx.restore();
  // ---- 邊緣 ----
  if (sty === 'metal') {
    const E = edgeSamples(pts, 30);
    for (let i = 0; i < E.length; i++) {  // 一片片立體裝甲板（上面亮、前面暗）
      const p = E[i], hw = 14, out = 6, a = [p.x - p.tx * hw, p.y - p.ty * hw], b = [p.x + p.tx * hw, p.y + p.ty * hw];
      const ao = [a[0] + p.nx * out, a[1] + p.ny * out], bo = [b[0] + p.nx * out, b[1] + p.ny * out], ai = [a[0] - p.nx * 6, a[1] - p.ny * 6], bi = [b[0] - p.nx * 6, b[1] - p.ny * 6];
      ctx.beginPath(); ctx.moveTo(...ao); ctx.lineTo(...bo); ctx.lineTo(...bi); ctx.lineTo(...ai); ctx.closePath(); ctx.fillStyle = '#3a4466'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...ao); ctx.lineTo(...bo); ctx.lineTo(b[0] + p.nx * (out - 3), b[1] + p.ny * (out - 3)); ctx.lineTo(a[0] + p.nx * (out - 3), a[1] + p.ny * (out - 3)); ctx.closePath(); ctx.fillStyle = '#8f9bb8'; ctx.fill();
      if (i % 2 === 0) { const on = Math.floor(t * 4) % 6 === (i / 2) % 6; if (on) glow(ctx, p.x, p.y, 9, '#6e96ff', 0.9); ctx.fillStyle = on ? '#cfe0ff' : '#2a3a6a'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8, 0, TAU); ctx.fill(); }  // 依序閃的航行燈
    }
  }
  if (sty === 'lava') {
    ADD(ctx, () => { edge(); ctx.strokeStyle = rgba('#ff7a2e', 0.35 + 0.15 * Math.sin(t * 2)); ctx.lineWidth = 10; ctx.stroke(); ctx.strokeStyle = 'rgba(255,180,80,0.5)'; ctx.lineWidth = 3; ctx.stroke(); });  // 岩塊之間滲出的岩漿光
    for (const p of edgeSamples(pts, 24)) { const r = 9 + seeded(p.k) * 8; ctx.save(); ctx.translate(p.x - p.nx * r * 0.15, p.y - p.ny * r * 0.15); faceted(ctx, polyPts(6, r, p.k, [1, 0.82, 1.05, 0.86, 0.95, 0.9]), '#4a4450', { outline: 2.6, dark: 0.8, bright: 0.25 }); ctx.restore(); }
  }
  if (sty === 'rock') rockEdge(ctx, t, pts);
  if (sty === 'ice') iceEdge(ctx, t, pts, edge);
  if (sty === 'organic') organicEdge(ctx, t, pts);
  if (sty === 'ruins') {
    const E = edgeSamples(pts, 9);
    const torn = E.map(p => { const j = (seeded(p.k) - 0.35) * 12 + (seeded(p.k + 900) < 0.12 ? 10 : 0); return [p.x + p.nx * j, p.y + p.ny * j]; });  // 撕裂的金屬板邊（不規則、偶爾翹起）
    ctx.beginPath(); torn.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); for (let i = E.length - 1; i >= 0; i--) ctx.lineTo(E[i].x - E[i].nx * 8, E[i].y - E[i].ny * 8); ctx.closePath();
    ctx.fillStyle = '#4a4f5c'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); torn.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = '#8a8f9c'; ctx.lineWidth = 1; ctx.stroke();
    for (const p of edgeSamples(pts, 46)) {  // 彎折的鋼樑
      if (seeded(p.k + 11) < 0.45) continue;
      const a = Math.atan2(p.ny, p.nx) + (seeded(p.k + 12) - 0.5) * 0.8, l1 = 12 + seeded(p.k + 13) * 10, b = a + (seeded(p.k + 14) - 0.5) * 1.6, l2 = 8 + seeded(p.k + 15) * 8;
      const j = [p.x + Math.cos(a) * l1, p.y + Math.sin(a) * l1], e = [j[0] + Math.cos(b) * l2, j[1] + Math.sin(b) * l2];
      ctx.lineCap = 'square'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(...j); ctx.lineTo(...e); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = '#6a6f7c'; ctx.lineWidth = 3.5; ctx.stroke(); ctx.strokeStyle = 'rgba(220,225,235,0.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineCap = 'butt';
    }
    for (const p of edgeSamples(pts, 60)) {  // 垂下來的斷電纜＋火花
      const sw = Math.sin(t * 1.5 + p.k) * 4, ex = p.x + p.nx * 22 + sw, ey = p.y + p.ny * 22 + 10;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + p.nx * 4 + 8, p.y + p.ny * 4 + 16, ex, ey); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = p.k % 2 ? '#7a3a2a' : '#2a3a5a'; ctx.lineWidth = 1.6; ctx.stroke();
      if (Math.sin(t * 7 + p.k * 3) > 0.85) { glow(ctx, ex, ey, 9, '#ffd27a', 1); for (let s = 0; s < 4; s++) { const a = seeded(Math.floor(t * 10) + s + p.k) * TAU; ctx.strokeStyle = '#fff1c4'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + Math.cos(a) * 6, ey + Math.sin(a) * 6); ctx.stroke(); } }
    }
    for (const p of edgeSamples(pts, 70)) { const f = seeded(Math.floor(t * 8) + p.k * 13) > 0.35 ? 1 : 0.15; glow(ctx, p.x - p.nx * 16, p.y - p.ny * 16, 10, '#ffcf8a', 0.5 * f); ctx.fillStyle = f > 0.5 ? '#ffe2b0' : '#4a3a22'; ctx.beginPath(); ctx.arc(p.x - p.nx * 16, p.y - p.ny * 16, 1.8, 0, TAU); ctx.fill(); }  // 忽明忽滅的殘燈
  }
  if (S.glowC && sty !== 'lava' && sty !== 'metal') ADD(ctx, () => { edge(); ctx.strokeStyle = rgba(S.glowC, 0.16); ctx.lineWidth = 12; ctx.stroke(); });
  if (sty === 'metal') ADD(ctx, () => { edge(); ctx.strokeStyle = rgba(S.glowC, 0.1); ctx.lineWidth = 16; ctx.stroke(); });
  drawGates(ctx, t, W, H, sty);
}
// ---- 岩石、冰晶、生物巢壁的細節（牆體內部：在 clip 裡畫；邊緣：clip 外） ----
function rockInterior(ctx, t, W, H) {
  for (let i = 0; i < 6; i++) {  // 岩層：一層一層斜斜的帶狀紋理
    const y = H * 0.6 + i * H * 0.08; ctx.fillStyle = i % 2 ? 'rgba(255,230,200,0.035)' : 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= W; x += 40) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6 - x * 0.03); ctx.lineTo(W, y + 30); ctx.lineTo(0, y + 30); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(220,200,170,0.22)'; ctx.lineWidth = 1;  // 礦脈
  for (let i = 0; i < 5; i++) { let x = seeded(i + 200) * W, y = H; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (seeded(i * 7 + k + 210) - 0.5) * 60; y -= H * 0.08; ctx.lineTo(x, y); } ctx.stroke(); }
  for (let i = 0; i < 6; i++) {  // 發光礦石結晶
    const x = seeded(i + 300) * W, y = H * (0.68 + seeded(i + 301) * 0.28), c = i % 3 ? '#7fe3ff' : '#ffd166', p = 0.6 + 0.4 * Math.sin(t * 2 + i * 1.7);
    glow(ctx, x, y, 14, c, 0.45 * p);
    for (let k = 0; k < 3; k++) { ctx.save(); ctx.translate(x + (k - 1) * 4, y); ctx.rotate(-0.4 + k * 0.4); ctx.beginPath(); ctx.moveTo(-2.2, 0); ctx.lineTo(0, -7 - k % 2 * 3); ctx.lineTo(2.2, 0); ctx.closePath(); ctx.fillStyle = mix(c, '#ffffff', 0.3); ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore(); }
  }
}
function rockEdge(ctx, t, pts) {
  for (const p of edgeSamples(pts, 15)) { const r = 4 + seeded(p.k + 40) * 4; ctx.save(); ctx.translate(p.x + p.nx * 5, p.y + p.ny * 5); faceted(ctx, polyPts(5, r, p.k * 2), '#6b6155', { outline: 1.8, dark: 0.75, bright: 0.3 }); ctx.restore(); }  // 碎石
  for (const p of edgeSamples(pts, 34)) { const r = 13 + seeded(p.k + 20) * 9; ctx.save(); ctx.translate(p.x - p.nx * r * 0.45, p.y - p.ny * r * 0.45); faceted(ctx, polyPts(7, r, p.k + 1, [1, 0.85, 1.05, 0.9, 0.95, 0.88, 1]), '#5e554a', { outline: 2.6, dark: 0.8, bright: 0.28 }); ctx.restore(); }  // 後排大岩塊
  for (const p of edgeSamples(pts, 22)) { const r = 9 + seeded(p.k) * 9; ctx.save(); ctx.translate(p.x - p.nx * r * 0.1, p.y - p.ny * r * 0.1); faceted(ctx, polyPts(6, r, p.k, [1, 0.8, 1.05, 0.85, 0.95, 0.9]), '#7d7264', { outline: 2.6, dark: 0.75, bright: 0.3 }); ctx.restore(); }  // 前排岩塊
}
function iceInterior(ctx, t, W, H) {
  ADD(ctx, () => {  // 斜照進冰裡的光
    for (let i = 0; i < 4; i++) { const x = W * (0.1 + i * 0.27) + Math.sin(t * 0.4 + i) * 10, g = ctx.createLinearGradient(x, H * 0.45, x + 60, H); g.addColorStop(0, 'rgba(160,225,255,0.12)'); g.addColorStop(1, 'rgba(160,225,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x, H * 0.45); ctx.lineTo(x + 24, H * 0.45); ctx.lineTo(x + 90, H); ctx.lineTo(x + 50, H); ctx.closePath(); ctx.fill(); }
  });
  for (let i = 0; i < 5; i++) { const x = seeded(i + 500) * W, y = H * (0.72 + seeded(i + 501) * 0.25); ctx.save(); ctx.translate(x, y); ctx.globalAlpha = 0.35; faceted(ctx, polyPts(6, 6 + seeded(i + 502) * 8, i), '#3a4a5a', { outline: 1 }); ctx.restore(); }  // 凍在冰裡的碎石
  ctx.strokeStyle = 'rgba(200,240,255,0.35)'; ctx.lineWidth = 0.8;  // 氣泡
  for (let i = 0; i < 26; i++) { const x = seeded(i + 600) * W, y = H * (0.6 + seeded(i + 601) * 0.4), r = 1 + seeded(i + 602) * 2.5; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  ADD(ctx, () => {  // 發光的深藍裂縫
    for (let i = 0; i < 4; i++) { let x = seeded(i + 700) * W, y = H; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (seeded(i * 5 + k + 710) - 0.5) * 50; y -= H * 0.075; ctx.lineTo(x, y); } ctx.strokeStyle = 'rgba(80,170,255,0.35)'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = 'rgba(200,240,255,0.5)'; ctx.lineWidth = 0.8; ctx.stroke(); }
  });
}
function iceEdge(ctx, t, pts, edge) {
  edge(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#6aa8cc'; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.strokeStyle = 'rgba(240,250,255,0.85)'; ctx.lineWidth = 1.6; ctx.beginPath();  // 霜邊
  for (const p of edgeSamples(pts, 5)) { const j = 1 + seeded(p.k + 800) * 2.5; ctx.lineTo(p.x + p.nx * j, p.y + p.ny * j); } ctx.stroke();
  const crystal = (x, y, a, h, w) => {
    const tip = [x + Math.cos(a) * h, y + Math.sin(a) * h], l = [x + Math.cos(a + 1.57) * w, y + Math.sin(a + 1.57) * w], r = [x + Math.cos(a - 1.57) * w, y + Math.sin(a - 1.57) * w];
    ctx.beginPath(); ctx.moveTo(...l); ctx.lineTo(...tip); ctx.lineTo(...r); ctx.closePath(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#e4f8ff'; ctx.beginPath(); ctx.moveTo(...l); ctx.lineTo(...tip); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5f9fc4'; ctx.beginPath(); ctx.moveTo(...r); ctx.lineTo(...tip); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
    return tip;
  };
  for (const p of edgeSamples(pts, 26)) {  // 一簇 2～3 根
    if (seeded(p.k + 3) < 0.25) continue;
    const base = Math.atan2(p.ny, p.nx), n = 2 + (seeded(p.k + 9) < 0.5 ? 1 : 0);
    glow(ctx, p.x + p.nx * 12, p.y + p.ny * 12, 22, '#8fdcff', 0.35);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * 0.45 + (seeded(p.k * 3 + k) - 0.5) * 0.25, h = (k === 1 || n === 2 ? 22 : 13) + seeded(p.k + k + 50) * 12;
      const tip = crystal(p.x + Math.cos(a + 1.57) * (k - 1) * 3, p.y + Math.sin(a + 1.57) * (k - 1) * 3, a, h, 3.5 + seeded(p.k + k) * 2.5);
      const tw = Math.sin(t * 3 + p.k * 2 + k * 5); if (tw > 0.9) { glow(ctx, tip[0], tip[1], 8, '#ffffff', (tw - 0.9) * 10); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(tip[0] - 4, tip[1]); ctx.lineTo(tip[0] + 4, tip[1]); ctx.moveTo(tip[0], tip[1] - 4); ctx.lineTo(tip[0], tip[1] + 4); ctx.stroke(); }  // 反光一閃
    }
  }
}
function organicInterior(ctx, t, W, H) {
  for (let i = 0; i < 40; i++) {  // 細胞膜格狀紋理
    const x = seeded(i + 900) * W, y = H * (0.55 + seeded(i + 901) * 0.45), r = 10 + seeded(i + 902) * 14;
    ctx.fillStyle = 'rgba(120,30,40,0.25)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(10,2,4,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  ADD(ctx, () => {  // 會分岔的粗血管（脈動往上傳）
    for (let i = 0; i < 5; i++) {
      const pts = []; let x = seeded(i + 3) * W, y = H; pts.push([x, y]);
      for (let k = 0; k < 8; k++) { x += Math.sin(k * 1.3 + i) * 10; y -= H * 0.06; pts.push([x, y]); }
      const ph = (t * 1.5 + i * 0.37) % 1, a = 0.2 + 0.35 * Math.max(0, Math.sin(ph * Math.PI));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); pts.forEach(([px, py], j) => j ? ctx.lineTo(px, py) : ctx.moveTo(px, py)); ctx.strokeStyle = rgba('#ff5d73', a); ctx.lineWidth = 4.5; ctx.stroke();
      for (const j of [2, 4, 6]) { const [bx, by] = pts[j], d = j % 4 ? 1 : -1; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + d * 18, by - 4, bx + d * 28, by - 16); ctx.strokeStyle = rgba('#ff5d73', a * 0.8); ctx.lineWidth = 2; ctx.stroke(); }
      ctx.lineCap = 'butt';
    }
  });
  for (let i = 0; i < 7; i++) {  // 一開一合的氣孔
    const x = seeded(i + 950) * W, y = H * (0.66 + seeded(i + 951) * 0.3), o = 0.3 + 0.7 * Math.max(0, Math.sin(t * 1.3 + i * 2));
    ctx.fillStyle = '#5a1a20'; ctx.beginPath(); ctx.ellipse(x, y, 7, 4.5, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#12030a'; ctx.beginPath(); ctx.ellipse(x, y, 5 * o, 2.6 * o, 0, 0, TAU); ctx.fill();
  }
}
function organicEdge(ctx, t, pts) {
  for (const p of edgeSamples(pts, 23)) {  // 擺動的觸鬚
    if (seeded(p.k + 60) < 0.35) continue;
    const L = 14 + seeded(p.k + 61) * 14, sw = Math.sin(t * 2 + p.k) * 0.5, a = Math.atan2(p.ny, p.nx);
    const mx = p.x + Math.cos(a + sw) * L * 0.55, my = p.y + Math.sin(a + sw) * L * 0.55, ex = p.x + Math.cos(a + sw * 2) * L, ey = p.y + Math.sin(a + sw * 2) * L;
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#8a3a3c'; ctx.lineWidth = 3; ctx.stroke(); ctx.strokeStyle = 'rgba(255,170,170,0.35)'; ctx.lineWidth = 1; ctx.stroke(); ctx.lineCap = 'butt';
  }
  for (const p of edgeSamples(pts, 18)) {  // 肉質突起
    const r = 7 + seeded(p.k) * 8, pul = 1 + 0.06 * Math.sin(t * 3 + p.k);
    ctx.save(); ctx.translate(p.x - p.nx * 2, p.y - p.ny * 2); litEllipse(ctx, 0, 0, r * pul, r * 0.8 * pul, '#a8484a');
    if (seeded(p.k + 5) < 0.3) { glow(ctx, 0, 0, r, '#ff5d73', 0.5 + 0.3 * Math.sin(t * 3 + p.k)); ctx.fillStyle = '#2a0a0e'; ctx.beginPath(); ctx.arc(0, 0, r * 0.35, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  for (const p of edgeSamples(pts, 50)) {  // 靠近邊緣的發光卵囊
    const x = p.x - p.nx * 16, y = p.y - p.ny * 16, q = 0.6 + 0.4 * Math.sin(t * 2.5 + p.k);
    for (let k = 0; k < 3; k++) { const ex = x + (k - 1) * 7, ey = y + (k % 2) * 4; glow(ctx, ex, ey, 9, '#ffb36b', 0.45 * q); ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(ex, ey, 4.2, 0, TAU); ctx.fill(); ctx.fillStyle = mix('#ffb36b', '#fff1d0', q * 0.5); ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(ex, ey, 3.2, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; ctx.fillStyle = '#5a2010'; ctx.beginPath(); ctx.arc(ex + 0.5, ey + 0.5, 1.2, 0, TAU); ctx.fill(); }
  }
}
// 閘門：兩座面對面的發射器＋中間的能量屏障（半透明、兩側漸淡、掃描線往下流）；能過時屏障幾乎消失，只剩淡綠微光和飄過的光點
function drawGates(ctx, t, W, H, sty) {
  const S = WALL_STYLES[sty];
  for (const [gx, open] of [[W * 0.25, false], [W * 0.72, true]]) {
    const col = open ? '#2ee6a6' : '#ff4d6d', y0 = H * 0.08, y1 = H * 0.42;
    if (opt.old) { ctx.strokeStyle = col; ctx.lineWidth = open ? 3 : 6; ctx.globalAlpha = 0.8; if (open) ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; continue; }
    const fy0 = y0 + 9, fy1 = y1 - 9, fw = 16;
    ADD(ctx, () => {
      const g = ctx.createLinearGradient(gx - fw, 0, gx + fw, 0);
      g.addColorStop(0, rgba(col, 0)); g.addColorStop(0.5, rgba(col, open ? 0.1 + 0.05 * Math.sin(t * 3) : 0.35)); g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g; ctx.fillRect(gx - fw, fy0, fw * 2, fy1 - fy0);
      if (!open) {  // 掃描線往下流
        ctx.strokeStyle = rgba(col, 0.55); ctx.lineWidth = 1;
        for (let y = fy0 + ((t * 30) % 8); y < fy1; y += 8) { const k = 1 - Math.abs((y - (fy0 + fy1) / 2) / ((fy1 - fy0) / 2)) * 0.3; ctx.beginPath(); ctx.moveTo(gx - fw * 0.55 * k, y); ctx.lineTo(gx + fw * 0.55 * k, y); ctx.stroke(); }
        ctx.strokeStyle = rgba('#ffd0d8', 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(gx, fy0); ctx.lineTo(gx, fy1); ctx.stroke();
      } else for (let i = 0; i < 5; i++) {  // 飄過的光點（往通行方向）
        const ph = (t * 0.6 + i / 5) % 1, x = gx - 20 + ph * 40, y = fy0 + seeded(i + 30) * (fy1 - fy0);
        glow(ctx, x, y, 5, col, Math.sin(ph * Math.PI) * 0.8);
      }
    });
    for (const [yy, dir] of [[y0, 1], [y1, -1]]) {  // 發射器：照牆的材質＋朝屏障的發光鏡頭
      ctx.save(); ctx.translate(gx, yy);
      ctx.beginPath(); ctx.moveTo(-10, -dir * 6); ctx.lineTo(10, -dir * 6); ctx.lineTo(6, dir * 7); ctx.lineTo(-6, dir * 7); ctx.closePath();
      const gg = ctx.createLinearGradient(-10, 0, 10, 0); gg.addColorStop(0, mix(S.post, '#ffffff', 0.25)); gg.addColorStop(1, mix(S.post, '#000000', 0.45));
      ctx.fillStyle = gg; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 2; ctx.stroke();
      glow(ctx, 0, dir * 8, open ? 8 : 12, col, open ? 0.5 : 0.9);
      ctx.fillStyle = mix(col, '#ffffff', 0.4); ctx.beginPath(); ctx.ellipse(0, dir * 7, 4, 1.6, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
}

const OBJS = [
  { name: '行星', note: '實心球體＋雲帶、坑、大氣光暈、邊緣光；虛線是引力範圍', draw: (c, t, W, H) => drawPlanet(c, t, W / 2, H / 2, 78) },
  { name: '黑洞', note: '斜看的吸積盤（後半圈在後、前半圈在前）＋事件視界光環', draw: (c, t, W, H) => drawHole(c, t, W / 2, H / 2, 40) },
  { name: '小行星帶', note: '多面切割的岩石（跟敵人同一套上色）', draw: (c, t, W, H) => { for (const [x, y, r, s] of [[0.25, 0.38, 40, 1], [0.52, 0.66, 28, 2], [0.75, 0.33, 46, 3], [0.9, 0.75, 22, 4], [0.1, 0.78, 24, 5]]) drawRock(c, t, x * W, y * H, r, s); } },
  { name: '彗星', note: '冰晶核心＋加法發光的長尾', draw: (c, t, W, H) => drawComet(c, t, W * 0.7, H * 0.36, 24) },
  ...Object.entries(WALL_STYLES).map(([k, S]) => ({ name: '牆：' + S.name, note: S.note + '；閘門左關（紅）右開（綠）', draw: (c, t, W, H) => drawWall(c, t, W, H, k) })),
];

// ---------- 背包模組 ----------
const MODS = [
  { id: 'shield', name: '護盾產生器', col: '#4cc9f0', glyph: 'shield' },
  { id: 'blink', name: '相位跳躍', col: '#c77dff', glyph: 'blink' },
  { id: 'gravity', name: '重力井', col: '#b388ff', glyph: 'gravity' },
  { id: 'drone', name: '修復無人機', col: '#9dff6b', glyph: 'plus' },
  { id: 'reactive', name: '反應裝甲', col: '#ff9f1c', glyph: 'burst' },
  { id: 'swarmcore', name: '星噬核心', col: '#ff4d6d', glyph: 'core', boss: true },
  { id: 'thruster', name: '裂界推進器', col: '#b388ff', glyph: 'arrow', boss: true },
  { id: 'endshell', name: '終焉護殼', col: '#2ee6a6', glyph: 'hex', boss: true },
];
function drawGlyph(ctx, g, col, t) {
  ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const P = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); };
  if (g === 'shield') { P([[0, -9], [8, -5], [7, 4], [0, 10], [-7, 4], [-8, -5]]); ctx.closePath(); ctx.stroke(); }
  else if (g === 'blink') { P([[-9, 4], [-3, -4], [2, 4], [8, -4]]); ctx.stroke(); ctx.beginPath(); ctx.arc(8, -4, 2, 0, TAU); ctx.fill(); }
  else if (g === 'gravity') { for (const r of [3, 6.5, 10]) { ctx.beginPath(); ctx.arc(0, 0, r, t, t + 4.4); ctx.stroke(); } }
  else if (g === 'plus') { P([[-8, 0], [8, 0]]); ctx.stroke(); P([[0, -8], [0, 8]]); ctx.stroke(); }
  else if (g === 'burst') { for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; P([[Math.cos(a) * 3, Math.sin(a) * 3], [Math.cos(a) * (i % 2 ? 7 : 10), Math.sin(a) * (i % 2 ? 7 : 10)]]); ctx.stroke(); } }
  else if (g === 'core') { ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + t; P([[Math.cos(a) * 6, Math.sin(a) * 6], [Math.cos(a) * 10, Math.sin(a) * 10]]); ctx.stroke(); } }
  else if (g === 'arrow') { P([[-9, 6], [6, -6]]); ctx.stroke(); P([[0, -7], [6, -6], [5, 0]]); ctx.stroke(); P([[-9, -1], [-3, -6]]); ctx.stroke(); }
  else if (g === 'hex') { P(polyPts(6, 9, Math.PI / 6)); ctx.closePath(); ctx.stroke(); P(polyPts(6, 4.5, Math.PI / 6)); ctx.closePath(); ctx.stroke(); }
  ctx.restore();
}
function drawModule(ctx, M, t, s = 1) {
  ctx.save(); ctx.scale(s, s);
  const w = 34, h = 34;
  ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.roundRect(-w / 2 - 2.5, -h / 2 - 2.5, w + 5, h + 5, 8); ctx.fill();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, '#9aa6c4'); g.addColorStop(0.5, '#5a6584'); g.addColorStop(1, '#2a3150');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 6); ctx.fill();
  ctx.fillStyle = '#0a0e22'; ctx.beginPath(); ctx.roundRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 4); ctx.fill();  // 面板
  if (M.boss) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3, 5); ctx.stroke(); }  // 旗艦模組：金邊
  for (const [x, y] of [[-w / 2 + 3, -h / 2 + 3], [w / 2 - 3, -h / 2 + 3], [-w / 2 + 3, h / 2 - 3], [w / 2 - 3, h / 2 - 3]]) { ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(x, y, 1.2, 0, TAU); ctx.fill(); }
  glow(ctx, 0, 0, 22, M.col, 0.55 + 0.15 * Math.sin(t * 3));
  drawGlyph(ctx, M.glyph, mix(M.col, '#ffffff', 0.25), opt.spin ? t : 0);
  ctx.restore();
}
// 模組裝在飛船上：不掛盒子，變成飛船身上／周圍的效果（D 版先鋒號）
const VAN = [[17, 0], [-10, -11], [-5, 0], [-10, 11]];
function shipD(ctx, t) {
  const col = '#4cc9f0', hull = () => { ctx.beginPath(); VAN.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
  ctx.fillStyle = `rgba(140,210,255,${0.6 + Math.random() * 0.3})`; ctx.beginPath(); ctx.moveTo(-7.8, -3.2); ctx.lineTo(-18 - Math.random() * 3, 0); ctx.lineTo(-7.8, 3.2); ctx.fill();
  hull(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
  for (const sg of [-1, 1]) { ctx.save(); ctx.beginPath(); ctx.rect(-40, sg < 0 ? -40 : 0, 80, 40); ctx.clip(); const g = ctx.createLinearGradient(17, sg * 2, -10, sg * 12); g.addColorStop(0, sg < 0 ? mix(col, '#ffffff', 0.35) : col); g.addColorStop(1, mix(col, '#000000', sg < 0 ? 0.25 : 0.7)); hull(); ctx.fillStyle = g; ctx.fill(); ctx.restore(); }
  ctx.fillStyle = '#0a1430'; ctx.beginPath(); ctx.ellipse(6.5, 0, 4.4, 2.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.ellipse(7.7, -0.9, 1.6, 0.7, -0.2, 0, TAU); ctx.fill();
}
const ADD = (ctx, f) => { ctx.save(); ctx.globalCompositeOperation = opt.glow ? 'lighter' : 'source-over'; f(); ctx.restore(); };
function moduleFx(ctx, M, t, front) {
  const c = M.col;
  if (M.id === 'shield' && front) ADD(ctx, () => {  // 六角護盾泡泡
    ctx.strokeStyle = rgba(c, 0.55); ctx.lineWidth = 1; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + t * 0.3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.lineTo(Math.cos(a) * 24, Math.sin(a) * 24); ctx.stroke(); }
    ctx.beginPath(); polyPts(6, 24, t * 0.3).forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = rgba(c, 0.08); ctx.fill(); ctx.strokeStyle = rgba(c, 0.8); ctx.lineWidth = 1.4; ctx.stroke();
  });
  if (M.id === 'blink' && !front) for (let k = 3; k >= 1; k--) { ctx.save(); ctx.globalAlpha = 0.18 * (4 - k) / 3; ctx.translate(-k * 7, 0); ctx.beginPath(); VAN.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = c; ctx.fill(); ctx.restore(); }  // 相位殘影
  if (M.id === 'gravity' && !front) ADD(ctx, () => { ctx.strokeStyle = rgba(c, 0.45); ctx.lineWidth = 1.2; for (const [r, d] of [[20, 1], [27, -0.7], [34, 0.5]]) { const a = t * d; ctx.beginPath(); ctx.arc(0, 0, r, a, a + 2.2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r, a + Math.PI, a + Math.PI + 2.2); ctx.stroke(); } });  // 重力環
  if (M.id === 'drone' && front) {  // 小無人機繞著飛
    const a = t * 1.8, x = Math.cos(a) * 22, y = Math.sin(a) * 22;
    glow(ctx, x, y, 7, c, 0.7);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2); faceted(ctx, polyPts(4, 4, Math.PI / 4), '#9aa6c4', { outline: 1.5 }); ctx.fillStyle = c; ctx.fillRect(-1, -3.5, 2, 7); ctx.fillRect(-3.5, -1, 7, 2); ctx.restore();
    ADD(ctx, () => { ctx.strokeStyle = rgba(c, 0.5); ctx.lineWidth = 0.8; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(0, 0); ctx.stroke(); ctx.setLineDash([]); });
  }
  if (M.id === 'reactive' && front) for (const sg of [-1, 1]) {  // 兩側發光裝甲板
    ctx.beginPath(); ctx.moveTo(-6, sg * 8.5); ctx.lineTo(4, sg * 4); ctx.lineTo(5, sg * 6.5); ctx.lineTo(-5, sg * 11.5); ctx.closePath();
    ctx.fillStyle = '#5a6584'; ctx.fill(); ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1.2; ctx.stroke();
    ADD(ctx, () => { ctx.strokeStyle = rgba(c, 0.6 + 0.3 * Math.sin(t * 4)); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-5, sg * 9.8); ctx.lineTo(4, sg * 5.3); ctx.stroke(); });
  }
  if (M.id === 'swarmcore' && front) {  // 船背的核心＋6 個噴口
    const p = 0.5 + 0.5 * Math.sin(t * 4);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + t * 0.5; ctx.fillStyle = '#5a6584'; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(-2 + Math.cos(a) * 5, Math.sin(a) * 5, 1.4, 0, TAU); ctx.fill(); ctx.stroke(); }
    glow(ctx, -2, 0, 10, c, 0.5 + p * 0.4); ctx.fillStyle = '#03050c'; ctx.beginPath(); ctx.arc(-2, 0, 3.4, 0, TAU); ctx.fill(); ctx.fillStyle = mix(c, '#ffffff', 0.3 + p * 0.4); ctx.beginPath(); ctx.arc(-2, 0, 2.2, 0, TAU); ctx.fill();
  }
  if (M.id === 'thruster' && !front) for (const sg of [-1, 1]) {  // 兩側大推進器
    ctx.fillStyle = `rgba(200,170,255,${0.6 + Math.random() * 0.3})`; ctx.beginPath(); ctx.moveTo(-9, sg * 9 - 2.5); ctx.lineTo(-24 - Math.random() * 5, sg * 9); ctx.lineTo(-9, sg * 9 + 2.5); ctx.fill();
    const g = ctx.createLinearGradient(0, sg * 9 - 3, 0, sg * 9 + 3); g.addColorStop(0, '#9aa6c4'); g.addColorStop(1, '#2a3150');
    ctx.fillStyle = g; ctx.strokeStyle = '#03050c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(-10, sg * 9 - 3, 11, 6, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c; ctx.fillRect(-10, sg * 9 - 3, 1.4, 6);
  }
  if (M.id === 'endshell' && front) ADD(ctx, () => {  // 六角形護殼線（一格一格）
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - t * 0.4; ctx.strokeStyle = rgba(c, 0.55 + 0.3 * Math.sin(t * 3 + i)); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 21, a + 0.08, a + TAU / 6 - 0.08); ctx.stroke(); }
  });
}
function drawShipModule(ctx, M, t) {
  ctx.save(); ctx.scale(3, 3); ctx.rotate(-0.35);
  moduleFx(ctx, M, t, false); shipD(ctx, t); moduleFx(ctx, M, t, true);
  ctx.restore();
}

