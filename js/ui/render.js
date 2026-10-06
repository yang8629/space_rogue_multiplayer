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

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (GLR.on && GLR.ready) {  // 新畫面：世界（背景、地圖、子彈、敵人、飛船、數字）交給 WebGL 繪圖層，這層只畫 HUD
    ctx.clearRect(0, 0, VW, VH);
    GLR.render();
    if (!Game.inArena) return;
    drawHUD();
    if (Input.touch && Game.state === 'play') drawSticks();
    return;
  }
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, VW, VH);
  const c = Game.cam;
  for (const s of Game.stars) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#9fb4ff';
    ctx.fillRect(mod(s.u * VW - c.x * s.z, VW), mod(s.v * VH - c.y * s.z, VH), s.s, s.s);
  }
  ctx.globalAlpha = 1;
  if (!Game.inArena) return;

  const sx = c.shake ? rand(-c.shake, c.shake) : 0, sy = c.shake ? rand(-c.shake, c.shake) : 0;
  ctx.save();
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-c.x + sx, -c.y + sy);
  drawWorld();
  ctx.restore();
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

function drawWorld() {
  const c = Game.cam, W = Arena.W, H = Arena.H;
  ctx.strokeStyle = 'rgba(60, 90, 180, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const g = 80;
  for (let x = Math.max(0, Math.floor(c.x / g) * g); x <= Math.min(W, c.x + ZW); x += g) { ctx.moveTo(x, Math.max(0, c.y)); ctx.lineTo(x, Math.min(H, c.y + ZH)); }
  for (let y = Math.max(0, Math.floor(c.y / g) * g); y <= Math.min(H, c.y + ZH); y += g) { ctx.moveTo(Math.max(0, c.x), y); ctx.lineTo(Math.min(W, c.x + ZW), y); }
  ctx.stroke();
  if (Arena.rect) {
    ctx.strokeStyle = 'rgba(76, 201, 240, 0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, W, H);
  } else WorldView.drawArena(Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player);  // 大地圖：牆、閘門

  WorldView.drawObjects(Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player);  // 行星、黑洞、小行星（含視野陰影）、彗星、星門
  drawExit();
  for (const z of Game.zones) {  // 王的落點轟炸：紅圈，裡面的實心圓越長越大，滿了就爆炸
    const k = 1 - Math.max(0, z.t) / z.max;
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(Game.time * 20) ** 2; ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.18 + 0.2 * k; ctx.fillStyle = '#ff2a2a';
    ctx.beginPath(); ctx.arc(z.x, z.y, z.r * k, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#ffd166';
  for (const p of Game.pickups) {
    if (p.gone || (p.life < 3 && Math.floor(p.life * 8) % 2)) continue;
    polygon(p.x, p.y, 5, 4, Game.time * 3);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'lighter';
  // 我方子彈在飛船 50px 內變淡（最淡 20%），免得後期彈幕把船蓋住；相位刃本來就只在身邊，不變淡
  const ships = [Game.player, Game.mate].filter(p => p && !p.dead && !p.gone), FADE = 50;
  for (const b of Game.bullets) {
    let fa = 1;
    if (b.shape !== 'blade') for (const p of ships) fa = Math.min(fa, 0.2 + 0.8 * Math.min(1, Math.hypot(b.x - p.x, b.y - p.y) / FADE));
    drawBullet(b, fa);
  }
  for (const z of Game.zaps) {  // 電弧：鋸齒狀的閃電
    ctx.globalAlpha = z.life / z.max;
    ctx.strokeStyle = z.c || '#9fe8ff'; ctx.lineWidth = 2;  // c：攔截合併的綠色電弧
    const dx = z.x2 - z.x1, dy = z.y2 - z.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    ctx.beginPath(); ctx.moveTo(z.x1, z.y1);
    for (let k = 1; k < 6; k++) { const j = rand(-10, 10); ctx.lineTo(z.x1 + dx * k / 6 + nx * j, z.y1 + dy * k / 6 + ny * j); }
    ctx.lineTo(z.x2, z.y2); ctx.stroke();
  }
  for (const f of Game.flashes || []) {  // 彗星爆炸的閃光
    const k = f.life / f.max, g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (0.7 + 0.5 * (1 - k)));
    g.addColorStop(0, `rgba(235,250,255,${0.9 * k})`); g.addColorStop(0.4, `rgba(190,233,255,${0.45 * k})`); g.addColorStop(1, 'rgba(190,233,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 1.2, 0, TAU); ctx.fill();
  }
  for (const r of Game.rings) {  // 爆炸光圈
    const t = 1 - r.life / r.max;
    ctx.globalAlpha = r.life / r.max;
    ctx.strokeStyle = r.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (0.4 + 0.6 * t), 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const q of Game.particles) {
    ctx.globalAlpha = q.life / q.max;
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  drawEnemyBullets();  // 敵彈畫在敵人底下（看起來從砲管／機身邊緣射出），我方子彈之上（看起來從砲管／機身邊緣射出）
  // 敵人畫在我方子彈之上，才不會被彈幕蓋住
  // 被小行星擋住的敵人看不到：只在那顆小行星邊緣畫一個淡淡的「？」
  const viewer = Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player;
  for (const e of Game.enemies) {
    const rock = e.t.boss ? null : Objects.blocker(viewer, e);
    if (!rock) { drawEnemy(e); continue; }
    const a = Math.atan2(e.y - rock.y, e.x - rock.x);
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#ff8f8f'; ctx.font = 'bold 14px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('?', rock.x + Math.cos(a) * (rock.r + 10), rock.y + Math.sin(a) * (rock.r + 10) + 5);
  }
  ctx.globalAlpha = 1;

  // 敵方攻擊畫在我方子彈之上、不用 lighter 疊色：紅色實心＋深色外框，才不會被我方彈幕蓋掉
  for (const e of Game.enemies) drawTelegraph(e);

  const tg = Game.player.target;
  if (Input.touch && tg && !tg.dead) {  // 自動攻擊的鎖定框
    const r = tg.r + 10, s = Game.time * 3;
    ctx.strokeStyle = 'rgba(157, 255, 107, 0.85)'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(tg.x, tg.y, r, s + i * TAU / 4, s + i * TAU / 4 + 0.6); ctx.stroke();
    }
  }
  if (Game.mate && Game.state === 'play') {  // 雙人：倒下的人畫在原地，外圈是救援範圍與進度
    if (Game.mate.dead && !Game.mate.gone) drawDowned(Game.mate, Net.role === 'host' ? '2P' : '1P', !Game.player.dead);
    if (Game.player.dead) drawDowned(Game.player, Net.role === 'host' ? '1P' : '2P', false);
  }
  if (Game.mate && !Game.mate.dead && !Game.mate.gone) drawPlayer(Game.mate, Net.role === 'host' ? '2P' : '1P');
  if (Game.state !== 'dead' && !Game.player.dead) drawPlayer(Game.player, Game.mate ? (Net.role === 'host' ? '1P' : '2P') : '');

  ctx.textAlign = 'center';
  // 浮動數字：深色外框再填色（疊在一起、壓在亮色彈幕上時才分得開）
  //   分兩批：先一般數字、再大數字（大的永遠在最上層）；每批只設一次字型和外框粗細
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#03050c';
  for (const big of [false, true]) {
    ctx.font = big ? 'bold 21px Microsoft JhengHei' : 'bold 15px Segoe UI';
    ctx.lineWidth = big ? 4 : 3.5;
    for (const t of Game.texts) {
      if (!t.big !== !big) continue;
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
  }
  ctx.globalAlpha = 1; ctx.lineJoin = 'miter';
}

// 衝鋒／滾球預警線：跟敵方子彈一起畫在我方子彈之上，一律紅色
// 區域出口：旋轉的綠色光環；出口不在畫面裡時，飛船旁邊畫一個箭頭指過去
function drawExit() {
  const X = Game.exit;
  if (!X) return;
  const t = Game.time, pulse = 1 + 0.08 * Math.sin(t * 5);
  if (X.gate) {  // 大地圖：閘門本身由 WorldView.drawArena 畫，這裡只寫字＋畫箭頭（已經穿過去的人不畫）
    const me = Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player, g = Arena.gates[me.zone];
    if (!g || !g.open) return;
    ctx.globalAlpha = 1; ctx.fillStyle = '#c9fff3'; ctx.font = 'bold 14px Microsoft JhengHei'; ctx.textAlign = 'center';
    ctx.fillText('閘門', g.x - g.nx * 30, g.y - g.ny * 30 - 10);
  } else {
  ctx.strokeStyle = '#2ee6a6'; ctx.lineWidth = 4; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(X.x, X.y, X.r * pulse, 0, TAU); ctx.stroke();
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { const a = t * 2 + i * TAU / 3; ctx.beginPath(); ctx.arc(X.x, X.y, X.r * 0.6, a, a + 1.2); ctx.stroke(); }
  ctx.globalAlpha = 0.15; ctx.fillStyle = '#2ee6a6'; ctx.beginPath(); ctx.arc(X.x, X.y, X.r * pulse, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = '#c9fff3'; ctx.font = 'bold 14px Microsoft JhengHei'; ctx.textAlign = 'center';
  ctx.fillText('出口', X.x, X.y - X.r - 10);
  }
  const p = Game.player.dead && Game.mate && !Game.mate.dead ? Game.mate : Game.player, c = Game.cam;
  if (X.x > c.x && X.x < c.x + ZW && X.y > c.y && X.y < c.y + ZH) return;  // 看得到就不畫箭頭
  const dir = X.gate ? Arena.exitDir(p.x, p.y, p.zone, p.r) : null;  // 大地圖：箭頭照繞牆的路線指
  const a0 = dir ? Math.atan2(dir[1], dir[0]) : Math.atan2(X.y - p.y, X.x - p.x);
  // 角度慢慢轉過去（不跟著每一幀的方向跳）
  const a = drawExit.a = drawExit.a == null || drawExit.key !== X.x + ',' + X.y ? a0 : drawExit.a + angleDiff(drawExit.a, a0) * 0.15;
  drawExit.key = X.x + ',' + X.y;  // 雙人的隊友每次同步都會換一個新的 exit 物件，用位置判斷是不是同一個出口
  const ax = p.x + Math.cos(a) * 60, ay = p.y + Math.sin(a) * 60;
  ctx.fillStyle = '#2ee6a6'; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 6);
  ctx.beginPath(); ctx.moveTo(ax + Math.cos(a) * 12, ay + Math.sin(a) * 12);
  ctx.lineTo(ax + Math.cos(a + 2.5) * 10, ay + Math.sin(a + 2.5) * 10); ctx.lineTo(ax + Math.cos(a - 2.5) * 10, ay + Math.sin(a - 2.5) * 10);
  ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
}
function drawTelegraph(e) {
  if (e.mode !== 'windup') return;
  let len, alpha, w = e.r * 1.6;
  if (e.type === 'elite') { len = telegraphLen(e); alpha = 0.3 + 0.5 * Math.sin(Game.time * 30) ** 2; w = e.r * 1.4; }
  else if (e.type === 'brute') { len = telegraphLen(e); alpha = e.modeT <= CFG.BRUTE.lock ? 0.55 : 0.2; }  // 最後鎖定方向時變亮
  else if (e.type === 'boss2') { len = telegraphLen(e); alpha = 0.25 + 0.45 * Math.sin(Game.time * 30) ** 2; }
  else if (e.type === 'lurker') { len = telegraphLen(e); alpha = 0.3 + 0.5 * Math.sin(Game.time * 30) ** 2; }
  else if (e.type === 'gunboat') {  // 彈幕艇：蓄力中，外圈縮小的紅圈（縮到身上就放彈）
    ctx.globalAlpha = 0.35 + 0.4 * Math.sin(Game.time * 30) ** 2; ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 6 + 40 * Math.max(0, e.modeT) / 0.6, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    return;
  }
  else return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.chargeA) * len, e.y + Math.sin(e.chargeA) * len); ctx.stroke();
  ctx.globalAlpha = 1;
}

// 潛伏者的殘影：記住最近幾個位置（依敵人 id；雙人的隊友那邊也畫得出來）
const LURK_TRAIL = new Map();
function drawLurkerTrail(e) {
  let T = LURK_TRAIL.get(e.id);
  if (!T) { T = []; LURK_TRAIL.set(e.id, T); if (LURK_TRAIL.size > 80) for (const k of LURK_TRAIL.keys()) { if (!Game.enemies.some(q => q.id === k)) LURK_TRAIL.delete(k); } }
  const last = T[T.length - 1];
  if (!last || Math.hypot(e.x - last.x, e.y - last.y) > 10) { T.push({ x: e.x, y: e.y }); if (T.length > 6) T.shift(); }
  ctx.strokeStyle = e.t.color; ctx.lineWidth = 1.5;
  T.forEach((q, i) => {
    ctx.globalAlpha = 0.08 + 0.1 * (i / T.length) * (0.4 + (e.cloak || 0));
    polygon(q.x, q.y, e.r * (0.6 + 0.4 * i / T.length), e.t.shape, Math.atan2(e.vy, e.vx)); ctx.stroke();
  });
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
function drawEnemyBullets() {
  for (const b of Game.eBullets) {
    ctx.fillStyle = 'rgba(255, 30, 30, 0.35)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2, 0, TAU); ctx.fill();
    ctx.fillStyle = b.col || '#ff2a2a'; ctx.strokeStyle = b.col ? '#ff2a2a' : '#2a0000'; ctx.lineWidth = 2;  // 盾衛反彈：芯是原本子彈的顏色、紅框
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = b.col ? '#ffffff' : '#ffd0d0';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU); ctx.fill();
  }
}
function spitterFace(e) { const q = nearestShip(e); return q ? Math.atan2(q.y - e.y, q.x - e.x) : Math.atan2(e.vy, e.vx); }  // 噴吐者：嘴對著瞄準的玩家
function drawEnemy(e) {
  const sp = e.spawnT > 0 ? 1 - e.spawnT / e.spawnMax : 1;
  if (e.type === 'lurker') drawLurkerTrail(e);
  ctx.globalAlpha = (0.3 + 0.7 * sp) * (1 - 0.9 * (e.cloak || 0));  // 潛伏者隱形時幾乎看不到（殘影還在）
  const rot = ['swarmer', 'worm', 'splitling', 'lurker'].includes(e.type) ? Math.atan2(e.vy, e.vx)
    : e.type === 'spitter' ? spitterFace(e) : e.type === 'elite' || e.type === 'boss2' ? enemyFace(e) : e.rot;
  if (e.type === 'elite') {
    ctx.strokeStyle = 'rgba(255, 212, 0, 0.35)'; ctx.lineWidth = 1;
    polygon(e.x, e.y, e.r * 1.5 * sp, 5, -e.rot * 0.7); ctx.stroke();
  }
  // 刺殼縮球／滾動時變小、變成圓一點（12 邊形）；暈眩時閃爍
  const curled = e.type === 'brute' && (e.mode === 'windup' || e.mode === 'charge');
  if (e.type === 'brute' && e.mode === 'stun' && Math.floor(Game.time * 10) % 2) ctx.globalAlpha *= 0.5;
  polygon(e.x, e.y, e.r * sp * (curled ? 0.85 : 1), curled ? 12 : e.t.shape, e.type === 'boss2' && e.mode !== 'chase' ? e.chargeA : rot);
  ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.t.color + '33';
  ctx.fill();
  ctx.strokeStyle = e.flash > 0 ? '#ffffff' : e.t.color;
  ctx.lineWidth = e.type === 'elite' || e.t.boss ? 3 : 2;
  ctx.stroke();
  if (e.t.boss) {  // 旗艦：反向旋轉的內環與脈動核心（暴走時轉成金色）
    const inner = { boss: 4, boss2: 3, boss3: 6 }[e.type] || 4;
    ctx.strokeStyle = e.enraged ? '#ffd166' : e.t.color; ctx.lineWidth = 2;
    polygon(e.x, e.y, e.r * 0.62 * sp, inner, -e.rot * 1.6); ctx.stroke();
    if (e.type === 'boss3') { polygon(e.x, e.y, e.r * 1.35 * sp, 6, e.rot * 0.5); ctx.globalAlpha *= 0.4; ctx.stroke(); ctx.globalAlpha = 0.3 + 0.7 * sp; }
    const pulse = 0.5 + 0.5 * Math.sin(Game.time * (e.enraged ? 12 : 5));
    ctx.globalAlpha = (0.3 + 0.7 * sp) * (0.4 + pulse * 0.5);
    ctx.fillStyle = e.enraged ? '#ffd166' : e.t.color;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.28 * sp, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.3 + 0.7 * sp;
  }
  if (e.shieldA != null) {  // 盾衛：朝固定方向的弧形盾（120°）
    ctx.strokeStyle = '#bfefff'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 7, e.shieldA - Math.PI / 3, e.shieldA + Math.PI / 3); ctx.stroke();
  }
  if (e.type === 'hive') {  // 母巢：脈動的核心
    ctx.fillStyle = e.t.color; ctx.globalAlpha *= 0.4 + 0.3 * Math.sin(Game.time * 4);
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.45, 0, TAU); ctx.fill(); ctx.globalAlpha = 0.3 + 0.7 * sp;
  }
  if (!(e.cloak > 0.5)) {  // 狀態圈：潛伏者隱形時不畫（不能被狀態圈暴露位置）
  if (e.slowT > 0) {  // 減速：藍色外圈
    ctx.strokeStyle = 'rgba(127, 212, 255, 0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, TAU); ctx.stroke();
  }
  if (e.markT > 0 || e.shredT > 0) {  // 弱點標記、破甲：紅色準星
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.8)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Game.time; ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 8, a, a + 0.5); ctx.stroke(); }
  }
  if (e.burnT > 0) {  // 燃燒：橘色閃爍
    ctx.strokeStyle = `rgba(255, 159, 28, ${0.4 + 0.4 * Math.sin(Game.time * 20)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 2, 0, TAU); ctx.stroke();
  }
  const stuck = e.stuckN != null ? e.stuckN : e.stuck ? e.stuck.length : 0;
  if (stuck) {  // 黏著：身上黏了幾發（粉紅小點繞一圈）
    ctx.fillStyle = '#f78cff';
    for (let i = 0; i < Math.min(stuck, 16); i++) {
      const a = i / Math.min(stuck, 16) * TAU + Game.time * 2;
      ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * (e.r + 3), e.y + Math.sin(a) * (e.r + 3), 2.5, 0, TAU); ctx.fill();
    }
  }
  }
  if (e.spawnT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (2.2 - sp), 0, TAU);
    ctx.strokeStyle = e.t.color; ctx.lineWidth = 1; ctx.stroke();
  }
  if (e.hp < e.maxHp && !['swarmer', 'worm', 'splitling'].includes(e.type) && !e.t.boss && !(e.cloak > 0.5)) {
    const w = e.type === 'elite' ? e.r * 3 : e.r * 2;
    ctx.fillStyle = '#300'; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w, 4);
    ctx.fillStyle = e.t.color; ctx.fillRect(e.x - w / 2, e.y - e.r - 12, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}

// 子彈尾巴的長度：最長 max，但不超過從發射點飛過的距離
const tail = (b, max) => Math.min(max, Math.hypot(b.x - b.sx, b.y - b.sy));

function drawBullet(b, fa = 1) {  // fa：整體透明度（飛船附近變淡用）
  const cos = Math.cos(b.angle), sin = Math.sin(b.angle);
  ctx.fillStyle = b.color; ctx.strokeStyle = b.color;
  ctx.globalAlpha = fa;
  if (b.shape === 'rail') {
    ctx.lineWidth = b.r + 2; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.35 * fa;
    const t1 = tail(b, 60), t2 = tail(b, 34);
    ctx.beginPath(); ctx.moveTo(b.x - cos * t1, b.y - sin * t1); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.globalAlpha = fa; ctx.lineWidth = b.r * 0.6; ctx.strokeStyle = '#fff6d8';
    ctx.beginPath(); ctx.moveTo(b.x - cos * t2, b.y - sin * t2); ctx.lineTo(b.x, b.y); ctx.stroke();
  } else if (b.shape === 'blade') {  // 垂直於飛行方向、中間往前凸的弧形刃片
    const w = b.r * 1.6, a0 = Math.min(1, b.life * 6);
    const arc = (bx, by, ww) => {  // 兩端在刃的左右，控制點在前方 → 弧形
      ctx.beginPath(); ctx.moveTo(bx - sin * ww, by + cos * ww);
      ctx.quadraticCurveTo(bx + cos * ww * 0.9, by + sin * ww * 0.9, bx + sin * ww, by - cos * ww); ctx.stroke();
    };
    ctx.lineWidth = 3; ctx.lineCap = 'round';
    // 被分裂過的刃片：後方拖出殘影、中心變白。分裂出的刃片會疊在一起，沒有這個提示看起來就像同一片
    for (let k = b.splits * 2; k >= 1; k--) {
      ctx.globalAlpha = a0 * 0.35 / k;
      arc(b.x - cos * k * 6, b.y - sin * k * 6, w * (1 - k * 0.08));
    }
    ctx.globalAlpha = a0;
    arc(b.x, b.y, w);
    if (b.splits) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; arc(b.x, b.y, w * 0.7); }
    if (b.payload) {  // 帶觸發器：刃的中心與兩端點上粉紅點（不用大圈，免得把刃整個包住看不出形狀）
      ctx.fillStyle = '#ff6b9d';
      for (const [px, py, pr] of [[b.x + cos * w * 0.45, b.y + sin * w * 0.45, 2.6], [b.x - sin * w, b.y + cos * w, 2], [b.x + sin * w, b.y - cos * w, 2]]) {
        ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    return;
  } else if (b.shape === 'line') {
    ctx.lineWidth = b.r; ctx.lineCap = 'round';
    const t = tail(b, 18);
    ctx.beginPath(); ctx.moveTo(b.x - cos * t, b.y - sin * t); ctx.lineTo(b.x, b.y); ctx.stroke();
  } else if (b.shape === 'reflect') {  // 反射鏡反彈：敵彈的圓球外形（外圈＋實心＋亮芯）、我方的顏色
    ctx.globalAlpha = 0.25 * fa; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.7 * fa; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = fa; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU); ctx.fill();
  } else if (b.shape === 'dart') {
    ctx.beginPath();
    ctx.moveTo(b.x + cos * b.r * 2.2, b.y + sin * b.r * 2.2);
    ctx.lineTo(b.x - cos * b.r * 1.5 - sin * b.r, b.y - sin * b.r * 1.5 + cos * b.r);
    ctx.lineTo(b.x - cos * b.r * 1.5 + sin * b.r, b.y - sin * b.r * 1.5 - cos * b.r);
    ctx.closePath(); ctx.fill();
  } else {
    if (b.shape === 'orb') {
      ctx.globalAlpha = 0.3 * fa;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.8, 0, TAU); ctx.fill();
      ctx.globalAlpha = fa;
    }
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
  }
  if (b.payload) {  // 帶觸發器的子彈：粉色外環
    ctx.strokeStyle = '#ff6b9d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

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

function drawPlayer(p, tag = '') {
  if (tag) {  // 雙人：船上方標示 1P / 2P
    ctx.font = 'bold 11px Segoe UI'; ctx.textAlign = 'center'; ctx.fillStyle = p.ship.color;
    ctx.fillText(tag, p.x, p.y - p.r - 12);
  }
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.aim);
  if (p.iframe > 0 && Math.floor(Game.time * 20) % 2) ctx.globalAlpha = 0.35;
  const S = p.ship, own = p === Game.player;
  const parts = own ? Game.parts : p.L ? p.L.parts : p.parts || {}, mod = own ? Game.module : p.L ? p.L.module : p.module;
  const n = id => (parts && parts[id]) || 0;
  // 外觀跟著零件變：加速器 → 噴焰變長變亮、散熱片 → 兩側散熱鰭、感測器 → 船頭天線、輕裝甲 → 外圈薄殼、重裝甲 → 船身裝甲板線
  if (n('sink')) {
    ctx.strokeStyle = '#8f9bb8'; ctx.lineWidth = 2;
    for (let i = 0; i < Math.min(4, n('sink')); i++) for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-2 - i * 4, sgn * 9); ctx.lineTo(-5 - i * 4, sgn * 16); ctx.stroke();
    }
  }
  if (n('sensor')) {
    ctx.strokeStyle = '#8f9bb8'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(22 + n('sensor') * 2, 0); ctx.stroke();
    ctx.fillStyle = '#9dff6b'; ctx.beginPath(); ctx.arc(22 + n('sensor') * 2, 0, 2, 0, TAU); ctx.fill();
  }
  if (mod && MODULES[mod]) {  // 背包模組畫在船尾
    ctx.fillStyle = '#2a3150'; ctx.strokeStyle = '#9aa6c4'; ctx.lineWidth = 1.5;
    ctx.fillRect(-19, -5, 8, 10); ctx.strokeRect(-19, -5, 8, 10);
  }
  drawShipArt(ctx, S, { moving: p.moving, booster: n('booster'), armor: n('armor'), hot: p.dashT > 0 || p.overdrive > 0 });
  ctx.rotate(-p.aim);
  if (p.frostT > 0) {  // 被彗星凍住：淡藍的霜
    ctx.fillStyle = 'rgba(160, 220, 255, 0.28)'; ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(200, 240, 255, 0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 20, 0, TAU); ctx.stroke();
  }
  for (let i = 0; i < Math.min(3, n('larmor')); i++) {  // 輕裝甲：外圈薄殼
    ctx.strokeStyle = 'rgba(159, 232, 255, 0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 22 + i * 4, 0, TAU); ctx.stroke();
  }
  for (let i = 0; i < (p.shield || 0); i++) {  // 護盾產生器
    ctx.strokeStyle = 'rgba(76, 201, 240, 0.85)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, 26 + i * 5, 0, TAU); ctx.stroke();
  }
  if (p.gravField) {  // 重力井：減速場範圍
    ctx.strokeStyle = 'rgba(179, 136, 255, 0.35)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.arc(0, 0, p.gravField.R, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }
  if (own && Game.stats && Game.stats.charge && (p.chargeC || 0) > 0.02) {  // 停火蓄力：船身外圈的蓄力環（蓄滿時變白、閃動）
    const k = Math.min(1, p.chargeC), full = k >= 1;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.18)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.stroke();
    ctx.strokeStyle = full ? '#ffffff' : '#ffb347'; ctx.lineWidth = full ? 5 : 4;
    if (full) { ctx.shadowBlur = 14 + 8 * Math.sin(Game.time * 10); ctx.shadowColor = '#ffffff'; }
    ctx.beginPath(); ctx.arc(0, 0, 34, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// 雙人：倒下的飛船（灰色殘骸）＋救援範圍虛線圈＋綠色進度弧；mine = 自己是可以去救的那一方
function drawDowned(p, tag, mine) {
  const R = CFG.REVIVE, k = Math.min(1, (p.reviveT || 0) / R.time), pulse = 0.5 + 0.5 * Math.sin(Game.time * 4);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = `rgba(157, 255, 107, ${0.35 + 0.35 * pulse})`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.arc(0, 0, R.range, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
  if (k > 0) {
    ctx.strokeStyle = '#9dff6b'; ctx.lineWidth = 5; ctx.shadowBlur = 12; ctx.shadowColor = '#9dff6b';
    ctx.beginPath(); ctx.arc(0, 0, R.range, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.rotate(p.aim);
  ctx.beginPath();
  p.ship.hull.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.globalAlpha = 0.5; ctx.strokeStyle = '#8a8f98'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  ctx.font = 'bold 12px Microsoft JhengHei'; ctx.textAlign = 'center'; ctx.fillStyle = '#9dff6b';
  ctx.fillText(k > 0 ? `${tag} 救援中 ${Math.round(k * 100)}%` : `${tag} 倒下${mine ? ' · 靠近救援' : ' · 等隊友救援'}`, p.x, p.y - R.range - 8);
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
  const bar = (x, label, k, col) => {
    ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(x, 42, 70, 8);
    ctx.fillStyle = col; ctx.fillRect(x + 1, 43, 68 * clamp(k, 0, 1), 6);
    ctx.font = '10px Microsoft JhengHei'; ctx.fillStyle = col; ctx.fillText(label, x + 74, 50);
  };
  if (s.charge) bar(T ? 180 : 250, p.chargeC >= 1 ? '蓄滿' : '蓄力', p.chargeC || 0, p.chargeC >= 1 ? '#ffffff' : '#ffb347');
  if (s.heatLimit) bar(T ? 250 : 330, p.ohLock > 0 ? '過熱！' : '熱度', p.ohLock > 0 ? 1 : heat, p.ohLock > 0 ? '#ff4d6d' : '#ff9f1c');
  // 奇異點「間歇失效」的格子：失效的那 2 秒標出來
  const fk = (Game.slotAttr || []).map((a, i) => a === 'flaky' && Game.chain[i] ? i : -1).filter(i => i >= 0);
  if (fk.length && flakyOff()) {
    ctx.font = 'bold 11px Microsoft JhengHei'; ctx.fillStyle = '#ff6b6b';
    ctx.fillText(`✖ 間歇失效中：${fk.map(i => CHIPS[Game.chain[i]].short || CHIPS[Game.chain[i]].name).join('、')}`, T ? 320 : 410, 50);
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
  if (T) WorldView.drawMinimap(20, 96, Math.min(150, VW * 0.22), Math.min(100, VH * 0.2), true);
  else WorldView.drawMinimap(VW - 20, 88, Math.min(170, VW * 0.24), Math.min(120, VH * 0.22));

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
    ctx.fillText(`每發 ${s.count} 顆 · 射速 ${s.rps.toFixed(1)}/秒 · ⚡${s.heat}　[Tab] 編輯電路`, VW / 2, VH - 16);
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
  if (Game.banner) {
    ctx.globalAlpha = Math.min(1, Game.banner.t);
    ctx.textAlign = 'center'; ctx.font = 'bold 36px Microsoft JhengHei'; ctx.fillStyle = '#4cc9f0';
    ctx.fillText(Game.banner.text, VW / 2, VH * 0.22);
    if (Game.banner.sub) {
      ctx.font = 'bold 16px Microsoft JhengHei'; ctx.fillStyle = '#ffd400';
      ctx.fillText(Game.banner.sub, VW / 2, VH * 0.22 + 30);
    }
    ctx.globalAlpha = 1;
  }
}
