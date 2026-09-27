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
  const c = Game.cam, W = CFG.WORLD_W, H = CFG.WORLD_H;
  ctx.strokeStyle = 'rgba(60, 90, 180, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const g = 80;
  for (let x = Math.max(0, Math.floor(c.x / g) * g); x <= Math.min(W, c.x + ZW); x += g) { ctx.moveTo(x, Math.max(0, c.y)); ctx.lineTo(x, Math.min(H, c.y + ZH)); }
  for (let y = Math.max(0, Math.floor(c.y / g) * g); y <= Math.min(H, c.y + ZH); y += g) { ctx.moveTo(Math.max(0, c.x), y); ctx.lineTo(Math.min(W, c.x + ZW), y); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(76, 201, 240, 0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, W, H);

  ctx.fillStyle = '#ffd166';
  for (const p of Game.pickups) {
    if (p.gone || (p.life < 3 && Math.floor(p.life * 8) % 2)) continue;
    polygon(p.x, p.y, 5, 4, Game.time * 3);
    ctx.fill();
  }

  for (const e of Game.enemies) drawEnemy(e);
  ctx.globalAlpha = 1;

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
    ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 2;
    const dx = z.x2 - z.x1, dy = z.y2 - z.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    ctx.beginPath(); ctx.moveTo(z.x1, z.y1);
    for (let k = 1; k < 6; k++) { const j = rand(-10, 10); ctx.lineTo(z.x1 + dx * k / 6 + nx * j, z.y1 + dy * k / 6 + ny * j); }
    ctx.lineTo(z.x2, z.y2); ctx.stroke();
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

  // 敵方攻擊畫在我方子彈之上、不用 lighter 疊色：紅色實心＋深色外框，才不會被我方彈幕蓋掉
  for (const e of Game.enemies) drawTelegraph(e);
  for (const b of Game.eBullets) {
    ctx.fillStyle = 'rgba(255, 30, 30, 0.35)';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff2a2a'; ctx.strokeStyle = '#2a0000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd0d0';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU); ctx.fill();
  }

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
  for (const t of Game.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = t.big ? 'bold 16px Microsoft JhengHei' : '11px Segoe UI';
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

// 衝鋒／滾球預警線：跟敵方子彈一起畫在我方子彈之上，一律紅色
function drawTelegraph(e) {
  if (e.mode !== 'windup') return;
  let len, alpha, w = e.r * 1.6;
  if (e.type === 'elite') { len = 320; alpha = 0.3 + 0.5 * Math.sin(Game.time * 30) ** 2; w = e.r * 1.4; }
  else if (e.type === 'brute') { len = CFG.BRUTE.rollSpeed * CFG.BRUTE.rollT; alpha = e.modeT <= CFG.BRUTE.lock ? 0.55 : 0.2; }  // 最後鎖定方向時變亮
  else if (e.type === 'boss2') { len = 520; alpha = 0.25 + 0.45 * Math.sin(Game.time * 30) ** 2; }
  else return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff2a2a'; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(e.chargeA) * len, e.y + Math.sin(e.chargeA) * len); ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawEnemy(e) {
  const sp = e.spawnT > 0 ? 1 - e.spawnT / e.spawnMax : 1;
  ctx.globalAlpha = 0.3 + 0.7 * sp;
  const rot = e.type === 'swarmer' ? Math.atan2(e.vy, e.vx)
    : e.type === 'spitter' ? Math.atan2(Game.player.y - e.y, Game.player.x - e.x) : e.rot;
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
  if (e.slowT > 0) {  // 減速：藍色外圈
    ctx.strokeStyle = 'rgba(127, 212, 255, 0.8)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 5, 0, TAU); ctx.stroke();
  }
  if (e.burnT > 0) {  // 燃燒：橘色閃爍
    ctx.strokeStyle = `rgba(255, 159, 28, ${0.4 + 0.4 * Math.sin(Game.time * 20)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r + 2, 0, TAU); ctx.stroke();
  }
  if (e.spawnT > 0) {
    ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (2.2 - sp), 0, TAU);
    ctx.strokeStyle = e.t.color; ctx.lineWidth = 1; ctx.stroke();
  }
  if (e.hp < e.maxHp && e.type !== 'swarmer' && !e.t.boss) {
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
    if (b.payload) {  // 帶命中觸發：刃的中心與兩端點上粉紅點（不用大圈，免得把刃整個包住看不出形狀）
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
  if (b.payload) {  // 帶有命中觸發的子彈：粉色外環
    ctx.strokeStyle = '#ff6b9d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
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
  const S = p.ship;
  if (p.moving) {
    ctx.fillStyle = `rgba(255, 159, 28, ${rand(0.5, 0.9)})`;
    ctx.beginPath(); ctx.moveTo(-6, -4); ctx.lineTo(-6 - rand(8, 14), 0); ctx.lineTo(-6, 4); ctx.fill();
  }
  // 深色實心船身＋船色粗外框＋白色內框：在後期的亮色彈幕裡形成暗色剪影
  const hot = p.dashT > 0 || p.overdrive > 0;
  ctx.shadowBlur = hot ? 28 : 14; ctx.shadowColor = S.color;
  ctx.beginPath();
  S.hull.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.strokeStyle = S.color; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#070a16'; ctx.fill();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
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
    [Input.touch ? '「電路」改電路（改完數據歸零）' : '1 單一　2 一排　3 密集　4 散開　·　R 清除數據　·　T 慢動作　·　Tab 改電路（改完數據歸零）', '#6a79ad'],
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

function drawHUD() {
  const p = Game.player, s = Game.stats, C = Game.combat, T = Input.touch;
  const hpW = Math.min(220, VW * 0.42);
  ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(20, 20, hpW + 4, 18);
  ctx.fillStyle = p.hp / p.maxHp > 0.3 ? '#4cc9f0' : '#ff4d6d';
  ctx.fillRect(22, 22, hpW * p.hp / p.maxHp, 14);
  ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  ctx.fillText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, 28, 33);
  // 衝刺冷卻
  const dashMax = p.ship.dashCd * (1 - Game.passives.dashCd), dr = 1 - clamp(p.dashCd / dashMax, 0, 1);
  ctx.fillStyle = 'rgba(10, 16, 40, 0.8)'; ctx.fillRect(20, 42, 110, 8);
  ctx.fillStyle = dr >= 1 ? '#bdf0ff' : '#35508a'; ctx.fillRect(21, 43, 108 * dr, 6);
  ctx.font = '10px Microsoft JhengHei'; ctx.fillStyle = '#8fa3d9';
  ctx.fillText(T ? '衝刺' : '衝刺 [Space/右鍵]', 136, 50);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 14px Segoe UI';
  ctx.fillText(`◆ ${Game.credits}`, 20, 72);
  ctx.fillStyle = p.ship.color; ctx.font = 'bold 12px Microsoft JhengHei';
  ctx.fillText(p.ship.name + (p.overdrive > 0 ? '　相位超載 ×1.5' : ''), 72, 72);
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
  ctx.fillText(C.range ? `🎯 靶場 · ${Range.LAYOUTS[Range.layout]}${Range.slow ? ' · 慢動作 ×0.25' : ''}` : C.sandbox ? `${Game.mode === 'coop' ? '雙人' : '沙盒'} · WAVE ${C.wave}` : `${NODE_META[Game.node.type].label} · WAVE ${C.wave} / ${C.wavesTotal}`, VW - 20, 34);
  ctx.font = '12px Microsoft JhengHei'; ctx.fillStyle = '#8fa3d9';
  ctx.fillText(C.range ? `場上子彈 ${Game.bullets.length}` : `擊殺 ${Game.kills}　子彈 ${Game.bullets.length}`, VW - 20, 54);
  if (C.range) drawRangePanel();
  if (Game.mode === 'coop' && Net.active()) {  // 雙人：連線延遲（綠 < 80ms、黃 < 150ms、紅）
    ctx.font = `bold ${VW < 500 ? 13 : 15}px Microsoft JhengHei`; ctx.fillStyle = Net.pingColor(Net.ping);
    ctx.fillText(Net.ping == null ? '連線延遲 測量中…' : `連線延遲 ${Net.ping} ms`, VW - 20, 76);
  }

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
