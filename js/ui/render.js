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
  if (!Game.inArena) { if (Hub.shown()) drawHubHud(); return; }
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
  for (const p of Game.allShips()) if (p && !p.dead && !p.gone) { const d = dist2(p.x, p.y, e.x, e.y); if (d < bd) { bd = d; q = p; } }
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
// 哨兵號的砲台（圖集 s/turret_base、s/turret_gun；原點在砲台中心，砲口朝 +x）：金屬色、切面上色（光從左上）、深色描邊
//   玩家色不畫在貼圖上：遊戲裡另外加中心的光暈和剩餘時間的弧線
function drawTurretBase(c) {
  const R = 11, pts = Array.from({ length: 6 }, (_, i) => [Math.cos(i / 6 * TAU + TAU / 12) * R, Math.sin(i / 6 * TAU + TAU / 12) * R]);
  for (let i = 0; i < 6; i++) {  // 六片三角形：朝左上的亮、朝右下的暗
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % 6], mx = (ax + bx) / 2, my = (ay + by) / 2;
    const lit = clamp(0.5 - (mx + my) / (R * 2.4), 0, 1);
    c.fillStyle = `rgb(${Math.round(42 + lit * 120)},${Math.round(50 + lit * 128)},${Math.round(78 + lit * 128)})`;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(ax, ay); c.lineTo(bx, by); c.closePath(); c.fill();
  }
  c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath();
  c.strokeStyle = '#03050c'; c.lineWidth = 2.2; c.lineJoin = 'round'; c.stroke();
  for (const [x, y] of pts) { c.fillStyle = '#1b2238'; c.beginPath(); c.arc(x * 0.72, y * 0.72, 0.9, 0, TAU); c.fill(); }  // 固定腳的螺栓
}
function drawTurretGun(c) {
  const g = c.createLinearGradient(0, -2.4, 0, 2.4);
  g.addColorStop(0, '#b8c3dc'); g.addColorStop(0.5, '#6a7594'); g.addColorStop(1, '#2a3150');
  c.beginPath(); c.rect(0, -2.2, 14, 4.4); c.fillStyle = g; c.fill(); c.strokeStyle = '#03050c'; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = '#dfe7f7'; c.fillRect(12.4, -2.2, 1.6, 4.4);  // 砲口
  const d = c.createRadialGradient(-1.8, -1.8, 0.5, 0, 0, 6);  // 圓頂：左上亮
  d.addColorStop(0, '#d6deef'); d.addColorStop(0.55, '#77829f'); d.addColorStop(1, '#2c3452');
  c.beginPath(); c.arc(0, 0, 5.6, 0, TAU); c.fillStyle = d; c.fill(); c.strokeStyle = '#03050c'; c.lineWidth = 1.4; c.stroke();
  c.fillStyle = '#0a1430'; c.beginPath(); c.arc(0, 0, 2, 0, TAU); c.fill();  // 中間的感測器（遊戲裡蓋玩家色的光）
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
  if (A.id === 'sentry') {  // 哨兵：背上一座小砲塔（圓頂＋往前的短砲管）、兩翼的裝甲線
    c.fillStyle = '#5a6584'; c.fillRect(-4.5, -1.1, 5.5, 2.2); c.strokeStyle = '#03050c'; c.lineWidth = 0.6; c.strokeRect(-4.5, -1.1, 5.5, 2.2);
    const d = c.createRadialGradient(-5.5, -1.2, 0.3, -4.5, 0, 3.2);
    d.addColorStop(0, '#d6deef'); d.addColorStop(1, '#3a4566');
    c.beginPath(); c.arc(-4.5, 0, 3, 0, TAU); c.fillStyle = d; c.fill(); c.strokeStyle = '#03050c'; c.lineWidth = 0.8; c.stroke();
    c.strokeStyle = A.trim; c.lineWidth = 0.9;
    for (const sg of [-1, 1]) { c.beginPath(); c.moveTo(-1, sg * 10); c.lineTo(-7, sg * 9); c.stroke(); }
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
    [Input.touch ? '「電路」改電路（改完數據歸零）' : '1 單一　2 一排　3 密集　4 散開　6 爆量　5 實戰　·　R 清除數據　·　T 慢動作　·　Tab 改電路（改完數據歸零）', '#6a79ad'],
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
  hudFrame(x - w, y, w, h, 'rgba(130, 160, 240, 0.35)', 0.9);
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
  for (const p of Game.allShips()) {
    if (!p || p.gone) continue;
    const coop = Game.mates.length > 0;
    ctx.fillStyle = p.dead ? '#888' : coop ? Game.colorOf(p) : p === Game.player ? '#fff' : (p.ship && p.ship.color) || '#4cc9f0';
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.5 / s, 0, TAU); ctx.fill();
    if (coop && p === Game.player) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 / s; ctx.stroke(); }  // 雙人：自己多一圈白框
  }
  ctx.restore();
}

// 每 0.5 秒算一次 FPS（主迴圈每幀呼叫 FPS.tick）
const FPS = { v: 60, n: 0, t0: 0, tick(now) { this.n++; if (now - this.t0 >= 500) { this.v = Math.round(this.n * 1000 / (now - this.t0)); this.n = 0; this.t0 = now; } } };
// 基地的文字標籤：門、終端機、發射台的名稱，停機坪的船名（沒解鎖加 🔒），有「新」的亮金色標記，靠近時船上方提示「E」
function drawHubHud() {
  const k = Hub.k, sx = x => (x - Hub.cam.x) * k, sy = y => (y - Hub.cam.y) * k, seen = unlockSeen();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const label = (txt, x, y, color, size = 14) => {
    ctx.font = `bold ${size}px Microsoft JhengHei`; ctx.lineWidth = 4; ctx.strokeStyle = '#03050c';
    ctx.strokeText(txt, x, y); ctx.fillStyle = color; ctx.fillText(txt, x, y);
  };
  const badge = (n, x, y) => {
    const txt = n > 1 ? `新 ${n}` : '新', w = n > 1 ? 40 : 26;
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 10, w, 20, 10); ctx.fill();
    ctx.font = 'bold 12px Microsoft JhengHei'; ctx.fillStyle = '#1a1205'; ctx.fillText(txt, x, y + 1);
  };
  // 房間名：印在地板左上角（大字、淡色、房間的顏色），英文小字在下面
  for (const r of Object.values(HUB.rooms)) {
    ctx.textAlign = 'left'; ctx.globalAlpha = 0.55;
    label(r.label, sx(r.x + 18), sy(r.y + 64), r.color, Math.round(20 * k));
    ctx.font = `bold ${Math.round(10 * k)}px Segoe UI`; ctx.fillStyle = r.color; ctx.fillText(r.en, sx(r.x + 20), sy(r.y + 88));
    ctx.globalAlpha = 1; ctx.textAlign = 'center';
  }
  for (const z of HUB.zones) {
    const x = sx(z.x), n = Screen.hubNew(z, seen);
    if (z.kind === 'rack') {  // 武器架：名字（裝備中的加「・裝備中」，沒解鎖的灰＋🔒）
      const ok = isUnlocked('weapon', z.weapon), on = z.weapon === Hub.weaponId, y = sy(z.y + z.r + 10);
      label(`${ok ? '' : '🔒 '}${z.label}${on ? '（裝在船上）' : ''}`, x, y, !ok ? '#6a79ad' : on ? hudMix(z.color, -0.45) : z.color, 13);  // 裝備中：武器跟著飛船，架子空著（字變暗）
      if (n) badge(n, x + 36 * k, sy(z.y - z.r + 10));
    } else if (z.kind === 'pad') {
      const ok = isUnlocked('ship', z.ship), f = z.face == null ? Math.PI / 2 : z.face, lx = sx(z.x + Math.cos(f) * (z.r + 16)), y = sy(z.y + Math.sin(f) * (z.r + 16));  // 名字寫在船頭那側（機庫中間）
      label(`${ok ? '' : '🔒 '}${z.label}`, lx, y, !ok ? '#6a79ad' : z.ship === Hub.shipId ? hudMix(z.color, -0.45) : z.color, 13);  // 自己開走的那艘：字變暗
      if (n) badge(n, x + 40 * k, sy(z.y - z.r + 4));
    } else {
      const y = sy(z.kind === 'console' ? z.y + 62 : z.kind === 'launch' ? z.y - z.r - 14 : z.y + 78);
      label(z.label, x, y, z.kind === 'term' && Hub.coop() ? '#4a5886' : z.color, 15);  // 多人選配裝中：終端機不能用（變暗）
      if (n) badge(n, x + 60, y - 18);
    }
  }
  if (Hub.coop()) {  // 多人房間：每艘船頭上的號碼（號碼色），✓ = 準備好了，📖 = 在看面板
    const tag = (slot, x, y, r, b) => label(`${slot}P${r ? ' ✓' : ''}${b ? ' 📖' : ''}`, sx(x), sy(y) - 24, Game.slotColor(slot), 13);
    for (const o of Net.roomShips()) tag(o.slot, o.x, o.y, o.r, o.b);
    if (!Hub.near) tag(Net.mySlot(), Hub.ship.x, Hub.ship.y, Net.meReady, false);
  }
  if (Hub.near) {  // 靠近：船上方的「E」
    const s = Hub.ship, x = sx(s.x), y = sy(s.y) - 34;
    ctx.fillStyle = 'rgba(7, 11, 26, 0.85)'; ctx.strokeStyle = '#bdf0ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 13, y - 13, 26, 26, 6); ctx.fill(); ctx.stroke();
    ctx.font = 'bold 15px Segoe UI'; ctx.fillStyle = '#bdf0ff'; ctx.fillText('E', x, y + 1);
  }
  ctx.textBaseline = 'alphabetic';
}

// HUD 的條（跟介面同一套：描邊 #03050c、凹槽、填色上亮下暗）：k = 0～1，seg = 刻度幾格
function hudBar(x, y, w, h, k, col, seg = 0) {
  ctx.fillStyle = '#03050c'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const g0 = ctx.createLinearGradient(0, y, 0, y + h); g0.addColorStop(0, '#05070f'); g0.addColorStop(1, '#141b33');
  ctx.fillStyle = g0; ctx.fillRect(x, y, w, h);
  const fw = w * clamp(k, 0, 1);
  if (fw > 0) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, hudMix(col, 0.45)); g.addColorStop(0.45, col); g.addColorStop(1, hudMix(col, -0.45));
    ctx.fillStyle = g; ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'; ctx.fillRect(x, y, fw, 1);
  }
  if (seg) { ctx.fillStyle = 'rgba(3, 5, 12, 0.55)'; for (let i = 1; i < seg; i++) ctx.fillRect(x + Math.round(w * i / seg), y, 1, h); }
}
// HUD 的框（電路格、小地圖）：描邊、金屬底（上亮下暗）、左上亮邊右下暗邊；edge = 內圈的色邊（null = 不畫）
function hudFrame(x, y, w, h, edge, alpha = 0.9) {
  ctx.save(); ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#03050c'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#18213f'); g.addColorStop(1, '#0a0f22');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'; ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 1, y, 1, h);
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); }
  ctx.restore();
}
// 顏色變亮（k > 0）／變暗（k < 0），給漸層用；只認 #rrggbb
function hudMix(c, k) {
  if (typeof c !== 'string' || c.length !== 7) return c;
  const v = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)).map(x => Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k)));
  return `rgb(${v[0]}, ${v[1]}, ${v[2]})`;
}
// HUD 的字：深色描邊（疊在場景上也看得清楚）
function hudText(txt, x, y, col, font) {
  ctx.font = font; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#03050c';
  ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y);
}

function drawHUD() {
  const p = Game.player, s = Game.stats, C = Game.combat, T = Input.touch;
  const hpW = Math.min(220, VW * 0.42);
  hudBar(22, 22, hpW, 14, p.hp / p.maxHp, p.hp / p.maxHp > 0.3 ? '#4cc9f0' : '#ff4d6d', 10);  // 每格 10%
  if (p.drRec > 0 && p.hp < p.maxHp) {  // 灰血（堡壘號）：之後還能補回來的血量（淡色接在血條後面）
    ctx.fillStyle = 'rgba(176, 186, 206, 0.55)';  // 灰色
    ctx.fillRect(22 + hpW * Math.max(0, p.hp) / p.maxHp, 22, hpW * Math.min(p.drRec, p.maxHp - Math.max(0, p.hp)) / p.maxHp, 14);
  }
  const ward = Game.wardOf(p);
  if (ward > 0) {  // 終焉護殼（？事件）還能免死：血條金框＋右邊 ⛨
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.strokeRect(19, 19, hpW + 6, 20);
    ctx.font = 'bold 15px Segoe UI Symbol'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd166';
    ctx.fillText('⛨' + (ward > 1 ? '×' + ward : ''), hpW + 32, 35);
  }
  ctx.textAlign = 'left';
  hudText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, 28, 33, '#fff', 'bold 12px Segoe UI');
  // 衝刺冷卻
  const dashMax = p.ship.dashCd * (1 - Game.passives.dashCd) * Game.mech.dashCd, dr = 1 - clamp(p.dashCd / dashMax, 0, 1);
  hudBar(22, 44, 106, 5, dr, dr >= 1 ? '#bdf0ff' : '#4a6aa8');
  hudText(T ? '衝刺' : '衝刺 [Space/右鍵]', 136, 50, '#8fa3d9', '10px Microsoft JhengHei');
  // 蓄力／超頻模組過熱（隊友：數值由房主同步過來）
  const heat = Net.role === 'client' ? p.heatR || 0 : s.heatLimit ? p.ohT / s.heatLimit : 0;
  let bx = T ? 180 : 250;  // 小條由左往右排（文字長短不一）
  const bar = (label, k, col) => {
    hudBar(bx + 2, 44, 66, 5, k, col);
    hudText(label, bx + 74, 50, col, '10px Microsoft JhengHei');
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
  hudText(`◆ ${Game.credits}`, 20, 72, '#ffd166', 'bold 14px Segoe UI');
  hudText(p.ship.name + (p.shield ? ' ' + '⛨'.repeat(p.shield) : ''), 72, 72, p.ship.color, 'bold 12px Microsoft JhengHei');  // 護盾層數
  Game.mates.forEach((m, i) => {  // 雙人：隊友血條（一人一行）
    const mw = Math.min(160, VW * 0.3), tag = Game.tagOf(m), y = 82 + i * 14;
    hudBar(22, y + 2, mw, 8, Math.max(0, m.hp) / m.maxHp, m.dead ? '#555555' : Game.colorOf(m));
    hudText(m.gone ? `${tag} 隊友離線　·　房號 ${Net.code} 可以重新加入`
      : `${tag} ${m.ship.name}${m.dead ? '　已被擊墜' : `　HP ${Math.ceil(m.hp)}`}${!m.dead && Game.wardOf(m) > 0 ? '　⛨' : ''}`, mw + 32, y + 11, m.dead ? '#ff4d6d' : '#cfe8ff', '11px Microsoft JhengHei');  // ⛨：還有終焉護殼
  });

  ctx.textAlign = 'right';
  hudText(C.range ? `🎯 靶場 · ${Range.LAYOUTS[Range.layout]}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : Game.mode === 'range' ? `🎯 靶場 · 實戰 · WAVE ${C.wave}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : C.sandbox ? `${Game.mode === 'coop' ? '多人' : '沙盒'} · WAVE ${C.wave}` : `${NODE_META[Game.node.type].label} · WAVE ${C.wave} / ${C.wavesTotal}`, VW - 20, 34, '#cfe8ff', `bold ${VW < 500 ? 13 : 16}px Microsoft JhengHei`);
  hudText(C.range ? `場上子彈 ${Game.bullets.length}` : `擊殺 ${Game.kills}　子彈 ${Game.bullets.length}`, VW - 20, 54, '#8fa3d9', '12px Microsoft JhengHei');
  // FPS（右上角最上面）：綠 ≥ 55、黃 ≥ 40、紅
  if (Settings.fps) { ctx.font = '11px Microsoft JhengHei'; ctx.fillStyle = FPS.v >= 55 ? '#9dff6b' : FPS.v >= 40 ? '#ffd166' : '#ff6b6b'; ctx.fillText(`FPS ${FPS.v}`, VW - 20, 14); }  // 設定頁可以關掉
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
    if (id) {
      const col = id === 'weapon' ? Game.wp.color : TYPE_META[CHIPS[id].type].color;
      hudFrame(x, y, w, 40, col);
      hudText(lvShort(id, slotLv(i)), x + w / 2, y + 25, col, `bold ${T ? 11 : 13}px Microsoft JhengHei`);
      if (rareOf(id)) { ctx.fillStyle = '#ffd166'; ctx.font = `bold ${T ? 10 : 12}px Segoe UI`; ctx.fillText('★', x + w - 7, y + 12); }  // 稀有晶片
    } else hudFrame(x, y, w, 40, null, 0.55);  // 空格：暗一點的空框（不用虛線）
    if (i < n - 1) {
      ctx.fillStyle = '#4c5a8f'; ctx.font = '12px Segoe UI';
      ctx.fillText('→', x + w + gap / 2, y + 25);
    }
    x += w + gap;
  }
  if (T) hudText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒`, VW / 2, y + 56, '#8fa3d9', '11px Microsoft JhengHei');
  else {
    hudText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒 · ⚡${s.used}/${s.cap}${s.off ? `（沒電 ${s.off}）` : ''}　[Tab] 編輯電路`, VW / 2, VH - 16, '#8fa3d9', '11px Microsoft JhengHei');
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
  } else {  // 精英血條（跟旗艦同一個位置，黃色）：分裂出來的兩隻合起來算
    const els = Game.enemies.filter(e => e.t.elite && !e.dead && !(e.spawnT > 0));
    if (els.length) {
      const bw = Math.min(420, VW - 40), bx = VW / 2 - bw / 2, by = T ? VH - 44 : VH - 112;
      const hp = els.reduce((a, e) => a + Math.max(0, e.hp), 0), mx = els.reduce((a, e) => a + e.maxHp, 0);
      ctx.fillStyle = 'rgba(20, 16, 4, 0.85)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 12);
      ctx.fillStyle = els.some(e => e.enraged) ? '#ff4d6d' : '#ffd400';
      ctx.fillRect(bx, by, bw * clamp(hp / (mx || 1), 0, 1), 8);
      ctx.textAlign = 'center'; ctx.font = 'bold 13px Microsoft JhengHei'; ctx.fillStyle = '#fff3b0';
      ctx.fillText(`⚠ ${eliteName(els[0])}${els.length > 1 ? ` ×${els.length}` : ''}`, VW / 2, by - 6);
    }
  }

  const why = Net.pauseReason();
  if (why && (Net.mateEditing || Net.mateAway || Net.hold) && !Net.waiting && !Net.rejoin) {  // 雙人：隊友在編輯電路／切到其他視窗／別的隊友斷線 → 暫停中（自己的斷線另有視窗）
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
