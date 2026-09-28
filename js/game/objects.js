// 星環電路 雙人版 · objects.js：地圖物件（行星、黑洞、彗星、小行星帶）：產生、更新、碰撞、視野、同步
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 地圖物件：場上固定存在、會改變走位和子彈路線（不是可以撿的東西）
//   行星  planet：實心大球，擋所有子彈；靠近的子彈被引力彎過去（越慢彎越多）
//   黑洞  hole  ：把附近所有東西往中心拉；核心吞掉子彈，敵人和飛船受傷（敵人走路會繞開，被打進去才會受傷）
//   彗星  comet ：定時沿直線橫越（先有預警線）。撞到敵人、飛船都受傷；打爆後碎片往前炸（只傷敵人）
//   小行星 rock ：一整條小行星帶，擋所有子彈；擋住視野；只有單發 ≥ 30 的傷害打得動，打爆給電路上的晶片成長
//   雙人：房主模擬，隊友只收同步（Game.objs）；飛船被拉、被擋由各自的電腦算
// =====================================================================
const OBJ = {
  PLANET_GM: 1.2e7, HOLE_GM: 2.4e7,  // 引力強度（加速度 = GM / 距離²）
  HOLE_R: 280, HOLE_CORE: 34,
  ROCK_MIN_DMG: 30, ROCK_GROW: 0.05,  // 小行星：單發至少 30 才打得動；打爆時電路上每個會成長的晶片 + Lv2 門檻的 5%
  COMET_EVERY: [9, 14], COMET_WARN: 1.5, COMET_SPEED: 380, COMET_HP: 60,
};
const Objects = {
  dt: 1 / 60,

  // ---------- 產生：每場戰鬥一半機率完全沒有；有的話一般戰 1～2 種、精英戰 1 種（行星或彗星）、旗艦戰兩顆對稱行星；沙盒／靶場沒有 ----------
  gen(C, node) {
    if (!C || C.sandbox || Math.random() < 0.5) return [];
    const kinds = C.boss ? ['planet', 'planet'] : C.elites ? pickN(['planet', 'comet'], 1) : pickN(['planet', 'hole', 'comet', 'belt'], randInt(1, 2));
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
    if (C.boss) {  // 旗艦戰：左右兩顆對稱的行星當掩體
      out.push({ type: 'planet', x: cx - 520, y: cy, r: 80 }, { type: 'planet', x: cx + 520, y: cy, r: 80 });
      return out;
    }
    for (const k of kinds) {
      if (k === 'planet') { const r = randInt(60, 90), p = spot(300, r); if (p) out.push({ type: 'planet', ...p, r }); }
      if (k === 'hole') { const p = spot(420, OBJ.HOLE_R * 0.6); if (p) out.push({ type: 'hole', ...p, r: OBJ.HOLE_CORE, R: OBJ.HOLE_R, tick: 0 }); }
      if (k === 'comet') out.push({ type: 'cometgen', t: rand(4, 7) });
      if (k === 'belt') {  // 小行星帶：一條斜線上十幾顆，中央（出生點）附近空出來
        const a = rand(0, TAU), ox = cx + Math.cos(a + Math.PI / 2) * rand(260, 420), oy = cy + Math.sin(a + Math.PI / 2) * rand(260, 420);
        for (let i = -9; i <= 9; i++) {
          const x = ox + Math.cos(a) * i * 58 + rand(-22, 22), y = oy + Math.sin(a) * i * 58 + rand(-22, 22), r = randInt(18, 32);
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
    // 敵人不會穿過行星（撞得很快時多受傷：被擊退撞上去）；小行星帶不擋敵人的移動（只擋子彈和視野），不然敵人會卡在帶子後面
    for (const e of G.enemies) {
      if (e.dead) continue;
      for (const o of G.objs) {
        if (o.type !== 'planet') continue;
        if (!this.pushOut(e, o, e.r)) continue;
        if (o.type === 'planet' && Math.hypot(e.vx, e.vy) > 300 && G.time > (e.slamT || 0)) {
          e.slamT = G.time + 0.5;
          e.hurt(20, 0, 0, 'shock', e.lastAtt || null);
          floatText(e.x, e.y - e.r, 20, '#ffd166');
        }
      }
    }
    G.objs = G.objs.filter(o => !o.dead);
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
      const d = Math.sqrt(d2), a = (o.type === 'hole' ? OBJ.HOLE_GM : OBJ.PLANET_GM) / Math.max(d2, (o.r * 1.2) ** 2);
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
      if (b.boom && b.mode === 'fly') { b.startReturn(); return true; }
      if (b.endBoom) G.explode(b.x, b.y, 90, b.damage, b.color, null, b.att);
      b.dead = true;
      return true;
    }
    return false;
  },
  // 敵彈：被行星、小行星擋住，被黑洞核心吞掉，被引力彎曲；回傳 true = 消失了
  eBulletHit(b) {
    if (!Game.objs.length) return false;
    const [ax, ay] = this.gravity(b.x, b.y);
    b.vx += ax * this.dt; b.vy += ay * this.dt;
    for (const o of Game.objs) {
      if (o.type !== 'planet' && o.type !== 'rock' && o.type !== 'hole') continue;
      if (dist2(b.x, b.y, o.x, o.y) < (o.r + b.r) ** 2) { b.life = 0; return true; }
    }
    return false;
  },
  // 小行星受傷：單發至少 30 才算；打爆時打的人電路上每個會成長的晶片 + 它 Lv2 門檻的 5%（每個晶片一樣值錢）
  hitRock(o, dmg, owner, x, y) {
    if (dmg < OBJ.ROCK_MIN_DMG || o.dead) { if (Math.random() < 0.3) burst(x, y, '#8a8f98', 2, 80, 0.2, 2); return; }
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
    Game.objs.push({ type: 'comet', id: Game.nextId++, x: edge[0], y: edge[1], vx: Math.cos(a) * OBJ.COMET_SPEED, vy: Math.sin(a) * OBJ.COMET_SPEED,
      r: 18, hp: OBJ.COMET_HP, warn: OBJ.COMET_WARN, hits: new Set(), age: 0 });
    SFX.play('boss');
  },
  updateComet(o, dt) {
    const G = Game;
    if (o.warn > 0) { o.warn -= dt; return; }
    const [ax, ay] = this.gravity(o.x, o.y);  // 行星讓彗星彎軌道，黑洞把彗星吸偏
    o.vx += ax * dt * 0.5; o.vy += ay * dt * 0.5;
    o.x += o.vx * dt; o.y += o.vy * dt; o.age += dt;
    if (o.age > 1 && (o.x < -80 || o.y < -80 || o.x > CFG.WORLD_W + 80 || o.y > CFG.WORLD_H + 80)) { o.dead = true; return; }
    for (const h of G.objs) {
      if (h.type === 'hole' && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 120, 60); return; }  // 被黑洞吞掉時爆炸
      if (h.type === 'planet' && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 100, 40); return; }
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
  cometBoom(o, r, dmg) {
    o.dead = true;
    Game.explode(o.x, o.y, r, dmg, '#bfe9ff', null, o.lastAtt || null);
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
      o.type === 'planet' ? [0, r(o.x), r(o.y), o.r]
        : o.type === 'hole' ? [1, r(o.x), r(o.y), o.r, o.R]
        : o.type === 'rock' ? [2, r(o.x), r(o.y), o.r, r(o.hp), r(o.maxHp)]
        : [3, r(o.x), r(o.y), o.r, r(o.vx), r(o.vy), r2(Math.max(0, o.warn)), o.id]);
  },
  unpack(arr) {
    const T = ['planet', 'hole', 'rock', 'comet'];
    return (Array.isArray(arr) ? arr : []).filter(a => Array.isArray(a) && T[a[0]]).map(a => {
      const o = { type: T[a[0]], x: num(a[1]), y: num(a[2]), r: num(a[3], 20) };
      if (o.type === 'hole') o.R = num(a[4], OBJ.HOLE_R);
      if (o.type === 'rock') { o.hp = num(a[4]); o.maxHp = num(a[5], 1); }
      if (o.type === 'comet') { o.vx = num(a[4]); o.vy = num(a[5]); o.warn = num(a[6]); o.id = a[7]; }
      return o;
    });
  },
  // 隊友：兩次同步之間讓彗星照速度往前飛
  clientStep(dt) { for (const o of Game.objs) if (o.type === 'comet' && !(o.warn > 0)) { o.x += o.vx * dt; o.y += o.vy * dt; } },

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
          ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + ux * 3000, o.y + uy * 3000); ctx.stroke();
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
