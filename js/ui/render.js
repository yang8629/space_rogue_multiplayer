// 星環電路 雙人版 · render.js：戰鬥畫面繪圖：世界、敵人、子彈、飛船、HUD、靶場面板
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// RENDER（戰鬥畫面）
// =====================================================================
function initStars() {
  for (let i = 0; i < 240; i++)
    Game.stars.push({ u: Math.random(), v: Math.random(), z: [0.15, 0.35, 0.6][i % 3], s: rand(0.6, 1.8), a: rand(0.3, 0.9) });
}

function polygon(x, y, r, sides, rot) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rot + i / sides * TAU;
    i ? ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r) : ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// 世界（背景、地圖、子彈、敵人、飛船、數字）由 WebGL 繪圖層畫（js/ui/gl/），這層 2D 畫布只畫 HUD
//   繪圖層還沒準備好（載入中）或啟動失敗時：深色底，失敗的話中間寫原因
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  if (!GLR.render()) {
    ctx.fillStyle = '#05060f'; ctx.fillRect(0, 0, VW, VH);
    if (GLR.failed && Game.inArena) {
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 16px Microsoft JhengHei'; ctx.textAlign = 'center';
      ctx.fillText('畫面載入失敗：請檢查網路後重新整理；還是不行的話，請開啟瀏覽器的硬體加速或更新顯示卡驅動', VW / 2, VH / 2);
    }
  }
  if (!Game.inArena) return;
  drawHUD();
  if (Input.touch && Game.state === 'play') drawSticks();
}

function drawSticks() {
  const draw = (s, color) => {
    if (!s) return;
    const v = stickVec(s);
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(s.bx, s.by, 60, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.8; ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(s.bx + v.x * 60, s.by + v.y * 60, 22, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  };
  draw(Input.joy, '#4cc9f0');
  draw(Input.aimStick, '#ff6b9d');
  if (!Input.joy && !Input.aimStick && Game.time < 8) {
    ctx.font = '13px Microsoft JhengHei'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(143, 163, 217, 0.8)';
    if (Input.autoFire) ctx.fillText('任意位置拖曳：移動　·　自動攻擊中', VW / 2, VH * 0.62);
    else {
      ctx.fillText('左半邊拖曳：移動', VW * 0.25, VH * 0.62);
      ctx.fillText('右半邊按住：射擊（拖曳瞄準）', VW * 0.75, VH * 0.62);
    }
  }
}

// 虛空獵手、裂界獵艦的畫面朝向（只影響繪圖；e.rot 還是環形彈的起始角）：蓄力／衝鋒等招式朝 chargeA，
//   追人時船頭轉向最近的玩家（每秒最多轉 6 弧度）。隊友那邊的敵人每次同步都重建，所以角度記在這裡（用 id）
const ENEMY_FACE = new Map();
function nearestShip(e) {  // 離敵人最近、還活著的飛船（跟敵人瞄準的目標一樣；雙人時可能是隊友）
  let q = null, bd = Infinity;
  for (const p of [Game.player, Game.mate]) if (p && !p.dead && !p.gone) { const d = dist2(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; q = p; } }
  return q;
}
function enemyFace(e) {
  const G = Game;
  if (e.mode && e.mode !== 'chase') { const m = ENEMY_FACE.get(e.id); if (m) { m.a = e.chargeA; m.t = G.time; } return e.chargeA; }
  const q = nearestShip(e), want = q ? Math.atan2(q.y - e.y, q.x - e.x) : e.rot || 0, m = ENEMY_FACE.get(e.id);
  if (!m || G.time - m.t > 0.5 || G.time < m.t) { ENEMY_FACE.set(e.id, { a: want, t: G.time }); return want; }  // 新出現（或編號被下一場重用）：直接朝目標
  const step = 6 * clamp(G.time - m.t, 0, 0.1), d = angleDiff(m.a, want);
  m.a += clamp(d, -step, step); m.t = G.time;
  if (ENEMY_FACE.size > 100) for (const k of ENEMY_FACE.keys()) if (!G.enemies.some(o => o.id === k)) ENEMY_FACE.delete(k);
  return m.a;
}
function spitterFace(e) { const q = nearestShip(e); return q ? Math.atan2(q.y - e.y, q.x - e.x) : Math.atan2(e.vy, e.vx); }  // 噴吐者：嘴對著瞄準的玩家
// 飛船本體（D 版：實心塗裝＋金屬噴嘴＋藍色噴焰）；在飛船自己的座標（船頭朝 +x）裡畫
//   船身：深色描邊、上亮下暗的船色漸層、中線高光、深色玻璃駕駛艙；各船專屬零件；衝刺／超頻時外框發出船色光暈
//   o：moving（有噴焰）、booster（加速器層數：噴焰更長）、armor（重裝甲層數：裝甲板線）、hot（衝刺／超頻）
const SHIP_ART = new Map(Object.entries(SHIPS).map(([id, S]) => {
  const nose = S.hull[0][0], rear = Math.min(...S.hull.map(q => q[0]));
  const notch = S.hull.find(q => q[1] === 0 && q[0] < nose) || [rear, 0];  // 船尾凹口（噴嘴裝在這裡）
  const col = S.color;  // 顏色先算好（每幀不用重算）
  return [S, { id, nose, rear, nx: notch[0], hi: mixWhite(col, 0.35), lo1: mixBlack(col, 0.25), lo2: mixBlack(col, 0.7),
    trim: mixWhite(col, 0.3), fin: mixWhite(col, 0) + 'b3', ring: mixWhite(col, 0) + 'cc' }];
}));
function drawGateRing(c, A) {  // 星門號的傳送環（原點在環中心）
  c.strokeStyle = A.ring; c.lineWidth = 1.3; c.setLineDash([3, 3]);
  c.beginPath(); c.arc(0, 0, 7.5, 0, TAU); c.stroke(); c.setLineDash([]);
}
function drawShipArt(c, S, o = {}) {
  const A = SHIP_ART.get(S), col = S.color, t = Game.time, x1 = A.nx - 2.8, x0 = A.nx + 1.5;
  const hull = () => { c.beginPath(); S.hull.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); };
  if (o.moving) {  // 噴嘴出口後面的火光（畫在船身底下，只從船尾透出來）
    const R = 7 + Math.sin(t * 30) * 0.8, fx = A.nx - 5, g = c.createRadialGradient(fx, 0, 0, fx, 0, R);
    g.addColorStop(0, 'rgba(190,230,255,0.55)'); g.addColorStop(0.5, 'rgba(120,190,255,0.22)'); g.addColorStop(1, 'rgba(120,190,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(fx, 0, R, 0, TAU); c.fill();
  }
  if (A.id === 'wraith') {  // 幻影：兩條往後拖的尾鰭
    c.strokeStyle = A.fin; c.lineWidth = 1.4;
    for (const sg of [-1, 1]) { c.beginPath(); c.moveTo(-8, sg * 6); c.lineTo(-19, sg * 10); c.stroke(); }
  }
  if (A.id === 'gate' && !o.noRing) {  // 星門：船尾旋轉的傳送環（新畫面另外用 s/gate_ring 貼圖轉）
    c.save(); c.translate(-9, 0); c.rotate(t * 2); drawGateRing(c, A); c.restore();
  }
  // 深色描邊（剪影）；衝刺／超頻時發船色光暈
  if (o.hot) { c.shadowBlur = 22; c.shadowColor = col; }
  hull(); c.strokeStyle = '#03050c'; c.lineWidth = 4 + (o.armor || 0) * 0.8; c.lineJoin = 'round'; c.stroke();
  c.shadowBlur = 0;
  // 上半面亮、下半面暗（光從左上來）
  for (const sg of [-1, 1]) {
    c.save(); c.beginPath(); c.rect(-40, sg < 0 ? -40 : 0, 80, 40); c.clip();
    const g = c.createLinearGradient(A.nose, sg * 2, A.rear, sg * 12);
    g.addColorStop(0, sg < 0 ? A.hi : col); g.addColorStop(1, sg < 0 ? A.lo1 : A.lo2);
    hull(); c.fillStyle = g; c.fill(); c.restore();
  }
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.8;  // 中線高光
  c.beginPath(); c.moveTo(A.nose - 1, -0.3); c.lineTo(A.nx + 1, -0.3); c.stroke();
  if (o.armor) {  // 重裝甲：每層一條裝甲板線
    c.strokeStyle = 'rgba(3,5,12,0.6)'; c.lineWidth = 0.9;
    for (let i = 0; i < Math.min(4, o.armor); i++) for (const sg of [-1, 1]) { const x = A.nx + 3 + i * 3; c.beginPath(); c.moveTo(x, sg * 2); c.lineTo(x - 2, sg * 7); c.stroke(); }
  }
  const kx = A.nose * 0.38;  // 駕駛艙：深色玻璃＋反光
  c.fillStyle = '#0a1430'; c.beginPath(); c.ellipse(kx, 0, 4.4, 2.5, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.ellipse(kx + 1.2, -0.9, 1.6, 0.7, -0.2, 0, TAU); c.fill();
  if (A.id === 'vanguard') {  // 先鋒：兩側短砲管
    c.fillStyle = A.trim;
    for (const sg of [-1, 1]) c.fillRect(2, sg * 5 - 0.8, 8, 1.6);
  }
  if (A.id === 'bulwark') {  // 堡壘：機翼上的裝甲板
    c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = 0.9;
    for (const sg of [-1, 1]) for (const x of [-7, -1, 4]) { c.beginPath(); c.moveTo(x, sg * 8); c.lineTo(x, sg * 13); c.stroke(); }
  }
  // 噴嘴：金屬短噴管（蓋住船身黑邊）＋船色環＋出口；移動時藍色噴焰從出口接出去（加速器越多越長）
  if (o.moving) {
    const L = 9 + (o.booster || 0) * 4 + Math.sin(t * 40) * 2 + rand(0, 3), a = rand(0.6, 0.9);
    c.fillStyle = o.booster ? `rgba(170,225,255,${a})` : `rgba(140,210,255,${a})`;
    c.beginPath(); c.moveTo(x1, -3.2); c.lineTo(x1 - L, 0); c.lineTo(x1, 3.2); c.fill();
    c.fillStyle = 'rgba(235,248,255,0.85)';
    c.beginPath(); c.moveTo(x1, -1.4); c.lineTo(x1 - L * 0.45, 0); c.lineTo(x1, 1.4); c.fill();
  }
  const g = c.createLinearGradient(0, -3.6, 0, 3.6);
  g.addColorStop(0, '#9aa6c4'); g.addColorStop(0.5, '#5a6584'); g.addColorStop(1, '#2a3150');
  c.beginPath(); c.moveTo(x0, -2.4); c.lineTo(x1, -3.6); c.lineTo(x1, 3.6); c.lineTo(x0, 2.4); c.closePath();
  c.fillStyle = g; c.fill(); c.strokeStyle = '#03050c'; c.lineWidth = 0.7; c.stroke();
  c.strokeStyle = A.trim; c.lineWidth = 0.6;
  c.beginPath(); c.moveTo(x0 - 1.2, -2.6); c.lineTo(x0 - 1.2, 2.6); c.stroke();
  c.fillStyle = o.moving ? '#bfe6ff' : '#3a4566';
  c.beginPath(); c.ellipse(x1, 0, 0.9, 3.1, 0, 0, TAU); c.fill();
}

// 選飛船畫面的小圖：用 drawShipArt 畫成圖片（船頭朝上、噴焰開著），每艘只畫一次；畫不出來（測試環境）回傳 null
const SHIP_ICON = new Map();
function shipIconURL(S) {
  if (SHIP_ICON.has(S)) return SHIP_ICON.get(S);
  let url = null;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 144;
    const c = cv.getContext('2d');
    c.translate(72, 76); c.scale(3, 3); c.rotate(-Math.PI / 2);
    drawShipArt(c, S, { moving: true });
    url = cv.toDataURL();
  } catch (e) { url = null; }
  SHIP_ICON.set(S, url);
  return url;
}

// 靶場數據面板（右上）：DPS、總傷害、命中次數、傷害來源、這條電路每發幾顆、觸發層
function drawRangePanel() {
  const s = Game.stats, fmt = n => Math.round(n).toLocaleString('zh-TW');
  const src = DMG_SOURCES.filter(([k]) => Range.bySrc[k] > 0).map(([k, label]) => `${label} ${fmt(Range.bySrc[k])}（${Math.round(Range.bySrc[k] / Range.total * 100)}%）`);
  const lines = [
    [`DPS（近 3 秒）${fmt(Range.dps())}`, '#9dff6b', true],
    [`估算 DPS ${fmt(s.dpsEst)}　·　總傷害 ${fmt(Range.total)}　·　命中 ${Range.hits} 次　·　最高單發 ${fmt(Range.maxHit)}`, '#cfe8ff'],
    ...src.map(t => [t, '#8fa3d9']),
    [`開火：每發 ${s.count} 顆、共 ${fmt(s.dmg)} 傷害　·　每秒 ${s.rps.toFixed(2)} 發`, '#ffd166'],
    ...s.layers.map((l, i) => [`◎ 命中第 ${i + 1} 層：每次命中展開 ${l.count} 顆 / ${fmt(l.dmg)} 傷害`, '#ff9dbd']),
    [Input.touch ? '「電路」改電路（改完數據歸零）' : '1 單一　2 一排　3 密集　4 散開　5 實戰　·　R 清除數據　·　T 慢動作　·　Tab 改電路（改完數據歸零）', '#6a79ad'],
    ['粉紅外圈 = 帶「命中觸發」的子彈（命中時才展開觸發器右邊的晶片）', '#6a79ad'],
  ];
  const w = Math.min(470, VW - 40), x = VW - 20 - w;
  let y = 70;
  ctx.fillStyle = 'rgba(10, 16, 40, 0.78)'; ctx.fillRect(x - 10, y - 16, w + 20, lines.length * 18 + 14);
  ctx.textAlign = 'left';
  for (const [t, color, big] of lines) {
    ctx.font = big ? 'bold 16px Microsoft JhengHei' : '12px Microsoft JhengHei'; ctx.fillStyle = color;
    ctx.fillText(t, x, y, w);
    y += big ? 20 : 18;
  }
}

// 小地圖（畫面右上角，螢幕座標）：整張地圖、閘門、飛船
function drawMinimap(x, y, maxW, maxH, left = false) {  // x = 右邊緣（left：左邊緣）
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
}

// 每 0.5 秒算一次 FPS（主迴圈每幀呼叫 FPS.tick）
const FPS = { v: 60, n: 0, t0: 0, tick(now) { this.n++; if (now - this.t0 >= 500) { this.v = Math.round(this.n * 1000 / (now - this.t0)); this.n = 0; this.t0 = now; } } };
function drawHUD() {
  const p = Game.player, s = Game.stats, C = Game.combat, T = Input.touch;
  const hpW = Math.min(220, VW * 0.42);
  ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(20, 20, hpW + 4, 18);
  ctx.fillStyle = p.hp / p.maxHp > 0.3 ? '#4cc9f0' : '#ff4d6d';
  ctx.fillRect(22, 22, hpW * p.hp / p.maxHp, 14);
  if (p.drRec > 0 && p.hp < p.maxHp) {  // 修復無人機：之後還能補回來的血量（淡色接在血條後面）
    ctx.fillStyle = 'rgba(157, 255, 107, 0.35)';
    ctx.fillRect(22 + hpW * Math.max(0, p.hp) / p.maxHp, 22, hpW * Math.min(p.drRec, p.maxHp - Math.max(0, p.hp)) / p.maxHp, 14);
  }
  ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  ctx.fillText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, 28, 33);
  // 衝刺冷卻
  const dashMax = p.ship.dashCd * (1 - Game.passives.dashCd) * Game.mech.dashCd, dr = 1 - clamp(p.dashCd / dashMax, 0, 1);
  ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(20, 42, 110, 8);
  ctx.fillStyle = dr >= 1 ? '#bdf0ff' : '#35508a'; ctx.fillRect(21, 43, 108 * dr, 6);
  ctx.font = '10px Microsoft JhengHei'; ctx.fillStyle = '#8fa3d9';
  ctx.fillText(T ? '衝刺' : '衝刺 [Space/右鍵]', 136, 50);
  // 蓄力／超頻模組過熱（隊友：數值由房主同步過來）
  const heat = Net.role === 'client' ? p.heatR || 0 : s.heatLimit ? p.ohT / s.heatLimit : 0;
  let bx = T ? 180 : 250;  // 小條由左往右排（文字長短不一）
  const bar = (label, k, col) => {
    ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(bx, 42, 70, 8);
    ctx.fillStyle = col; ctx.fillRect(bx + 1, 43, 68 * clamp(k, 0, 1), 6);
    ctx.font = '10px Microsoft JhengHei'; ctx.fillStyle = col; ctx.fillText(label, bx + 74, 50);
    bx += 84 + ctx.measureText(label).width;
  };
  if (s.charge) bar(p.chargeC >= 1 ? '蓄滿' : '蓄力', p.chargeC || 0, p.chargeC >= 1 ? '#ffffff' : '#ffb347');
  if (s.heatLimit) bar(p.ohLock > 0 ? '過熱！' : `熱度 傷害 +${Math.round(heat * 40)}%`, p.ohLock > 0 ? 1 : heat, p.ohLock > 0 ? '#ff4d6d' : '#ff9f1c');
  if (s.stand) {  // 架設：站著不動的層數（隊友：房主同步過來）
    const sk = Net.role === 'client' ? p.standK || 0 : standStacks(p, s.stand), mx = standMax(s.stand);
    bar(`架設 射速 +${sk * 10}%`, sk / mx, sk >= mx ? '#ffffff' : '#9dff6b');
  }
  // 武器升級（散彈、雷射）、輕裝甲 4 層（隊友：房主同步過來）
  const W = Game.wp;
  if (W.focus) { const k = p.focusK || 0; bar(`專注 傷害 +${Math.round(k * W.focus.per * 100)}%`, k / W.focus.max, k >= W.focus.max ? '#ffffff' : '#5ef2ff'); }
  if (W.spreadUp) { const k = p.spreadK || 0; bar(`分散 射速 +${Math.round(k * W.spreadUp.per * 100)}%`, k / W.spreadUp.max, k >= W.spreadUp.max ? '#ffffff' : '#5ef2ff'); }
  if (W.graze) { const k = p.grazeK || 0; bar(`擦彈 射速 +${Math.round(k * W.graze.per * 100)}%`, k / W.graze.max, k >= W.graze.max ? '#ffffff' : '#5ef2ff'); }
  if (W.parryUp) { const k = p.parryK || 0; bar(`格擋流 傷害 +${Math.round(k * W.parryUp.per * 100)}%`, k / W.parryUp.max, k >= W.parryUp.max ? '#ffffff' : '#ff8fd8'); }
  if (W.static) { const k = p.staticK || 0; bar(`靜電 電弧 +${k}`, k / W.static.max, k >= W.static.max ? '#ffffff' : '#9fe8ff'); }
  if (W.rage) { const k = rageAdd(p, W.rage); bar(`狂怒 射速 +${Math.round(k * 100)}%`, k, '#ff4d6d'); }
  if (W.crowd) { const k = Math.min(W.crowd.max, p.crowdK || 0); bar(`群戰 射速 +${Math.round(k * W.crowd.per * 100)}%`, k / W.crowd.max, k >= W.crowd.max ? '#ffffff' : '#ffb347'); }
  if (W.revenge && p.revengeT > 0) bar(`逆襲 ${p.revengeT.toFixed(1)} 秒`, p.revengeT / W.revenge.t, '#ff4d6d');
  if (W.ascetic) { const n = emptySlots(); bar(`空格苦行 傷害 +${Math.round(n * W.ascetic.per * 100)}%`, n / 4, n ? '#ffd166' : '#8fa3d9'); }
  if (Game.mech.traits.streak) { const n = p.streak || 0; bar(`無傷連殺 傷害 +${Math.round(n * STREAK.per * 100)}%`, n / STREAK.max, n >= STREAK.max ? '#ffffff' : '#9fe8ff'); }
  // 奇異點「間歇失效」的格子：失效的那 2 秒標出來
  const fk = (Game.slotAttr || []).map((a, i) => a === 'flaky' && Game.chain[i] ? i : -1).filter(i => i >= 0);
  if (fk.length && flakyOff()) {
    ctx.font = 'bold 11px Microsoft JhengHei'; ctx.fillStyle = '#ff6b6b';
    ctx.fillText(`✖ 間歇失效中：${fk.map(i => CHIPS[Game.chain[i]].short || CHIPS[Game.chain[i]].name).join('、')}`, Math.max(bx, T ? 320 : 410), 50);
  }
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 14px Segoe UI';
  ctx.fillText(`◆ ${Game.credits}`, 20, 72);
  ctx.fillStyle = p.ship.color; ctx.font = 'bold 12px Microsoft JhengHei';
  ctx.fillText(p.ship.name + (Game.module ? `　${MODULES[Game.module].icon} ${MODULES[Game.module].name}${p.shield ? ' ' + '⛨'.repeat(p.shield) : ''}` : ''), 72, 72);
  const m = Game.mate;
  if (m) {  // 雙人：隊友血條
    const mw = Math.min(160, VW * 0.3), tag = Net.role === 'host' ? '2P' : '1P';
    ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(20, 82, mw + 4, 12);
    ctx.fillStyle = m.dead ? '#555' : m.ship.color; ctx.fillRect(22, 84, mw * Math.max(0, m.hp) / m.maxHp, 8);
    ctx.font = '11px Microsoft JhengHei'; ctx.fillStyle = m.dead ? '#ff4d6d' : '#cfe8ff';
    ctx.fillText(m.gone ? `${tag} 隊友離線　·　房號 ${Net.code} 可以重新加入`
      : `${tag} ${m.ship.name}${m.dead ? '　已被擊墜' : `　HP ${Math.ceil(m.hp)}`}`, mw + 32, 93);
  }

  ctx.textAlign = 'right'; ctx.fillStyle = '#cfe8ff'; ctx.font = `bold ${VW < 500 ? 13 : 16}px Microsoft JhengHei`;
  ctx.fillText(C.range ? `🎯 靶場 · ${Range.LAYOUTS[Range.layout]}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : Game.mode === 'range' ? `🎯 靶場 · 實戰 · WAVE ${C.wave}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : C.sandbox ? `${Game.mode === 'coop' ? '雙人' : '沙盒'} · WAVE ${C.wave}` : `${NODE_META[Game.node.type].label} · WAVE ${C.wave} / ${C.wavesTotal}`, VW - 20, 34);
  ctx.font = '12px Microsoft JhengHei'; ctx.fillStyle = '#8fa3d9';
  ctx.fillText(C.range ? `場上子彈 ${Game.bullets.length}` : `擊殺 ${Game.kills}　子彈 ${Game.bullets.length}`, VW - 20, 54);
  // FPS（右上角最上面）：綠 ≥ 55、黃 ≥ 40、紅
  ctx.font = '11px Microsoft JhengHei'; ctx.fillStyle = FPS.v >= 55 ? '#9dff6b' : FPS.v >= 40 ? '#ffd166' : '#ff6b6b';
  ctx.fillText(`FPS ${FPS.v}`, VW - 20, 14);
  if (Game.mode === 'range') drawRangePanel();
  if (Game.mode === 'coop' && Net.active()) {  // 雙人：連線延遲（綠 < 80ms、黃 < 150ms、紅）
    ctx.font = `bold ${VW < 500 ? 13 : 15}px Microsoft JhengHei`; ctx.fillStyle = Net.pingColor(Net.ping);
    ctx.fillText(Net.ping == null ? '連線延遲 測量中…' : `連線延遲 ${Net.ping} ms`, VW - 20, 76);
  }
  // 大地圖：小地圖（電腦在右上角；手機的右邊有按鈕，放在左上角 HP 下面）
  if (T) drawMinimap(20, 96, Math.min(150, VW * 0.22), Math.min(100, VH * 0.2), true);
  else drawMinimap(VW - 20, 88, Math.min(170, VW * 0.24), Math.min(120, VH * 0.22));

  // 電路鏈縮圖（觸控時移到上方，避開拇指）
  const n = Game.chain.length, w = T ? 40 : 54, gap = T ? 5 : 8, total = n * w + (n - 1) * gap;
  let x = VW / 2 - total / 2;
  const y = T ? 84 : VH - 70;
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    const id = Game.chain[i];
    ctx.fillStyle = 'rgba(10, 16, 48, 0.85)'; ctx.fillRect(x, y, w, 40);
    if (id) {
      const col = id === 'weapon' ? Game.wp.color : TYPE_META[CHIPS[id].type].color;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 39);
      ctx.fillStyle = col; ctx.font = `bold ${T ? 11 : 13}px Microsoft JhengHei`;
      ctx.fillText(CHIPS[id].short, x + w / 2, y + 25);
    } else {
      ctx.strokeStyle = '#2f3f78'; ctx.setLineDash([3, 3]); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 39); ctx.setLineDash([]);
    }
    if (i < n - 1) {
      ctx.fillStyle = '#4c5a8f'; ctx.font = '12px Segoe UI';
      ctx.fillText('→', x + w + gap / 2, y + 25);
    }
    x += w + gap;
  }
  ctx.font = '11px Microsoft JhengHei'; ctx.fillStyle = '#8fa3d9';
  if (T) ctx.fillText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒`, VW / 2, y + 56);
  else {
    ctx.fillText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒 · ⚡${s.used}/${s.cap}${s.off ? `（沒電 ${s.off}）` : ''}　[Tab] 編輯電路`, VW / 2, VH - 16);
    ctx.textAlign = 'left'; ctx.fillStyle = '#4a5886';
    ctx.fillText('WASD 移動 · 左鍵射擊 · Space 衝刺', 20, VH - 16);
  }

  const boss = Game.enemies.find(e => e.t.boss && !e.dead);
  if (boss) {  // Boss 血條
    const bw = Math.min(520, VW - 40), bx = VW / 2 - bw / 2, by = T ? VH - 44 : VH - 112;
    ctx.fillStyle = 'rgba(20, 6, 14, 0.85)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
    ctx.fillStyle = boss.enraged ? '#ffd166' : '#ff4d6d';
    ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 10);
    ctx.textAlign = 'center'; ctx.font = 'bold 13px Microsoft JhengHei'; ctx.fillStyle = '#ffd3dc';
    ctx.fillText(`♛ ${boss.t.name}${boss.enraged ? '（暴走）' : ''}`, VW / 2, by - 6);
  }

  const why = Net.pauseReason();
  if (why && (Net.mateEditing || Net.mateAway) && !Net.waiting && !Net.rejoin) {  // 雙人：隊友在編輯電路／切到其他視窗 → 暫停中（斷線另有視窗）
    ctx.fillStyle = 'rgba(5, 6, 15, 0.55)'; ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center'; ctx.font = 'bold 26px Microsoft JhengHei'; ctx.fillStyle = '#ffd166';
    ctx.fillText(`⏸ ${why}`, VW / 2, VH * 0.45);
    ctx.font = '14px Microsoft JhengHei'; ctx.fillStyle = '#cfe8ff';
    ctx.fillText(Input.touch ? '暫停中　·　你也可以按「電路」整理自己的電路' : '暫停中　·　你也可以按 Tab 整理自己的電路', VW / 2, VH * 0.45 + 30);
  }
  const BN = FX.banner;
  if (BN) {
    ctx.globalAlpha = Math.min(1, BN.t);
    ctx.textAlign = 'center'; ctx.font = 'bold 36px Microsoft JhengHei'; ctx.fillStyle = '#4cc9f0';
    ctx.fillText(BN.text, VW / 2, VH * 0.22);
    if (BN.sub) {
      ctx.font = 'bold 16px Microsoft JhengHei'; ctx.fillStyle = '#ffd400';
      ctx.fillText(BN.sub, VW / 2, VH * 0.22 + 30);
    }
    ctx.globalAlpha = 1;
  }
}
