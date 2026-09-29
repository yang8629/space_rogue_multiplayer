// 星環電路 雙人版 · objects.js：地圖物件（行星、黑洞、彗星、小行星帶）：產生、更新、碰撞、視野、同步
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 地圖物件：場上固定存在、會改變走位和子彈路線（不是可以撿的東西）
//   行星  planet：實心大球，擋所有子彈；靠近的子彈被引力彎過去（越慢彎越多）；大小、耐久、引力隨機；只有旗艦的子彈打得掉（越打越小，打光就崩解）
//   黑洞  hole  ：把附近所有東西往中心拉；核心吞掉子彈，敵人和飛船受傷（敵人走路會繞開，被打進去才會受傷）
//   彗星  comet ：定時沿直線橫越（先有預警線）。撞到敵人、飛船都受傷；打爆後碎片往前炸（只傷敵人）
//   小行星 rock ：一整條小行星帶（中間留 2 個縫），擋所有子彈和敵人（敵人會繞路或鑽縫）；擋住視野；只有單發 ≥ 30 的傷害打得動，打爆給電路上的晶片成長；
//                 旗艦的子彈、旗艦和滾動的刺殼撞上去也會打碎（不給成長）
//   雙人：房主模擬，隊友只收同步（Game.objs）；飛船被拉、被擋由各自的電腦算
// =====================================================================
const OBJ = {
  PLANET_GM: 1.2e7, HOLE_GM: 2.4e7,  // 引力強度（加速度 = GM / 距離²）
  HOLE_R: 280, HOLE_CORE: 34,
  ROCK_MIN_DMG: 30, ROCK_GROW: 0.05,  // 小行星：單發至少 30 才打得動；打爆時電路上每個會成長的晶片 + Lv2 門檻的 5%
  PLANET_HP: 20,  // 行星耐久 = 半徑 × 20（只有旗艦的子彈會扣）；縮到原本一半大小以下就崩解
  FLOW_CELL: 20, FLOW_PAD: 12, FLOW_EVERY: 0.25,  // 敵人尋路：格子大小、障礙物外擴、多久重算一次
  COMET_EVERY: [9, 14], COMET_WARN: 1.5, COMET_SPEED: 380, COMET_HP: 60, COMET_GRAV: 1.5,  // COMET_GRAV：彗星受引力影響的倍數
};
const Objects = {
  dt: 1 / 60,

  // ---------- 產生：每場戰鬥一半機率完全沒有；有的話一般戰 1～2 種、精英戰 1 種（行星或彗星）、旗艦戰 1～2 種（行星 1～2 顆、小行星帶、彗星，沒有黑洞）；沙盒／靶場沒有 ----------
  gen(C, node) {
    if (!C || C.sandbox || Math.random() < 0.5) return [];
    const kinds = C.boss ? pickN(['planet', 'belt', 'comet'], randInt(1, 2)) : C.elites ? pickN(['planet', 'comet'], 1) : pickN(['planet', 'hole', 'comet', 'belt'], randInt(1, 2));
    if (kinds.includes('comet') && !kinds.includes('planet')) kinds.push('planet');  // 有彗星就配一顆行星：彗星會被引力彎過去
    const out = [], cx = CFG.WORLD_W / 2, cy = CFG.WORLD_H / 2;
    const spot = (minD, r) => {  // 離開場地中央（玩家出生點）和其他物件
      for (let i = 0; i < 60; i++) {
        const x = rand(r + 120, CFG.WORLD_W - r - 120), y = rand(r + 120, CFG.WORLD_H - r - 120);
        if (Math.hypot(x - cx, y - cy) < minD + r) continue;
        if (out.some(o => o.type !== 'rock' && o.type !== 'cometgen' && Math.hypot(o.x - x, o.y - y) < (o.R || o.r) + r + 160)) continue;
        return { x, y };
      }
      return null;
    };
    for (const k of kinds) {
      if (k === 'planet') for (let n = C.boss ? randInt(1, 2) : 1; n > 0; n--) {  // 大小、耐久、引力隨機（引力 ×0.7～1.3）
        const r = randInt(55, 95), p = spot(300, r);
        if (p) out.push({ type: 'planet', ...p, r, r0: r, hp: r * OBJ.PLANET_HP, maxHp: r * OBJ.PLANET_HP, gm: +rand(0.7, 1.3).toFixed(2) });
      }
      if (k === 'hole') { const p = spot(420, OBJ.HOLE_R * 0.6); if (p) out.push({ type: 'hole', ...p, r: OBJ.HOLE_CORE, R: OBJ.HOLE_R, tick: 0 }); }
      if (k === 'comet') out.push({ type: 'cometgen', t: rand(4, 7) });
      if (k === 'belt') {  // 小行星帶：一條斜線上十幾顆，中央（出生點）附近空出來；另外留 2 個縫（缺一顆，兩旁的縮小、不偏移，寬約 80）讓敵人鑽
        const a = rand(0, TAU), ox = cx + Math.cos(a + Math.PI / 2) * rand(260, 420), oy = cy + Math.sin(a + Math.PI / 2) * rand(260, 420);
        const g1 = randInt(-7, -2), g2 = randInt(2, 7), gap = i => i === g1 || i === g2, edge = i => gap(i - 1) || gap(i + 1);
        for (let i = -9; i <= 9; i++) {
          if (gap(i)) continue;
          const e = edge(i), j = e ? 0 : rand(-22, 22);
          const x = ox + Math.cos(a) * (i * 58 + j) - Math.sin(a) * rand(-12, 12), y = oy + Math.sin(a) * (i * 58 + j) + Math.cos(a) * rand(-12, 12), r = e ? 18 : randInt(18, 32);
          if (x < r || y < r || x > CFG.WORLD_W - r || y > CFG.WORLD_H - r || Math.hypot(x - cx, y - cy) < 200 + r) continue;
          const hp = r * 4;
          out.push({ type: 'rock', x, y, r, hp, maxHp: hp });
        }
      }
    }
    return out;
  },
  list(type) { return Game.objs.filter(o => o.type === type); },

  // ---------- 每幀（房主）：彗星、黑洞對敵人／敵彈、敵人撞行星 ----------
  update(dt) {
    this.dt = dt;
    const G = Game;
    if (!G.objs.length) return;
    for (const o of G.objs) {
      if (o.type === 'cometgen' && (o.t -= dt) <= 0) { o.t = rand(...OBJ.COMET_EVERY); this.spawnComet(); }
      if (o.type === 'comet') this.updateComet(o, dt);
      if (o.type === 'hole') {
        o.tick -= dt;
        const hurt = o.tick <= 0;
        if (hurt) o.tick = 0.25;
        for (const e of G.enemies) {
          if (e.dead || e.spawnT > 0 || e.t.boss) continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y);
          if (d > o.R || d < 1) continue;
          const pull = 60 + 160 * (1 - d / o.R);
          e.x += (o.x - e.x) / d * pull * dt; e.y += (o.y - e.y) / d * pull * dt;
          if (hurt && d < o.r + e.r) e.hurt(10, 0, 0, 'explode', e.lastAtt || null);
        }
      }
    }
    // 敵人不會穿過行星和小行星（撞得很快時多受傷：被擊退撞上去）；繞路靠尋路（flowDir）
    // 旗艦、滾動中的刺殼撞到小行星直接撞碎
    for (const e of G.enemies) {
      if (e.dead) continue;
      for (const o of G.objs) {
        if (o.type !== 'planet' && (o.type !== 'rock' || o.dead)) continue;
        if (o.type === 'rock' && (e.t.boss || (e.type === 'brute' && e.mode === 'charge'))) {
          if (dist2(e.x, e.y, o.x, o.y) < (o.r + e.r) ** 2) this.hitRock(o, o.hp, null, o.x, o.y, true);
          continue;
        }
        if (!this.pushOut(e, o, e.r)) continue;
        if (Math.hypot(e.vx, e.vy) > 300 && G.time > (e.slamT || 0)) {
          e.slamT = G.time + 0.5;
          e.hurt(20, 0, 0, 'shock', e.lastAtt || null);
          floatText(e.x, e.y - e.r, 20, '#ffd166');
        }
      }
    }
    G.objs = G.objs.filter(o => !o.dead);
    if ((this.flowT = (this.flowT || 0) - dt) <= 0) { this.flowT = OBJ.FLOW_EVERY; this.buildFlow(); }
  },

  // ---------- 敵人尋路：看不到玩家（中間有行星或小行星）時，照路線圖繞過去或鑽縫 ----------
  //   場地切成 20×20 的格子，障礙物（外擴 12）佔的格子不能走；每 0.25 秒從每個玩家往外算一次步數（BFS）
  //   敵人往周圍 8 格裡步數最少的那一格走
  blockers() { return Game.objs.filter(o => o.type === 'planet' || (o.type === 'rock' && !o.dead)); },
  buildFlow() {
    const B = this.blockers();
    this.fields = new Map();
    if (!B.length) return;
    const C = OBJ.FLOW_CELL, W = Math.ceil(CFG.WORLD_W / C), H = Math.ceil(CFG.WORLD_H / C), blk = new Uint8Array(W * H);
    for (const o of B) {
      const R = o.r + OBJ.FLOW_PAD, x0 = Math.max(0, Math.floor((o.x - R) / C)), x1 = Math.min(W - 1, Math.floor((o.x + R) / C));
      const y0 = Math.max(0, Math.floor((o.y - R) / C)), y1 = Math.min(H - 1, Math.floor((o.y + R) / C));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
        if (dist2((x + 0.5) * C, (y + 0.5) * C, o.x, o.y) < R * R) blk[y * W + x] = 1;
    }
    for (const p of Game.players()) {
      if (!p || p.dead) continue;
      const dist = new Int32Array(W * H).fill(-1), q = new Int32Array(W * H);
      const px = clamp(Math.floor(p.x / C), 0, W - 1), py = clamp(Math.floor(p.y / C), 0, H - 1);
      let head = 0, tail = 0;
      dist[py * W + px] = 0; q[tail++] = py * W + px;
      while (head < tail) {
        const c = q[head++], x = c % W, y = (c - x) / W, d = dist[c] + 1;
        if (x > 0 && dist[c - 1] < 0 && !blk[c - 1]) { dist[c - 1] = d; q[tail++] = c - 1; }
        if (x < W - 1 && dist[c + 1] < 0 && !blk[c + 1]) { dist[c + 1] = d; q[tail++] = c + 1; }
        if (y > 0 && dist[c - W] < 0 && !blk[c - W]) { dist[c - W] = d; q[tail++] = c - W; }
        if (y < H - 1 && dist[c + W] < 0 && !blk[c + W]) { dist[c + W] = d; q[tail++] = c + W; }
      }
      this.fields.set(p, { dist, W, H });
    }
  },
  // 從 (ax, ay) 到 (bx, by) 的直線有沒有被行星、小行星擋住（pad：線的半寬）；回傳擋住的那一個
  losBlocked(ax, ay, bx, by, pad) {
    for (const o of Game.objs) {
      if (o.type !== 'planet' && (o.type !== 'rock' || o.dead)) continue;
      if (segDist2(ax, ay, bx, by, o.x, o.y) < (o.r + pad) ** 2) return o;
    }
    return null;
  },
  // 尋路方向：往周圍 8 格裡步數最少的格子中心走；找不到路（被圍住、路線圖還沒算好）回傳 null，照直線追
  flowDir(e, p) {
    const F = this.fields && this.fields.get(p);
    if (!F) return null;
    const C = OBJ.FLOW_CELL, { dist, W, H } = F, cx = clamp(Math.floor(e.x / C), 0, W - 1), cy = clamp(Math.floor(e.y / C), 0, H - 1);
    let best = -1, bd = dist[cy * W + cx] >= 0 ? dist[cy * W + cx] : Infinity;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const x = cx + ox, y = cy + oy;
      if ((!ox && !oy) || x < 0 || y < 0 || x >= W || y >= H) continue;
      const d = dist[y * W + x];
      if (d >= 0 && d < bd) { bd = d; best = y * W + x; }
    }
    if (best < 0) return null;
    const tx = (best % W + 0.5) * C - e.x, ty = (Math.floor(best / W) + 0.5) * C - e.y, l = Math.hypot(tx, ty) || 1;
    return [tx / l, ty / l];
  },
  // 敵人繞開黑洞：(mx, my) 是敵人想走的方向；在引力範圍（外加 30）內時，拿掉朝核心的分量改往旁邊繞，再加上往外的力（越近越強）
  // 只影響敵人自己走路：被擊退、被減速、精英衝鋒時還是可能被吸進核心
  steer(e, mx, my) {
    for (const o of Game.objs) {
      if (o.type !== 'hole') continue;
      const dx = e.x - o.x, dy = e.y - o.y, d = Math.hypot(dx, dy), zone = o.R + 30;
      if (d > zone || d < 1) { if (e.holeSide && d > zone + 40) e.holeSide = 0; continue; }
      const nx = dx / d, ny = dy / d, inward = -(mx * nx + my * ny);
      if (!e.holeSide) e.holeSide = -ny * mx + nx * my < 0 ? -1 : 1;  // 進入範圍時決定往哪邊繞，之後不換（蟲群左右擺動也不會卡住）
      const tx = -ny * e.holeSide, ty = nx * e.holeSide;
      if (inward > 0) { mx += (nx + tx) * inward; my += (ny + ty) * inward; }
      const w = 2.5 * (1 - d / zone);
      mx += nx * w; my += ny * w;
    }
    return [mx, my];
  },
  // 圓形物體 a 被推出圓 o 外面；回傳有沒有碰到
  pushOut(a, o, r) {
    const dx = a.x - o.x, dy = a.y - o.y, d = Math.hypot(dx, dy), min = o.r + r;
    if (d >= min) return false;
    const nx = d > 0.01 ? dx / d : 1, ny = d > 0.01 ? dy / d : 0;
    a.x = o.x + nx * min; a.y = o.y + ny * min;
    const vn = (a.vx || 0) * nx + (a.vy || 0) * ny;
    if (vn < 0 && a.vx != null) { a.vx -= vn * nx; a.vy -= vn * ny; }
    return true;
  },
  // 引力加速度（行星、黑洞）
  gravity(x, y) {
    let ax = 0, ay = 0;
    for (const o of Game.objs) {
      if (o.type !== 'planet' && o.type !== 'hole') continue;
      const range = o.type === 'hole' ? o.R : o.r * 3.2, dx = o.x - x, dy = o.y - y, d2 = dx * dx + dy * dy;
      if (d2 > range * range || d2 < 1) continue;
      const d = Math.sqrt(d2), a = (o.type === 'hole' ? OBJ.HOLE_GM : OBJ.PLANET_GM * (o.gm || 1)) / Math.max(d2, (o.r * 1.2) ** 2);
      ax += dx / d * a; ay += dy / d * a;
    }
    return [ax, ay];
  },

  // ---------- 我方子彈：引力彎曲、撞行星／小行星／彗星／黑洞核心；回傳 true = 這顆子彈這一幀結束了 ----------
  bulletHit(b) {
    const G = Game;
    if (!G.objs.length || b.mode === 'orbit' || b.mode === 'wait') return false;
    if (b.speed > 0) {  // 彈弓：只改方向（加速度垂直於飛行方向的分量 / 速度），越慢的子彈彎越多
      const [ax, ay] = this.gravity(b.x, b.y);
      if (ax || ay) b.angle += (-Math.sin(b.angle) * ax + Math.cos(b.angle) * ay) / b.speed * this.dt;
    }
    for (const o of G.objs) {
      if (o.type === 'hole') {
        if (dist2(b.x, b.y, o.x, o.y) < o.r * o.r) { b.dead = true; return true; }  // 核心吞掉子彈
        continue;
      }
      if (o.type === 'comet') {
        if (o.warn > 0 || b.hitSet.has('c' + o.id)) continue;
        if (segDist2(b.px, b.py, b.x, b.y, o.x, o.y) >= (o.r + b.r) ** 2) continue;
        b.hitSet.add('c' + o.id);
        const dmg = hitDamage(b);
        o.hp -= dmg; o.lastAtt = b.att;
        floatText(o.x, o.y - o.r, Math.round(dmg), '#bfe9ff');
        if (o.hp <= 0) this.breakComet(o);
        if (!b.infPierce) {
          if (b.pierce > 0) b.pierce--;
          else if (b.boom && b.mode === 'fly') b.startReturn();
          else { b.dead = true; return true; }
        }
        continue;
      }
      if (o.type !== 'planet' && o.type !== 'rock') continue;
      if (segDist2(b.px, b.py, b.x, b.y, o.x, o.y) >= (o.r + b.r) ** 2) continue;
      if (o.type === 'rock') this.hitRock(o, hitDamage(b), b.owner, b.x, b.y);
      // 撞上去：牆反彈的子彈照法線反彈，迴旋折返，其他消失（過載砲在這裡爆炸）
      const d = Math.hypot(b.x - o.x, b.y - o.y) || 1, nx = (b.x - o.x) / d, ny = (b.y - o.y) / d;
      if (b.bounce > 0) {
        b.bounce--;
        const vx = Math.cos(b.angle), vy = Math.sin(b.angle), dot = vx * nx + vy * ny;
        b.angle = Math.atan2(vy - 2 * dot * ny, vx - 2 * dot * nx);
        b.x = o.x + nx * (o.r + b.r + 1); b.y = o.y + ny * (o.r + b.r + 1); b.px = b.x; b.py = b.y;
        b.hitSet.clear(); b.life = Math.max(b.life, 0.5);
        G.grow(b.owner, 'wallbounce');
        if (b.prism) { b.copy(0.4); b.angle -= 0.2; }
        return false;
      }
      b.x = o.x + nx * (o.r + b.r); b.y = o.y + ny * (o.r + b.r);
      if (b.endBoom) G.explode(b.x, b.y, 90, b.damage, b.color, null, b.att);
      b.dead = true;
      return true;
    }
    return false;
  },
  // 敵彈：被行星、小行星擋住，被黑洞核心吞掉，被引力彎曲；回傳 true = 消失了；旗艦的子彈會削掉行星、打碎小行星
  eBulletHit(b) {
    if (!Game.objs.length) return false;
    const [ax, ay] = this.gravity(b.x, b.y);
    b.vx += ax * this.dt; b.vy += ay * this.dt;
    for (const o of Game.objs) {
      if ((o.type !== 'planet' && o.type !== 'rock' && o.type !== 'hole') || o.dead) continue;
      if (dist2(b.x, b.y, o.x, o.y) >= (o.r + b.r) ** 2) continue;
      if (b.boss && o.type === 'planet') this.hurtPlanet(o, b.dmg, b.x, b.y);
      if (b.boss && o.type === 'rock') this.hitRock(o, b.dmg, null, b.x, b.y, true);
      b.life = 0; return true;
    }
    return false;
  },
  // 行星受傷（只有旗艦的子彈）：越打越小（面積跟著耐久），縮到一半大小以下就崩解
  hurtPlanet(o, dmg, x, y) {
    if (o.dead || !o.maxHp) return;
    o.hp -= dmg;
    o.r = o.r0 * Math.sqrt(Math.max(0, o.hp) / o.maxHp);
    if (Math.random() < 0.3) burst(x, y, '#6c7fb8', 3, 100, 0.3, 2);
    if (o.r >= o.r0 * 0.5) return;
    o.dead = true;
    burst(o.x, o.y, '#6c7fb8', 40, 300, 0.8, 4);
    Game.shake(10); SFX.play('bigkill');
    floatText(o.x, o.y - o.r0, '行星崩解', '#9fb4ff', true);
    if (Net.role === 'host') Net.fx(['t', Math.round(o.x), Math.round(o.y - o.r0), '行星崩解', '#9fb4ff', 1]);
  },
  // 小行星受傷：單發至少 30 才算；打爆時打的人電路上每個會成長的晶片 + 它 Lv2 門檻的 5%（每個晶片一樣值錢）
  //   byBoss：旗艦的子彈或撞擊、滾動的刺殼（沒有最低傷害，打碎不給成長）
  hitRock(o, dmg, owner, x, y, byBoss = false) {
    if (o.dead) return;
    if (byBoss) {
      o.hp -= dmg;
      if (Math.random() < 0.3) burst(x, y, '#c9b79c', 3, 100, 0.3, 2);
      if (o.hp <= 0) { o.dead = true; burst(o.x, o.y, '#c9b79c', 20, 220, 0.6, 3); SFX.play('explode'); }
      return;
    }
    if (dmg < OBJ.ROCK_MIN_DMG) { if (Math.random() < 0.3) burst(x, y, '#8a8f98', 2, 80, 0.2, 2); return; }
    o.hp -= dmg;
    burst(x, y, '#c9b79c', 4, 120, 0.3, 2);
    if (o.hp > 0) return;
    o.dead = true;
    burst(o.x, o.y, '#c9b79c', 24, 220, 0.6, 3);
    SFX.play('bigkill');
    const G = Game, chain = owner ? owner.chain : G.chain, bases = new Set(chain.filter(Boolean).map(baseOf).filter(b => CHIPS[b] && CHIPS[b].grow));
    for (const b of bases) G.grow(owner, b, Math.max(1, Math.round(CHIPS[b].grow.need[0] * OBJ.ROCK_GROW)));
    floatText(o.x, o.y - o.r, bases.size ? '晶片成長 +5%' : '小行星碎裂', '#9dff6b', true);
    if (Net.role === 'host') Net.fx(['t', Math.round(o.x), Math.round(o.y - o.r), bases.size ? '晶片成長 +5%' : '小行星碎裂', '#9dff6b', 1]);
  },
  // 爆炸波及小行星
  explodeRocks(x, y, r, dmg, att) {
    for (const o of Game.objs) if (o.type === 'rock' && !o.dead && Math.hypot(o.x - x, o.y - y) < r + o.r) this.hitRock(o, dmg, att ? att.owner : null, o.x, o.y);
  },

  // ---------- 彗星 ----------
  spawnComet() {
    const W = CFG.WORLD_W, H = CFG.WORLD_H, side = randInt(0, 3);
    const edge = [[rand(200, W - 200), -40], [W + 40, rand(200, H - 200)], [rand(200, W - 200), H + 40], [-40, rand(200, H - 200)]][side];
    const tx = rand(W * 0.3, W * 0.7), ty = rand(H * 0.3, H * 0.7), a = Math.atan2(ty - edge[1], tx - edge[0]);
    // 大小隨機：越大飛越慢、越耐打、爆炸越大（半徑 12～30；速度 520～230）
    const r = randInt(12, 30), k = r / 18, spd = OBJ.COMET_SPEED / k;
    Game.objs.push({ type: 'comet', id: Game.nextId++, x: edge[0], y: edge[1], vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      r, hp: Math.round(OBJ.COMET_HP * k), maxHp: Math.round(OBJ.COMET_HP * k), warn: OBJ.COMET_WARN, hits: new Set(), age: 0 });
    SFX.play('boss');
  },
  updateComet(o, dt) {
    const G = Game;
    if (o.warn > 0) { o.warn -= dt; return; }
    const [ax, ay] = this.gravity(o.x, o.y);  // 行星讓彗星彎軌道，黑洞把彗星吸偏
    o.vx += ax * dt * OBJ.COMET_GRAV; o.vy += ay * dt * OBJ.COMET_GRAV;
    o.x += o.vx * dt; o.y += o.vy * dt; o.age += dt;
    if (o.age > 1 && (o.x < -80 || o.y < -80 || o.x > CFG.WORLD_W + 80 || o.y > CFG.WORLD_H + 80)) { o.dead = true; return; }
    for (const h of G.objs) {
      if (h.type === 'hole' && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 120, 60); return; }  // 被黑洞吞掉時爆炸
      if (h.type === 'planet' && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 100, 40); return; }
      if (h.type === 'rock' && !h.dead && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 100, 40); return; }  // 撞上小行星帶：爆炸也會打碎附近的小行星
    }
    for (const e of G.enemies) {
      if (e.dead || e.spawnT > 0 || o.hits.has(e.id) || dist2(o.x, o.y, e.x, e.y) > (o.r + e.r) ** 2) continue;
      o.hits.add(e.id);
      const s = Math.hypot(o.vx, o.vy) || 1;
      e.hurt(40, o.vx / s * 400, o.vy / s * 400, 'shock', o.lastAtt || null, 3);
      floatText(e.x, e.y - e.r, 40, '#bfe9ff', true);
    }
    for (const p of G.players()) {
      if (o.hits.has(p) || dist2(o.x, o.y, p.x, p.y) > (o.r + p.r) ** 2) continue;
      o.hits.add(p);
      G.hurtPlayer(20, '彗星（撞擊）', p, o.x, o.y);
    }
  },
  // 打爆：碎片沿原本的飛行方向炸出去（只傷敵人，算打爆的人的）
  breakComet(o) {
    if (o.dead) return;
    o.dead = true;
    const a = Math.atan2(o.vy, o.vx), owner = o.lastAtt ? o.lastAtt.owner : null;
    const list = Array.from({ length: 10 }, (_, i) => shot({ angle: (i / 9 - 0.5) * 1.2, speed: 620, damage: 25, radius: 4, life: 0.7,
      color: '#bfe9ff', shape: 'dot', src: 'ship', shard: true }));
    Game.withLoadout(owner, () => spawnShots(list, o.x, o.y, a, 0, null));
    burst(o.x, o.y, '#bfe9ff', 30, 260, 0.6, 3);
    SFX.play('explode');
  },
  cometBoom(o, r, dmg) {  // 爆炸範圍、傷害照彗星大小（範圍最大 180，不會炸到整個畫面）
    o.dead = true;
    const k = o.r / 18;
    Game.explode(o.x, o.y, Math.min(180, r * k), dmg * k, '#bfe9ff', null, o.lastAtt || null);
  },

  // ---------- 飛船（自己的電腦）：黑洞拉扯與核心、行星和小行星擋住 ----------
  moveShip(p, dt) {
    for (const o of Game.objs) {
      if (o.type === 'planet' || o.type === 'rock') this.pushOut(p, o, p.r);
      if (o.type === 'hole') {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d > o.R || d < 1) continue;
        const pull = 40 + 150 * (1 - d / o.R);
        p.x += (o.x - p.x) / d * pull * dt; p.y += (o.y - p.y) / d * pull * dt;
        if (d < o.r + p.r && !Game.isClient()) Game.hurtPlayer(10, '黑洞核心', p, o.x, o.y);
      }
    }
  },
  // 雙人：房主的飛船由房主的電腦算，隊友的飛船由隊友的電腦算；隊友掉進黑洞核心的傷害也要房主判定
  hostCheckMate(m) {
    for (const o of Game.objs) if (o.type === 'hole' && dist2(o.x, o.y, m.x, m.y) < (o.r + m.r) ** 2) Game.hurtPlayer(10, '黑洞核心', m, o.x, o.y);
  },

  // ---------- 視野：被小行星擋住的敵人看不到（感測器 4 層看得到）；回傳擋住它的那顆小行星 ----------
  blocker(viewer, e) {
    if (!viewer || Game.mech.traits.mark) return null;
    for (const o of Game.objs) {
      if (o.type !== 'rock') continue;
      if (dist2(viewer.x, viewer.y, o.x, o.y) < o.r * o.r) continue;
      if (segDist2(viewer.x, viewer.y, e.x, e.y, o.x, o.y) < (o.r * 0.9) ** 2 && dist2(e.x, e.y, o.x, o.y) > o.r * o.r) return o;
    }
    return null;
  },

  // ---------- 同步（房主 → 隊友） ----------
  pack() {
    const r = Math.round;
    return Game.objs.filter(o => o.type !== 'cometgen').map(o =>
      o.type === 'planet' ? [0, r(o.x), r(o.y), r(o.r), o.gm || 1]
        : o.type === 'hole' ? [1, r(o.x), r(o.y), o.r, o.R]
        : o.type === 'rock' ? [2, r(o.x), r(o.y), o.r, r(o.hp), r(o.maxHp)]
        : [3, r(o.x), r(o.y), o.r, r(o.vx), r(o.vy), r2(Math.max(0, o.warn)), o.id]);
  },
  unpack(arr) {
    const T = ['planet', 'hole', 'rock', 'comet'];
    return (Array.isArray(arr) ? arr : []).filter(a => Array.isArray(a) && T[a[0]]).map(a => {
      const o = { type: T[a[0]], x: num(a[1]), y: num(a[2]), r: num(a[3], 20) };
      if (o.type === 'hole') o.R = num(a[4], OBJ.HOLE_R);
      if (o.type === 'planet') o.gm = num(a[4], 1);
      if (o.type === 'rock') { o.hp = num(a[4]); o.maxHp = num(a[5], 1); }
      if (o.type === 'comet') { o.vx = num(a[4]); o.vy = num(a[5]); o.warn = num(a[6]); o.id = a[7]; }
      return o;
    });
  },
  // 隊友：兩次同步之間讓彗星照速度往前飛
  clientStep(dt) {
    for (const o of Game.objs) if (o.type === 'comet' && !(o.warn > 0)) {
      const [ax, ay] = this.gravity(o.x, o.y);
      o.vx += ax * dt * OBJ.COMET_GRAV; o.vy += ay * dt * OBJ.COMET_GRAV; o.x += o.vx * dt; o.y += o.vy * dt;
    }
  },
  // 彗星預警：照引力算出之後的路線（撞到行星、黑洞核心或出場就停）
  cometPath(o) {
    const pts = [[o.x, o.y]], dt = 1 / 30;
    let x = o.x, y = o.y, vx = o.vx, vy = o.vy;
    for (let i = 0; i < 240; i++) {
      const [ax, ay] = this.gravity(x, y);
      vx += ax * dt * OBJ.COMET_GRAV; vy += ay * dt * OBJ.COMET_GRAV; x += vx * dt; y += vy * dt;
      pts.push([x, y]);
      if (x < -100 || y < -100 || x > CFG.WORLD_W + 100 || y > CFG.WORLD_H + 100) break;
      if (Game.objs.some(h => (h.type === 'planet' || h.type === 'hole' || (h.type === 'rock' && !h.dead)) && dist2(x, y, h.x, h.y) < (h.r + o.r) ** 2)) break;
    }
    return pts;
  },

  // ---------- 畫面 ----------
  // 視野陰影：從飛船看出去，每顆小行星後面拖出一塊灰霧（死角；背景太暗，用變暗看不出來）；感測器 4 層看得穿，只留很淡的霧
  // 所有死角合成一個路徑一次填滿（重疊處不會疊得更深），邊緣模糊，不畫硬邊
  drawShadows(viewer) {
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
  draw(viewer) {
    const G = Game;
    this.drawShadows(viewer);
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
          const pts = this.cometPath(o), gap = 70, off = (G.time * s * 0.8) % gap;
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
};
