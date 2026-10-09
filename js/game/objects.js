// 星環電路 雙人版 · objects.js：地圖物件（行星、黑洞、彗星、小行星帶）：產生、更新、碰撞、視野、同步
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 地圖物件：場上固定存在、會改變走位和子彈路線（不是可以撿的東西）
//   行星  planet：實心大球，擋所有子彈；靠近的子彈被引力彎過去（越慢彎越多）；大小、耐久、引力隨機；只有旗艦的子彈打得掉（越打越小，打光就崩解）
//   黑洞  hole  ：把附近所有東西往中心拉；核心吞掉子彈，敵人和飛船受傷（敵人走路會繞開，被打進去才會受傷）
//   彗星  comet ：定時沿直線橫越（先有預警線）。撞到敵人、飛船都受傷；打爆後碎片往前炸（敵人、飛船都會被打到）
//   小行星 rock ：一整條小行星帶（中間留 2 個縫），擋所有子彈和敵人（敵人會繞路或鑽縫）；擋住視野；只有單發 ≥ 30 的傷害打得動，打爆掉晶體；
//                 旗艦的子彈、旗艦和滾動的刺殼撞上去也會打碎（不給成長）
//   雙人：房主模擬，隊友只收同步（Game.objs）；飛船被拉、被擋由各自的電腦算
// =====================================================================
const OBJ = {
  PLANET_GM: 1.2e7, HOLE_GM: 2.4e7,  // 引力強度（加速度 = GM / 距離²）
  HOLE_R: 280, HOLE_CORE: 34, HOLE_BLOCK: 70, HOLE_PCT: 0.1, HOLE_ESCAPE: [0.3, 1.05], HOLE_NOESC: 130,  // HOLE_NOESC：會走路的敵人從靜止起步、離核心多遠以內走不出來（實測最快的蟲群約 95，留餘裕）：敵人不生在這裡面；  // HOLE_ESCAPE：拉敵人最多到牠原本移動速度的 0.3 + 1.05 ×（1 − 距離 / 範圍）² 倍（繞路時往外最多約速度的 0.89 倍，所以離核心約 72 內走不出來；外圍只拖慢；被減速時界線往外推）；  // HOLE_PCT：核心每秒扣敵人最大 HP 的比例；  // HOLE_BLOCK：核心外多少算擋住視線（敵人尋路繞開）
  ROCK_MIN_DMG: 30, ROCK_CREDIT_HP: 32,  // 小行星：單發至少 30 才打得動；打爆掉晶體（耐久每 32 一顆）
  PLANET_HP: 20,  // 行星耐久 = 半徑 × 20（只有旗艦的子彈會扣）；縮到原本一半大小以下就崩解
  FLOW_CELL: 20, FLOW_PAD: 12, FLOW_EVERY: 0.25,  // 敵人尋路：格子大小、障礙物外擴、多久重算一次
  HOLE_ZONE_COST: 8, HOLE_WALL: 350,  // 尋路：黑洞閃避範圍（R + 30）裡的格子算幾步遠（有別條路就繞開，沒有才穿過）；大地圖：黑洞離牆至少多遠（閃避範圍 310 ＋ 40，不堵住通道）
  COMET_EVERY: [9, 14], COMET_WARN: 1.5, COMET_SPEED: 380, COMET_HP: 60, COMET_GRAV: 1.5,  // COMET_GRAV：彗星受引力影響的倍數
  COMET_FROST: { slow: 0.4, t: 2 }, COMET_SHARDS: 12,  // 被彗星打到（撞擊、爆炸、碎片）都會冰凍：減速 40%、2 秒（敵人、玩家一樣）；打爆、撞爆都往四周噴 12 片碎片
};
const Objects = {
  dt: 1 / 60,

  // ---------- 產生：每場戰鬥一半機率完全沒有；有的話一般戰 1～2 種、精英戰 1 種（行星或彗星）、旗艦戰 1～2 種（行星 1～2 顆、小行星帶、彗星，沒有黑洞）；沙盒／靶場沒有 ----------
  gen(C, node) {
    if (C && C.boss) return [];  // 旗艦戰：王關場地本身就有地形（凹室、柱子），不放行星、小行星帶、黑洞、彗星
    if (C && !C.sandbox && !Arena.rect) return this.genAreas(C);
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
  // 大地圖：每個區域各自抽（規則跟方形場地一樣：一半機率沒有；一般戰 1～2 種、精英戰 1 種），開場一次放好
  //   行星：放在空地，周圍至少留飛船過得去的寬度；黑洞：核心離牆至少 350（敵人的閃避範圍 310 不碰到牆、不堵住通道；2026-10-09）、離入口至少 420；兩者都不能擋住閘門
  //   小行星帶：從一邊的牆拉到另一邊的牆（挑比較窄的地方），一樣留 2 個縫；不擋入口和閘門
  //   彗星：只在玩家所在的區域出現，從那一區的牆邊飛進來
  genAreas(C) {
    const out = [];
    for (let k = 0; k < Arena.areas.length; k++) {
      if (Math.random() < 0.5) continue;
      const kinds = C.elites ? pickN(['planet', 'comet'], 1) : pickN(['planet', 'hole', 'comet', 'belt'], randInt(1, 2));
      if (kinds.includes('comet') && !kinds.includes('planet')) kinds.push('planet');
      const entry = Arena.entryOf(k), gate = Arena.gates[k];
      const spot = (minD, r, margin) => {
        for (let i = 0; i < 60; i++) {
          const [x, y] = Arena.randomIn(k, margin);
          if (Math.hypot(x - entry.x, y - entry.y) < minD + r) continue;
          if (gate && Math.hypot(x - gate.x, y - gate.y) < r + 260) continue;
          if (out.some(o => o.type !== 'rock' && o.type !== 'cometgen' && Math.hypot(o.x - x, o.y - y) < (o.R || o.r) + r + 160)) continue;
          return { x, y };
        }
        return null;
      };
      for (const kd of kinds) {
        if (kd === 'planet') {
          const r = randInt(55, 95), p = spot(300, r, r + 90);
          if (p) out.push({ type: 'planet', ...p, r, r0: r, hp: r * OBJ.PLANET_HP, maxHp: r * OBJ.PLANET_HP, gm: +rand(0.7, 1.3).toFixed(2), area: k });
        }
        if (kd === 'hole') { const p = spot(420, OBJ.HOLE_R * 0.6, OBJ.HOLE_WALL); if (p && Arena.f(p.x, p.y) >= OBJ.HOLE_WALL) out.push({ type: 'hole', ...p, r: OBJ.HOLE_CORE, R: OBJ.HOLE_R, tick: 0, area: k }); }
        if (kd === 'comet') out.push({ type: 'cometgen', t: rand(4, 7), area: k });
        if (kd === 'belt') this.genBelt(k, entry, gate, out);
      }
    }
    return out;
  },
  genBelt(k, entry, gate, out) {
    let best = null;
    for (let t = 0; t < 30; t++) {
      const [qx, qy] = Arena.randomIn(k, 160), a = rand(0, TAU), ux = Math.cos(a), uy = Math.sin(a);
      const reach = sg => { let d = 0; while (d < 1600 && Arena.f(qx + ux * sg * d, qy + uy * sg * d) > 0) d += 20; return d; };
      const d1 = reach(1), d2 = reach(-1), len = d1 + d2;
      if (len < 360 || len > 1500) continue;
      const ax = qx - ux * d2, ay = qy - uy * d2, bx = qx + ux * d1, by = qy + uy * d1;
      if (segDist2(ax, ay, bx, by, entry.x, entry.y) < 220 ** 2) continue;
      if (gate && segDist2(ax, ay, bx, by, gate.x, gate.y) < 260 ** 2) continue;
      if (out.some(o => (o.type === 'planet' || o.type === 'hole') && segDist2(ax, ay, bx, by, o.x, o.y) < ((o.R || o.r) + 60) ** 2)) continue;
      if (!best || len < best.len) best = { ax, ay, ux, uy, len };
    }
    if (!best) return;
    const m = Math.max(6, Math.round(best.len / 58)), step = best.len / m;
    const g1 = randInt(1, Math.floor(m / 2) - 1), g2 = randInt(Math.ceil(m / 2) + 1, m - 1), gap = i => i === g1 || i === g2, edge = i => gap(i - 1) || gap(i + 1);
    for (let i = 0; i <= m; i++) {
      if (gap(i)) continue;
      const e = edge(i), j = e ? 0 : rand(-22, 22), r = e ? 18 : randInt(18, 32);
      const x = best.ax + best.ux * (i * step + j) - best.uy * rand(-12, 12), y = best.ay + best.uy * (i * step + j) + best.ux * rand(-12, 12);
      if (Arena.f(x, y) < -r * 0.3) continue;  // 太深入牆裡的不放
      const hp = r * 4;
      out.push({ type: 'rock', x, y, r, hp, maxHp: hp, area: k });
    }
  },
  list(type) { return Game.objs.filter(o => o.type === type); },

  // ---------- 每幀（房主）：彗星、黑洞對敵人／敵彈、敵人撞行星 ----------
  update(dt) {
    this.dt = dt;
    const G = Game;
    if (!G.objs.length) { if (!Arena.rect && (this.flowT = (this.flowT || 0) - dt) <= 0) { this.flowT = OBJ.FLOW_EVERY; this.buildFlow(); } return; }  // 大地圖：沒有物件也要尋路（繞牆）
    const cur = G.combat ? Math.max(0, G.combat.wave - 1) : 0;
    for (const o of G.objs) {
      if (o.type === 'cometgen' && (o.area == null || o.area === cur) && (o.t -= dt) <= 0) { o.t = rand(...OBJ.COMET_EVERY); this.spawnComet(o.area); }  // 大地圖：只有玩家所在的區域會來彗星
      if (o.type === 'comet') this.updateComet(o, dt);
      if (o.type === 'hole') {
        o.tick -= dt;
        const hurt = o.tick <= 0;
        if (hurt) o.tick = 0.25;
        for (const e of G.enemies) {
          if (e.dead || e.spawnT > 0 || e.t.boss) continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y);
          if (d > o.R || d < 1) continue;
          const sp = e.frozen || e.t.dummy ? 0 : e.t.speed * endlessSpd();  // 不會動的（標靶、母巢）照原本的拉力
          const [e0, e1] = OBJ.HOLE_ESCAPE, k = 1 - d / o.R;
          const pull = Math.min(60 + 160 * k, sp > 0 ? sp * (e0 + e1 * k * k) : Infinity);
          e.x += (o.x - e.x) / d * pull * dt; e.y += (o.y - e.y) / d * pull * dt;
          if (hurt && d < o.r + e.r) e.hurt(Math.max(10, e.maxHp * OBJ.HOLE_PCT * 0.25), 0, 0, 'explode', e.lastAtt || null);  // 核心每秒扣最大 HP 的 10%（至少每 0.25 秒 10）：掉進去的一定會死，不會卡住戰鬥
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
        if (e.whT > 0) G.wallSlam(e);  // 撞牆（散彈升級）
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
  //   黑洞也算：核心外 70 內子彈最容易被吞掉或拉彎，敵人站在黑洞後面時玩家打不到，所以繞過去找看得到的位置
  //   黑洞的閃避範圍（R + 30，敵人走進去會被往外推）每格算 HOLE_ZONE_COST 步：有別條路就繞開，真的沒有才穿過去
  //     （2026-10-09 以前每格一樣遠，路線直接穿過閃避範圍，敵人走到範圍邊上被推開，卡在原地）
  blockers() { return Game.objs.filter(o => o.type === 'planet' || o.type === 'hole' || (o.type === 'rock' && !o.dead)); },
  blockR(o) { return o.type === 'hole' ? o.r + OBJ.HOLE_BLOCK : o.r; },
  buildFlow() {
    const B = this.blockers();
    this.fields = new Map();
    if (!B.length && Arena.rect) return;
    const C = OBJ.FLOW_CELL, W = Math.ceil(Arena.W / C), H = Math.ceil(Arena.H / C), N = W * H;
    // 陣列重複使用（每 0.25 秒就算一次，不要每次配新的記憶體）；col[c] = 第 c 格在第幾欄（不用每格做除法）
    let S = this._flowBuf;
    if (!S || S.N !== N) {
      S = this._flowBuf = { N, blk: new Uint8Array(N), zone: new Uint8Array(N), col: new Int32Array(N), dists: [],
        bq: Array.from({ length: OBJ.HOLE_ZONE_COST + 1 }, () => new Int32Array(N * 2)), bh: new Int32Array(OBJ.HOLE_ZONE_COST + 1), bt: new Int32Array(OBJ.HOLE_ZONE_COST + 1) };
      for (let c = 0; c < N; c++) S.col[c] = c % W;
    }
    const blk = S.blk, zone = S.zone, col = S.col;
    if (Arena.rect) blk.fill(0); else blk.set(Arena.wallMask(C, W, H, OBJ.FLOW_PAD + 8));  // 大地圖：牆（離牆不到 20 的格子）和閘門不能走
    for (const o of B) {
      const R = this.blockR(o) + OBJ.FLOW_PAD, x0 = Math.max(0, Math.floor((o.x - R) / C)), x1 = Math.min(W - 1, Math.floor((o.x + R) / C));
      const y0 = Math.max(0, Math.floor((o.y - R) / C)), y1 = Math.min(H - 1, Math.floor((o.y + R) / C));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
        if (dist2((x + 0.5) * C, (y + 0.5) * C, o.x, o.y) < R * R) blk[y * W + x] = 1;
    }
    zone.fill(0);
    for (const o of B) {
      if (o.type !== 'hole') continue;
      const R = o.R + 30, x0 = Math.max(0, Math.floor((o.x - R) / C)), x1 = Math.min(W - 1, Math.floor((o.x + R) / C));
      const y0 = Math.max(0, Math.floor((o.y - R) / C)), y1 = Math.min(H - 1, Math.floor((o.y + R) / C));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
        if (dist2((x + 0.5) * C, (y + 0.5) * C, o.x, o.y) < R * R) zone[y * W + x] = 1;
    }
    const K = OBJ.HOLE_ZONE_COST, NB = K + 1, bq = S.bq, bh = S.bh, bt = S.bt, cap = N * 2;
    let k = 0;
    for (const p of Game.players()) {
      if (!p || p.dead) continue;
      const dist = S.dists[k] || (S.dists[k] = new Int32Array(N));  // 每個玩家一份（上一次算的這時已經用不到了）
      k++;
      dist.fill(-1);
      const px = clamp(Math.floor(p.x / C), 0, W - 1), py = clamp(Math.floor(p.y / C), 0, H - 1);
      // Dial 演算法：步數只有 1（一般格）或 K（黑洞閃避範圍），用 K + 1 個輪流的桶子照步數由小到大展開
      bh.fill(0); bt.fill(0);
      const s0 = py * W + px; dist[s0] = 0; bq[0][bt[0]++] = s0;
      const last = N - W;  // c >= W：不是第一列；c < last：不是最後一列
      const relax = (n, d) => { if (blk[n]) return; const nd = d + (zone[n] ? K : 1); if (dist[n] < 0 || nd < dist[n]) { dist[n] = nd; const b = nd % NB; if (bt[b] < cap) bq[b][bt[b]++] = n; } };
      for (let d = 0, idle = 0; idle < NB; d++) {
        const b = d % NB, Q = bq[b];
        if (bh[b] >= bt[b]) { idle++; continue; }
        idle = 0;
        while (bh[b] < bt[b]) {
          const c = Q[bh[b]++];
          if (dist[c] !== d) continue;  // 後來找到更近的路，這一筆作廢
          const x = col[c];
          if (x > 0) relax(c - 1, d);
          if (x < W - 1) relax(c + 1, d);
          if (c >= W) relax(c - W, d);
          if (c < last) relax(c + W, d);
        }
        bh[b] = bt[b] = 0;
      }
      this.fields.set(p, { dist, W, H });
    }
  },
  // 從 (ax, ay) 到 (bx, by) 的直線有沒有被行星、小行星擋住（pad：線的半寬）；回傳擋住的那一個
  losBlocked(ax, ay, bx, by, pad) {
    for (const o of Game.objs) {
      if (o.type !== 'planet' && o.type !== 'hole' && (o.type !== 'rock' || o.dead)) continue;
      if (segDist2(ax, ay, bx, by, o.x, o.y) < (this.blockR(o) + pad) ** 2) return o;
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
      // 範圍外 40 以內也照「沿著邊繞」走（只是不推開）：以前只在範圍內繞，一出範圍又照尋路方向往回走，敵人在邊界上來回、停在原地（2026-10-09）
      if (d > zone + 40 || d < 1) { if (e.holeSide && d > zone + 40) e.holeSide = 0; continue; }
      const nx = dx / d, ny = dy / d, inward = -(mx * nx + my * ny);
      if (!e.holeSide) e.holeSide = -ny * mx + nx * my < 0 ? -1 : 1;  // 進入範圍時決定往哪邊繞，之後不換（蟲群左右擺動也不會卡住）
      const tx = -ny * e.holeSide, ty = nx * e.holeSide;
      if (inward > 0) {
        mx += (nx + tx) * inward; my += (ny + ty) * inward;
        // 繞的速度至少跟擋掉的往內那一份一樣大：想去的方向偏向另一邊時，兩股力量會剛好抵銷成 0，敵人在範圍邊上進進出出、停在原地
        //   （2026-10-09 整局模擬：隱形的潛伏者停在黑洞範圍邊上 150 秒，電腦看不到牠，戰鬥卡死）
        const mt = mx * tx + my * ty;
        if (mt < inward) { mx += tx * (inward - mt); my += ty * (inward - mt); }
      }
      const w = 2.5 * Math.max(0, 1 - d / zone);
      mx += nx * w; my += ny * w;
    }
    return [mx, my];
  },
  // 敵人在黑洞的引力範圍內（R：改用離核心多遠算，預設整個引力範圍）：會停下來的招式（衝鋒、縮球、蓄力射擊、撲擊）先不放，走出來再放（停下來會被吸進核心）
  inHole(e, R) {
    for (const o of Game.objs) if (o.type === 'hole' && dist2(e.x, e.y, o.x, o.y) < ((R || o.R) + e.r) ** 2) return true;
    return false;
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
  // 引力來源（行星、黑洞）：照 Game.objs 的順序；物件陣列換了或數量變了才重挑
  gravSrc() {
    const O = Game.objs;
    if (this._gsArr !== O || this._gsLen !== O.length) { this._gsArr = O; this._gsLen = O.length; this._gs = O.filter(o => o.type === 'planet' || o.type === 'hole'); }
    return this._gs;
  },
  // 物件空間格子：子彈、敵彈更新前重建（物件會動：彗星）；near 查不到格子就回傳全部（照 Game.objs 的順序，結果不變）
  buildGrid() {
    const O = Game.objs;
    if (O.length < 8) { this.grid = null; return; }
    this.grid = (this._grid || (this._grid = new SpatialGrid(160))).build(O, o => { const r = o.r || 0; return [o.x - r, o.y - r, o.x + r, o.y + r]; });
  },
  near(x0, y0, x1, y1) { return this.grid && this.grid.items === Game.objs ? this.grid.query(x0, y0, x1, y1) : Game.objs; },
  gravity(x, y) {
    let ax = 0, ay = 0;
    for (const o of this.gravSrc()) {  // 只有行星、黑洞有引力（每顆子彈都要算：先挑出來存著）
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
    for (const o of this.near(Math.min(b.px, b.x) - b.r, Math.min(b.py, b.y) - b.r, Math.max(b.px, b.x) + b.r, Math.max(b.py, b.y) + b.r)) {  // 只看子彈路徑附近的物件（空間格子）
      if (o.dead) continue;  // 這一幀剛被打爆的（例如彗星：碎片不會打到自己的彗星）
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
      if (b.wallPass) {  // 穿牆（軌道升級）：穿過去，小行星照樣受傷（每顆只算一次）
        if (o.type === 'rock' && !(b.phased || (b.phased = new Set())).has(o)) { b.phased.add(o); this.hitRock(o, hitDamage(b), b.owner, b.x, b.y); }
        continue;
      }
      if (o.type === 'rock') this.hitRock(o, hitDamage(b), b.owner, b.x, b.y);
      // 撞上去：牆反彈的子彈照法線反彈，迴旋折返，其他消失（過載砲在這裡爆炸）
      const d = Math.hypot(b.x - o.x, b.y - o.y) || 1, nx = (b.x - o.x) / d, ny = (b.y - o.y) / d;
      if (b.bounce > 0) {
        b.bounce--;
        const vx = Math.cos(b.angle), vy = Math.sin(b.angle), dot = vx * nx + vy * ny;
        b.angle = Math.atan2(vy - 2 * dot * ny, vx - 2 * dot * nx);
        b.x = o.x + nx * (o.r + b.r + 1); b.y = o.y + ny * (o.r + b.r + 1); b.px = b.x; b.py = b.y;
        b.hitSet.clear(); b.life = Math.max(b.life, 0.5);
        b.bounced = true;
        if (b.prism) { b.copy(0.4); b.angle -= 0.2; }
        return false;
      }
      b.x = o.x + nx * (o.r + b.r); b.y = o.y + ny * (o.r + b.r);
      if (b.boom && b.mode === 'fly') { b.x += nx; b.y += ny; b.startReturn(); return false; }  // 迴旋：撞到行星、小行星折返
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
    for (const o of this.near(b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r)) {
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
    Game.shake(10); Events.emit('objBreak', { o, big: true });
    floatText(o.x, o.y - o.r0, '行星崩解', '#9fb4ff', true);
  },
  // 小行星受傷：單發至少 30 才算；打爆掉晶體
  //   byBoss：旗艦的子彈或撞擊、滾動的刺殼（沒有最低傷害，打碎不給成長）
  hitRock(o, dmg, owner, x, y, byBoss = false) {
    if (o.dead) return;
    if (byBoss) {
      o.hp -= dmg;
      if (Math.random() < 0.3) burst(x, y, '#c9b79c', 3, 100, 0.3, 2);
      if (o.hp <= 0) { o.dead = true; burst(o.x, o.y, '#c9b79c', 20, 220, 0.6, 3); Events.emit('objBreak', { o, big: false }); }
      return;
    }
    if (dmg < OBJ.ROCK_MIN_DMG) { if (Math.random() < 0.3) burst(x, y, '#8a8f98', 2, 80, 0.2, 2); return; }
    o.hp -= dmg;
    burst(x, y, '#c9b79c', 4, 120, 0.3, 2);
    if (o.hp > 0) return;
    o.dead = true;
    burst(o.x, o.y, '#c9b79c', 24, 220, 0.6, 3);
    Events.emit('objBreak', { o, big: true });
    // 掉晶體：耐久 ÷ 32（大約 2～4 顆，跟刺殼差不多）；晶體由房主產生，隨同步傳給隊友
    const G = Game;
    if (!G.isClient()) for (let i = 0, n = Math.max(1, Math.round(o.maxHp / OBJ.ROCK_CREDIT_HP)); i < n; i++)
      G.pickups.push({ id: G.nextId++, x: o.x + rand(-10, 10), y: o.y + rand(-10, 10), vx: rand(-90, 90), vy: rand(-90, 90), life: 14 });
    floatText(o.x, o.y - o.r, '小行星碎裂', '#9dff6b', true);
  },
  // 爆炸波及小行星
  explodeRocks(x, y, r, dmg, att) {
    for (const o of Game.objs) if (o.type === 'rock' && !o.dead && Math.hypot(o.x - x, o.y - y) < r + o.r) this.hitRock(o, dmg, att ? att.owner : null, o.x, o.y);
  },

  // ---------- 彗星 ----------
  spawnComet(area) {
    const W = CFG.WORLD_W, H = CFG.WORLD_H, side = randInt(0, 3);
    let edge = [[rand(200, W - 200), -40], [W + 40, rand(200, H - 200)], [rand(200, W - 200), H + 40], [-40, rand(200, H - 200)]][side];
    let tx = rand(W * 0.3, W * 0.7), ty = rand(H * 0.3, H * 0.7);
    if (!Arena.rect) {  // 大地圖：從這一區裡隨機一點往隨機方向找到牆邊，從那裡朝那一點飛過去
      const [qx, qy] = Arena.randomIn(area || 0, 150), b = rand(0, TAU);
      let d = 0;
      while (d < 2000 && Arena.f(qx + Math.cos(b) * (d + 20), qy + Math.sin(b) * (d + 20)) > 30) d += 20;
      edge = [qx + Math.cos(b) * d, qy + Math.sin(b) * d]; tx = qx; ty = qy;
    }
    const a = Math.atan2(ty - edge[1], tx - edge[0]);
    // 大小隨機：越大飛越慢、越耐打、爆炸越大（半徑 12～30；速度 520～230）
    const r = randInt(12, 30), k = r / 18, spd = OBJ.COMET_SPEED / k;
    Game.objs.push({ type: 'comet', id: Game.nextId++, x: edge[0], y: edge[1], vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      r, hp: Math.round(OBJ.COMET_HP * k), maxHp: Math.round(OBJ.COMET_HP * k), warn: OBJ.COMET_WARN, hits: new Set(), age: 0 });
    Events.emit('cometIncoming');
  },
  updateComet(o, dt) {
    const G = Game;
    if (o.warn > 0) { o.warn -= dt; return; }
    const [ax, ay] = this.gravity(o.x, o.y);  // 行星讓彗星彎軌道，黑洞把彗星吸偏
    o.vx += ax * dt * OBJ.COMET_GRAV; o.vy += ay * dt * OBJ.COMET_GRAV;
    o.x += o.vx * dt; o.y += o.vy * dt; o.age += dt;
    if (o.age > 1 && (o.x < -80 || o.y < -80 || o.x > Arena.W + 80 || o.y > Arena.H + 80)) { o.dead = true; return; }
    if (!Arena.rect && o.age > 0.3 && (Arena.f(o.x, o.y) < o.r * 0.3 || Arena.gateCross(o.x - o.vx * dt, o.y - o.vy * dt, o.x, o.y))) { this.cometBoom(o, 100, 40); return; }  // 大地圖：撞牆爆炸
    for (const h of G.objs) {
      if (h.type === 'hole' && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 120, 60); return; }  // 被黑洞吞掉時爆炸
      if (h.type === 'planet' && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 100, 40); return; }
      if (h.type === 'rock' && !h.dead && dist2(o.x, o.y, h.x, h.y) < (h.r + o.r) ** 2) { this.cometBoom(o, 100, 40); return; }  // 撞上小行星帶：爆炸也會打碎附近的小行星
    }
    for (const e of G.enemies) {
      if (e.dead || e.spawnT > 0 || o.hits.has(e.id) || dist2(o.x, o.y, e.x, e.y) > (o.r + e.r) ** 2) continue;
      o.hits.add(e.id);
      const s = Math.hypot(o.vx, o.vy) || 1;
      e.hurt(40, o.vx / s * 400, o.vy / s * 400, 'comet', this.cometAtt(o, false), 3);  // 飛行中撞到：不算任何人的
      this.cometFrost(e);
      floatText(e.x, e.y - e.r, 40, '#bfe9ff', true);
    }
    for (const p of G.players()) {
      if (o.hits.has(p) || dist2(o.x, o.y, p.x, p.y) > (o.r + p.r) ** 2) continue;
      o.hits.add(p);
      this.cometFrost(p);  // 先凍再扣血
      G.hurtPlayer(20, '彗星（撞擊）', p, o.x, o.y);
    }
  },
  // 打爆：往四周噴冰晶碎片（敵人和飛船都會被打到、會冰凍；打到敵人算打爆的人的「彗星」傷害，打到飛船每片 CFG.COMET_SHARD_DMG）
  breakComet(o) {
    if (o.dead) return;
    o.dead = true;
    this.cometShards(o, this.cometAtt(o, true));
    this.cometFx(o.x, o.y, 40 + o.r * 2);
    Events.emit('objBreak', { o, big: false });
  },
  // 彗星傷害的歸屬：被玩家打爆的 = 那個玩家的「彗星」傷害；撞爆、飛行中撞到 = 不算任何人的（nobody，傷害統計不記）
  cometAtt(o, broken) {
    return broken && o.lastAtt ? { src: 'comet', cr: null, owner: o.lastAtt.owner } : { src: 'comet', cr: null, owner: null, nobody: true };
  },
  // 冰凍：敵人減速（跟冰凍塗層一樣），玩家移動變慢（Player.update 的 frostT）
  cometFrost(t) {
    const F = OBJ.COMET_FROST;
    if (t instanceof Enemy) { t.slowAmt = Math.max(t.slowT > 0 ? t.slowAmt : 0, F.slow); t.slowT = Math.max(t.slowT, F.t); }
    else if (t && !t.dead && !t.invuln) t.frostT = Math.max(t.frostT || 0, F.t);
  },
  // 冰晶碎片：往四周 360° 噴（不吃任何人的電路效果，直接做成子彈；命中會冰凍）
  cometShards(o, att) {
    const n = OBJ.COMET_SHARDS, a0 = rand(0, TAU), F = OBJ.COMET_FROST;
    for (let i = 0; i < n; i++) {
      const b = new Bullet(o.x, o.y, a0 + i / n * TAU, shot({ angle: 0, speed: 620, damage: 25, radius: 4, life: 0.7, color: '#bfe9ff', shape: 'ice', shard: true, slow: F.slow, slowDur: F.t }), 0, null);
      b.att = att; b.owner = att.owner || null; b.comet = true;
      Game.bullets.push(b);
    }
  },
  // 新畫面風格的爆炸：淡藍白閃光＋往外擴的衝擊波＋殘留的冰霧
  cometFx(x, y, r) {
    flashFx(x, y, r);
    Game.fxRing(x, y, r, '#bfe9ff');
    burst(x, y, '#cfefff', 22, 90, 1.1, 4);
  },
  cometBoom(o, r, dmg) {  // 撞爆：爆炸範圍、傷害照彗星大小（範圍最大 180，不會炸到整個畫面）；敵人和玩家都會受傷、冰凍，再往四周噴碎片；不算任何人的
    o.dead = true;
    const k = o.r / 18, R = Math.min(180, r * k), D = dmg * k, att = this.cometAtt(o, false);
    Game.explode(o.x, o.y, R, D, '#bfe9ff', null, att);
    for (const e of Game.enemies) if (!e.dead && dist2(e.x, e.y, o.x, o.y) <= (R + e.r) ** 2) this.cometFrost(e);
    for (const p of Game.players()) {
      if (!p || p.dead || dist2(p.x, p.y, o.x, o.y) > (R + p.r) ** 2) continue;
      this.cometFrost(p);  // 先凍再扣血（扣血後的無敵時間會擋掉冰凍）
      Game.hurtPlayer(D, '彗星（爆炸）', p, o.x, o.y);
    }
    this.cometShards(o, att);
    this.cometFx(o.x, o.y, R);
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
      if (x < -100 || y < -100 || x > Arena.W + 100 || y > Arena.H + 100) break;
      if (!Arena.rect && i > 8 && Arena.f(x, y) < 0) break;  // 大地圖：預警線畫到牆為止
      if (Game.objs.some(h => (h.type === 'planet' || h.type === 'hole' || (h.type === 'rock' && !h.dead)) && dist2(x, y, h.x, h.y) < (h.r + o.r) ** 2)) break;
    }
    return pts;
  },

};
