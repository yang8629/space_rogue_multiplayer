// 星環電路 多人版 · render.js：戰鬥畫面繪圖：世界、敵人、子彈、飛船、HUD、靶場面板
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 武器的狀態小條（左上，右鍵冷卻條下面）：每把武器顯示什麼、什麼顏色（讀玩家身上的武器狀態；隊友那邊是房主同步來的，p.wN = 場上幾個飛輪／重力井）
const WEAPON_HUD = {
  laser: p => ({ label: p.hLock > 0 ? '過熱！' : `熱度 ${pct(p.hHeat || 0)}`, k: p.hLock > 0 ? 1 : p.hHeat || 0, color: p.hLock > 0 ? '#ff4d6d' : '#ff9f1c' }),
  scatter: p => { const W = WEAPON_PLAY.scatter, M = W.max(), n = p.wN ?? W.count(p); return { label: `飛輪 ${M - n} / ${M}`, k: (M - n) / M, color: '#ffb347' }; },
  plasma: p => { const W = WEAPON_PLAY.plasma, M = W.max(), n = p.wN ?? W.count(p); return { label: `重力井 ${n} / ${M}`, k: n / M, color: '#c77dff' }; },
  railgun: p => ({ label: p.hookE ? (p.hookE.t.boss ? '釘住旗艦！' : `勾住了！${(p.hookX || []).length ? '×' + (1 + p.hookX.length) : ''}`) : '鉤爪', k: p.hookE ? p.hookT / WEAPON_PLAY.railgun.holdT(p.hookE) : 0, color: '#ffd166' }),
  drone: p => {
    if (p.guardT > 0) return { label: `收攏中 還能擋 ${p.guardN}`, k: p.guardN / WEAPON_PLAY.drone.blockMax(), color: '#7cf5c8' };
    const D = p.drones || [], up = D.filter(d => !(d.down > 0)).length;
    return { label: `無人機 ${up} / ${D.length}`, k: D.length ? up / D.length : 1, color: up < D.length ? '#ff9f1c' : '#7cf5c8' };
  },
};

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

// 靶場數據面板（右上）：DPS、總傷害、命中次數、傷害來源、每發幾顆、每條線
function drawRangePanel() {
  const s = Game.stats, fmt = n => Math.round(n).toLocaleString('zh-TW');
  const src = DMG_SOURCES.filter(([k]) => Range.bySrc[k] > 0).map(([k, label]) => `${label} ${fmt(Range.bySrc[k])}（${Math.round(Range.bySrc[k] / Range.total * 100)}%）`);
  const lines = [
    [`DPS（近 3 秒）${fmt(Range.dps())}`, '#9dff6b', true],
    [`估算 DPS ${fmt(s.dpsEst)}　·　總傷害 ${fmt(Range.total)}　·　命中 ${Range.hits} 次　·　最高單發 ${fmt(Range.maxHit)}`, '#cfe8ff'],
    ...src.map(t => [t, '#8fa3d9']),
    [`開火：每發 ${s.count} 顆、共 ${fmt(s.dmg)} 傷害　·　每秒 ${s.rps.toFixed(2)} 發`, '#ffd166'],
    ...(s.line.cells.length ? [[`◎ 線：${s.line.cells.map(c => lvName(c.id, c.lv)).join(' → ')}`, '#ff9dbd']] : []),
    [Input.touch ? '「電路」改電路（改完數據歸零）' : '1 單一　2 一排　3 密集　4 散開　6 爆量　5 實戰　·　R 清除數據　·　T 慢動作　·　Tab 改電路（改完數據歸零）', '#6a79ad'],
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

// 新手教學：上方中間一個框（第幾段、這一步要做什麼、進度；完成時變綠）；右下角「按住 Esc 跳過」＋按住的進度條
function drawTutorialPanel() {
  const V = Tutorial.view();
  if (!V) return;
  ctx.font = 'bold 17px Microsoft JhengHei';
  const w = Math.min(VW - 40, Math.max(360, ctx.measureText(V.goal).width + 48)), x = VW / 2 - w / 2, y = 22, col = V.done ? '#9dff6b' : '#ffd166';
  hudFrame(x, y, w, 64, col);
  ctx.textAlign = 'left'; hudText(V.sec, x + 14, y + 20, col, 'bold 12px Microsoft JhengHei');
  ctx.textAlign = 'right'; if (V.prog || V.done) hudText(V.done ? '✓ 完成' : V.prog, x + w - 14, y + 20, col, 'bold 12px Microsoft JhengHei');
  ctx.textAlign = 'center'; hudText(V.goal, VW / 2, y + 48, '#ffffff', 'bold 17px Microsoft JhengHei', w - 24);
  if (Input.touch) return;  // 手機沒有 Esc：從「選單」離開
  ctx.textAlign = 'right'; hudText('按住 Esc 跳過教學', VW - 20, VH - 40, V.hold > 0 ? '#ffffff' : '#6a79ad', '12px Microsoft JhengHei');
  if (V.hold > 0) hudBar(VW - 128, VH - 32, 108, 5, V.hold, '#ffd166');
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
    if (z.kind === 'rack') {  // 武器架：名字（裝備中的變暗，沒解鎖的灰＋🔒）
      const ok = isUnlocked('weapon', z.weapon), on = z.weapon === Hub.weaponId, y = sy(z.y + 44);
      label(`${ok ? '' : '🔒 '}${z.label}`, x, y, !ok ? '#6a79ad' : on ? hudMix(z.color, -0.45) : z.color, 13);  // 裝備中：武器跟著飛船，架子空著，名字變暗（跟停機位一樣）
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
  for (const [i, T] of HUB.targets.entries()) { const v = Hub.dps(i), e = Game.enemies[i] || T; if (v) label(`每秒 ${v}`, sx(e.x), sy(e.y - T.r - 22), '#ffd166', 13); }  // 標靶機：最近 3 秒的每秒傷害；跟著標靶機實際的位置（被鉤爪拉走、甩走時一起動）
  if (Hub.coop()) {  // 多人房間：每艘船頭上的號碼（號碼色），✓ = 準備好了，📖 = 在看面板
    const tag = (slot, x, y, r, b) => label(`${slot}P${r ? ' ✓' : ''}${b ? ' 📖' : ''}`, sx(x), sy(y) - 24, Game.slotColor(slot), 13);
    const ML = Hub.mateLaunch();  // 出發動畫中：名牌跟著動畫裡的船（Hub.mateLaunch），不是同步來的位置
    for (const o of Net.roomShips()) { const m = ML && ML.find(q => q.slot === o.slot); tag(o.slot, m ? m.x : o.x, m ? m.y : o.y, o.r, o.b); }
    if (!Hub.actable(Hub.near)) tag(Net.mySlot(), Hub.ship.x, Hub.ship.y, Net.meReady, false);
  }
  if (Hub.actable(Hub.near)) {  // 靠近（按 E 有作用的）：船上方的「E」
    const s = Hub.ship, x = sx(s.x), y = sy(s.y) - 34;
    ctx.fillStyle = 'rgba(7, 11, 26, 0.85)'; ctx.strokeStyle = '#bdf0ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 13, y - 13, 26, 26, 6); ctx.fill(); ctx.stroke();
    ctx.font = 'bold 15px Segoe UI'; ctx.fillStyle = '#bdf0ff'; ctx.fillText('E', x, y + 1);
  }
  ctx.textBaseline = 'alphabetic';
  const fade = Hub.fade();  // 回航的過場：開頭從黑畫面淡入
  if (fade > 0) { ctx.fillStyle = `rgba(3, 5, 12, ${fade})`; ctx.fillRect(0, 0, VW, VH); }
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
function hudText(txt, x, y, col, font, maxW) {  // maxW：超過就壓窄（不給 = 不限）
  ctx.font = font; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = '#03050c';
  ctx.strokeText(txt, x, y, maxW); ctx.fillStyle = col; ctx.fillText(txt, x, y, maxW);
}

// 寶藏無人機的位置：在畫面外就在邊緣畫金色箭頭指向它，旁邊寫還剩幾秒（modeT，隊友那邊也有）；在畫面內頭上寫秒數
function drawTreasureMarks() {
  const M = 34;
  for (const e of Game.enemies) {
    if (e.dead || !e.t.treasure || e.spawnT > 0) continue;
    const sx = (e.x - Game.cam.x) * ZOOM, sy = (e.y - Game.cam.y) * ZOOM, left = Math.max(0, Math.ceil(e.modeT || 0));
    const fl = left <= CFG.TREASURE.blink ? 0.5 + 0.5 * Math.sin(Game.time * 18) : 1;
    ctx.globalAlpha = fl; ctx.textAlign = 'center';
    if (sx > M && sx < VW - M && sy > M && sy < VH - M) { hudText(`寶藏 ${left}s`, sx, sy - 26 * ZOOM - 8, '#ffd166', 'bold 12px Microsoft JhengHei'); ctx.globalAlpha = 1; continue; }
    const cx = VW / 2, cy = VH / 2, a = Math.atan2(sy - cy, sx - cx);
    const k = Math.min((VW / 2 - M) / Math.abs(Math.cos(a) || 1e-9), (VH / 2 - M) / Math.abs(Math.sin(a) || 1e-9));
    const x = cx + Math.cos(a) * k, y = cy + Math.sin(a) * k;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-4, 0); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
    ctx.restore();
    hudText(`寶藏 ${left}s`, x - Math.cos(a) * 26, y - Math.sin(a) * 26 + 4, '#ffd166', 'bold 12px Microsoft JhengHei');
    ctx.globalAlpha = 1;
  }
}
const HUD_ROW = 14;  // 左上角狀態每一列的高度（11px 字＋行距）
const HUD_AT = {};  // 左上角某幾列畫在哪（畫布座標）：新手教學的泡泡框指著它（ui/bubble.js）
function drawHUD() {
  const p = Game.player, s = Game.stats, C = Game.combat, T = Input.touch;
  drawTreasureMarks();
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
  // 血條下面一列一列往下排（每列 HUD_ROW 高：左邊一條進度條、右邊文字）：衝刺、武器右鍵、武器狀態；以前三列擠在 14 像素裡，字疊在一起（使用者 10-24）
  let row = 42;
  const line = (k, col, text, tcol, h = 5) => { hudBar(22, row + 1, 106, h, k, col); hudText(text, 136, row + 9, tcol, '11px Microsoft JhengHei'); row += HUD_ROW; };
  const dashMax = p.ship.dashCd * (1 - Game.passives.dashCd) * Game.mech.dashCd, dr = 1 - clamp(p.dashCd / dashMax, 0, 1);
  const A = WEAPONS[Game.weapon.id].alt;  // 武器有右鍵：右鍵不再是衝刺
  const dashRow = row;
  line(dr, dr >= 1 ? '#bdf0ff' : '#4a6aa8', T ? '衝刺' : A ? '衝刺 [Space]' : '衝刺 [Space/右鍵]', '#8fa3d9');
  const WH = WEAPON_HUD[Game.weapon.id], hb = WH && WH(p);  // 武器的狀態：熱度、飛輪數、重力井數、鉤住、收攏
  if (A) {  // 武器右鍵的冷卻（強化下一刀的期間整條變白）
    const ar = 1 - clamp((p.altCd || 0) / A.cd, 0, 1), up = p.edgeT > 0;
    line(up ? 1 : ar, up ? '#ffffff' : ar >= 1 ? '#ff8fd8' : '#7a4a6a', `${A.name}${T ? '' : ' [右鍵]'}${up ? '　下一刀強化！' : ''}`, up ? '#ffffff' : '#ff8fd8');
  }
  if (hb) { ctx.font = '11px Microsoft JhengHei'; HUD_AT.heat = { x: 16, y: row - 4, w: 126 + ctx.measureText(hb.label).width, h: HUD_ROW + 2 }; line(hb.k, hb.color, hb.label, hb.color, 4); }
  let bx = T ? 180 : 250;  // 衝刺那一列右邊的小條：由左往右排（文字長短不一）
  ctx.font = '11px Microsoft JhengHei';
  bx = Math.max(bx, 136 + 12 + ctx.measureText(T ? '衝刺' : A ? '衝刺 [Space]' : '衝刺 [Space/右鍵]').width);
  const bar = (label, k, col) => {
    hudBar(bx + 2, dashRow + 1, 66, 5, k, col);
    hudText(label, bx + 74, dashRow + 9, col, '11px Microsoft JhengHei');
    bx += 84 + ctx.measureText(label).width;
  };
  // 輕裝甲 4 層（隊友：房主同步過來）
  if (Game.mech.traits.streak) { const n = p.streak || 0; bar(`無傷連殺 傷害 +${Math.round(n * STREAK.per * 100)}%`, n / STREAK.max, n >= STREAK.max ? '#ffffff' : '#9fe8ff'); }
  row += 6;
  hudText(`◆ ${Game.credits}`, 20, row + 12, '#9ff0ff', 'bold 14px Segoe UI');  // 晶體的顏色（跟戰場上的晶體一樣）
  ctx.font = 'bold 14px Segoe UI';
  hudText(p.ship.name + (p.shield ? ' ' + '⛨'.repeat(p.shield) : ''), 20 + ctx.measureText(`◆ ${Game.credits}`).width + 14, row + 12, p.ship.color, 'bold 12px Microsoft JhengHei');  // 護盾層數；接在晶體數後面（以前固定 x，晶體四位數會疊到船名）
  row += 20;
  Game.mates.forEach((m, i) => {  // 雙人：隊友血條（一人一行）
    const mw = Math.min(160, VW * 0.3), tag = Game.tagOf(m), y = row + i * HUD_ROW;
    hudBar(22, y + 2, mw, 8, Math.max(0, m.hp) / m.maxHp, m.dead ? '#555555' : Game.colorOf(m));
    const line = m.gone ? `${tag} 隊友離線　·　房號 ${Net.code} 可以重新加入`
      : `${tag} ${m.ship.name}${m.dead ? '　已被擊墜' : `　HP ${Math.ceil(m.hp)}`}${!m.dead && Game.wardOf(m) > 0 ? '　⛨' : ''}`;  // ⛨：還有終焉護殼
    hudText(line, mw + 32, y + 11, m.dead ? '#ff4d6d' : '#cfe8ff', '11px Microsoft JhengHei');
    const ms = m.gone ? null : Net.pingOf(m.slot);  // 這個隊友到房主的延遲（房主自己不寫）
    if (ms != null) { ctx.font = '11px Microsoft JhengHei'; hudText(`　${ms}ms`, mw + 32 + ctx.measureText(line).width, y + 11, NetView.pingColor(ms), '11px Microsoft JhengHei'); }
  });

  ctx.textAlign = 'right';
  hudText(C.tutorial ? '📘 新手教學' : C.range ? `🎯 靶場 · ${Range.LAYOUTS[Range.layout]}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : Game.mode === 'range' ? `🎯 靶場 · 實戰 · WAVE ${C.wave}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : C.sandbox ? `${Game.mode === 'coop' ? '多人' : '沙盒'} · WAVE ${C.wave}` : `${NODE_META[Game.node.type].label} · WAVE ${C.wave} / ${C.wavesTotal}`, VW - 20, 34, '#cfe8ff', `bold ${VW < 500 ? 13 : 16}px Microsoft JhengHei`);
  hudText(C.range ? `場上子彈 ${Game.bullets.length}` : `擊殺 ${Game.kills}　子彈 ${Game.bullets.length}`, VW - 20, 54, '#8fa3d9', '12px Microsoft JhengHei');
  // FPS（右上角最上面）：綠 ≥ 55、黃 ≥ 40、紅
  if (Settings.fps) { ctx.font = '11px Microsoft JhengHei'; ctx.fillStyle = FPS.v >= 55 ? '#9dff6b' : FPS.v >= 40 ? '#ffd166' : '#ff6b6b'; ctx.fillText(`FPS ${FPS.v}`, VW - 20, 14); }  // 設定頁可以關掉
  if (Game.mode === 'range') drawRangePanel();
  if (Game.mode === 'tutorial') drawTutorialPanel();
  if (Game.mode === 'coop' && Net.active()) {  // 雙人：連線延遲（綠 < 80ms、黃 < 150ms、紅）
    ctx.font = `bold ${VW < 500 ? 13 : 15}px Microsoft JhengHei`; ctx.fillStyle = NetView.pingColor(Net.ping);
    ctx.fillText(Net.ping == null ? '連線延遲 測量中…' : `連線延遲 ${Net.ping} ms`, VW - 20, 76);
  }
  // 大地圖：小地圖（電腦在右上角；手機的右邊有按鈕，放在左上角 HP 下面）
  if (T) drawMinimap(20, row + Game.mates.length * HUD_ROW + 8, Math.min(150, VW * 0.22), Math.min(100, VH * 0.2), true);
  else drawMinimap(VW - 20, 88, Math.min(170, VW * 0.24), Math.min(120, VH * 0.22));

  // 電路縮圖（觸控時移到上方，避開拇指）
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
    } else hudFrame(x, y, w, 40, null, 0.55);  // 空格：暗一點的空框（不用虛線）
    if (i < n - 1) {
      ctx.fillStyle = '#4c5a8f'; ctx.font = '12px Segoe UI';
      ctx.fillText('→', x + w + gap / 2, y + 25);
    }
    x += w + gap;
  }
  if (T) hudText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒`, VW / 2, y + 56, '#8fa3d9', '11px Microsoft JhengHei');
  else {
    hudText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒　[Tab] 編輯電路`, VW / 2, VH - 16, '#8fa3d9', '11px Microsoft JhengHei');
    ctx.textAlign = 'left'; ctx.fillStyle = '#4a5886';
    ctx.fillText(`WASD 移動 · 左鍵射擊 · Space 衝刺${WEAPONS[Game.weapon.id].alt ? ` · 右鍵${WEAPONS[Game.weapon.id].alt.name}` : ''}`, 20, VH - 16);
  }

  const boss = Game.enemies.find(e => e.t.boss && !e.dead);
  if (boss) {  // Boss 血條
    const bw = Math.min(520, VW - 40), bx = VW / 2 - bw / 2, by = T ? VH - 44 : VH - 112;
    ctx.fillStyle = 'rgba(20, 6, 14, 0.85)'; ctx.fillRect(bx - 2, by - 2, bw + 4, 14);
    ctx.fillStyle = boss.enraged ? '#ffd166' : '#ff4d6d';
    ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 10);
    ctx.textAlign = 'center'; ctx.font = 'bold 13px Microsoft JhengHei'; ctx.fillStyle = '#ffd3dc';
    ctx.fillText(`♛ ${boss.t.name}${boss.enraged ? '（暴走）' : ''}`, VW / 2, by - 6);
  } else {  // 精英血條（跟旗艦同一個位置，黃色）：一隻精英一條，往上疊；同一隻 = 同一個 grp（分裂出來的兩隻、編隊的幾艘，Enemy.grp）
    //   同一隻有好幾艘時切成幾段，一段一艘、各自的血量（編隊 fleet 段、分裂 2 段；打掉的那段留空）；哪一艘殘血看頭上的小血條
    const groups = new Map();
    for (const e of Game.enemies) if (e.t.elite && !e.dead && !(e.spawnT > 0)) {
      const k = e.grp || e.id, g = groups.get(k) || { e, list: [], n: e.t.fleet || (e.grp ? 2 : 1) };
      g.list.push(e); groups.set(k, g);
    }
    const bw = Math.min(420, VW - 40), bx = VW / 2 - bw / 2;
    [...groups.values()].slice(0, 4).forEach((g, i) => {
      const by = (T ? VH - 44 : VH - 112) - i * 30, n = Math.max(g.n, g.list.length), gap = n > 1 ? 4 : 0, sw = (bw - gap * (n - 1)) / n;
      g.list.sort((a, b) => a.id - b.id);
      for (let s = 0; s < n; s++) {
        const e = g.list[s], x = bx + s * (sw + gap);
        ctx.fillStyle = 'rgba(20, 16, 4, 0.85)'; ctx.fillRect(x - 2, by - 2, sw + 4, 12);
        if (!e) continue;  // 打掉的那艘：空的一段
        ctx.fillStyle = e.enraged ? '#ff4d6d' : '#ffd400';
        ctx.fillRect(x, by, sw * clamp(e.hp / (e.maxHp || 1), 0, 1), 8);
      }
      ctx.textAlign = 'center'; ctx.font = 'bold 13px Microsoft JhengHei'; ctx.fillStyle = '#fff3b0';
      ctx.fillText(`⚠ ${eliteName(g.e)}`, VW / 2, by - 6);
    });
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
