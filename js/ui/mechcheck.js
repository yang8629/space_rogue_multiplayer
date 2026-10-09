// 星環電路 雙人版 · mechcheck.js：機制觸發檢查（總覽的「機制檢查」分頁）＋插座檢查 SockCheck
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// MECH CHECK — 機制觸發檢查：用真正的遊戲引擎在測試靶場跑一遍，確認每個機制有觸發
//   跑之前把 Game 的狀態整份存起來，跑完還原，不影響正在進行的遊戲
// =====================================================================
const MechCheck = {
  results: null,

  // ---------- 測試用工具 ----------
  setup(mode, ship, weapon, path, final, chain, inv = []) {
    Game.newRun(mode, ship, weapon);
    Game.weapon = { id: weapon, path, final };
    Game.refreshWeapon();
    const r = splitChain(chain.map(fullChip));  // 宿主給滿插座；組件寫在晶片後面 = 插在它的插座上（不佔電路格，電路維持原本格數）
    while (r.chain.length < chain.length) { r.chain.push(null); r.socks.push([]); }
    Game.chain = r.chain; Game.socks = r.socks;
    Game.slotAttr = [];
    Game.inventory = [...inv, null, null, null, null, null, null].slice(0, CFG.INV_SLOTS);
    Game.recalc();
    const p = Game.player;
    p.x = 1200; p.y = 800; p.aim = 0; p.vx = p.vy = 0;
    Game.bullets = []; Game.eBullets = []; Game.triggerQueue = []; Events.emit('fxClear'); Game.pickups = [];
  },
  // 在玩家前方擺靶（dx, dy 相對玩家）；frozen 的靶不會動也不會攻擊
  targets(list, type = 'brute', frozen = true, hpScale = 60) {
    const p = Game.player;
    Game.enemies = list.map(([dx, dy]) => {
      const e = new Enemy(type, p.x + dx, p.y + dy, hpScale);
      e.spawnT = 0;
      if (frozen) { e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.rollCd = Infinity; }  // 靶子（刺殼）不會縮球滾動
      return e;
    });
    return Game.enemies;
  },
  // 合併的檢查：依序跑每一段（各自 setup），全部通過才算過；沒過的那一段前面標 ✗
  all(parts) {
    const r = parts.map(fn => fn(this));
    return { ok: r.every(x => x.ok), got: r.map(x => (x.ok ? '' : '✗ ') + x.got).join('；') };
  },
  // 持續開火 frames 幀，回傳觀察到的數據
  run(frames, { fire = true } = {}) {
    const p = Game.player, dt = 1 / 60, m = { fired: 0, created: 0, explosions: 0, burn: false, slow: false, maxDepth: 0, hits: [] };
    const start = Game.enemies.map(e => e.hp);
    const origSpawn = window.spawnShots, origExplode = Game.explode;
    window.spawnShots = (list, ...rest) => { m.created += list.length; return origSpawn(list, ...rest); };
    Game.explode = function (...a) { m.explosions++; return origExplode.apply(this, a); };
    let cd = 0;
    try {
      for (let f = 0; f < frames; f++) {
        Game.time += dt; cd -= dt;
        if (fire && cd <= 0) { p.fire(); m.fired++; cd = Game.stats.interval; }
        const before = Game.enemies.map(e => e.hp);
        for (const e of Game.enemies) e.update(dt, p);
        Game.updateBullets(dt);
        Game.updateEnemyBullets(dt);
        Game.enemies.forEach((e, i) => { if (before[i] - e.hp > 0) m.hits.push(before[i] - e.hp); });
        for (const b of Game.bullets) m.maxDepth = Math.max(m.maxDepth, b.depth);
        for (const e of Game.enemies) { if (e.burnT > 0) m.burn = true; if (e.slowT > 0) m.slow = true; }
      }
    } finally { window.spawnShots = origSpawn; Game.explode = origExplode; }
    m.dmg = Game.enemies.reduce((a, e, i) => a + (start[i] - e.hp), 0);
    m.hitCount = Game.enemies.filter((e, i) => e.hp < start[i]).length;
    return m;
  },
  // 只射 1 發（最接近正前方的那發）並一路追蹤，回傳它打中幾隻不同的敵人
  trackOne(frames = 240) {
    const p = Game.player;
    const s = runOps(Game.stats.ops, 0).reduce((a, c) => Math.abs(c.angle) < Math.abs(a.angle) ? c : a);
    s.payload = null;
    Game.bullets = [];
    spawnShots([s], p.x, p.y, 0, 0, null);
    const b = Game.bullets[0];
    for (let f = 0; f < frames && !b.dead; f++) Game.updateBullets(1 / 60);
    return Game.enemies.filter(e => b.hitSet.has(e.id)).length;
  },
  firstHit() {  // 單發命中的傷害
    const e = this.targets([[80, 0]])[0], hp = e.hp;
    this.trackOne(60);
    return hp - e.hp;
  },
  cone: [[90, 0], [140, 60], [140, -60], [260, 0], [300, 140], [300, -140], [480, 0], [200, 260]],
  line: [[90, 0], [140, 0], [190, 0], [240, 0]],

  // ---------- 檢查項目：[分組, 名稱, 預期, 檢查函式 → { ok, got }] ----------
  CASES: [
    ['武器命中效果', '爆炸（電漿砲・新星）', '命中時爆炸並波及周圍敵人', M => {
      M.setup('sandbox', 'vanguard', 'plasma', 'C', null, ['weapon', null, null, null]); M.targets(M.cone);
      const r = M.run(180);
      return { ok: r.explosions > 0 && r.hitCount >= 2, got: `爆炸 ${r.explosions} 次，打中 ${r.hitCount} 隻` };
    }],
    ['武器命中效果', '燃燒（散彈砲・龍息彈）', '停火後敵人持續扣血', M => {
      M.setup('sandbox', 'vanguard', 'scatter', 'C', null, ['weapon', null, null, null]); M.targets([[90, 0]]);
      M.run(20); const hp = Game.enemies[0].hp; Game.bullets = [];
      const r = M.run(90, { fire: false });
      return { ok: r.burn && Game.enemies[0].hp < hp, got: `停火 1.5 秒內再扣 ${Math.round(hp - Game.enemies[0].hp)} HP` };
    }],
    ['武器命中效果', '減速（電漿砲・重力井・黑潮）', '被打中的敵人移動速度 -50%', M => {
      M.setup('sandbox', 'vanguard', 'plasma', 'B', 1, ['weapon', null, null, null]);
      const e = M.targets([[150, 0]], 'brute', false)[0]; e.t = { ...e.t, dmg: 0 };
      M.run(60);
      return { ok: e.slowT > 0 && near1(e.spdMul, 0.5), got: `速度倍率 ×${(e.spdMul || 1).toFixed(2)}` };
    }],
    ['武器命中效果', '碎片（雷射步槍・稜鏡）', '命中時折射出額外子彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', 'A', null, ['weapon', null, null, null]); M.targets(M.cone);
      const r = M.run(120);
      return { ok: r.created > r.fired, got: `開火 ${r.fired} 次，額外產生 ${r.created - r.fired} 發碎片` };
    }],
    ['武器命中效果', '吸血（相位刃・相位灼燒・吸能刃）', '命中時回復 HP', M => {
      M.setup('sandbox', 'vanguard', 'blade', 'C', 1, ['weapon', null, null, null]); M.targets(M.cone);
      const p = Game.player; p.hp = 20;
      M.run(120);
      return { ok: p.hp > 20, got: `HP 20 → ${p.hp.toFixed(1)}` };
    }],
    ['武器命中效果', '穿透（軌道砲）', '1 發子彈穿過一整排敵人', M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]); M.targets(M.line);
      const n = M.trackOne();
      return { ok: n >= 4, got: `1 發打中 ${n} 隻（穿透 3）` };
    }],
    ['武器命中效果', '追蹤（相位刃・飛刃・追蹤飛刃）', '子彈轉向打中偏離準心的敵人；很快的子彈也追得到（不會繞圈）', M => {
      M.setup('sandbox', 'vanguard', 'blade', 'B', 0, ['weapon', null, null, null]); M.targets([[220, 110]]);
      const n = M.trackOne();
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); const e = M.targets([[150, 150]])[0];
      spawnShots([shot({ angle: 0, speed: 2400, damage: 10, life: 1, homing: 4 })], Game.player.x, Game.player.y, 0, 0, null);
      for (let f = 0; f < 60 && Game.bullets.length && !Game.bullets[0].dead; f++) Game.updateBullets(1 / 60);
      const fast = e.hp < e.maxHp;
      return { ok: n === 1 && fast, got: (n ? '偏離準心 27° 的敵人被打中' : '沒有打中') + `；2400 速度的追蹤彈打偏離 45° 的敵人：${fast ? '打中' : '繞過去沒打中'}` };
    }],
    ['武器命中效果', '擊退（軌道砲・攻城砲）', '被打中的敵人往後退', M => {
      M.setup('sandbox', 'vanguard', 'railgun', 'B', null, ['weapon', null, null, null]);
      const e = M.targets([[120, 0]], 'swarmer', false, 1)[0]; e.t = { ...e.t, speed: 0, dmg: 0 }; e.hp = e.maxHp = 9999;
      const x0 = e.x; M.run(10);
      return { ok: e.x > x0 + 15, got: `被推後 ${Math.round(e.x - x0)} px` };
    }],
    ['武器命中效果', '貼臉命中', '敵人貼在船身上也打得到', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([[3, 2]]);
      const r = M.run(30);
      return { ok: r.dmg > 0, got: `造成 ${Math.round(r.dmg)} 傷害` };
    }],

    ['電路晶片', '分裂模組', '每發子彈變成 3 發', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'split', null, null]); M.targets(M.cone);
      const r = M.run(60);
      return { ok: r.created === r.fired * 3, got: `開火 ${r.fired} 次，射出 ${r.created} 發` };
    }],
    ['電路晶片', '巨彈', '散彈 5 發還是 5 發、每發變大，總傷害 +30%；跟分裂誰先插結果都一樣（15 發）', M => {
      const run = flat => { M.setup('sandbox', 'vanguard', 'scatter', null, null, flat); const L = runOps(Game.stats.ops, 0); return { n: L.length, sum: L.reduce((a, b) => a + b.damage, 0), r: L[0].radius }; };
      const A = run(['weapon', null, null, null]), B = run(['weapon', 'bigshot', null, null]), C = run(['weapon', 'bigshot', 'split', null]), D = run(['weapon', 'split', 'bigshot', null]);
      return { ok: B.n === 5 && near1(B.sum, A.sum * 1.3) && B.r > A.r * 1.5 && C.n === 15 && D.n === 15 && near1(C.sum, D.sum),
        got: `${B.n} 發，總傷害 ${A.sum.toFixed(1)} → ${B.sum.toFixed(1)}（應 ×1.3）；巨彈→分裂 ${C.n} 發 ${C.sum.toFixed(1)}、分裂→巨彈 ${D.n} 發 ${D.sum.toFixed(1)}` };
    }],
    ['電路晶片', '射速跟幀率無關', '一直按住 20 秒：30／60／144Hz 射出的發數一樣，都接近 20 ÷ 射擊間隔（多過的時間留到下一發）', M => {
      const rows = [];
      let ok = true;
      for (const w of ['laser', 'railgun']) {
        M.setup('sandbox', 'vanguard', w, null, null, ['weapon', null, null, null]);
        const P = Game.player, iv = Game.stats.interval, want = 20 / iv, ns = [];
        for (const hz of [30, 60, 144]) {
          let n = 0; const orig = P.fire; P.fireCd = 0; P.fire = () => { n++; };
          try { for (let f = 0; f < 20 * hz; f++) P.tickFire(1 / hz, true); } finally { P.fire = orig; }
          ns.push(n);
          if (Math.abs(n - want) > 1.5) ok = false;
        }
        rows.push(`${WEAPONS[w].name} 理論 ${want.toFixed(0)} 發：${ns.join('／')}`);
      }
      return { ok, got: rows.join('；') };
    }],
    ['電路晶片', '超頻熱度', '超頻模組：熱度越高越痛，傷害 +（熱度 × 40%）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'overclock', null, null]); M.targets([]);
      const P = Game.player, lim = Game.stats.heatLimit, one = h0 => {
        Game.bullets = []; P.ohT = h0; P.ohLock = 0; P.fireCd = 0; P.tickFire(1 / 60, true);
        return { d: Game.bullets[0] ? Game.bullets[0].damage : 0, h: P.ohT / lim };
      };
      const A = one(0), B = one(lim * 0.75), want = (1 + 0.4 * B.h) / (1 + 0.4 * A.h);
      return { ok: A.d > 0 && near1(B.d / A.d, want), got: `熱度 ${Math.round(A.h * 100)}% 傷害 ${A.d.toFixed(1)}；熱度 ${Math.round(B.h * 100)}% 傷害 ${B.d.toFixed(1)}（比值 ${(B.d / A.d).toFixed(2)}，要 ${want.toFixed(2)}）` };
    }],
    ['電路晶片', '收束透鏡', '武器每次射出 1 發 +60%、每多 1 發少 15%、4 發以上沒有；只能插在武器上', M => {
      const run = (w, chain) => { M.setup('sandbox', 'vanguard', w, null, null, chain); const L = runOps(Game.stats.ops, 0); return { n: L.length, d: L[0] ? L[0].damage : 0 }; };
      const a0 = run('laser', ['weapon', null, null, null]), a1 = run('laser', ['weapon', 'focus', null, null]);
      const m0 = run('laser', ['weapon', 'mirror', null, null]), m1 = run('laser', ['weapon', 'mirror', 'focus', null]), m2 = run('laser', ['weapon', 'focus', 'mirror', null]);
      const s0 = run('scatter', ['weapon', null, null, null]), s1 = run('scatter', ['weapon', 'focus', null, null]);
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', 'focus', null]);
      const idle = Game.stats.info.socks[1][0].idle;
      return { ok: near1(a1.d, a0.d * 1.6) && m1.n === 2 && near1(m1.d, m0.d * 1.45) && near1(m2.d, m1.d) && s1.n === 5 && near1(s1.d, s0.d) && idle,
        got: `雷射 1 發 ${a0.d.toFixed(1)} → ${a1.d.toFixed(1)}；鏡像 ${m1.n} 發 ${m0.d.toFixed(1)} → ${m1.d.toFixed(1)}（插座順序對調 ${m2.d.toFixed(1)}）；散彈 ${s1.n} 發 ${s0.d.toFixed(1)} → ${s1.d.toFixed(1)}；插在迴旋上${idle ? '沒有作用' : '有作用（錯）'}` };
    }],
    ['電路晶片', '架設', '站著不動 2 秒疊滿（Lv1 6 層，每層射速 +10%）；滿層時射出的才是產物；移動 0.15 秒內不歸零，超過就歸零', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'stand', null, null]); M.targets([]);
      const P = Game.player, iv = Game.stats.interval, tick = (sec, want) => { for (let f = 0; f < Math.round(sec * 60); f++) P.tickFire(1 / 60, want); };
      P.moving = false; tick(1.9, false);
      const sk0 = standStacks(P, Game.stats.stand);
      tick(0.15, false);
      const sk = standStacks(P, Game.stats.stand);
      let n = 0, full = 0; const orig = P.fire; P.fireCd = 0;
      P.fire = () => { n++; if (Game.standFull) full++; };
      try { tick(2, true); } finally { P.fire = orig; }
      const want = 2 / (iv / 1.6);
      P.moving = true; tick(0.1, false); const keep = P.standT > 2;
      tick(0.2, false); const reset = P.standT === 0;
      return { ok: sk0 === 5 && sk === 6 && Math.abs(n - want) <= 1.5 && full === n && keep && reset,
        got: `站 1.9 秒 ${sk0} 層（要 5）、2.05 秒 ${sk} 層（要 6）；接著 2 秒射 ${n} 發（要 ${want.toFixed(1)}），其中滿層 ${full} 發；移動 0.1 秒${keep ? '還在' : '就歸零（錯）'}，0.3 秒${reset ? '歸零' : '沒歸零（錯）'}` };
    }],
    ['武器命中效果', '動能彈頭', '雷射・貫穿光束・動能彈頭：命中時子彈比原本彈速快多少 %，傷害加一半（沒有上限）；感測器也算', M => {
      const one = sensor => {
        M.setup('sandbox', 'vanguard', 'laser', 'C', 0, ['weapon', null, null, null]);
        Game.parts.sensor = sensor; Game.recalc();
        const e = M.targets([[200, 0]])[0], got = [], h = e.hurt.bind(e);
        e.hurt = (d, ...r) => { got.push(d); return h(d, ...r); };
        Game.player.fire(); const b = Game.bullets[0], d0 = b.damage, want = 1 + (b.speed / WEAPONS.laser.base.speed - 1) * 0.5;
        for (let f = 0; f < 30 && !got.length; f++) Game.updateBullets(1 / 60);
        return { d0, d: got[0] || 0, want };
      };
      const A = one(0), B = one(3);
      return { ok: near1(A.d, A.d0 * A.want) && near1(B.d, B.d0 * B.want) && near1(A.want, 1.15) && B.want > A.want,
        got: `沒感測器：子彈 ${A.d0.toFixed(1)} 打中 ${A.d.toFixed(1)}（×${A.want.toFixed(2)}）；感測器 3 層：${B.d0.toFixed(1)} → ${B.d.toFixed(1)}（×${B.want.toFixed(2)}）` };
    }],
    ['武器命中效果', '重量砲', '電漿・重力井・重量砲：移動速度每慢 1% 傷害 +2%（沒有上限）；重裝甲、被凍住都算', M => {
      const one = (armor, frost) => {
        M.setup('sandbox', 'vanguard', 'plasma', 'B', 0, ['weapon', null, null, null]);
        Game.parts.armor = armor; Game.recalc(); Game.player.frostT = frost ? 1 : 0;
        const L = runOps(Game.stats.ops, 0); return { d: L[0].damage, spd: shipSpeedNow() };
      };
      const A = one(0), B = one(5), C = one(5, true);
      const wantB = 1 + (1 - B.spd) * 2, wantC = 1 + (1 - C.spd) * 2;
      return { ok: near1(A.spd, 1) && near1(B.d / A.d, wantB) && near1(C.d / A.d, wantC) && wantC > 1.8,
        got: `沒重裝甲 ${A.d.toFixed(1)}；重裝甲 5 層（速度 ×${B.spd.toFixed(3)}）${B.d.toFixed(1)}（×${(B.d / A.d).toFixed(2)}，要 ×${wantB.toFixed(2)}）；再被凍住（×${C.spd.toFixed(3)}）${C.d.toFixed(1)}（×${(C.d / A.d).toFixed(2)}，要 ×${wantC.toFixed(2)}，超過舊上限 ×1.8）` };
    }],
    ['武器命中效果', '玻璃砲', '相位刃・巨刃・玻璃砲：自帶受到的傷害 +10%（真的多扣血）；受到的傷害每多 1%，傷害 +3%（沒有上限、相加）；輕裝甲、散熱片都算', M => {
      const one = (larmor, sink) => {
        M.setup('sandbox', 'vanguard', 'blade', 'A', 1, ['weapon', null, null, null]);
        Game.parts.larmor = larmor; Game.parts.sink = sink; Game.recalc();
        return { d: runOps(Game.stats.ops, 0)[0].damage, t: Game.mech.taken };
      };
      M.setup('sandbox', 'vanguard', 'blade', 'A', null, ['weapon', null, null, null]);
      const base = runOps(Game.stats.ops, 0)[0].damage;
      const A = one(0, 0), B = one(3, 3), wantB = 1 + (0.1 + 0.03 * 3 + 0.04 * 3) * 3;
      const P = Game.player; P.iframe = 0; const hp0 = P.hp; Game.hurtPlayer(10, 'mc', P); const lost = hp0 - P.hp, wantLost = 10 * B.t;
      return { ok: near1(A.d / base, 1.3) && near1(A.t, 1.1) && near1(B.t, 1.31) && near1(B.d / base, wantB) && near1(lost, wantLost),
        got: `巨刃 ${base.toFixed(1)}；玻璃砲沒疊 ${A.d.toFixed(1)}（×${(A.d / base).toFixed(2)}）；輕裝甲 3＋散熱片 3（受傷 ×${B.t.toFixed(3)}）${B.d.toFixed(1)}（×${(B.d / base).toFixed(2)}，要 ×${wantB.toFixed(2)}）；被打 10 扣 ${lost.toFixed(1)}（要 ${wantLost.toFixed(1)}）` };
    }],
    ['武器命中效果', '群戰', '散彈・霰彈擴充・群戰：身邊 250 以內每隻敵人射速 +8%（最多算 8 隻）；250 外的不算', M => {
      const one = near => {
        M.setup('sandbox', 'vanguard', 'scatter', 'A', 0, ['weapon', null, null, null]);
        M.targets([...Array.from({ length: near }, (_, i) => [150, -100 + i * 25]), [400, 0], [0, 420]]);
        const P = Game.player, iv = Game.stats.interval;
        Game.tickWeaponFx(P, 1 / 60);
        let n = 0; const orig = P.fire; P.fireCd = 0; P.fire = () => { n++; };
        try { for (let f = 0; f < 240; f++) { Game.tickWeaponFx(P, 1 / 60); P.tickFire(1 / 60, true); } } finally { P.fire = orig; }
        return { k: P.crowdK, n, want: 4 / (iv / (1 + 0.08 * Math.min(8, near))) };
      };
      const A = one(0), B = one(5), C = one(11);
      return { ok: A.k === 0 && B.k === 5 && C.k === 8 && Math.abs(A.n - A.want) <= 1.5 && Math.abs(B.n - B.want) <= 1.5 && Math.abs(C.n - C.want) <= 1.5 && C.n > A.n * 1.5,
        got: `身邊 0 隻：算到 ${A.k}，4 秒 ${A.n} 發（要 ${A.want.toFixed(1)}）；5 隻：算到 ${B.k}，${B.n} 發（要 ${B.want.toFixed(1)}）；11 隻：算到 ${C.k}（要 8），${C.n} 發（要 ${C.want.toFixed(1)}）` };
    }],
    ['武器命中效果', '專注', '雷射・稜鏡・專注：碎光折回打同一隻；連續打中同一隻（碎光也算）每次 +10%，最多 +100%；打中別隻歸零', M => {
      M.setup('sandbox', 'vanguard', 'laser', 'A', 0, ['weapon', null, null, null]);
      const P = Game.player, [a, b] = M.targets([[150, 0], [0, 150]]), log = [];
      for (const e of [a, b]) { const h = e.hurt.bind(e); e.hurt = (d, ...r) => { log.push([e, d, r[2]]); return h(d, ...r); }; }
      const shoot = (e, ang) => { P.aim = ang; const n = log.length; P.fire(); for (let f = 0; f < 30 && log.length < n + 3; f++) Game.updateBullets(1 / 60); return log.slice(n); };
      const s1 = shoot(a, 0); for (let i = 0; i < 3; i++) shoot(a, 0); const s5 = shoot(a, 0), kA = P.focusK;
      const t1 = shoot(b, Math.PI / 2);
      const base = s1[0][1], shard = s1.filter(x => x[2] === 'shard');
      return { ok: s1.length === 3 && shard.length === 2 && shard.every(x => x[0] === a) && near1(shard[0][1], base * 0.4 * 1.1) && near1(s5[0][1], base * 2) && kA === 10 && near1(t1[0][1], base) && t1[0][0] === b,
        got: `第 1 槍打中 ${s1.length} 下（要 3：光束＋2 道碎光${shard.every(x => x[0] === a) ? '都打同一隻' : '，碎光打到別隻（錯）'}），碎光 ${shard.length ? shard[0][1].toFixed(1) : 0}（要 ${(base * 0.44).toFixed(1)}）；第 5 槍 ${s5[0][1].toFixed(1)}（要 ${(base * 2).toFixed(1)}，${kA} 層）；換一隻 ${t1[0][1].toFixed(1)}（要 ${base.toFixed(1)}）` };
    }],
    ['武器命中效果', '分散', '雷射・稜鏡・分散：碎光 3 道；碎光每打中一隻射速 +5%（最多 12 層）；2 秒沒疊開始每 0.25 秒掉 1 層', M => {
      M.setup('sandbox', 'vanguard', 'laser', 'A', 1, ['weapon', null, null, null]);
      const P = Game.player; M.targets([[150, 0], [300, -70], [320, 0], [300, 70]]); P.aim = 0;
      let made = 0; for (let i = 0; i < 4; i++) { P.fire(); for (let f = 0; f < 40; f++) { Game.updateBullets(1 / 60); made = Math.max(made, Game.bullets.filter(q => q.spreadSh).length); } }
      const k = P.spreadK;
      P.spreadK = 12; P.spreadT = 99; let n = 0; const orig = P.fire, iv = Game.stats.interval; P.fireCd = 0; P.fire = () => { n++; };
      try { for (let f = 0; f < 240; f++) P.tickFire(1 / 60, true); } finally { P.fire = orig; }
      const want = 4 / (iv / 1.6);
      P.spreadT = 2; for (let f = 0; f < 60 * 2.6; f++) Game.tickWeaponFx(P, 1 / 60); const kDecay = P.spreadK;
      return { ok: made === 3 && k >= 4 && Math.abs(n - want) <= 1.5 && kDecay > 0 && kDecay < 12 && kDecay >= 9,
        got: `一次 ${made} 道碎光（要 3）；4 槍疊到 ${k} 層；12 層時 4 秒 ${n} 發（要 ${want.toFixed(1)}）；停 2.6 秒剩 ${kDecay} 層（要 9～11）` };
    }],
    ['武器命中效果', '擦彈', '雷射・連發・擦彈：敵彈從身邊 40 以內飛過、沒打中 → 射速 +10%（最多 8 層）；直接打中的不算', M => {
      M.setup('sandbox', 'vanguard', 'laser', 'B', 0, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, hp0 = P.hp; P.iframe = 0;
      const eb = dy => ({ x: P.x - 200, y: P.y + dy, vx: 600, vy: 0, r: 5, life: 2, dmg: 10, from: 'mc' });
      Game.eBullets = [eb(P.r + 5 + 25)]; for (let f = 0; f < 60; f++) Game.updateEnemyBullets(1 / 60);
      const k1 = P.grazeK, kept = P.hp === hp0;
      Game.eBullets = [eb(0)]; for (let f = 0; f < 60; f++) Game.updateEnemyBullets(1 / 60);
      const k2 = P.grazeK, hit = P.hp < hp0;
      Game.eBullets = [eb(P.r + 5 + 80)]; for (let f = 0; f < 60; f++) Game.updateEnemyBullets(1 / 60);
      const k3 = P.grazeK;
      P.grazeK = 8; P.grazeT = 99; let n = 0; const orig = P.fire, iv = Game.stats.interval; P.fireCd = 0; P.fire = () => { n++; };
      try { for (let f = 0; f < 240; f++) P.tickFire(1 / 60, true); } finally { P.fire = orig; }
      const want = 4 / (iv / 1.8);
      return { ok: k1 === 1 && kept && k2 === 1 && hit && k3 === 1 && Math.abs(n - want) <= 1.5,
        got: `身邊 25 飛過：${k1} 層（要 1）、${kept ? '沒扣血' : '扣血了（錯）'}；直接打中：${k2} 層（要還是 1）、${hit ? '扣血' : '沒扣血（錯）'}；80 外飛過：${k3} 層（要還是 1）；8 層時 4 秒 ${n} 發（要 ${want.toFixed(1)}）` };
    }],
    ['武器命中效果', '狂怒', '雷射・連發・狂怒：每缺 1% HP 射速 +1%（剩一半血 +50%）', M => {
      const rate = hpK => {
        M.setup('sandbox', 'vanguard', 'laser', 'B', 1, ['weapon', null, null, null]); M.targets([]);
        const P = Game.player; P.hp = P.maxHp * hpK;
        let n = 0; const orig = P.fire; P.fireCd = 0; P.fire = () => { n++; };
        try { for (let f = 0; f < 240; f++) P.tickFire(1 / 60, true); } finally { P.fire = orig; }
        return { n, want: 4 / (Game.stats.interval / (1 + (1 - hpK))) };
      };
      const A = rate(1), B = rate(0.5), C = rate(0.1);
      return { ok: [A, B, C].every(x => Math.abs(x.n - x.want) <= 1.5) && B.n > A.n * 1.35,
        got: `滿血 4 秒 ${A.n} 發（要 ${A.want.toFixed(1)}）；剩一半 ${B.n} 發（要 ${B.want.toFixed(1)}）；剩 10% ${C.n} 發（要 ${C.want.toFixed(1)}）` };
    }],
    ['武器命中效果', '串燒', '雷射・貫穿光束・串燒：每穿過一隻，之後打中的 +30%（第 2 隻 ×1.3、第 3 隻 ×1.6）', M => {
      const run = fin => {
        M.setup('sandbox', 'vanguard', 'laser', 'C', fin, ['weapon', null, null, null]);
        const P = Game.player, es = M.targets([[100, 0], [160, 0], [220, 0], [280, 0]]), d = new Map();
        for (const e of es) { const h = e.hurt.bind(e); e.hurt = (x, ...r) => { if (!d.has(e)) d.set(e, x); return h(x, ...r); }; }
        P.aim = 0; P.fire(); for (let f = 0; f < 30; f++) Game.updateBullets(1 / 60);
        return es.map(e => d.get(e) || 0);
      };
      const A = run(null), B = run(1);
      return { ok: A[0] > 0 && near1(A[1], A[0]) && near1(B[0], A[0]) && near1(B[1], A[0] * 1.3) && near1(B[2], A[0] * 1.6),
        got: `貫穿光束 ${A.map(x => x.toFixed(1)).join('／')}；串燒 ${B.map(x => x.toFixed(1)).join('／')}（第 2、3 隻要 ×1.3、×1.6）` };
    }],
    ['武器命中效果', '撞牆','散彈・霰彈擴充・撞牆：被彈丸打飛的敵人 0.4 秒內撞到別的敵人 → 受到打中牠的彈丸傷害加總 ×2、暈眩 0.5 秒；被撞的不受傷；同一隻 0.5 秒內只算一次', M => {
      M.setup('sandbox', 'vanguard', 'scatter', 'A', 1, ['weapon', null, null, null]);
      const [a, b] = M.targets([[90, 0], [400, 300]]), P = Game.player, got = [];
      const h = a.hurt.bind(a); a.hurt = (d, ...r) => { got.push([d, r[2]]); return h(d, ...r); };
      P.aim = 0; P.fire();
      for (let f = 0; f < 30 && !(a.whT > 0); f++) Game.updateBullets(1 / 60);
      const pel = got.filter(g => g[1] !== 'shock').reduce((s, g) => s + g[0], 0), wh = a.whDmg || 0;
      const hb0 = b.hp; b.x = a.x + a.r + b.r - 4; b.y = a.y;
      got.length = 0; Game.updateEnemies(1 / 60);
      const slam = got.filter(g => g[1] === 'shock').reduce((s, g) => s + g[0], 0), stun = a.stunT > 0;
      got.length = 0; a.whT = 0.4; b.x = a.x + a.r + b.r - 4; b.y = a.y; Game.updateEnemies(1 / 60);
      const again = got.some(g => g[1] === 'shock');
      return { ok: pel > 0 && near1(wh, pel) && near1(slam, pel * 2) && stun && b.hp === hb0 && !again,
        got: `彈丸打中 ${pel.toFixed(1)}（記下 ${wh.toFixed(1)}）；撞到別的敵人受到 ${slam.toFixed(1)}（要 ${(pel * 2).toFixed(1)}）、${stun ? '暈眩' : '沒暈眩（錯）'}；被撞的${b.hp === hb0 ? '沒受傷' : '受傷了（錯）'}；0.5 秒內再撞${again ? '又算了（錯）' : '不算'}` };
    }],
    ['武器命中效果', '逆襲','散彈・獨頭彈・逆襲：受傷（護盾擋下也算）之後 3 秒內傷害 ×2、命中爆炸（半徑 80）；3 秒後恢復', M => {
      M.setup('sandbox', 'vanguard', 'scatter', 'B', 0, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, shot0 = () => runOps(Game.stats.ops, 0)[0];
      const a = shot0(); P.iframe = 0; Game.hurtPlayer(5, 'mc', P); const b = shot0(), t1 = P.revengeT;
      for (let f = 0; f < 190; f++) Game.tickWeaponFx(P, 1 / 60);
      const c = shot0();
      P.shield = 1; P.iframe = 0; const hp0 = P.hp; Game.hurtPlayer(5, 'mc', P); const t2 = P.revengeT, kept = P.hp === hp0;
      return { ok: !a.explode && near1(b.damage / a.damage, 2) && b.explode && b.explode.r === 80 && near1(t1, 3) && near1(c.damage, a.damage) && !c.explode && near1(t2, 3) && kept,
        got: `平常 ${a.damage.toFixed(1)}${a.explode ? '（有爆炸，錯）' : ''}；受傷後 ${b.damage.toFixed(1)}（×${(b.damage / a.damage).toFixed(2)}）${b.explode ? `爆炸半徑 ${b.explode.r}` : '沒爆炸（錯）'}、倒數 ${t1.toFixed(1)} 秒；3.2 秒後 ${c.damage.toFixed(1)}${c.explode ? '（還在爆，錯）' : ''}；護盾擋下：倒數 ${t2.toFixed(1)} 秒、${kept ? '沒扣血' : '扣血了（錯）'}` };
    }],
    ['武器命中效果', '空格苦行', '散彈・獨頭彈・空格苦行：電路上每個沒裝晶片的空格傷害 +20%（組件插座不算）', M => {
      const one = chain => { M.setup('sandbox', 'vanguard', 'scatter', 'B', 1, chain); return runOps(Game.stats.ops, 0)[0].damage; };
      M.setup('sandbox', 'vanguard', 'scatter', 'B', null, ['weapon', null, null, null]);
      const base = runOps(Game.stats.ops, 0)[0].damage;
      const A = one(['weapon', null, null, null]), B = one(['weapon', 'rear', null, null]), C = one(['weapon', 'rear', 'stand', 'charge']);
      return { ok: near1(A / base, 1.6) && near1(B / base, 1.4) && near1(C / base, 1),
        got: `獨頭彈 ${base.toFixed(1)}；3 個空格 ${A.toFixed(1)}（×${(A / base).toFixed(2)}，要 ×1.6）；2 個 ${B.toFixed(1)}（×${(B / base).toFixed(2)}，要 ×1.4）；沒空格 ${C.toFixed(1)}（×${(C / base).toFixed(2)}，要 ×1）` };
    }],
    ['武器命中效果', '火毯', '散彈・龍息彈・火毯：每顆彈丸消失的地方（射程盡頭、打中敵人）留一團火（燒 2 秒），碰到的敵人燃燒每秒 12；場上最多 60 團', M => {
      M.setup('sandbox', 'vanguard', 'scatter', 'C', 0, ['weapon', null, null, null]);
      const P = Game.player; M.targets([]); P.aim = 0;
      P.fire(); const n = Game.bullets.length;
      for (let f = 0; f < 60 && Game.bullets.length; f++) Game.updateBullets(1 / 60);
      const left = Game.flames.length, far = Game.flames.every(z => Math.hypot(z.x - P.x, z.y - P.y) > 200);
      const z0 = Game.flames[0], e = M.targets([[z0.x - P.x, z0.y - P.y]])[0];
      for (let f = 0; f < 15; f++) Game.updateFlames(1 / 60);
      const burn = e.burnT > 0 ? e.burnDps : 0;
      for (let f = 0; f < 130; f++) Game.updateFlames(1 / 60);
      const gone = Game.flames.length;
      for (let i = 0; i < 20; i++) { P.fire(); for (let f = 0; f < 60 && Game.bullets.length; f++) Game.updateBullets(1 / 60); }
      return { ok: n === 5 && left === 5 && far && burn === 12 && gone === 0 && Game.flames.length === 60,
        got: `一槍 ${n} 顆，消失後留 ${left} 團（要 5）、${far ? '都在射程盡頭' : '位置不對（錯）'}；火上的敵人燃燒每秒 ${burn}（要 12）；2.4 秒後剩 ${gone} 團（要 0）；連射 20 槍場上 ${Game.flames.length} 團（上限 60）` };
    }],
    ['武器命中效果', '野火', '散彈・龍息彈・野火：燃燒中的敵人每 0.5 秒把火傳給 80 以內一隻沒燒的；燒著死掉時火噴到 120 以內所有敵人', M => {
      M.setup('sandbox', 'vanguard', 'scatter', 'C', 1, ['weapon', null, null, null]);
      const [a, b, c, d] = M.targets([[200, 0], [260, 0], [600, 0], [360, 0]]);
      const s0 = runOps(Game.stats.ops, 0)[0];
      Game.hitFx(a, { burn: s0.burn, burnR: 0, wild: s0.wild, att: { src: 'weapon', cr: null, owner: null }, damage: s0.damage }, s0.damage, a.x, a.y);
      for (let f = 0; f < 33; f++) Game.updateWildfire(1 / 60);
      const bOn = b.burnT > 0, cOn = c.burnT > 0, dOn0 = d.burnT > 0;
      b.hurt(1e9, 0, 0, 'mc');
      const dOn = d.burnT > 0;
      return { ok: !!s0.wild && a.burnT > 0 && bOn && !cOn && !dOn0 && dOn,
        got: `子彈${s0.wild ? '帶' : '沒帶（錯）'}野火；A 點燃後 0.55 秒：60 外的 B ${bOn ? '燒起來' : '沒燒（錯）'}、400 外的 C ${cOn ? '燒起來（錯）' : '沒燒'}、100 外的 D ${dOn0 ? '已經燒（錯）' : '還沒燒'}；B 燒死後 D ${dOn ? '燒起來' : '沒燒（錯）'}` };
    }],
    ['機體', '無傷連殺', '輕裝甲 4 層：沒被打中時每擊殺 1 隻傷害 +3%（最多 15 層）；護盾擋下不歸零，被打中歸零', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.parts.larmor = 4; Game.recalc();
      const P = Game.player, d = () => runOps(Game.stats.ops, 0)[0].damage, kill = n => { for (const e of M.targets(Array.from({ length: n }, (_, i) => [200, i * 20]))) e.hurt(1e9, 0, 0, 'mc'); };
      const d0 = d(); kill(5); const s5 = P.streak, d5 = d();
      kill(20); const s20 = P.streak;
      P.shield = 1; P.iframe = 0; Game.hurtPlayer(5, 'mc', P); const sSh = P.streak;
      P.iframe = 0; Game.hurtPlayer(5, 'mc', P); const sHit = P.streak;
      return { ok: Game.mech.traits.streak && s5 === 5 && near1(d5 / d0, 1.15) && s20 === 15 && sSh === 15 && sHit === 0,
        got: `殺 5 隻 ${s5} 層，傷害 ×${(d5 / d0).toFixed(2)}（要 ×1.15）；再殺 20 隻 ${s20} 層（要 15）；護盾擋下 ${sSh} 層；被打中 ${sHit} 層（要 0）` };
    }],
    ['機體', '射速加成相加','散熱片 2 層 +12%、疾風（移動中）+20%、急冷 +30% 相加 = +62%（不是相乘的 +75%）；重力井 −10% 再相乘', M => {
      const count = (gravity) => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
        Game.parts.sink = 2; Game.parts.booster = 2; Game.module = gravity ? 'gravity' : null; Game.recalc();
        const P = Game.player, iv = Game.stats.interval; let n = 0; const orig = P.fire; P.fire = () => { n++; };
        P.moving = true; P.fireCd = 0;
        try { for (let f = 0; f < 600; f++) { P.quenchT = 1; P.tickFire(1 / 60, true); } } finally { P.fire = orig; }
        return n / (10 / iv);
      };
      const a = count(false), b = count(true);
      return { ok: Math.abs(a - 1.62) < 0.03 && Math.abs(b - 1.62 * 0.9) < 0.03, got: `射速 ×${a.toFixed(2)}（要 ×1.62）；加上重力井 ×${b.toFixed(2)}（要 ×${(1.62 * 0.9).toFixed(2)}）` };
    }],
    ['電路晶片', '牆反彈', '子彈碰到場地邊緣反彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'wallbounce', null, null]); M.targets([]);
      Game.player.x = CFG.WORLD_W - 40;
      M.run(40);
      const back = Game.bullets.filter(b => Math.cos(b.angle) < 0), marked = back.filter(b => b.bounced).length;
      return { ok: back.length > 0 && marked === back.length, got: `${back.length} 發往回飛，其中 ${marked} 發標成反彈過（打中才算成長）` };
    }],
    ['電路晶片', '威力倍增器', '實際命中傷害 ×2', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]);
      const d = M.firstHit();
      return { ok: near1(d, 20), got: `單發命中 ${d.toFixed(1)}（基礎 10）` };
    }],
    ['電路晶片', '迴旋', '沒打中也會在射程盡頭折返、飛回飛船；撞到場地邊緣折返；打中敵人時穿過去折返，回程再打牠一次，飛回飛船；相刃的刃片揮到盡頭（砍到或沒砍到）都飛回飛船；迴旋的子彈打中時留一份黏著，照常折返（不會黏住就消失）', M => M.all([
      M => {  // 迴旋
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); M.targets([]);
        M.run(1); const b = Game.bullets[0];
        let back = false;
        for (let f = 0; f < 300 && b && !b.dead; f++) { Game.updateBullets(1 / 60); if (b.mode === 'return') back = true; }
        const missHome = b.dead && Math.hypot(b.x - Game.player.x, b.y - Game.player.y) < 40;
        // 撞牆：靠著右邊的場地邊緣往右射
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); M.targets([]);
        Game.player.x = CFG.WORLD_W - 60; M.run(1); const w = Game.bullets[0];
        let wallBack = false, maxX = 0;
        for (let f = 0; f < 120 && w && !w.dead; f++) { Game.updateBullets(1 / 60); maxX = Math.max(maxX, w.x); if (w.mode === 'return') wallBack = true; }
        const wallOk = wallBack && maxX <= CFG.WORLD_W + 1;
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); const e = M.targets([[150, 0]])[0];
        M.run(1); const c = Game.bullets[0];
        for (let f = 0; f < 300 && c && !c.dead; f++) Game.updateBullets(1 / 60);
        const dmg = e.maxHp - e.hp;
        const home = c.dead && Math.hypot(c.x - Game.player.x, c.y - Game.player.y) < 40;
        return { ok: back && missHome && wallOk && near1(dmg, 14) && home, got: (back && missHome ? '沒打中：盡頭折返、回到飛船' : '沒打中：沒有折返回來（錯誤）') + `；撞牆${wallOk ? '折返' : '沒折返（錯誤）'}；單發打一隻：${Math.round(dmg)}（應為 7 + 7）${home ? '，回到飛船' : '，沒回到飛船'}` };
      },
      M => {  // 相刃＋迴旋
        const go = tg => {
          M.setup('sandbox', 'vanguard', 'blade', null, null, ['weapon', 'boomerang', null, null]); M.targets(tg);
          Game.player.fire();
          let ret = 0, home = false;
          for (let f = 0; f < 90; f++) { Game.updateBullets(1 / 60); ret = Math.max(ret, Game.bullets.filter(b => b.mode === 'return').length); }
          home = !Game.bullets.length;
          return { ret, home };
        };
        const hit = go([[70, 0]]), miss = go([]);
        return { ok: hit.ret > 0 && hit.home && miss.ret > 0 && miss.home, got: `砍到：${hit.ret} 片折返${hit.home ? '、都飛回來了' : '、還沒回來'}；沒砍到：${miss.ret} 片折返${miss.home ? '、都飛回來了' : '、還沒回來'}` };
      },
      M => {  // 黏著＋迴旋
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', 'boomerang', null]); const e = M.targets([[150, 0]])[0];
        Game.player.fire();
        let ret = false;
        for (let f = 0; f < 40; f++) { Game.updateBullets(1 / 60); if (Game.bullets.some(b => b.mode === 'return')) ret = true; }
        const n = e.stuck ? e.stuck.length : 0;
        return { ok: ret && n >= 1, got: `${ret ? '有' : '沒有'}折返，黏了 ${n} 份` };
      },
    ])],
    ['電路晶片', '超頻模組', '同樣時間內開火次數變多；連續射擊 3 秒後過熱，停火 1.5 秒', M => M.all([
      M => {  // 超頻模組
        M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
        const a = M.run(180).fired;
        M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', 'overclock', null, null]); M.targets([]);
        const b = M.run(180).fired;
        return { ok: b > a, got: `3 秒開火 ${a} → ${b} 次` };
      },
      M => {  // 超頻模組・過熱
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'overclock', null, null]); M.targets([]);
        const p = Game.player;
        let n = 0, lockAt = null;
        for (let f = 0; f < 60 * 4; f++) {
          const before = Game.bullets.length;
          p.tickFire(1 / 60, true); if (Game.bullets.length > before) n++;
          if (p.ohLock > 0 && lockAt == null) lockAt = f / 60;
        }
        return { ok: lockAt != null && lockAt > 2.9 && lockAt < 3.1 && n > 0,
          got: lockAt == null ? '沒有過熱' : `${lockAt.toFixed(2)} 秒過熱，4 秒內開火 ${n} 次` };
      },
    ])],
    ['電路晶片', '環繞', '按住射擊時存在飛船旁繞圈（Lv1 最多 10 發，散彈一次的 5 顆算一發），碰到敵人照打、打到就消失；衝刺不會放出；放開後全部從所在位置朝滑鼠那一點射出，Lv1 繞滿 3 秒速度與傷害 ×1.5；搭加速時從 1.5 往上加（不相乘）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'orbit', null, null]); M.targets([]);
      const p = Game.player; p.wantFire = true;
      M.run(180);
      const stored = Game.bullets.filter(b => b.mode === 'orbit').length;
      const e = M.targets([[60, 0]])[0];
      M.run(8, { fire: false });  // 還按著但不再射：繞圈打到敵人的子彈消失
      const orb = Game.bullets.filter(b => b.mode === 'orbit'), d0 = orb.length && orb[0].damage, hit = e.maxHp - e.hp;
      p.dashT = 0.2; Game.updateBullets(1 / 60); p.dashT = 0;  // 衝刺不會放出
      const kept = orb.every(b => b.mode === 'orbit');
      p.wantFire = false; p.aim = Math.PI / 2; p.aimD = 300; Game.enemies = [];
      Game.updateBullets(1 / 60);
      const out = orb.filter(b => b.mode === 'fly' && Math.abs(angleDiff(b.angle, Math.atan2(p.y + 300 - b.y, p.x - b.x))) < 0.01).length;
      const dmgOk = orb.length > 0 && near1(orb[0].damage, d0) && Math.abs(orb[0].accelMul - 1.5) < 0.02;
      // 搭加速：放出時從轉速的倍率開始加速
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'orbit', 'accel', null]); M.targets([]);
      const p2 = Game.player; p2.wantFire = true; M.run(200); const a = Game.bullets.find(b => b.mode === 'orbit');
      p2.wantFire = false; Game.updateBullets(1 / 60); Game.updateBullets(1 / 60);
      const am = a ? a.accelMul : 0;
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'orbit', null, null]); M.targets([]);
      const p3 = Game.player; p3.wantFire = true; M.run(400); const sc = Game.bullets.filter(b => b.mode === 'orbit').length;
      return { ok: sc === 50 && kept && stored === 10 && hit > 0 && orb.length < 10 && out === orb.length && out > 0 && dmgOk && am > 1.52 && am < 1.7,
        got: `${kept ? '' : '衝刺時就射出了！'}存了 ${stored} 發（散彈存了 ${sc} 顆 = 10 發）；繞圈打敵人 ${Math.round(hit)}，剩 ${orb.length} 發；放開後 ${out} 發朝滑鼠那一點射出，速度與傷害倍率 ${orb.length && orb[0].accelMul.toFixed(2)}；搭加速放出後 ${am.toFixed(2)}（從 1.5 往上加，不相乘）` };
    }],
    ['電路晶片', '佈雷', '子彈飛到射程一半停住變成地雷（不擋敵彈，相刃也停得住）；敵人靠近就衝出去打中（×1.2）', M => {
      M.setup('sandbox', 'vanguard', 'blade', null, null, ['weapon', 'stasis', null, null]); M.targets([]);
      M.run(1); const k = Game.bullets[0];
      for (let f = 0; f < 60 && k.mode !== 'wait' && !k.dead; f++) Game.updateBullets(1 / 60);
      const bladeOk = k.mode === 'wait';
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'stasis', null, null]); M.targets([]);
      M.run(1); const b = Game.bullets[0];
      for (let f = 0; f < 120 && b.mode !== 'wait'; f++) Game.updateBullets(1 / 60);
      const stopped = b.mode === 'wait', d0 = b.damage, half = b.dist / b.R;
      Game.eBullets = [{ x: b.x + 40, y: b.y, vx: -600, vy: 0, r: 5, dmg: 10, life: 2, from: 'test' }];
      for (let f = 0; f < 10; f++) { Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
      const passed = !b.dead && b.mode === 'wait';
      const e = M.targets([[b.x - Game.player.x + 45, b.y - Game.player.y]])[0];
      for (let f = 0; f < 30 && e.hp === e.maxHp; f++) Game.updateBullets(1 / 60);
      const hit = e.maxHp - e.hp;
      return { ok: bladeOk && stopped && Math.abs(half - 0.5) < 0.05 && passed && near1(hit, d0 * 1.2),
        got: `相刃${bladeOk ? '停得住' : '沒停住'}；雷射${stopped ? `停在射程的 ${Math.round(half * 100)}%` : '沒停住'}；敵彈${passed ? '穿過去（不擋）' : '被擋了'}；敵人靠近後被打 ${Math.round(hit)}（應為 ${d0 * 1.2}）` };
    }],
    ['電路晶片', '加速', '出手 0.5 倍速，飛到射程盡頭 3 倍（射程 ×1.5，照射程進度算）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'accel', null, null]); M.targets([]);
      M.run(1); const b = Game.bullets[0], m0 = b.accelMul, R0 = b.speed0 * Game.wp.life;
      for (let f = 0; f < 300 && b.dist < b.R / 2; f++) Game.updateBullets(1 / 60);
      const m1 = b.accelMul;
      let m2 = 0;
      for (let f = 0; f < 300 && !b.dead; f++) { m2 = b.accelMul; Game.updateBullets(1 / 60); }
      const range = b.dist / R0;
      return { ok: m0 >= 0.5 && m0 < 0.6 && Math.abs(m1 - 1.75) < 0.08 && m2 > 2.9 && Math.abs(range - 1.5) < 0.08,
        got: `出手 ${m0.toFixed(2)} 倍，射程一半 ${m1.toFixed(2)} 倍（應為 1.75），盡頭 ${m2.toFixed(2)} 倍；射程 ×${range.toFixed(2)}` };
    }],
    ['電路晶片', '疾射', '出手 3 倍，飛到射程盡頭 0.5 倍（射程不變）；跟加速一起裝時加在同一個倍率上', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'quick', null, null]); M.targets([]);
      M.run(1); const b = Game.bullets[0], m0 = b.accelMul, R0 = b.speed0 * Game.wp.life;
      for (let f = 0; f < 300 && b.dist < b.R / 2; f++) Game.updateBullets(1 / 60);
      const m1 = b.accelMul;
      for (let f = 0; f < 300 && !b.dead; f++) Game.updateBullets(1 / 60);
      const range = b.dist / R0;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'quick', 'accel', null]); M.targets([]);
      M.run(1); const c = Game.bullets[0], c0 = c.accelMul;
      for (let f = 0; f < 20; f++) Game.updateBullets(1 / 60);
      const c1 = c.accelMul;
      return { ok: m0 > 2.8 && m0 <= 3 && Math.abs(m1 - 1.75) < 0.08 && Math.abs(range - 1) < 0.06 && Math.abs(c0 - 2.5) < 0.02 && Math.abs(c1 - 2.5) < 0.02,
        got: `出手 ${m0.toFixed(2)} 倍，射程一半 ${m1.toFixed(2)} 倍（應為 1.75）；射程 ×${range.toFixed(2)}；疾射＋加速一直是 ${c0.toFixed(2)} → ${c1.toFixed(2)} 倍（應為 2.5）` };
    }],
    ['電路晶片', '黏著', '子彈黏上敵人，2 秒後一起爆炸（Lv1 ×1.5＋0.1／發，最多 ×3）；會穿透的子彈每穿過一隻留一份；Lv3 爆炸時立刻引爆周圍敵人身上的子彈（沒有波及傷害）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', null, null]); const e = M.targets([[120, 0]])[0];
      M.run(20); const n = e.stuck ? e.stuck.length : 0, hp = e.hp; Game.bullets = [];
      for (let f = 0; f < 150; f++) { Game.time += 1 / 60; Game.updateEnemies(1 / 60); }
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', 'sticky', null, null]); const row = M.targets([[120, 0], [180, 0], [240, 0], [300, 0], [360, 0]]);
      M.run(1); for (let f = 0; f < 30; f++) Game.updateBullets(1 / 60);
      const each = row.map(r => r.stuck ? r.stuck.length : 0).join('');
      const want = n * 10 * Math.min(3, 1.5 + 0.1 * n);
      // 連鎖引爆（Lv3）：爆炸時把 90 內敵人身上的子彈立刻引爆，不再有波及傷害
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', chipId('sticky', 3), null, null]); const [c0, c1, c2, c3] = M.targets([[120, 0], [120, 70], [120, 300], [200, 40]]);
      M.run(20); Game.bullets = []; const st = c0.stuck || [];
      c1.stuck = [...st]; c2.stuck = [...st]; c1.stickT = c2.stickT = 9; const h3 = c3.hp; Game.detonate(c0);
      const chain = st.length > 0 && c1.stickT < 0.1 && c2.stickT === 9 && c3.hp === h3;
      return { ok: n > 0 && near1(hp - e.hp, want) && each === '11110' && chain, got: `雷射黏了 ${n} 發，爆炸 ${Math.round(hp - e.hp)}（應為 ${Math.round(want)}）；軌道砲（穿甲 3）一排 5 隻各黏 ${each}；Lv3：旁邊 70 的${c1.stickT < 0.1 ? '立刻引爆' : '沒引爆（錯誤）'}、300 外的${c2.stickT === 9 ? '沒動' : '被引爆（錯誤）'}、旁邊沒黏的${c3.hp === h3 ? '沒受傷' : '受傷（錯誤：波及傷害應該拿掉）'}` };
    }],
    ['電路晶片', '感染', '被擊殺的敵人爆出 3 發子彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'infect', null, null]); M.targets([[120, 0]], 'swarmer', true, 0.1);
      const r = M.run(40);
      return { ok: r.created >= r.fired + 3, got: `開火 ${r.fired} 次，另外爆出 ${r.created - r.fired} 發` };
    }],
    ['電路晶片', '蓄力', '停火 2 秒蓄滿，再按下的第一發 ×5，之後照常連射', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', null, null]); M.targets([]);
      const p = Game.player; p.chargeC = 0;
      for (let f = 0; f < 60; f++) p.tickFire(1 / 60, true);
      const normal = Game.bullets.map(b => b.damage);
      Game.bullets = [];
      for (let f = 0; f < 120; f++) p.tickFire(1 / 60, false);
      for (let f = 0; f < 30; f++) p.tickFire(1 / 60, true);
      const d = Game.bullets.map(b => b.damage);
      return { ok: normal.length > 2 && normal.every(x => near1(x, 10)) && near1(d[0], 50) && d.length > 1 && d.slice(1).every(x => near1(x, 10)),
        got: `按住連射 ${normal.length} 發（${normal[0]}）；停火 2 秒後：${d.map(x => Math.round(x)).join('、')}` };
    }],
    ['電路晶片', '命中觸發器', '命中時用武器再射一次（50%）；觸發射出的子彈不會進環繞的圈；連放 4 個觸發器，最多只展開 3 層', M => M.all([
      M => {  // 命中觸發器
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', null, null]); M.targets(M.cone);
        const r = M.run(90);
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'orbit', null]); M.targets([[200, 0]]);
        Game.player.wantFire = true; const r2 = M.run(40);  // 回響可以打到被命中的那一隻，常常一出來就打中消失：數射出過幾發，不數場上剩的
        const trig = r2.created - r2.fired, inRing = Game.bullets.filter(b => b.depth > 0 && b.mode === 'orbit').length;
        return { ok: r.created > r.fired && r.hits.some(h => near1(h, 5)) && trig > 0 && inRing === 0,
          got: `開火 ${r.fired} 次，回響 ${r.created - r.fired} 發，回響傷害 5；接環繞時觸發 ${trig} 發、進圈 ${inRing} 發` };
      },
      M => {  // 觸發巢狀上限
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'trigger', 'trigger', 'trigger', null]); M.targets(M.cone);
        const r = M.run(120);
        return { ok: r.maxDepth === 3 && Game.stats.layers.length === 3, got: `實際最深第 ${r.maxDepth} 層` };
      },
    ])],
    ['電路晶片', '消失／定時觸發器', '消失：子彈飛完射程時射出 1 發回響；定時：雷射（0.85 秒）飛行中每 0.3 秒往兩側各射 1 發 = 4 發', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigend', null, null]); M.targets([]);
      Game.player.fire();
      for (let f = 0; f < 70; f++) Game.updateBullets(1 / 60);
      const e = Game.bullets.filter(b => b.depth === 1).length;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigtime', null, null]); M.targets([]);
      Game.player.fire();
      let t = 0;
      const orig = window.spawnShots;
      window.spawnShots = (list, ...rest) => { if (rest[3] > 0) t += list.length; return orig(list, ...rest); };
      try { for (let f = 0; f < 70; f++) Game.updateBullets(1 / 60); } finally { window.spawnShots = orig; }
      return { ok: e === 1 && t === 4, got: `消失觸發 ${e} 發；定時觸發 ${t} 發` };
    }],
    ['電路晶片', '觸發器：消失時機與方向', '消失觸發器：黏著引爆、地雷時間到、迴旋飛回飛船都會觸發；定時觸發器：停住的地雷不觸發（雷射飛到射程一半前只觸發 1 次 = 2 發）；命中觸發器的回響沿子彈方向射、打得到被命中的那一隻', M => {
      const echoes = (flat, targets, frames) => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, flat); M.targets(targets);
        const got = [], orig = window.spawnShots;
        window.spawnShots = (list, x, y, ang, depth, ...r) => { if (depth > 0) got.push({ n: list.length, x, y, ang }); return orig(list, x, y, ang, depth, ...r); };
        try { Game.player.fire(); SockCheck.step(frames); } finally { window.spawnShots = orig; }
        return got;
      };
      const st = echoes(['weapon', 'sticky', 'trigend'], [[150, 0]], 200);
      const mine = echoes(['weapon', 'stasis', 'trigend'], [], 360);
      const bm = echoes(['weapon', 'boomerang', 'trigend'], [[150, 0]], 120), p = Game.player;
      const back = bm.some(e => Math.hypot(e.x - p.x, e.y - p.y) < 40);
      const tm = echoes(['weapon', 'stasis', 'trigtime'], [], 360).reduce((a, e) => a + e.n, 0);
      const aim = echoes(['weapon', 'trigger'], [[150, 0], [150, 200]], 30);
      const one = M.targets([[150, 0]])[0], h1 = one.hp; Game.player.fire(); SockCheck.step(30);  // 只有一隻：回響打得到被命中的那一隻
      const hitSelf = (h1 - one.hp) > 10 * 1.4;  // 雷射 10 ＋ 回響 5
      const aimOk = aim.length > 0 && Math.abs(angleDiff(aim[0].ang, 0)) < 0.1 && hitSelf;
      return { ok: st.length > 0 && mine.length > 0 && back && tm === 2 && aimOk,
        got: `黏著引爆 ${st.length} 次、地雷時間到 ${mine.length} 次、迴旋飛回飛船${back ? '有' : '沒有'}觸發；定時（地雷）${tm} 發；回響方向 ${aim.length ? Math.round(aim[0].ang * 180 / Math.PI) + '°' : '沒有'}（應為 0°，沿子彈方向）、只有一隻時受傷 ${(h1 - one.hp).toFixed(1)}（雷射 10 ＋ 回響 5 應 > 14）` };
    }],
    ['電路晶片', '衝刺射擊／攔截', '衝刺結束時用整條電路朝準星開一槍（×1.5）；散彈照樣 5 發散射；攔截：子彈打掉敵彈（沒有穿甲就消失），0.2 秒後用整條電路回射；0.2 秒內擋 4 顆只回射一次、傷害 ×1.9、子彈變大；相隔 300 以上的各自回射；分裂插在攔截上：平常 1 發，只有回射分裂成 3 發', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'intercept', 'split', null]); M.targets([[300, 200]]);
      const gp = Game.player, gn = runOps(Game.stats.ops, 0).length;
      spawnShots([shot({ angle: 0, speed: 600, damage: 10, life: 1, intercept: 1 })], gp.x, gp.y, 0, 0, null);
      const mine = Game.bullets[0];
      Game.eBullets = [{ x: gp.x + 60, y: gp.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'test' }];
      for (let f = 0; f < 10 && Game.eBullets.length; f++) { Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
      const back0 = Game.bullets.filter(b => b.depth === 1).length;  // 集氣時間還沒到：還沒回射
      for (let f = 0; f < 16; f++) Game.updateEnemyBullets(1 / 60);
      const back = Game.bullets.filter(b => b.depth === 1).length;
      if (Game.eBullets.length || !mine.dead || back0 !== 0 || back !== 3 || gn !== 1) return { ok: false, got: `敵彈${Game.eBullets.length ? '沒被打掉' : '被打掉'}；子彈${mine.dead ? '消失了' : '還在'}；擋下當下回射 ${back0} 發、集氣時間到 ${back} 發（平常一槍 ${gn} 發）` };
      // 合併：集氣時間內擋下 4 顆 → 只回射一次（1 發），傷害 ×（1 ＋ 3 × 每顆加成）、變大；兩處相隔 400（超過 300）→ 各自一個池、各回射一次
      const one = (n, far = false) => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'intercept', null, null]); M.targets([[300, 200]]);
        const q = Game.player, ys = far ? [0, 400] : [0];
        Game.eBullets = [];
        for (const dy of ys) {
          spawnShots([shot({ angle: 0, speed: 600, damage: 10, life: 1, intercept: 1, pierce: 20 })], q.x, q.y + dy, 0, 0, null);
          for (let i = 0; i < n; i++) Game.eBullets.push({ x: q.x + 60 + i * 8, y: q.y + dy, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'test' });
        }
        for (let f = 0; f < 30; f++) { Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
        return Game.bullets.filter(b => b.depth === 1);
      };
      const s1 = one(1), s4 = one(4), s2 = one(1, true), want = 1 + 3 * CFG.COUNTER.per;
      if (s1.length !== 1 || s4.length !== 1 || !near1(s4[0].damage / s1[0].damage, want) || !(s4[0].r > s1[0].r) || s2.length !== 2)
        return { ok: false, got: `擋 1 顆回射 ${s1.length} 發、擋 4 顆回射 ${s4.length} 發；傷害比 ${s4.length && s1.length ? (s4[0].damage / s1[0].damage).toFixed(2) : '-'}（要 ${want.toFixed(2)}）；相隔 400 的兩處回射 ${s2.length} 發（要 2）` };
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'dashfire', null, null]); M.targets([]);
      const p = Game.player, n0 = runOps(Game.stats.ops, 0), d0 = n0[0].damage;
      p.aim = Math.PI / 2; p.dashT = 0.05; p.vx = 900; p.vy = 0;
      p.tickDash(); p.dashT = 0; p.tickDash();
      const B = Game.bullets, aimOk = B.length && Math.abs(angleDiff(B.reduce((a, b) => a + b.angle, 0) / B.length, Math.PI / 2)) < 0.05;
      return { ok: B.length === n0.length && B.every(b => b.dashShot && near1(b.damage, d0 * 1.5)) && aimOk,
        got: `一般一槍 ${n0.length} 發；衝刺射出 ${B.length} 發，傷害 ${B.length && B[0].damage.toFixed(1)}（一般 ${d0.toFixed(1)}）${aimOk ? '，朝準星' : '，方向不對'}` };
    }],
    ['航圖與戰鬥', '區域', '一般戰是一張大地圖，分成幾個區域（一區一波）；每一區都連得通；閘門關著過不去；清完閘門打開，穿過去才開始下一區（剩下的晶體直接收下），穿過去之後不能回頭；敵人只出生在玩家所在的區域；最後一區清完結束戰鬥；旗艦戰是一區的王關場地（沒有閘門）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 3, id: 'mc' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
      const p = Game.player; p.maxHp = p.hp = 1e9;
      const big = !Arena.rect && Arena.areas.length === 3 && Arena.gates.length === 2;
      // 連通：從出生點走得到每一道閘門的兩側（離牆 22 以上的格子）
      const C = 20, W = Math.ceil(Arena.W / C), H = Math.ceil(Arena.H / C), seen = new Uint8Array(W * H), q = [];
      const cell = (x, y) => Math.floor(y / C) * W + Math.floor(x / C), open = c => Arena.f((c % W + 0.5) * C, (Math.floor(c / W) + 0.5) * C) >= 22;
      q.push(cell(Arena.start.x, Arena.start.y)); seen[q[0]] = 1;
      while (q.length) { const c = q.pop(), x = c % W; for (const m of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (m >= 0 && m < W * H && !seen[m] && open(m)) { seen[m] = 1; q.push(m); } }
      const linked = Arena.gates.every(g => seen[cell(g.x - g.nx * 60, g.y - g.ny * 60)] && seen[cell(g.x + g.nx * 60, g.y + g.ny * 60)]);
      // 閘門關著：往閘門飛 2 秒，過不去
      const g0 = Arena.gates[0], side = () => (p.x - g0.x) * g0.nx + (p.y - g0.y) * g0.ny;
      p.x = g0.x - g0.nx * 80; p.y = g0.y - g0.ny * 80;
      const push = (sg, n) => { for (let i = 0; i < n; i++) { p.vx = g0.nx * 400 * sg; p.vy = g0.ny * 400 * sg; p.x += p.vx / 60; p.y += p.vy / 60; Arena.collide(p, p.r, Arena.shipPass(p)); Arena.updateZone(p); } };
      push(1, 120);
      const blocked = side() <= -p.r + 0.5 && p.zone === 0;
      p.x = Arena.start.x; p.y = Arena.start.y; p.zone = 0;
      let exits = 0, spawnOk = true, got0 = 0, credit = 0, passed = true, back = true;
      for (let f = 0; f < 60 * 150 && Game.state === 'play'; f++) {
        for (const e of Game.enemies) {
          if (!e.dead && e.spawnT <= 0) { if (Arena.zoneOf(e.x, e.y) !== Game.combat.wave - 1) spawnOk = false; e.hurt(1e9, 0, 0, 'direct'); }
        }
        const X = Game.exit;
        if (X && !X.seen) {
          X.seen = true; exits++;
          const g = Arena.gates[Game.combat.wave - 1];
          if (!g || !g.open) passed = false;
          Game.pickups.push({ x: p.x + 300, y: p.y, vx: 0, vy: 0, life: 9 }); got0 = Game.credits;
          // 飛到閘門後面，再往前穿過去
          p.x = g.x - g.nx * 60; p.y = g.y - g.ny * 60; p.zone = g.i;
          for (let i = 0; i < 30; i++) { p.vx = g.nx * 400; p.vy = g.ny * 400; p.x += p.vx / 60; p.y += p.vy / 60; Arena.collide(p, p.r, Arena.shipPass(p)); Arena.updateZone(p); }
          if (p.zone !== g.i + 1) passed = false;
          // 回頭：過不去
          for (let i = 0; i < 60; i++) { p.vx = -g.nx * 400; p.vy = -g.ny * 400; p.x += p.vx / 60; p.y += p.vy / 60; Arena.collide(p, p.r, Arena.shipPass(p)); Arena.updateZone(p); }
          if ((p.x - g.x) * g.nx + (p.y - g.y) * g.ny < p.r - 0.5) back = false;
        }
        const a0 = Game.combat.areaN || 0;
        Game.update(1 / 60);
        if ((Game.combat.areaN || 0) > a0) credit += Game.credits - got0;
      }
      const won = Game.state !== 'play', areas = Game.combat.areaN || 0;
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = CFG.BOSS_ORDER[0]; Game.startCombat({ level: 6, wavesTotal: 1, elites: 0, boss: true });
      const bossRect = !Game.usesAreas() && !Arena.rect && Arena.gates.length === 0 && Arena.bossId === Game.bossId;
      return { ok: big && linked && blocked && exits === 2 && areas === 2 && passed && back && spawnOk && credit >= 1 && won && bossRect,
        got: `${big ? '大地圖 3 區、2 道閘門' : '不是大地圖（錯誤）'}；${linked ? '每道閘門兩側都走得到' : '有地方走不到'}；閘門關著${blocked ? '過不去' : '穿過去了（錯誤）'}；閘門打開 ${exits} 次、換區 ${areas} 次（應各 2）${passed ? '' : '、穿閘門失敗'}${back ? '、不能回頭' : '、可以回頭（錯誤）'}；${spawnOk ? '敵人都在目前的區域' : '有敵人生在別區'}；晶體收下 ${credit}；${won ? '戰鬥結束' : '戰鬥沒結束'}；旗艦戰${bossRect ? '是王關場地' : '不是王關場地（錯誤）'}` };
    }],
    ['航圖與戰鬥', '大地圖的牆', '牆反彈的子彈照牆面法線反彈（入射角 = 反射角）、沒有反彈的子彈打到牆消失（消失觸發器照樣觸發，回響往反彈方向射）；敵人、敵彈不會穿牆；彗星碎片會打到飛船', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'wallbounce', null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 2, elites: 0 });
      const p = Game.player;
      // 1. 反彈：從出生點朝 8 個方向各找一面牆，在牆前 160 朝牆射（斜 25°）
      let tries = 0, okRef = 0, nRef = 0, diesOk = 0, nDie = 0, worst = 0, nEnd = 0, endOk = 0;
      const nearGate = (x, y) => Arena.gates.some(g => segDist2(g.x - g.ny * g.L, g.y + g.nx * g.L, g.x + g.ny * g.L, g.y - g.nx * g.L, x, y) < 60 * 60);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, ux = Math.cos(a), uy = Math.sin(a);
        let d = 0;
        while (d < 3000 && Arena.f(Arena.start.x + ux * d, Arena.start.y + uy * d) > 0) d += 10;
        if (d < 260 || d >= 3000 || Arena.gateCross(Arena.start.x, Arena.start.y, Arena.start.x + ux * d, Arena.start.y + uy * d)) continue;
        tries++;
        for (const chain of [['weapon', 'wallbounce', null, null], ['weapon', null, null, null]]) {
          const sp = splitChain(chain.map(fullChip)); Game.chain = sp.chain; Game.socks = sp.socks; Game.objs = []; Game.recalc();
          p.x = Arena.start.x + ux * (d - 160); p.y = Arena.start.y + uy * (d - 160); p.zone = 0;
          p.aim = a + 0.44; Game.bullets = []; p.fire();
          const b = Game.bullets[0];
          if (!b) continue;
          let prevA = b.angle, bounced = false;
          for (let f = 0; f < 90 && !b.dead; f++) {
            prevA = b.angle; Game.updateBullets(1 / 60);
            worst = Math.min(worst, Arena.f(b.x, b.y));
            if (b.bounced && !bounced) {
              bounced = true;
              if (nearGate(b.x, b.y)) continue;  // 打到閘門（閘門也會反彈，法線是閘門的方向，這裡只檢查牆）
              const g0 = Arena.grad(b.x, b.y);  // 兩個圓接起來的凹角：附近的牆面方向變很快，量不準，不算
              if ([[10, 0], [-10, 0], [0, 10], [0, -10]].some(([ox, oy]) => { const g = Arena.grad(b.x + ox, b.y + oy); return g[0] * g0[0] + g[1] * g0[1] < 0.95; })) continue;
              nRef++;
              const [nx, ny] = Arena.grad(b.x, b.y), ix = Math.cos(prevA), iy = Math.sin(prevA), ox = Math.cos(b.angle), oy = Math.sin(b.angle);
              const nIn = ix * nx + iy * ny, nOut = ox * nx + oy * ny, tIn = -ix * ny + iy * nx, tOut = -ox * ny + oy * nx;
              if (nIn < 0 && Math.abs(nIn + nOut) < 0.3 && Math.abs(tIn - tOut) < 0.3) okRef++;  // 容許約 17°：牆的場地值是 20 格點內插的，凹凸的牆面上法線每幾像素就差幾度
            }
          }
          if (chain[1] === null && b.dead && !b.bounced && !nearGate(b.x, b.y) && b.life > 0) { nDie++; if (Arena.f(b.x, b.y) < 2) diesOk++; }  // 射程用完才消失的不算
        }
        // 消失觸發器：撞牆算消失，回響從牆面往反彈的方向射（離開牆面）
        const sp = splitChain(['weapon', 'trigend', null, null].map(fullChip)); Game.chain = sp.chain; Game.socks = sp.socks; Game.recalc();
        p.x = Arena.start.x + ux * (d - 160); p.y = Arena.start.y + uy * (d - 160);
        p.aim = a + 0.44; Game.bullets = []; p.fire();
        const b = Game.bullets[0], got = [], orig = window.spawnShots;
        window.spawnShots = (list, x, y, ang, depth, ...r) => { if (depth > 0) got.push({ x, y, ang }); return orig(list, x, y, ang, depth, ...r); };
        try { for (let f = 0; f < 90 && b && !b.dead; f++) Game.updateBullets(1 / 60); } finally { window.spawnShots = orig; }
        if (b && b.dead && b.life > 0 && !nearGate(b.x, b.y)) {
          nEnd++;
          const e = got[0], g = e && Arena.grad(e.x, e.y);
          if (e && Arena.f(e.x, e.y) > 0 && Math.cos(e.ang) * g[0] + Math.sin(e.ang) * g[1] > 0) endOk++;
        }
      }
      // 2. 敵人、敵彈不穿牆：真正打 25 秒（飛船無敵、不開火）
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 5, id: 'mc' }; Game.startCombat({ level: 5, wavesTotal: 2, elites: 0 });
      Game.player.maxHp = Game.player.hp = 1e9;
      let inWall = 0, eb = 0, ebBad = 0, seenE = 0;
      for (let f = 0; f < 60 * 25; f++) {
        Game.update(1 / 60);
        for (const e of Game.enemies) { if (e.dead) continue; seenE++; if (Arena.f(e.x, e.y) < e.r * 0.5 || Arena.zoneOf(e.x, e.y) !== 0) inWall++; }
        for (const q of Game.eBullets) { eb++; if (Arena.f(q.x, q.y) < -10) ebBad++; }
      }
      // 3. 彗星碎片：彗星在飛船前方 40、朝飛船飛，打爆（碎片 360° 每 30° 一片、起始角隨機：40 以內一定有一片打到飛船）
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 2, elites: 0 });
      const P = Game.player; P.iframe = 0; const hp0 = P.hp = P.maxHp;
      const o = { type: 'comet', id: 999, x: P.x + 40, y: P.y, vx: -300, vy: 0, r: 18, hp: 1, maxHp: 1, warn: 0, hits: new Set(), age: 2 };
      Game.objs = [o]; Objects.breakComet(o);
      for (let f = 0; f < 30; f++) Game.updateBullets(1 / 60);
      const shardHit = P.hp < hp0 && /彗星（碎片）/.test(Game.lastHit || '');
      return { ok: tries >= 3 && nRef >= 3 && okRef === nRef && nDie >= 3 && diesOk === nDie && nEnd >= 3 && endOk === nEnd && worst > -40 && seenE > 100 && inWall === 0 && ebBad === 0 && shardHit,
        got: `反彈 ${okRef} / ${nRef} 次角度正確，沒反彈的子彈 ${diesOk} / ${nDie} 撞牆消失（最深進牆 ${(-worst).toFixed(0)}）、消失觸發器撞牆 ${endOk} / ${nEnd} 次從牆面往外射回響；敵人 ${inWall ? inWall + ' 次在牆裡或別區（錯誤）' : '沒有穿牆'}（${seenE} 隻·幀），敵彈 ${eb} 個·幀 ${ebBad ? '有 ' + ebBad + ' 個在牆裡（錯誤）' : '沒有穿牆'}；彗星碎片${shardHit ? `打到飛船（-${Math.round(hp0 - P.hp)}）` : '沒打到飛船（錯誤）'}` };
    }],
    ['航圖與戰鬥', '選單（Esc）', '戰鬥中按 Esc：跳出選單、單人時暫停（時間、敵人都不動）；再按一次繼續；選「離開遊戲」：這一局中途結束，顯示結算畫面', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 2, elites: 0 });
      for (let f = 0; f < 120; f++) Game.update(1 / 60);
      Game.togglePauseMenu(true);
      const t0 = Game.time, menu = /繼續/.test(Screen.el.innerHTML) && /離開遊戲/.test(Screen.el.innerHTML);
      for (let f = 0; f < 120; f++) Game.update(1 / 60);
      const paused = Game.time === t0;
      Game.togglePauseMenu(false);
      for (let f = 0; f < 30; f++) Game.update(1 / 60);
      const resumed = Game.time > t0;
      Game.togglePauseMenu(true); Game.quitRun();
      const ended = Game.state === 'ended' && !Game.inArena && /中途結束/.test(Screen.el.innerHTML) && /傷害|這一局還沒有造成傷害/.test(Screen.el.innerHTML);
      Game.state = 'title';
      return { ok: menu && paused && resumed && ended, got: `${menu ? '選單有「繼續」「離開遊戲」' : '選單不對'}；${paused ? '開著時暫停' : '開著時沒暫停（錯誤）'}；${resumed ? '繼續後照常進行' : '繼續後沒動'}；離開：${ended ? '顯示「中途結束」結算' : '沒有顯示結算（錯誤）'}` };
    }],
    ['航圖與戰鬥', '王關場地', '三隻王各有自己的場地形狀（母艦：圓形大廳＋凹室；獵艦：細長菱形；核心：中間四根柱子），只有一區、沒有閘門，大小跟方形場地差不多、整區連得通；王不會卡進牆裡；王的子彈打到牆會消失', M => {
      const out = [];
      let ok = true;
      for (const id of CFG.BOSS_ORDER) {
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = id; Game.startCombat({ level: 6, wavesTotal: 1, elites: 0, boss: true });
        Game.objs = [];
        const p = Game.player; p.maxHp = p.hp = 1e9;
        const C = 20, W = Math.ceil(Arena.W / C), H = Math.ceil(Arena.H / C), open = c => Arena.f((c % W + 0.5) * C, (Math.floor(c / W) + 0.5) * C) >= 22;
        const seen = new Uint8Array(W * H), s0 = Math.floor(Arena.start.y / C) * W + Math.floor(Arena.start.x / C), q = [s0]; seen[s0] = 1;
        while (q.length) { const c = q.pop(), x = c % W; for (const m of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, c - W, c + W]) if (m >= 0 && m < W * H && !seen[m] && open(m)) { seen[m] = 1; q.push(m); } }
        let tot = 0, reach = 0;
        for (let c = 0; c < W * H; c++) if (open(c)) { tot++; if (seen[c]) reach++; }
        const area = tot * C * C, sizeOk = area > 2.8e6 && area < 4.4e6, linked = reach >= tot * 0.97;
        let inWall = 0, ebInWall = 0, boss = null;
        for (let f = 0; f < 60 * 20; f++) {
          Game.update(1 / 60);
          boss = Game.enemies.find(e => e.t.boss) || boss;
          for (const e of Game.enemies) if (!e.dead && Arena.f(e.x, e.y) < e.r * 0.5) inWall++;
          for (const b of Game.eBullets) if (Arena.f(b.x, b.y) < -12) ebInWall++;
        }
        const good = !Arena.rect && Arena.bossId === id && Arena.gates.length === 0 && sizeOk && linked && boss && inWall === 0 && ebInWall === 0;
        if (!good) ok = false;
        out.push(`${ENEMY_TYPES[id].name}：${Arena.rect ? '方形（錯誤）' : '王關場地'}、空地 ${(area / 1e6).toFixed(1)}M${sizeOk ? '' : '（大小不對）'}${linked ? '' : '、有地方走不到'}${boss ? '' : '、王沒出現'}${inWall ? `、敵人卡牆 ${inWall} 次` : ''}${ebInWall ? `、敵彈穿牆 ${ebInWall}` : ''}`);
      }
      return { ok, got: out.join('；') };
    }],
    ['電路晶片', '吸引','把被打中那一隻附近的敵人拉向牠（被打中的那一隻不會被往飛船拉）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'pull', null, null]);
      const [a, b] = M.targets([[150, 0], [150, 70]]), ax = a.x, by = b.y, p = Game.player, d0 = Math.hypot(a.x - p.x, a.y - p.y);
      Game.player.fire(); SockCheck.step(30);
      const d1 = Math.hypot(a.x - p.x, a.y - p.y);
      return { ok: d1 >= d0 - 1 && b.y < by - 10, got: `被打中的離飛船 ${d0.toFixed(0)} → ${d1.toFixed(0)}（不能變近）；旁邊那隻往牠移動 ${(by - b.y).toFixed(0)}（應 > 10）` };
    }],
    ['電路晶片', '擊退不疊加', '同一幀被同方向打中 25 發，速度最多是單發的擊退（以前每發都加上去，散彈＋鏡像會把敵人推進牆裡）；單發照舊', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const [a, b] = M.targets([[150, 0], [150, 120]], 'swarmer'); a.hp = b.hp = 1e9; a.vx = a.vy = b.vx = b.vy = 0;
      for (let i = 0; i < 25; i++) a.hurt(1, 300, 0);
      b.hurt(1, 300, 0);
      const va = Math.hypot(a.vx, a.vy), vb = Math.hypot(b.vx, b.vy);
      return { ok: Math.abs(va - 300) < 1 && Math.abs(vb - 300) < 1, got: `25 發後速度 ${Math.round(va)}（要 300）；單發 ${Math.round(vb)}（要 300）` };
    }],
    ['電路晶片', '吸引不疊加', '同一幀被吸引 25 次，往中心的速度還是 380（以前每次 +380，散彈＋鏡像會把敵人甩進牆裡）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'pull', null, null]);
      const [a, b] = M.targets([[150, 0], [150, 70]]); b.vx = b.vy = 0;
      for (let i = 0; i < 25; i++) Game.pullAt({ pull: 1, x: a.x, y: a.y, owner: null }, a);
      const d = Math.hypot(a.x - b.x, a.y - b.y), vn = (b.vx * (a.x - b.x) + b.vy * (a.y - b.y)) / d;
      return { ok: Math.abs(vn - 380) < 1 && a.vx === 0 && a.vy === 0, got: `旁邊那隻往中心的速度 ${vn.toFixed(0)}（要 380）；被打中的那隻速度 ${Math.round(Math.hypot(a.vx, a.vy))}（要 0）` };
    }],
    ['電路晶片', '元素組件', '跟武器升級相加：新星＋爆裂 = 爆炸 130%（半徑 90）；磁暴線圈＋電擊 = 3 道電弧；黑潮＋冰凍 = 減速 70%（上限）；雷射＋燃燒實際打中：每秒燒 30% 命中傷害、3 秒；破甲 +25%，加弱點標記 +50%，沒有上限（破甲 37.5%＋標記 = +62.5%）', M => {
      const top = (w, path, fin, flat) => { M.setup('sandbox', 'vanguard', w, path, fin, flat); return runOps(Game.stats.ops, 0)[0]; };
      const ex = top('plasma', 'C', null, ['weapon', 'blast', null, null]).explode;
      const ar = top('railgun', 'C', null, ['weapon', 'shock', null, null]).arcs;
      const sl = top('plasma', 'B', 1, ['weapon', 'frost', null, null]).slow;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'ignite', null, null]); const e = M.targets([[120, 0]])[0];
      const hp = e.hp; Game.player.fire(); for (let f = 0; f < 20 && e.hp === hp; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); }
      const hit = hp - e.hp, ok4 = e.burnT > 2.9 && near1(e.burnDps, hit * 0.3);
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'shred', null, null]); const v = M.targets([[120, 0]])[0];
      Game.player.fire(); for (let f = 0; f < 20 && !(v.shredT > 0); f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); }
      const tk = () => { const h = v.hp; v.hurt(10, 0, 0, 'direct'); return h - v.hp; }, d1 = tk(); v.markT = 3; const d2 = tk(); v.shredAmt = 0.375; const d3 = tk();
      const ok5 = v.shredT > 2.9 && near1(d1, 12.5) && near1(d2, 15) && near1(d3, 16.25);
      return { ok: !!ex && near1(ex.ratio, 1.3) && ex.r === 90 && !!ar && ar.n === 3 && near1(sl, 0.7) && ok4 && ok5,
        got: `新星＋爆裂 ${ex ? Math.round(ex.ratio * 100) + '%、半徑 ' + ex.r : '沒有爆炸'}；磁暴＋電擊 ${ar ? ar.n : 0} 道；黑潮＋冰凍 ${Math.round((sl || 0) * 100)}%；雷射打中 ${hit.toFixed(1)}、燃燒每秒 ${e.burnDps.toFixed(1)}、${e.burnT.toFixed(1)} 秒；破甲 10 → ${d1.toFixed(1)}、加弱點標記 ${d2.toFixed(1)}、破甲 37.5%＋標記 ${d3.toFixed(1)}（沒有上限；應為 12.5／15／16.25）` };
    }],
    ['電路晶片', '鏡像迴路', '再來一次，插哪個插座都一樣：武器［鏡像］= 2 發、武器［分裂、鏡像］和［鏡像、分裂］都是 6 發；蓄力［倍增、鏡像］蓄滿 2 發、各 +100%；黏著［鏡像］有作用；吸引［鏡像］沒作用', M => {
      const cnt = flat => { M.setup('sandbox', 'vanguard', 'laser', null, null, flat); return Game.stats.count; };
      const a = cnt(['weapon', 'mirror', null, null]), b = cnt(['weapon', 'split', 'mirror', null]), c = cnt(['weapon', 'mirror', 'split', null]);
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', 'amp', 'mirror']);
      Game.chargeC = 1; const ch = runOps(Game.stats.ops, 0); Game.chargeC = null;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', 'mirror', null]);
      const st = !Game.stats.info.socks[1][0].idle;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'pull', 'mirror', null]);
      const pl = Game.stats.info.socks[1][0].idle;
      return { ok: a === 2 && b === 6 && c === 6 && ch.length === 2 && ch.every(x => near1(x.hb, 1)) && st && pl,
        got: `鏡像 ${a} 發；分裂＋鏡像 ${b}、鏡像＋分裂 ${c} 發；蓄滿 ${ch.length} 發（晶片加成 ${ch.map(x => '+' + Math.round(x.hb * 100) + '%').join('、')}）；黏著［鏡像］${st ? '有作用' : '沒作用（錯誤）'}；吸引［鏡像］${pl ? '沒作用' : '有作用（錯誤）'}` };
    }],
    ['電路晶片', '沒有子彈上限', '散彈分裂兩次 = 45 發，全部射出', M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'split', 'split', null]);
      const a = Game.stats, want = WEAPONS.scatter.base.damage * 5 * 0.16 * 9;  // 5 顆 × 分裂兩次（×0.4 × 3，兩次）
      return { ok: a.count === 45 && near1(a.dmg, want), got: `${a.count} 發，總傷害 ${a.dmg.toFixed(1)}（應為 ${want.toFixed(1)}）` };
    }],

    ['構築系統', '插座：規則', '插座滿了多的組件沒作用；超頻插在玩法晶片上沒作用；武器插 3 個倍增 +300%（不打折）；武器上的倍增不作用在回響；遠征開局武器 0 個插座（插了沒作用）；兩層相乘：蓄力［倍增］蓄滿 = 10 ×（1 ＋ 4）×（1 ＋ 1）= 100', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.chain = ['weapon', chipId('sticky', 1, 1), null, null]; Game.socks = [[], ['amp', 'amp']]; Game.recalc();
      const SI = Game.stats.info.socks[1], full = !SI[0].idle && SI[1].idle;
      Game.chain = ['weapon', chipId('sticky', 1, 2), null, null]; Game.socks = [[], ['overclock']]; Game.recalc();
      const oc = Game.stats.info.socks[1][0].idle && !Game.stats.heatLimit;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', 'amp', 'amp']);
      const d3 = Game.stats.dmg;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', 'trigger']);
      const echo = Game.stats.layers[0] ? Game.stats.layers[0].dmg : 0;
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]);
      const ws0 = Game.wSock, w0 = ws0 === 0 && Game.stats.info.socks[0][0].idle;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', 'amp']);
      Game.chargeC = 1; const ch = runOps(Game.stats.ops, 0)[0]; Game.chargeC = null;
      return { ok: full && oc && near1(d3, 40) && near1(echo, 5) && w0 && near1(ch.damage, 100),
        got: `1 個插座插 2 個倍增：第 2 個${full ? '沒作用' : '有作用（錯誤）'}；超頻插黏著${oc ? '沒作用' : '有作用（錯誤）'}；武器 3 個倍增 ${d3}；回響 ${echo}（應為 5）；遠征開局武器插座 ${ws0} 個${w0 ? '、倍增沒作用' : ''}；蓄力［倍增］蓄滿 ${ch.damage.toFixed(1)}` };
    }],
    ['構築系統', '插座組合（雷射）', '武器、13 個玩法晶片、3 種觸發器 × 分裂／穿甲／倍增／巨彈／鏡像／五種元素：效果出現在那個晶片的產物上（環繞放出時、迴旋折返時、黏著爆炸…）；疾射減速後插在上面的倍增失效', M => SockCheck.summary(SockCheck.rows('laser'))],
    ['構築系統', '插座組合（散彈）', '同上，散彈（一次 5 顆）', M => SockCheck.summary(SockCheck.rows('scatter'))],
    ['構築系統', '插座組合（相位刃）', '同上，相位刃（刃片、無限穿透、射程很短）', M => SockCheck.summary(SockCheck.rows('blade'))],
    ['構築系統', '武器、觸發器插座只算直擊', '插在武器上的倍增：迴旋回程、環繞放出、加速／疾射 1.5 倍以上、反彈後、反向往後、蓄滿、衝刺、攔截回射、黏著爆炸、感染爆出都不吃；插在觸發器上的倍增：回響的迴旋回程不吃', M => SockCheck.summary(SockCheck.direct())],
    ['構築系統', '武器插座數', '遠征開局 0 個，每打完一隻王 +1，最多 3 個', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const seq = [Game.wSock];
      for (let k = 0; k < 4; k++) {
        Game.node = { type: 'boss', L: 6, id: 'mc' + k }; Game.inArena = true; Game.state = 'play';
        Game.combatWon();
        seq.push(Game.wSock);
      }
      return { ok: seq.join() === '0,1,2,3,3', got: `打王前後：${seq.join(' → ')}` };
    }],
    ['構築系統', '三選一保底', '電路有空格時，零件只會出現在最後一格（滿了哪一格都可能）；上一次三選一沒有玩法晶片，這一次一定有', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      const N = 400, part = id => String(id).startsWith('part:'), play = id => !part(id) && !!CHIPS[baseOf(id)].grow;
      let early = 0, last = 0, dry = 0;
      for (let i = 0; i < N; i++) { Game.playDry = false; const o = Game.rewardOptions(); if (part(o[0]) || part(o[1])) early++; if (part(o[2])) last++; }
      for (let i = 0; i < N; i++) { Game.playDry = true; if (!Game.rewardOptions().some(play)) dry++; }
      Game.chain = ['weapon', 'boomerang', 'orbit', 'trigger'];
      let full = 0;
      for (let i = 0; i < N; i++) { const o = Game.rewardOptions(); if (part(o[0]) || part(o[1])) full++; }
      return { ok: early === 0 && last > 0 && dry === 0 && full > 0,
        got: `有空格：前兩格出現零件 ${early} 次、最後一格 ${last} 次；保底時沒有玩法晶片 ${dry} 次；電路滿了前兩格出現零件 ${full} 次（各 ${N} 次）` };
    }],
    ['構築系統', '用量成長','迴旋回程命中 180 次 → Lv2，540 次 → 進化「迴旋風暴」；拿到重複的不會合成，獎勵也不再出現；照玩法打中後 1 秒內敵人死掉，晶片成長 + 牠的晶體值；散彈多顆打中同一隻只算一份；超過 1 秒不算', M => M.all([
      M => {  // 用量成長
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
        Game.acquire('boomerang');
        const noMerge = baseOf(Game.chain[1]) === 'boomerang' && levelOf(Game.chain[1]) === 1 && !Game.chipOffers().includes('boomerang') && Game.chipOffers().includes('amp');
        if (!noMerge) return { ok: false, got: '改玩法的晶片拿到重複的還是會合成升級，或獎勵還會出現' };
        Game.inventory = Game.inventory.map(() => null);
        const G1 = CHIPS.boomerang.grow.need; Game.grow(null, 'boomerang', G1[0]); const a = Game.chain[1];
        Game.grow(null, 'boomerang', G1[1] - G1[0]); const b = Game.chain[1];
        return { ok: levelOf(a) === 2 && levelOf(b) === 3 && socketsOf(b) === CFG.MAX_SOCKETS, got: `${CHIPS[a].name} → ${CHIPS[b].name}（插座 ${socketsOf(b)} 個）` };
      },
      M => {  // 用量成長：擊殺標記
        const kill = (weapon, type, wait) => {
          M.setup('sandbox', 'vanguard', weapon, null, null, ['weapon', 'rear', null, null]);
          const e = M.targets([[-120, 0]], type, true, 0.01)[0]; e.hp = e.maxHp = 1e6;  // 在飛船後面，先打不死
          Game.growth = {};
          M.run(20);
          for (let f = 0; f < wait * 60; f++) Game.time += 1 / 60;
          e.hp = 1; e.hurt(5, 0, 0, 'direct', null);
          return Game.growth.rear || 0;
        };
        const a = kill('laser', 'swarmer', 0), b = kill('scatter', 'swarmer', 0), c = kill('laser', 'brute', 0), d = kill('laser', 'swarmer', 3);
        return { ok: a === 1 && b === 1 && c === 4 && d === 0, got: `雷射殺蟲群 +${a}；散彈殺蟲群 +${b}；雷射殺刺殼 +${c}；打中 3 秒後才死 +${d}` };
      },
    ])],
    ['構築系統', '傷害統計', '武器＋倍增器（×2）：兩者各分到一半，合計等於總傷害；結算的傷害總計 = 敵人實際被扣的血量，並分出來源；往前的子彈不算反向的；多射出來的那發基礎傷害算反向；攔截回射算「攔截回射」和攔截晶片（不是回響）；迴旋回程打中的傷害算迴旋；回射打中後 1 秒內擊殺，攔截才成長', M => M.all([
      M => {  // 晶片傷害統計
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]); M.targets([[120, 0]]);
        M.run(60);
        const C = Game.runStats.chips, total = Object.values(Game.runStats.dmg).reduce((a, b) => a + b, 0);
        const sum = Object.values(C).reduce((a, b) => a + b, 0), share = sum ? (C.amp || 0) / sum : 0;
        const sec = Object.values(Game.sectorStats.chips).reduce((a, b) => a + b, 0);
        return { ok: total > 0 && near1(sum, total) && near1(sec, total) && near1(share, 0.5),
          got: `總傷害 ${Math.round(total)}，晶片合計 ${Math.round(sum)}，倍增器佔 ${Math.round(share * 100)}%` };
      },
      M => {  // 結算傷害統計
        M.setup('run', 'vanguard', 'plasma', 'C', null, ['weapon', 'trigger', null, null]); M.targets(M.cone);
        const r = M.run(150), D = Game.runStats.dmg, total = Object.values(D).reduce((a, b) => a + b, 0);
        return { ok: near1(total, r.dmg) && D.direct > 0 && D.explode > 0 && D.echo > 0,
          got: `統計 ${Math.round(total)}／實際 ${Math.round(r.dmg)}（直擊 ${Math.round(D.direct)}、回響 ${Math.round(D.echo)}、爆炸 ${Math.round(D.explode)}）` };
      },
      M => {  // 反向：傷害歸屬
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'rear', null, null]); M.targets([]);
        Game.player.fire();
        const fwd = Game.bullets.find(b => !b.rear), back = Game.bullets.find(b => b.rear);
        const fs = fwd && splitDamage(10, fwd.att, null), bs = back && splitDamage(10, back.att, null);
        return { ok: !!fs && !!bs && !fs.rear && near1(bs.rear || 0, 10), got: `往前：${JSON.stringify(fs)}；往後：${JSON.stringify(bs)}` };
      },
      M => {  // 傷害歸屬：攔截回射、迴旋回程
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'intercept', null, null]);
        const e = M.targets([[300, 0]], 'swarmer', true, 1)[0], gp = Game.player; e.hp = 3;  // 回射一下就打死
        spawnShots([shot({ angle: 0, speed: 600, damage: 10, life: 1, intercept: 1 })], gp.x, gp.y, 0, 0, null);
        Game.eBullets = [{ x: gp.x + 60, y: gp.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'test' }];
        for (let f = 0; f < 60; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
        const R = Game.runStats, ic = Math.round(R.dmg.counter || 0), echo = Math.round(R.dmg.echo || 0), icChip = Math.round(R.chips.intercept || 0), g = Game.growth.intercept || 0;
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); M.targets([[150, 0]]);
        M.run(60);
        const bm = Math.round(Game.runStats.chips.boomerang || 0);
        return { ok: ic > 0 && echo === 0 && icChip > 0 && e.dead && g === 1 && bm > 0,
          got: '攔截回射 ' + ic + '、回響 ' + echo + '、攔截晶片 ' + icChip + '、攔截成長 +' + g + '；迴旋晶片 ' + bm };
      },
    ])],
    ['構築系統', '奇異點：強化格子', '投入 1 個晶片 → 隨機一格得到屬性（晶片消失）；效果 ×1.5 放在觸發器那格：插在觸發器上的倍增 +150%（回響 5 → 12.5）；能量歸零；不會成長', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'amp', null], ['split']);
      Game.openBlackhole(); Game.bhToggle('inv:0'); Game.bhFuse();
      const n = Game.slotAttr.filter(Boolean).length, gone = !Game.inventory[0], where = Game.slotAttr.findIndex(Boolean);
      Game.state = 'map';
      Game.slotAttr = [null, 'eff']; Game.recalc();
      const d = (Game.stats.layers[0] || { dmg: 0 }).dmg;
      Game.slotAttr = [null, 'free']; Game.recalc();
      const heat = Game.stats.heat;  // 觸發器不算，插在上面的倍增照算 3
      Game.chain = ['weapon', 'boomerang', null, null]; Game.socks = []; Game.slotAttr = [null, 'nogrow']; Game.growth = {}; Game.recalc();
      Game.grow(null, 'boomerang', 50);
      const g = Game.growth.boomerang || 0;
      return { ok: n === 1 && gone && where >= 0 && near1(d, 12.5) && heat === 3 && g === 0,
        got: `強化 ${n} 格（第 ${where + 1} 格）、晶片${gone ? '消失' : '還在'}；效果 ×1.5 回響 ${d}（應為 12.5）；能量歸零 ⚡${heat}；不會成長 +${g}` };
    }],
    ['構築系統', '奇異點：每種屬性', '觸發器［倍增］放在強化格：效果 ×1.5／×0.7 → 回響 12.5／8.5；能量歸零／+2；超載・威力 +50%、貫穿 +1、導引、頻率（射速變快）；間歇失效（第 6～8 秒沒作用）；成長 ×2／不會成長；武器格效果 ×1.5（武器上的倍增 +150%）', M => {
      const at = (a, slot = 1, flat = ['weapon', 'trigger', 'amp', null]) => { M.setup('sandbox', 'vanguard', 'laser', null, null, flat); Game.slotAttr = []; Game.slotAttr[slot] = a; Game.recalc(); return Game.stats; };
      const echo = s => s.layers[0] ? s.layers[0].dmg : 0, e1 = s => { const P = runOps(s.ops, 0)[0].payload; return P ? runOps(P, 1)[0] : {}; };
      const base = at(null), r = {};
      r.eff = echo(at('eff')); r.weak = echo(at('weak'));
      r.free = at('free').heat; r.heavy = at('heavy').heat;
      r.power = echo(at('ov_power')); r.pierce = e1(at('ov_pierce')).pierce; r.seek = e1(at('ov_seek')).homing; r.rate = at('ov_rate').interval / base.interval;
      at('flaky'); Game.time = 7; Game.recalc(); r.off = echo(Game.stats); Game.time = 1; Game.recalc(); r.on = echo(Game.stats);
      const grow = a => { at(a, 1, ['weapon', 'boomerang', null, null]); Game.growth = {}; Game.grow(null, 'boomerang', 10); return Game.growth.boomerang || 0; };
      r.g2 = grow('grow2'); r.g0 = grow('nogrow');
      r.w = at('eff', 0, ['weapon', 'amp', null, null]).dmg;
      const ok = near1(r.eff, 12.5) && near1(r.weak, 8.5) && r.free === 3 && r.heavy === 6 && near1(r.power, 12.5) && r.pierce === 1 && r.seek >= 3 && near1(r.rate, 0.8)
        && r.off === 0 && near1(r.on, 10) && r.g2 === 20 && r.g0 === 0 && near1(r.w, 25);
      return { ok, got: `回響：×1.5 ${r.eff}、×0.7 ${r.weak}、威力 ${r.power}；能量 ${r.free}／${r.heavy}；貫穿 ${r.pierce}、導引 ${r.seek}、射擊間隔 ×${r.rate.toFixed(2)}；間歇失效 ${r.on} → ${r.off}；成長 +${r.g2}／+${r.g0}；武器格 ×1.5 ${r.w}` };
    }],
    ['構築系統', '軍械台升級', '武器進入第一段、第二段', M => {
      M.setup('run', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]);
      Game.upgradeWeapon('C', 'armory');
      const s1 = !!Game.wp.explode;
      Game.upgradeWeapon('0', 'armory');
      return { ok: s1 && Game.wp.explode.r === 140, got: weaponTitle(Game.weapon) };
    }],
    ['構築系統', '電路擴充上限', '插槽最多 8 格', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      for (let i = 0; i < 6; i++) Game.expandSlot('reward');
      return { ok: Game.chain.length === CFG.MAX_SLOTS, got: `擴充 6 次後 ${Game.chain.length} 格` };
    }],
    ['構築系統', '晶體磁吸', '靠近的晶體會被吸過來', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, c0 = Game.credits;
      Game.pickups = [{ x: p.x + 100, y: p.y, vx: 0, vy: 0, life: 10 }];
      for (let i = 0; i < 60; i++) Game.updatePickups(1 / 60);
      return { ok: Game.credits === c0 + 1, got: Game.credits > c0 ? '1 秒內被吸走' : '沒有被吸走' };
    }],

    ['飛船技能', '衝刺無敵', '衝刺中被子彈打到不扣血', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, hp = p.hp; Game.state = 'play';
      p.dashT = CFG.DASH_TIME;
      Game.eBullets = [{ x: p.x, y: p.y, vx: 0, vy: 0, r: 6, dmg: 30, life: 1 }];
      Game.updateEnemyBullets(1 / 60);
      return { ok: p.hp === hp, got: `HP ${hp} → ${p.hp}` };
    }],
    ['機體', '星噬核心', '每 6 秒朝四周 6 個方向各用電路開一槍：吃晶片效果（裝分裂 = 每個方向 3 發）；有環繞時直接射出、不存在身邊', M => {
      const go = chain => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, chain); Game.module = 'swarmcore'; Game.recalc(); Game.enemies = [];
        const p = Game.player; Game.resetMechCombat(p);
        let max = 0, orb = 0, firstT = null;
        for (let f = 0; f < 60 * 6.5; f++) { Game.tickModules(p, 1 / 60); Game.updateBullets(1 / 60); if (firstT == null && Game.bullets.length) firstT = f / 60; max = Math.max(max, Game.bullets.length); orb = Math.max(orb, Game.bullets.filter(b => b.mode === 'orbit').length); }
        return { max, orb, firstT };
      };
      const plain = go(['weapon', null, null, null]), split = go(['weapon', 'split', null, null]), orbit = go(['weapon', 'orbit', null, null]);
      return { ok: plain.max === 6 && split.max === 18 && orbit.max === 6 && orbit.orb === 0 && Math.abs(plain.firstT - 6) < 0.1,
        got: `第 ${plain.firstT == null ? '-' : plain.firstT.toFixed(1)} 秒放出：一般 ${plain.max} 發、裝分裂 ${split.max} 發、裝環繞 ${orbit.max} 發（存在身邊 ${orbit.orb}）` };
    }],
    ['機體', '按住衝刺', '按住衝刺鍵：冷卻一好就自動再衝；同時按其他鍵也不會斷；放開就停', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); Game.enemies = [];
      const p = Game.player, keys = new Set(Input.keys);
      let n0 = 0, n1 = 0;
      Input.dash = false; Input.dashHeld = true; Input.keys.add('w'); Input.keys.add('d');
      for (let f = 0; f < 60 * 4; f++) { const s0 = p.dashSeq || 0; p.update(1 / 60); if ((p.dashSeq || 0) > s0) n0++; }
      Input.dashHeld = false;
      for (let f = 0; f < 60 * 3; f++) { const s0 = p.dashSeq || 0; p.update(1 / 60); if ((p.dashSeq || 0) > s0) n1++; }
      Input.keys = keys; Input.dash = false;
      return { ok: n0 >= 3 && n1 === 0, got: `按住 4 秒（同時按著移動鍵）衝了 ${n0} 次；放開後 3 秒衝了 ${n1} 次` };
    }],
    ['機體', '堡壘號・厚甲', '開局重裝甲 2 層：HP 140，單次受傷最多扣 20%（28）', M => {
      M.setup('run', 'bulwark', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player; p.hp = p.maxHp; Game.state = 'play';
      Game.hurtPlayer(100);
      return { ok: p.maxHp === 140 && near1(p.maxHp - p.hp, 28), got: `最大 HP ${p.maxHp}，受 100 傷害實扣 ${(p.maxHp - p.hp).toFixed(1)}` };
    }],
    ['機體', '衝撞（重裝甲 4 層）', '撞到敵人造成「最大 HP × 45%」傷害（4 層 HP 180 → 81），自己不扣血', M => {
      M.setup('run', 'bulwark', 'laser', null, null, ['weapon', null, null, null]);
      Game.parts.armor = 4; Game.recalc();
      const p = Game.player; p.hp = p.maxHp; Game.state = 'play';
      const e = M.targets([[10, 0]], 'brute', true, 60)[0], hp = e.hp; e.t = { ...e.t, dmg: 25 };
      Game.updateEnemies(1 / 60);
      return { ok: near1(hp - e.hp, Math.round(p.maxHp * 0.45)) && p.hp === p.maxHp, got: `敵人受到 ${Math.round(hp - e.hp)}（要 ${Math.round(p.maxHp * 0.45)}），自己 HP ${p.hp}/${p.maxHp}` };
    }],
    ['機體', '均衡', '5 種零件各 1 層：好處 +30%（HP 100 + 20×1.3 − 10 = 116；輕裝甲衝刺冷卻 ×(1 − 0.08×1.3)）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      for (const id of PART_IDS) Game.addPart(id);
      const cd = Game.mech.dashCd, want = (1 - 0.08 * 1.3) * 1.05;  // 輕裝甲 1 層（均衡加成）× 感測器 1 層的代價
      return { ok: Game.mech.traits.balance && Game.player.maxHp === 116 && Math.abs(cd - want) < 1e-9, got: `均衡${Game.mech.traits.balance ? '開啟' : '沒開'}，最大 HP ${Game.player.maxHp}，衝刺冷卻 ×${cd.toFixed(3)}（應為 ${want.toFixed(3)}）` };
    }],
    ['機體', '改裝廠：換零件', '付 ◆30 把 1 層重裝甲換成加速器', M => {
      M.setup('run', 'bulwark', 'laser', null, null, ['weapon', null, null, null]);
      Game.credits = 100;
      Game.swapPart('armor', 'booster');
      return { ok: Game.parts.armor === 1 && Game.parts.booster === 1 && Game.credits === 100 - PART_SWAP_PRICE,
        got: `重裝甲 ${Game.parts.armor}、加速器 ${Game.parts.booster}，剩 ◆${Game.credits}` };
    }],
    ['機體', '背包模組：護盾產生器', '8 秒充好 1 層護盾，擋下一次傷害', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.setModule('shield');
      const p = Game.player; p.hp = p.maxHp; Game.state = 'play'; Game.resetMechCombat(p);
      for (let i = 0; i < 60 * 8.1; i++) Game.tickModules(p, 1 / 60);
      const got1 = p.shield;
      Game.hurtPlayer(30);
      return { ok: got1 === 1 && p.hp === p.maxHp && p.shield === 0, got: `護盾 ${got1} 層，被打後 HP ${p.hp}/${p.maxHp}` };
    }],
    ['機體', '星門號：傳送門', '衝刺開出一對門，子彈穿過從另一個門出來；門開在飛船身上不會馬上傳送；衝刺途中穿門不會把門越拉越長；相位跳躍也會開門', M => {
      M.setup('sandbox', 'gate', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, x0 = p.x;
      p.dashSX = p.x; p.dashSY = p.y; p.dashT = 0.1; p.vx = 900; p.tickDash();
      p.x += 200; p.dashT = 0; p.tickDash();
      const q = Game.portals[0];
      if (!q) return { ok: false, got: '沒有開門' };
      Game.portalShip(p, p.x, p.y);  // 站在剛開的門上
      const stay = !p.portalT && p.x === q.bx;
      p.dashT = 0.1; p.dashSX = p.x + 5000;
      Game.portalShip(p, p.x + 80, p.y);  // 衝刺中從門外衝進來
      const hop = !!p.portalT && Math.abs(p.x - q.ax) < 60, reset = p.dashSX === p.x;
      p.dashT = 0;
      if (!stay || !hop) return { ok: false, got: stay ? '從門外走進門沒有傳送' : '門一開在飛船身上就被傳走了' };
      if (!reset) return { ok: false, got: '衝刺途中穿門後，衝刺起點沒有改成出口（門會越拉越長）' };
      spawnShots([shot({ angle: 0, speed: 300, damage: 10, life: 2 })], q.bx - 30, q.by, 0, 0, null);
      const b = Game.bullets[Game.bullets.length - 1];
      let at = null;
      for (let i = 0; i < 20 && at == null; i++) { Game.updateBullets(1 / 60); if (b.portalT) at = b.x; }
      if (at == null || Math.abs(at - q.ax) >= 60) return { ok: false, got: `門在 ${Math.round(q.ax - x0)} 與 ${Math.round(q.bx - x0)}，子彈沒有穿門` };
      M.setup('sandbox', 'gate', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      Game.setModule('blink');
      const p2 = Game.player; p2.dashCd = 0; Game.portals = []; Input.dash = true;
      for (let f = 0; f < 20; f++) { p2.update(1 / 60); p2.tickDash(); }
      const q2 = Game.portals[0], len = q2 ? Math.round(Math.hypot(q2.bx - q2.ax, q2.by - q2.ay)) : 0;
      return { ok: len > 130 && len < 170, got: `子彈從 ${Math.round(q.bx - x0)} 的門進去，從 ${Math.round(at - x0)} 出來；相位跳躍${len ? `開出相距 ${len} 的門` : '沒開門'}` };
    }],
    ['地圖物件', '行星', '正對行星的子彈被擋住；從旁邊經過的電漿球被彎過去；旗艦的子彈打到行星會讓它變小、打光崩解；一般敵人的子彈只會被擋住', M => M.all([
      M => {  // 行星：擋子彈、彈弓
        M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
        const p = Game.player;
        Game.objs = [{ type: 'planet', x: p.x + 300, y: p.y, r: 70 }];
        spawnShots([shot({ angle: 0, speed: 300, damage: 10, life: 3 })], p.x, p.y, 0, 0, null);
        spawnShots([shot({ angle: 0, speed: 300, damage: 10, life: 3 })], p.x, p.y + 130, 0, 0, null);
        const [hit, pass] = Game.bullets;
        for (let i = 0; i < 90; i++) Game.updateBullets(1 / 60);
        return { ok: hit.dead && hit.x < p.x + 300 && Math.abs(pass.angle) > 0.05,
          got: `正對的子彈${hit.dead ? '被擋下' : '穿過去了'}；旁邊的子彈轉了 ${(pass.angle * 180 / Math.PI).toFixed(1)}°` };
      },
      M => {  // 行星：只有旗艦打得掉
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
        const p = Game.player, mk = () => ({ type: 'planet', x: p.x + 300, y: p.y, r: 60, r0: 60, hp: 1200, maxHp: 1200, gm: 1 });
        const shoot = (o, boss, n) => {
          Game.objs = [o];
          for (let i = 0; i < n; i++) Game.eBullets.push({ x: o.x - 70, y: o.y, vx: 200, vy: 0, r: 6, dmg: 20, life: 3, from: 't', boss });
          for (let f = 0; f < 30; f++) Game.updateEnemyBullets(1 / 60);
        };
        const a = mk(); shoot(a, false, 10);
        const b = mk(); shoot(b, true, 10); const rb = b.r;
        const c = mk(); shoot(c, true, 60);
        return { ok: a.r === 60 && rb < 60 && rb > 30 && c.dead, got: `一般子彈後半徑 ${a.r}；旗艦 10 發後 ${Math.round(rb)}；60 發後${c.dead ? '崩解' : '還在（' + Math.round(c.r) + '）'}` };
      },
    ])],
    ['地圖物件', '小行星帶', '10 傷害打不動；打爆掉晶體（耐久每 32 一顆），不給晶片成長；小行星後面的敵人看不到；感測器 4 層看得到；敵人不會穿過小行星，從帶子的縫鑽過來追到玩家', M => M.all([
      M => {  // 小行星：重武器才打得動
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
        const o = { type: 'rock', x: 0, y: 0, r: 20, hp: 80, maxHp: 80 };
        Game.objs = [o]; Game.pickups = [];
        Objects.hitRock(o, 10, null, 0, 0); const hp1 = o.hp;
        Objects.hitRock(o, 100, null, 0, 0);
        const drops = Game.pickups.length, want = Math.round(80 / 32);
        return { ok: hp1 === 80 && o.dead && drops === want && !Game.growth.boomerang, got: `小彈後 HP ${hp1}，大彈後${o.dead ? '碎裂' : '還在'}，掉 ${drops} 顆晶體（應為 ${want}），迴旋成長 ${Game.growth.boomerang || 0}（應為 0）` };
      },
      M => {  // 小行星：擋住視野
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const p = Game.player, e = M.targets([[300, 0]])[0];
        Game.objs = [{ type: 'rock', x: p.x + 150, y: p.y, r: 30, hp: 100, maxHp: 100 }];
        const hidden = !!Objects.blocker(p, e);
        Game.parts.sensor = 4; Game.recalc();
        const seen = !Objects.blocker(p, e);
        return { ok: hidden && seen, got: `一般${hidden ? '看不到' : '看得到'}，感測器 4 層${seen ? '看得到' : '看不到'}` };
      },
      M => {  // 小行星帶：敵人繞路鑽縫
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const p = Game.player, e = M.targets([[400, 0]], 'swarmer', false, 1)[0]; e.t = { ...e.t, dmg: 0 };
        Game.objs = [];
        for (let y = -500; y <= 500; y += 50) if (Math.abs(y - 200) > 40) Game.objs.push({ type: 'rock', x: p.x + 200, y: p.y + y, r: 26, hp: 999, maxHp: 999 });
        let inside = false, closest = 1e9;
        for (let f = 0; f < 60 * 8; f++) {
          Game.time += 1 / 60; Objects.update(1 / 60); e.update(1 / 60, p);
          if (Game.objs.some(o => dist2(e.x, e.y, o.x, o.y) < (o.r + e.r - 3) ** 2)) inside = true;
          closest = Math.min(closest, Math.hypot(e.x - p.x, e.y - p.y));
        }
        return { ok: !inside && closest < 40, got: `${inside ? '穿進小行星了' : '沒有穿過小行星'}，最接近玩家 ${Math.round(closest)}` };
      },
    ])],
    ['地圖物件', '黑洞', '把附近的敵人往中心拉（不能動的靶被拉過去），核心吞掉子彈；會走路的敵人繞開黑洞追過來', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[400, 150]], 'brute', true, 60)[0];
      Game.objs = [{ type: 'hole', x: p.x + 400, y: p.y, r: 34, R: 280, tick: 0 }];
      const d0 = Math.hypot(e.x - (p.x + 400), e.y - p.y);
      for (let i = 0; i < 60; i++) Objects.update(1 / 60);
      spawnShots([shot({ angle: 0, speed: 400, damage: 10, life: 3 })], p.x + 300, p.y, 0, 0, null);
      const b = Game.bullets[0];
      for (let i = 0; i < 30; i++) Game.updateBullets(1 / 60);
      const d1 = Math.hypot(e.x - (p.x + 400), e.y - p.y);
      // 黑洞正後方的蟲群追玩家：要繞過去，不能掉進核心
      const hx = p.x + 400, w = new Enemy('swarmer', p.x + 800, p.y, 1);
      w.spawnT = 0; Game.enemies = [w]; p.hp = p.maxHp = 1e6;
      let near = Infinity, t = 0;
      for (; t < 60 * 12 && Math.hypot(w.x - p.x, w.y - p.y) > 120 && !w.dead; t++) {
        Game.time += 1 / 60; Objects.update(1 / 60); Game.updateEnemies(1 / 60);
        near = Math.min(near, Math.hypot(w.x - hx, w.y - p.y));
      }
      const around = !w.dead && Math.hypot(w.x - p.x, w.y - p.y) <= 120 && near > 34 + w.r + 20;
      return { ok: d1 < d0 - 20 && b.dead && around, got: `靶離中心 ${Math.round(d0)} → ${Math.round(d1)}，子彈${b.dead ? '被吞掉' : '還在'}；蟲群最靠近核心 ${Math.round(near)}，${around ? `${(t / 60).toFixed(1)} 秒繞到玩家身邊` : '沒繞過來'}` };
    }],
    ['地圖物件', '黑洞邊不卡住', '敵人在黑洞範圍邊上，要走的方向偏向「決定好要繞的另一邊」：閃避後的方向不能是 0（以前兩股力量剛好抵銷，敵人在範圍邊上進進出出停在原地；2026-10-09 整局模擬卡住那一局的數值）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, hx = p.x + 450, hy = p.y - 200;
      Game.objs = [{ type: 'hole', x: hx, y: hy, r: 34, R: 280, tick: 0 }];
      const e = new Enemy('lurker', hx - 300, hy - 76, 1); e.spawnT = 0; e.holeSide = 1; Game.enemies = [e];
      const [sx, sy] = Objects.steer(e, 0.51, 0.86), d = Math.hypot(e.x - hx, e.y - hy);  // 那一局的尋路方向（玩家在黑洞右下）
      const len = Math.hypot(sx, sy), side = (sx * -(e.y - hy) + sy * (e.x - hx)) / d;  // 繞的分量（照 holeSide 那一邊）
      return { ok: len > 0.5 && side > 0.5, got: `閃避後的方向長度 ${len.toFixed(2)}（要 > 0.5），往繞的那一邊 ${side.toFixed(2)}（要 > 0.5）` };
    }],
    ['地圖物件', '尋路繞開黑洞範圍', '玩家和敵人中間有黑洞：敵人的路線繞在閃避範圍（R + 30）外面（以前路線直接穿過去，走到範圍邊上被推開卡住）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, hx = p.x + 420, hy = p.y, R = 280 + 30;
      Game.objs = [{ type: 'hole', x: hx, y: hy, r: 34, R: 280, tick: 0 }];
      Objects.buildFlow();
      const F = Objects.fields.get(p), C = OBJ.FLOW_CELL, { dist, W, H } = F;
      let c = Math.floor(hy / C) * W + Math.floor((hx + 420) / C), near = Infinity, steps = 0;  // 從黑洞正後方出發，沿步數最少的格子走回玩家
      while (dist[c] > 0 && steps++ < 500) {
        const cx = c % W, cy = Math.floor(c / W); let best = -1;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const x = cx + ox, y = cy + oy, k = y * W + x; if ((ox || oy) && x >= 0 && y >= 0 && x < W && y < H && dist[k] >= 0 && (best < 0 || dist[k] < dist[best])) best = k; }
        if (best < 0 || dist[best] >= dist[c]) break;
        c = best; near = Math.min(near, Math.hypot((c % W + 0.5) * C - hx, (Math.floor(c / W) + 0.5) * C - hy));
      }
      return { ok: dist[c] === 0 && near > R - C, got: `走回玩家 ${dist[c] === 0 ? '有' : '沒有'}，路線離黑洞中心最近 ${Math.round(near)}（要 > ${R - C}）` };
    }],
    ['地圖物件', '彗星', '有預警線；打爆、撞爆都往四周噴 12 片冰晶碎片（命中會冰凍）；被玩家打爆的算那個玩家的「彗星」傷害；撞爆的爆炸會傷玩家、冰凍，不算任何人的', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      Game.objs = [];
      Objects.spawnComet();
      const c = Game.objs[0], warned = c.warn > 0;
      c.warn = 0; c.lastAtt = { src: 'weapon', cr: null, owner: null };
      Objects.breakComet(c);
      const S = Game.bullets, quads = new Set(S.map(b => Math.floor(((b.angle % TAU) + TAU) % TAU / (Math.PI / 2))));
      const brokeOk = S.length === OBJ.COMET_SHARDS && quads.size === 4 && S.every(b => b.att.src === 'comet' && !b.att.nobody && b.slow > 0);
      // 撞爆：飛船、敵人都在範圍內
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const P = Game.player, e = M.targets([[60, 0]], 'brute', true, 1)[0]; P.iframe = 0; P.frostT = 0;
      const hp0 = P.hp, ehp = e.hp, dmg0 = Game.totalDmg();
      const o = { type: 'comet', id: 998, x: P.x + 30, y: P.y, vx: 0, vy: 0, r: 18, hp: 60, maxHp: 60, warn: 0, hits: new Set(), age: 2, lastAtt: { src: 'weapon', cr: null, owner: null } };
      Game.objs = [o]; Objects.cometBoom(o, 100, 40);
      const crashOk = P.hp < hp0 && P.frostT > 0 && e.hp < ehp && e.slowT > 0 && Game.totalDmg() === dmg0 && Game.bullets.length === OBJ.COMET_SHARDS && Game.bullets.every(b => b.att.nobody);
      return { ok: warned && brokeOk && crashOk, got: `預警${warned ? '有' : '沒有'}；打爆：碎片 ${S.length} 片、涵蓋 ${quads.size}/4 個方向、${brokeOk ? '算玩家的彗星傷害、會冰凍' : '歸屬或冰凍不對'}；撞爆：飛船扣 ${Math.round(hp0 - P.hp)}、凍 ${(P.frostT || 0).toFixed(1)} 秒，敵人扣 ${Math.round(ehp - e.hp)}、減速 ${e.slowT > 0 ? '有' : '沒有'}，傷害統計 +${Math.round(Game.totalDmg() - dmg0)}（應為 0），碎片 ${Game.bullets.length} 片` };
    }],

    ['敵人', '精英：衝鋒與環形彈幕', '會蓄力衝鋒，也會連放兩圈 20 發環形彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const e = M.targets([[400, 0]], 'elite', false, 1)[0]; e.t = { ...e.t, dmg: 0 };
      let charged = false, maxShots = 0;
      for (let i = 0; i < 60 * 8; i++) {
        e.update(1 / 60, Game.player);
        if (e.mode === 'charge') charged = true;
        maxShots = Math.max(maxShots, Game.eBullets.length);
      }
      return { ok: charged && maxShots >= 40, got: `衝鋒${charged ? '有' : '沒有'}發生，彈幕最多 ${maxShots} 發` };
    }],
    ['敵人', '裂界獵艦：衝鋒與狙擊', '會預警後衝鋒並灑彈，暴走後會部署噴吐者', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const b = M.targets([[400, 0]], 'boss2', false, 1)[0]; b.t = { ...b.t, dmg: 0 };
      b.hp = b.maxHp * 0.45;
      let windup = false, charged = false, maxShots = 0;
      b.forceSkill = 'charge';  // 出招是隨機的：先指定衝鋒，7 秒後指定部署
      for (let i = 0; i < 60 * 14; i++) {
        if (i === 60 * 7) b.forceSkill = 'deploy';
        b.update(1 / 60, Game.player);
        if (b.mode === 'windup') windup = true;
        if (b.mode === 'charge') charged = true;
        maxShots = Math.max(maxShots, Game.eBullets.length);
      }
      const minions = Game.enemies.filter(e => e.type === 'spitter').length;
      return { ok: windup && charged && maxShots > 0 && b.enraged && minions > 0,
        got: `預警${windup ? '有' : '沒有'}、衝鋒${charged ? '有' : '沒有'}，彈幕最多 ${maxShots} 發，${b.enraged ? '已暴走' : '沒有暴走'}，部署 ${minions} 隻噴吐者` };
    }],
    ['敵人', '王出招', '加權隨機、不連續用同一招；玩家離得遠時瞄準型（扇形）比較多，貼近時範圍型（螺旋、環形）比較多', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const b = M.targets([[400, 0]], 'boss', false, 1)[0];
      const roll = d => { const n = {}; let rep = 0, last = null; for (let i = 0; i < 400; i++) { const k = b.pickSkill(d); if (k === last) rep++; b.skill = last = k; n[k] = (n[k] || 0) + 1; } return { n, rep }; };
      const far = roll(600), near = roll(200);
      return { ok: far.rep === 0 && near.rep === 0 && Object.keys(far.n).length === 4 && far.n.fan > near.n.fan && near.n.spiral + near.n.ring > far.n.spiral + far.n.ring,
        got: `連續同一招 ${far.rep + near.rep} 次；遠（600）扇形 ${far.n.fan}、螺旋＋環形 ${far.n.spiral + far.n.ring}；近（200）扇形 ${near.n.fan}、螺旋＋環形 ${near.n.spiral + near.n.ring}（各 400 次）` };
    }],
    ['敵人', '終焉核心：缺口環形波與護衛', '環形波留有缺口，會召喚刺殼', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const b = M.targets([[400, 0]], 'boss3', false, 1)[0]; b.t = { ...b.t, dmg: 0 };
      b.skillCd = 0; b.forceSkill = 'nova';
      b.update(1 / 60, Game.player);  // 指定第一招：缺口環形波（第一圈立刻發射；出招改成隨機之後要指定）
      b.update(1 / 60, Game.player);
      const first = Game.eBullets.length;
      b.forceSkill = 'guard'; b.skillCd = 0;  // 出招是隨機的：指定下一招叫護衛
      for (let i = 0; i < 60 * 16; i++) b.update(1 / 60, Game.player);
      const brutes = Game.enemies.filter(e => e.type === 'brute').length;
      return { ok: first > 0 && first < 32 && brutes > 0, got: `第一圈 ${first} 發（滿圈 32），召喚 ${brutes} 隻刺殼` };
    }],
    ['敵人', '終焉核心：落點轟炸', '在最近的玩家身邊標 4 個紅圈（暴走 6 個，其中一個在腳下），1.2 秒後爆炸，圈裡的飛船受 25 傷害；圈外不受傷', M => {
      const go = (rage, stay) => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const b = M.targets([[400, 0]], 'boss3', false, 1)[0]; b.t = { ...b.t, dmg: 0 };
        if (rage) b.hp = b.maxHp * 0.4;
        b.forceSkill = 'bomb'; b.skillCd = 0; b.mode = 'chase';
        Game.zones = []; Game.eBullets = [];
        const p = Game.player; p.iframe = 0; p.hp = p.maxHp; const hp0 = p.hp;
        b.update(1 / 60, p);
        const n = Game.zones.length, under = Game.zones.some(z => Math.hypot(z.x - p.x, z.y - p.y) < z.r);
        if (!stay) { p.x = 200; p.y = 200; }  // 跑開
        for (let f = 0; f < 80; f++) { Game.eBullets = []; Game.updateZones(1 / 60); }
        return { n, under, lost: hp0 - p.hp, left: Game.zones.length };
      };
      const a = go(false, true), r = go(true, true), away = go(false, false);
      return { ok: a.n === 4 && r.n === 6 && a.under && a.lost > 0 && away.lost === 0 && a.left === 0,
        got: `標 ${a.n} 個（暴走 ${r.n} 個）${a.under ? '、有一個在腳下' : '、腳下沒有（錯誤）'}；站著不動扣 ${Math.round(a.lost)}，跑開扣 ${Math.round(away.lost)}` };
    }],
    ['敵人', '刺殼：縮球滾過來', '靠近時縮球（有預警）→ 高速滾向玩家 → 暈眩', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const e = M.targets([[300, 0]], 'brute', false, 1)[0]; e.t = { ...e.t, dmg: 0 };
      const seen = new Set(); let maxSpd = 0, closest = 1e9;
      for (let i = 0; i < 60 * 4; i++) {
        e.update(1 / 60, Game.player);
        seen.add(e.mode);
        maxSpd = Math.max(maxSpd, Math.hypot(e.vx, e.vy));
        closest = Math.min(closest, Math.hypot(e.x - Game.player.x, e.y - Game.player.y));
      }
      return { ok: seen.has('windup') && seen.has('charge') && seen.has('stun') && maxSpd > 400 && closest < 60,
        got: `經過：${[...seen].join(' → ')}，最高速度 ${Math.round(maxSpd)}，最接近玩家 ${Math.round(closest)}` };
    }],
    ['敵人', '彈幕艇', '停在遠處，閃 0.6 秒後放一圈 8 發慢速彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[470, 0]], 'gunboat', false, 1)[0]; e.cd = 0.1;
      let wind = false;
      for (let f = 0; f < 90; f++) { Game.time += 1 / 60; e.update(1 / 60, p); if (e.mode === 'windup') wind = true; }
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      return { ok: wind && Game.eBullets.length === 8 && d > 380, got: (wind ? '有預警' : '沒預警') + '，放了 ' + Game.eBullets.length + ' 發，距離 ' + Math.round(d) };
    }],
    ['敵人', '列隊蟲', '6 節排成一列跟著走；頭被打死，下一節變成頭', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, W = [];
      for (let i = 0; i < 6; i++) { const w = new Enemy('worm', p.x + 600 + i * 22, p.y, 1); w.spawnT = 0; w.t = { ...w.t, dmg: 0 }; w.ahead = W[i - 1] || null; W.push(w); }
      Game.enemies = W.slice();
      for (let f = 0; f < 120; f++) { Game.time += 1 / 60; for (const w of W) w.update(1 / 60, p); }
      const gap = Math.max(...W.slice(1).map((w, i) => Math.hypot(w.x - W[i].x, w.y - W[i].y)));
      W[0].dead = true; W[1].update(1 / 60, p);
      return { ok: gap < 40 && W[1].ahead === null, got: '最大間距 ' + Math.round(gap) + '；頭死後第 2 節' + (W[1].ahead === null ? '變成頭' : '還在跟') };
    }],
    ['敵人', '盾衛', '打到盾（朝固定方向）的子彈反彈回去變成敵彈，不扣血；從背面打照常受傷', M => {
      const shoot = ang => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const e = M.targets([[150, 0]], 'shield', true, 1)[0]; e.shieldA = ang; const hp = e.hp;
        M.run(10);
        return { dmg: hp - e.hp, eb: Game.eBullets.length };
      };
      const front = shoot(Math.PI), back = shoot(0);
      // 擦到盾的外緣（沒碰到身體，離中心 r + 9）也要反彈
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const g = M.targets([[150, 0]], 'shield', true, 1)[0]; g.shieldA = Math.PI;
      const off = g.r + 9, b = new Bullet(g.x - 120, g.y + off, 0, shot({ angle: 0, speed: 900, damage: 10, radius: 3, life: 1 }), 0, null);
      Game.bullets = [b];
      for (let f = 0; f < 20 && !b.dead; f++) Game.updateBullets(1 / 60);
      const edge = Game.eBullets.length;
      return { ok: front.dmg === 0 && front.eb > 0 && back.dmg > 0 && back.eb === 0 && edge > 0, got: '正面：扣 ' + Math.round(front.dmg) + '、反彈 ' + front.eb + ' 發；背面：扣 ' + Math.round(back.dmg) + '、反彈 ' + back.eb + ' 發；擦到盾外緣：反彈 ' + edge + ' 發' };
    }],
    ['敵人', '盾衛的盾是實心的', '飛船撞到盾（盾那一側）會被推到盾外、往外彈開並受撞擊傷害；背面同樣距離沒事', M => {
      const bump = ang => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const p = Game.player, e = M.targets([[150, 0]], 'shield', true, 1)[0]; e.shieldA = ang; e.t = { ...e.t, dmg: ENEMY_TYPES.shield.dmg };
        p.x = e.x - (e.r + p.r + 6); p.y = e.y; p.iframe = 0; p.vx = p.vy = 0; const hp = p.hp;
        Game.updateEnemies(1 / 60);
        return { dmg: hp - p.hp, d: Math.hypot(p.x - e.x, p.y - e.y), R: e.r + SHIELD_OUT + p.r, out: -p.vx };  // 盾朝左：往外 = 往左
      };
      const front = bump(Math.PI), back = bump(0);
      return { ok: front.dmg > 0 && front.d >= front.R - 0.5 && front.out > 300 && back.dmg === 0 && back.d < back.R - 1, got: '盾那側：扣 ' + Math.round(front.dmg) + '、推到 ' + Math.round(front.d) + '（盾外緣 ' + front.R + '）、往外彈 ' + Math.round(front.out) + '；背面：扣 ' + Math.round(back.dmg) + '、距離 ' + Math.round(back.d) };
    }],
    ['敵人', '分裂體', '死掉時分成 3 隻碎裂體', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const e = M.targets([[150, 0]], 'splitter', true, 1)[0];
      e.hurt(9999, 0, 0, 'direct', null);
      const n = Game.enemies.filter(q => q.type === 'splitling').length;
      return { ok: n === 3, got: '分出 ' + n + ' 隻' };
    }],
    ['敵人', '潛伏者', '隱形接近（自動瞄準、追蹤看不到），離 140 內現形、預警後撲過去，之後現形 2 秒', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[400, 0]], 'lurker', false, 1)[0]; e.t = { ...e.t, dmg: 0 };
      const hidden = e.cloak >= 1 && !nearestEnemy(p.x, p.y, 900, null, true);
      const seen = new Set();
      for (let f = 0; f < 60 * 5; f++) { Game.time += 1 / 60; e.update(1 / 60, p); seen.add(e.mode); }
      return { ok: hidden && seen.has('windup') && seen.has('charge') && seen.has('shown'), got: (hidden ? '一開始隱形、自動瞄準找不到' : '一開始就看得到') + '；經過 ' + [...seen].join(' → ') };
    }],
    ['敵人', '母巢', '每 4 秒生 2 隻蟲群，最多 8 隻；生出來的不給晶片成長', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'rear', null, null]);
      const p = Game.player, h = M.targets([[300, 0]], 'hive', true, 1)[0]; h.cd = 0.05;
      for (let f = 0; f < 60 * 30; f++) { Game.time += 1 / 60; h.update(1 / 60, p); }
      const kids = Game.enemies.filter(q => q.type === 'swarmer' && !q.dead), k = kids[0];
      Game.growth = {}; Game.tagGrow(k, null, 'rear'); k.hurt(9999, 0, 0, 'direct', null);
      return { ok: kids.length === 8 && !(Game.growth.rear > 0), got: '生了 ' + kids.length + ' 隻；打死一隻成長 +' + (Game.growth.rear || 0) };
    }],
    ['敵人', '主題小兵隨進度增加', '第 1 星區前半 0～1 種、第 3 星區 2～3 種；母巢第 3 星區才出現', M => {
      const avg = (s, late) => { let n = 0, hive = 0; for (let i = 0; i < 200; i++) { const T = Game.pickThemes(s, late); n += T.list.length; if (T.list.includes('hive')) hive++; } return [n / 200, hive]; };
      const [a1, h1] = avg(1, false), [a2] = avg(2, false), [a3, h3] = avg(3, false);
      return { ok: a1 <= 1 && a2 >= 1 && a3 >= 2 && h1 === 0 && h3 > 0, got: '平均幾種：星區 1 ' + a1.toFixed(1) + '、星區 2 ' + a2.toFixed(1) + '、星區 3 ' + a3.toFixed(1) + '；母巢出現：星區 1 ' + h1 + ' 次、星區 3 ' + h3 + ' 次' };
    }],
    ['敵人', '推王（抗擊退）', '攻城砲（擊退 4）推得動星噬母艦（抗 1.5），雷射（0.6）推不動', M => {
      const push = (weapon, path) => {
        M.setup('sandbox', 'vanguard', weapon, path, null, ['weapon', null, null, null]);
        const b = M.targets([[200, 0]], 'boss', true, 50)[0], x0 = b.x;
        b.update = function () { this.move(1 / 60); this.vx *= 0.95; this.vy *= 0.95; };  // 只看被推的位移，不讓王自己移動
        M.run(60);
        return b.x - x0;
      };
      const siege = push('railgun', 'B'), laser = push('laser', null);
      return { ok: siege > 20 && Math.abs(laser) < 1, got: `攻城砲推了 ${Math.round(siege)} px，雷射推了 ${Math.round(laser)} px` };
    }],
    ['敵人', 'Boss：暴走與召喚', '血量低於一半暴走，會召喚蟲群', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const b = M.targets([[400, 0]], 'boss', false, 1)[0]; b.t = { ...b.t, dmg: 0 };
      b.hp = b.maxHp * 0.45;
      b.forceSkill = 'summon';  // 出招是隨機的：指定召喚
      for (let i = 0; i < 60 * 12; i++) b.update(1 / 60, Game.player);
      const minions = Game.enemies.filter(e => e.type === 'swarmer').length;
      return { ok: b.enraged && minions > 0, got: `${b.enraged ? '已暴走' : '沒有暴走'}，召喚 ${minions} 隻蟲群` };
    }],
  ],

  // ---------- 執行：存檔 → 逐項檢查 → 還原 ----------
  runAll() {
    const saved = {};
    for (const k of Object.keys(Game)) if (typeof Game[k] !== 'function') saved[k] = Game[k];
    const savedWeaponChip = { ...CHIPS.weapon }, savedMuted = SFX.muted, savedArena = { ...Arena };
    SFX.muted = true;
    const results = [];
    const t0 = performance.now();
    this.running = true;
    for (const [group, name, expect, fn] of this.CASES) {
      let r;
      try { r = fn(this); } catch (err) { r = { ok: false, got: '執行錯誤：' + err.message }; }
      results.push({ group, name, expect, ok: !!r.ok, got: r.got });
    }
    this.running = false;
    Object.assign(Game, saved);
    Object.assign(CHIPS.weapon, savedWeaponChip);
    Object.assign(Arena, savedArena);
    SFX.muted = savedMuted;
    this.results = { list: results, ms: performance.now() - t0, at: new Date() };
    Game.restoreScreen();
    return this.results;
  },
};
const near1 = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.02);

// =====================================================================
// 插座檢查（機制檢查用）：每個晶片 × 分裂／穿甲／倍增／巨彈，實際跑一遍，確認組件的效果出現在那個晶片的產物上；
//   武器、觸發器插座的傷害加成只算直擊。mp_tests 的 sockcheck.js 也用這裡印總表
// =====================================================================
const SockCheck = {
  COMPS: ['amp', 'split', 'pierce', 'bigshot', 'mirror', 'blast', 'ignite', 'frost', 'shock', 'shred'],
  // 元素組件：子彈身上的命中效果有沒有變多（爆炸傷害、燃燒、減速、電弧道數）
  EL: { blast: b => (b.explode ? b.explode.ratio : 0), ignite: b => b.burnR || 0, frost: b => b.slow || 0, shock: b => (b.arcs ? b.arcs.n : 0), shred: b => b.shred || 0 },
  elUp(c, a, b) { const g = this.EL[c]; return !!(a && b) && g(b) > g(a) + 0.05; },
  fires: [],
  setup(weapon, flat, targets = [], type = 'brute', hp = 60) {
    MechCheck.setup('sandbox', 'vanguard', weapon, null, null, flat);
    MechCheck.targets(targets, type, true, hp);
    this.fires = [];
  },
  step(n, fire = false) {
    const dt = 1 / 60;
    let cd = 0;
    for (let f = 0; f < n; f++) {
      Game.time += dt; cd -= dt;
      if (fire && cd <= 0) { Game.player.fire(); cd = Game.stats.interval; }
      Game.updateEnemies(dt);
      Game.updateBullets(dt);
    }
  },
  range() { const w = Game.wp; return w.speed * w.life; },  // 這把武器的射程
  // 包住 hostFire：記下產物出現時，套用前後子彈的變化
  watch(fn) {
    const orig = window.hostFire, self = this;
    window.hostFire = (b, base) => {
      const comps = b.hm && b.hm[base];
      if (!comps) return orig(b, base);
      const before = { hb: b.hb || 0, pierce: b.pierce, r: b.r, n: Game.bullets.length, el: { ...b } };
      orig(b, base);
      self.fires.push({ base, before, after: { hb: b.hb || 0, pierce: b.pierce, r: b.r, n: Game.bullets.length, el: { ...b } } });
    };
    try { fn(); } finally { window.hostFire = orig; }
  },
  spawned(src, fn) {  // 跑 fn 的時候，記下某個來源射出的子彈
    const got = [], orig = window.spawnShots;
    window.spawnShots = (list, ...rest) => { for (const s of list) if (s.src === src) got.push(s); return orig(list, ...rest); };
    try { fn(); } finally { window.spawnShots = orig; }
    return got;
  },
  hurtLog(type, fn) {  // 跑 fn 的時候，記下每隻敵人受到某種傷害（explode、echo…）
    const log = [];
    Game.enemies.forEach((e, i) => { const h = e.hurt.bind(e); e.hurt = (d, ...r) => { if (!type || r[2] === type) log.push({ i, d, t: r[2] }); return h(d, ...r); }; });
    fn();
    return log;
  },
  // 產物在事件時才出現的晶片：跑一個會觸發那個事件的場景
  RUNTIME: {
    boomerang: (S, w, c) => { S.setup(w, ['weapon', 'boomerang', c]); S.targets([[Math.min(150, S.range() * 0.6), 0]]); S.watch(() => S.step(60, true)); },
    orbit: (S, w, c) => { S.setup(w, ['weapon', 'orbit', c]); S.watch(() => { Game.player.wantFire = true; S.step(30, true); Game.player.wantFire = false; S.step(5); }); },
    stasis: (S, w, c) => { S.setup(w, ['weapon', 'stasis', c]); S.targets([[S.range() * 0.5 + 40, 0]]); S.watch(() => { Game.player.fire(); S.step(150); }); },
    accel: (S, w, c) => { S.setup(w, ['weapon', 'accel', c]); S.watch(() => { Game.player.fire(); S.step(90); }); },
    wallbounce: (S, w, c) => { S.setup(w, ['weapon', 'wallbounce', c]); Game.player.x = CFG.WORLD_W - S.range() * 0.4; S.watch(() => { Game.player.fire(); S.step(90); }); },
  },
  targets(list) { MechCheck.targets(list, 'brute', true, 60); },
  effectOk(c, x) { return SockCheck.EL[c] ? SockCheck.elUp(c, x.before.el, x.after.el) : c === 'mirror' ? x.after.n - x.before.n >= 1 : c === 'amp' ? x.after.hb - x.before.hb > 0.9 : c === 'split' ? x.after.n - x.before.n >= 2
    : c === 'pierce' ? x.after.pierce - x.before.pierce >= 2 : x.after.r > x.before.r * 1.3; },
  // 開火當下就出現的產物：同一個電路有沒有插組件，比較產物和其他子彈
  shots(mode, charge, stand) { Game.fireMode = mode; Game.chargeC = charge; Game.standFull = !!stand; try { return runOps(Game.stats.ops, 0); } finally { Game.fireMode = null; Game.chargeC = null; Game.standFull = false; } },
  launch(w, host, c) {
    const grab = flat => {
      this.setup(w, flat);
      if (host === 'rear') { const L = this.shots(null, 0); return { prod: L.filter(b => b.rear), other: L.filter(b => !b.rear) }; }
      if (host === 'charge') return { prod: this.shots(null, 1), other: this.shots(null, 0) };
      if (host === 'dashfire') return { prod: this.shots('dashfire', 0), other: this.shots(null, 0) };
      if (host === 'stand') return { prod: this.shots(null, 0, 1), other: this.shots(null, 0) };  // 架設：滿層時射出的
      if (host === 'intercept') return { prod: this.shots('intercept', 0), other: this.shots(null, 0) };
      return { prod: this.shots(null, 0), other: [] };  // 疾射：出手就是高速段
    };
    const A = grab(['weapon', host]), B = grab(['weapon', host, c]);
    const avg = (L, k) => L.length ? L.reduce((a, b) => a + (b[k] || 0), 0) / L.length : 0;
    const ok = this.EL[c] ? this.elUp(c, A.prod[0], B.prod[0]) && (!B.other.length || !this.elUp(c, A.other[0], B.other[0])) : c === 'mirror' ? B.prod.length === 2 * A.prod.length && B.other.length === A.other.length : c === 'amp' ? avg(B.prod, 'hb') > 0.9 && avg(B.other, 'hb') === 0 : c === 'split' ? B.prod.length === 3 * A.prod.length && B.other.length === A.other.length
      : c === 'pierce' ? B.prod[0].pierce - A.prod[0].pierce >= 2 : B.prod[0].radius > A.prod[0].radius * 1.3;
    return { ok, got: `產物 ${A.prod.length} → ${B.prod.length} 發（加成 ${avg(B.prod, 'hb').toFixed(1)}、穿透 ${A.prod[0].pierce}→${B.prod[0].pierce}、半徑 ${A.prod[0].radius.toFixed(1)}→${B.prod[0].radius.toFixed(1)}）；其他子彈 ${B.other.length} 發（加成 ${avg(B.other, 'hb').toFixed(1)}）` };
  },
  sticky(w, c) {  // 黏著：爆炸是產物
    const run = flat => {
      this.setup(w, flat);
      const d = Math.min(150, this.range() * 0.6);
      this.targets([[d, 0], [d, 70]]);
      let spawned = [];
      const all = this.hurtLog(null, () => { spawned = this.spawned('sticky', () => { Game.player.fire(); this.step(150); }); });
      const e0 = Game.enemies[0];
      return { log: all.filter(x => x.t === 'explode'), arcs: all.filter(x => x.t === 'arc').length, burn: !!(e0 && e0.burnT > 0), slow: !!(e0 && e0.slowT > 0), shred: !!(e0 && e0.shredT > 0), spawned, pierce: runOps(Game.stats.ops, 0)[0].pierce };
    };
    const A = run(['weapon', 'sticky']), B = run(['weapon', 'sticky', c]);
    const ex = r => r.log.filter(x => x.i === 0).reduce((a, x) => a + x.d, 0), side = r => r.log.filter(x => x.i === 1).length;
    const ok = c === 'blast' ? B.log.length > A.log.length : c === 'ignite' ? B.burn && !A.burn : c === 'frost' ? B.slow && !A.slow : c === 'shock' ? B.arcs > A.arcs : c === 'shred' ? B.shred && !A.shred
      : c === 'amp' || c === 'mirror' ? ex(B) > ex(A) * 1.8 : c === 'split' ? B.spawned.length >= 3 : c === 'pierce' ? B.pierce - A.pierce >= 2 : side(B) > side(A);
    return { ok, got: `爆炸 ${A.log.length}→${B.log.length} 下、燃燒 ${B.burn}、減速 ${B.slow}、電弧 ${A.arcs}→${B.arcs}；爆炸 ${ex(A).toFixed(1)} → ${ex(B).toFixed(1)}、碎片 ${B.spawned.length}、穿透 ${A.pierce}→${B.pierce}、波及 ${side(A)}→${side(B)}` };
  },
  infect(w, c) {  // 感染：爆出來的子彈是產物
    const run = flat => {
      this.setup(w, flat);
      MechCheck.targets([[Math.min(150, this.range() * 0.6), 0]], 'swarmer', true, 0.01);
      return this.spawned('infect', () => { Game.player.fire(); this.step(40); });
    };
    const A = run(['weapon', 'infect']), B = run(['weapon', 'infect', c]);
    const hb = L => L.length ? L.reduce((x, s) => x + (s.hb || 0), 0) / L.length : 0;
    const ok = !!A.length && !!B.length && (this.EL[c] ? this.elUp(c, A[0], B[0]) : c === 'mirror' ? B.length >= A.length * 2 : c === 'amp' ? hb(B) > 0.9 : c === 'split' ? B.length >= A.length * 3
      : c === 'pierce' ? B[0].pierce - A[0].pierce >= 2 : B[0].radius > A[0].radius * 1.3);
    return { ok, got: `爆出 ${A.length} → ${B.length} 發、加成 ${hb(B).toFixed(1)}、穿透 ${A[0] ? A[0].pierce : '-'}→${B[0] ? B[0].pierce : '-'}` };
  },
  pull(w, c) {  // 吸引：只能插巨彈（範圍 ×1.5）
    this.setup(w, ['weapon', 'pull', c]);
    const I = Game.stats.info.socks[1][0], L = runOps(Game.stats.ops, 0);
    return { ok: c === 'bigshot' ? !I.idle && L[0].pullMul > 1.4 : I.idle, got: c === 'bigshot' ? `拉力範圍 ×${L[0].pullMul}` : I.idle ? `沒作用（${I.why}）` : '有作用（錯誤）' };
  },
  trig(w, host, c) {  // 觸發器：插座上的組件作用在回響上，不作用在開火的子彈
    const run = flat => { this.setup(w, flat); const top = runOps(Game.stats.ops, 0), P = top[0].payload; return { top, echo: P ? runOps(P, 1) : [] }; };
    const A = run(['weapon', host]), B = run(['weapon', host, c]);
    const ok = B.top.length === A.top.length && !(B.top[0].bonus > 0) && B.echo.length > 0 && (this.EL[c] ? this.elUp(c, A.echo[0], B.echo[0]) && !this.elUp(c, A.top[0], B.top[0]) : c === 'mirror' ? B.echo.length === 2 * A.echo.length : c === 'amp' ? B.echo[0].bonus > 0.9
      : c === 'split' ? B.echo.length === 3 * A.echo.length : c === 'pierce' ? B.echo[0].pierce - A.echo[0].pierce >= 2 : B.echo[0].radius > A.echo[0].radius * 1.3);
    return { ok, got: `開火 ${B.top.length} 發；回響 ${A.echo.length} → ${B.echo.length} 發（加成 ${(B.echo[0] && B.echo[0].bonus || 0).toFixed(1)}、穿透 ${A.echo[0] ? A.echo[0].pierce : '-'}→${B.echo[0] ? B.echo[0].pierce : '-'}）` };
  },
  weapon(w, c) {
    const run = flat => { this.setup(w, flat); return runOps(Game.stats.ops, 0); };
    const A = run(['weapon']), B = run(['weapon', c]);
    const ok = this.EL[c] ? this.elUp(c, A[0], B[0]) : c === 'mirror' ? B.length === 2 * A.length : c === 'amp' ? B[0].bonus > 0.9 : c === 'split' ? B.length === 3 * A.length : c === 'pierce' ? B[0].pierce - A[0].pierce >= 2 : B[0].radius > A[0].radius * 1.3;
    return { ok, got: `${A.length} → ${B.length} 發、加成 ${(B[0].bonus || 0).toFixed(1)}、穿透 ${A[0].pierce}→${B[0].pierce}、半徑 ${A[0].radius.toFixed(1)}→${B[0].radius.toFixed(1)}` };
  },
  // 一把武器的完整表：每個晶片（武器、玩法晶片、觸發器）× 4 個組件
  rows(w) {
    const out = [];
    for (const h of ['weapon', ...NORMAL_IDS.filter(id => isHost(id))]) for (const c of this.COMPS) {
      let r;
      try {
        if (h === 'weapon') r = this.weapon(w, c);
        else if (CHIPS[h].type === 'trigger') r = this.trig(w, h, c);
        else if (this.RUNTIME[h]) {
          this.RUNTIME[h](this, w, c);
          const xs = this.fires.filter(x => x.base === h), x = xs.find(x => this.effectOk(c, x));
          const d = x || xs[0];
          r = { ok: !!x, got: d ? `產物出現 ${xs.length} 次：加成 ${d.before.hb.toFixed(1)}→${d.after.hb.toFixed(1)}、子彈 +${d.after.n - d.before.n}、穿透 ${d.before.pierce}→${d.after.pierce}、半徑 ${d.before.r.toFixed(1)}→${d.after.r.toFixed(1)}` : '產物沒有出現' };
        } else if (h === 'sticky') r = this.sticky(w, c);
        else if (h === 'infect') r = this.infect(w, c);
        else if (h === 'pull') r = this.pull(w, c);
        else r = this.launch(w, h, c);
      } catch (e) { r = { ok: false, got: '執行錯誤：' + e.message }; }
      out.push({ h, c, ...r });
    }
    // 疾射：掉到 1.5 倍速以下，插在疾射上的傷害加成拿掉
    try {
      this.setup(w, ['weapon', 'quick', 'amp']);
      Game.player.fire();
      const b = Game.bullets[0], hb0 = b.hb;
      this.step(90);
      out.push({ h: 'quick', c: 'amp', note: '減速後', ok: hb0 > 0.9 && b.hb < 0.1 && b.accelMul < 1.5, got: `出手加成 ${hb0.toFixed(1)}，速度掉到 ${b.accelMul.toFixed(2)} 倍後 ${b.hb.toFixed(1)}` });
    } catch (e) { out.push({ h: 'quick', c: 'amp', note: '減速後', ok: false, got: '執行錯誤：' + e.message }); }
    return out;
  },
  // 武器（和觸發器）插座上的倍增：傷害加成只算直擊，產物不吃
  direct() {
    const out = [], P = () => Game.player;
    const check = (name, fn) => { let r; try { r = fn(); } catch (e) { r = { ok: false, got: '執行錯誤：' + e.message }; } out.push({ h: name, ...r }); };
    check('迴旋', () => { this.setup('laser', ['weapon', 'amp', 'boomerang']); this.targets([[150, 0]]); const H = this.hurtLog(null, () => { P().fire(); this.step(60); }).map(x => Math.round(x.d));
      return { ok: H.includes(14) && H.includes(7), got: `去程／回程 ${[...new Set(H)].join('、')}（應有 14 和 7）` }; });
    const after = (name, flat, run, pick) => check(name, () => { this.setup('laser', flat); run(); const b = Game.bullets.find(pick);
      return { ok: !!b && Math.abs(b.bonus) < 0.01, got: b ? `產物的武器加成 ${b.bonus.toFixed(2)}` : '找不到產物' }; });
    after('環繞', ['weapon', 'amp', 'orbit'], () => { P().wantFire = true; this.step(20, true); P().wantFire = false; this.step(3); }, b => b.orbShot);
    after('加速', ['weapon', 'amp', 'accel'], () => { P().fire(); this.step(40); }, b => b.accelMul >= 1.5);
    after('牆反彈', ['weapon', 'amp', 'wallbounce'], () => { P().x = CFG.WORLD_W - 60; P().fire(); this.step(20); }, b => b.bounced);
    check('疾射', () => { this.setup('laser', ['weapon', 'amp', 'quick']); P().fire(); const b = Game.bullets[0], b0 = b.bonus; this.step(45);
      return { ok: Math.abs(b0) < 0.01 && b.bonus > 0.9, got: `出手（3 倍速）${b0.toFixed(2)} → 減速後 ${b.bonus.toFixed(2)}` }; });
    check('反向', () => { this.setup('laser', ['weapon', 'amp', 'rear']); const L = runOps(Game.stats.ops, 0), f = L.find(b => !b.rear), r = L.find(b => b.rear);
      return { ok: f.bonus > 0.9 && Math.abs(r.bonus) < 0.01, got: `往前 ${f.bonus.toFixed(2)}、往後 ${r.bonus.toFixed(2)}` }; });
    check('蓄力', () => { this.setup('laser', ['weapon', 'amp', 'charge']); const L = this.shots(null, 1);
      return { ok: Math.abs(L[0].bonus - 4) < 0.01, got: `蓄滿那發 ${L[0].bonus.toFixed(2)}（只有蓄力 +4）` }; });
    check('衝刺射擊', () => { this.setup('laser', ['weapon', 'amp', 'dashfire']); const L = this.shots('dashfire', 0);
      return { ok: Math.abs(L[0].bonus - 0.5) < 0.01, got: `衝刺那一槍 ${L[0].bonus.toFixed(2)}（只有衝刺 +0.5）` }; });
    check('攔截', () => { this.setup('laser', ['weapon', 'amp', 'intercept']); const L = this.shots('intercept', 0);
      return { ok: Math.abs(L[0].bonus) < 0.01, got: `回射 ${L[0].bonus.toFixed(2)}` }; });
    check('黏著', () => { const ex = flat => { this.setup('laser', flat); this.targets([[150, 0]]); return this.hurtLog('explode', () => { P().fire(); this.step(150); }).reduce((a, x) => a + x.d, 0); };
      const a = ex(['weapon', 'sticky']), b = ex(['weapon', 'amp', 'sticky']);
      return { ok: a > 0 && Math.abs(a - b) < 0.01, got: `爆炸：沒倍增 ${a.toFixed(1)}、武器插倍增 ${b.toFixed(1)}（應一樣）` }; });
    check('感染', () => { this.setup('laser', ['weapon', 'amp', 'infect']); MechCheck.targets([[150, 0]], 'swarmer', true, 0.01);
      const got = this.spawned('infect', () => { P().fire(); this.step(30); });
      return { ok: got.length > 0 && Math.abs(got[0].bonus) < 0.01, got: got.length ? `爆出的子彈 ${got[0].bonus.toFixed(2)}` : '沒有爆出' }; });
    // 進化複製出來的子彈：也只算直擊，插在宿主上的組件每一發都套用
    const evoSplit = (name, flat, pre, pick, want) => check(name, () => { this.setup('laser', flat); pre();
      for (let f = 0; f < 90 && !Game.bullets.some(pick); f++) this.step(1);
      const L = Game.bullets.filter(pick), bad = L.filter(b => Math.abs(b.bonus) > 0.01);
      return { ok: L.length === want && !bad.length, got: `產物 ${L.length} 發（應為 ${want}），吃到武器加成的 ${bad.length} 發` }; });
    evoSplit('迴旋風暴＋分裂', ['weapon', 'amp', chipId('boomerang', 3, 1), 'split'], () => { this.targets([[150, 0]]); P().fire(); }, b => b.mode === 'return', 9);
    evoSplit('稜鏡＋分裂', ['weapon', 'amp', chipId('wallbounce', 3, 1), 'split'], () => { P().x = CFG.WORLD_W - 60; P().fire(); }, b => b.bounced, 6);
    check('觸發器（回響的迴旋）', () => { this.setup('laser', ['weapon', 'trigger', 'amp', 'boomerang']); this.targets([[120, 0], [320, 0]]);
      const H = this.hurtLog('echo', () => { P().fire(); this.step(180); }).map(x => +x.d.toFixed(1));
      return { ok: H.some(d => Math.abs(d - 7) < 0.05) && H.some(d => Math.abs(d - 3.5) < 0.05), got: `回響 ${[...new Set(H)].join('、')}（去程 7，回程不吃觸發器上的倍增 3.5）` }; });
    return out;
  },
  // 機制檢查的一項：全部過才算過，沒過的列出來
  summary(rows, label = r => `${r.h === 'weapon' ? '武器' : CHIPS[r.h] ? CHIPS[r.h].short : r.h}${r.c ? '［' + CHIPS[r.c].short + '］' : ''}${r.note || ''}`) {
    const bad = rows.filter(r => !r.ok);
    return { ok: !bad.length, got: bad.length ? `${rows.length - bad.length}/${rows.length}；沒過：` + bad.map(r => `${label(r)} ${r.got}`).join('；') : `${rows.length} 組全部有作用` };
  },
};
