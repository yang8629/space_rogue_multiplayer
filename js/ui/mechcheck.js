// 星環電路 雙人版 · mechcheck.js：機制觸發檢查（總覽的「機制檢查」分頁）＋插座檢查 SockCheck
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// MECH CHECK — 機制觸發檢查：用真正的遊戲引擎在測試靶場跑一遍，確認每個機制有觸發
//   跑之前把 Game 的狀態整份存起來，跑完還原，不影響正在進行的遊戲
// =====================================================================
// 檢查裡的期望值照武器資料算（2026-10-10 改過雷射傷害、散彈顆數，以前寫死 10 和 5）
const LD = () => WEAPONS.laser.base.damage, SN = () => WEAPONS.scatter.base.count;
const MechCheck = {
  results: null,

  // ---------- 測試用工具 ----------
  // 這段期間 Math.random 固定回傳 v（測賭運氣的結果：0 = 一定成功，0.99 = 一定失敗）
  luck(v, fn) { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } },
  setup(mode, ship, weapon, path, final, chain, inv = []) {
    Game.chapterId = 1;  // 既有檢查都假設從第一章的星區 1 開始（玩家選了別章也一樣）
    Game.newRun(mode, ship, weapon);
    Game.weapon = { id: weapon, path, final };
    Game.refreshWeapon();
    const r = splitChain(chain.map(fullChip));  // 宿主給滿插座；組件寫在晶片後面 = 插在它的插座上（不佔電路格，電路維持原本格數）
    while (r.chain.length < chain.length) { r.chain.push(null); r.socks.push([]); }
    Game.chain = r.chain; Game.socks = r.socks;
    Game.slotAttr = [];
    Game.cap = 99;  // 供電（2026-10-10）：一般檢查不受容量限制；能量容量、供電順序兩項自己設
    Game.inventory = [...inv, null, null, null, null, null, null].slice(0, CFG.INV_SLOTS);
    Game.recalc();
    const p = Game.player;
    p.x = 1200; p.y = 800; p.aim = 0; p.vx = p.vy = 0;
    Game.bullets = []; Game.eBullets = []; Game.triggerQueue = []; Events.emit('fxClear'); Game.pickups = [];
  },
  // 雙人（房主這邊）：加一個本機的隊友（不連線），擺在房主下方 300；回傳隊友的飛船（p.L 是它的配裝）
  //   隊友放進 Game 的寫法只在這裡，其他檢查都透過回傳值拿隊友
  coop(mateWeapon = 'laser', mateChain = ['weapon', null, null, null]) {
    this.setup('coop', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
    const L = Net.makeLoadout({ ship: 'vanguard', weapon: mateWeapon, chip: null });
    const r = splitChain(mateChain.map(fullChip));
    while (r.chain.length < mateChain.length) { r.chain.push(null); r.socks.push([]); }
    L.chain = r.chain; L.socks = r.socks; L.cap = 99;
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.wp, Game.boons); });
    const m = new Player(SHIPS.vanguard);
    m.L = L; m.hp = m.maxHp = Game.maxHpOf(m.ship, L.passives, L.mech);
    m.x = Game.player.x; m.y = Game.player.y + 300; m.aim = 0; m.dashSeq = 0; m.wantFire = false;
    m.slot = 2; Game.mates = [m];
    Game.state = 'play';
    return m;
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
    ['武器命中效果', '冰封', '電漿・重質電漿・冰封：命中減速 40%（2 秒）；敵人每被減速 1%，受到你的傷害 +1%（第一下還沒減速不算；加冰凍塗層 = 剩下的速度相乘 64%）', M => {
      const one = chain => {
        M.setup('sandbox', 'vanguard', 'plasma', 'B', 1, chain);
        const P = Game.player, e = M.targets([[150, 0]])[0], got = [], h = e.hurt.bind(e);
        e.hurt = (d, ...r) => { if (r[2] === 'direct') got.push(d); return h(d, ...r); };
        P.aim = 0; for (let i = 0; i < 2; i++) { P.fire(); for (let f = 0; f < 40; f++) Game.updateBullets(1 / 60); }
        return { got, slow: e.slowAmt, dur: e.slowT };
      };
      const A = one(['weapon', null, null, null]), B = one(['weapon', 'frost', null, null]);
      return { ok: A.got.length >= 2 && near1(A.slow, 0.4) && A.dur > 1.3 && near1(A.got[1] / A.got[0], 1.4) && near1(B.slow, 0.64) && near1(B.got[1] / B.got[0], 1.64),
        got: `減速 ${Math.round(A.slow * 100)}%、剩 ${A.dur.toFixed(1)} 秒；第 2 發 ×${(A.got[1] / A.got[0]).toFixed(2)}（要 ×1.4）；加冰凍塗層：減速 ${Math.round(B.slow * 100)}%、第 2 發 ×${(B.got[1] / B.got[0]).toFixed(2)}（要 ×1.64）` };
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
      // 靶放在 trackOne 射的那道刃片方向再偏 27°、距離 246（2026-10-13：相刃一次 2 道、各偏 ±10°，以前靶固定在 (220,110)，挑到的那道其實要轉 37°；追蹤力 4 → 2 後轉不過來）
      M.setup('sandbox', 'vanguard', 'blade', 'B', 0, ['weapon', null, null, null]);
      const a0 = runOps(Game.stats.ops, 0).reduce((a, c) => Math.abs(c.angle) < Math.abs(a.angle) ? c : a).angle + 0.47;
      M.targets([[Math.cos(a0) * 246, Math.sin(a0) * 246]]);
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
    ['電路晶片', '巨彈', '散彈發數不變、每發變大，總傷害 +30%；跟分裂誰先插結果都一樣（發數 ×3）', M => {
      const run = flat => { M.setup('sandbox', 'vanguard', 'scatter', null, null, flat); const L = runOps(Game.stats.ops, 0); return { n: L.length, sum: L.reduce((a, b) => a + b.damage, 0), r: L[0].radius }; };
      const A = run(['weapon', null, null, null]), B = run(['weapon', 'bigshot', null, null]), C = run(['weapon', 'bigshot', 'split', null]), D = run(['weapon', 'split', 'bigshot', null]);
      return { ok: B.n === A.n && near1(B.sum, A.sum * 1.3) && B.r > A.r * 1.5 && C.n === A.n * 3 && D.n === A.n * 3 && near1(C.sum, D.sum),
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
    ['電路晶片', '收束透鏡', '武器每次射出 1 發 +60%、每多 1 發少 15%、5 發以上沒有；插在玩法晶片上沒有效果（只升級）', M => {
      const run = (w, chain) => { M.setup('sandbox', 'vanguard', w, null, null, chain); const L = runOps(Game.stats.ops, 0); return { n: L.length, d: L[0] ? L[0].damage : 0 }; };
      const a0 = run('laser', ['weapon', null, null, null]), a1 = run('laser', ['weapon', 'focus', null, null]);
      const m0 = run('laser', ['weapon', 'mirror', null, null]), m1 = run('laser', ['weapon', 'mirror', 'focus', null]), m2 = run('laser', ['weapon', 'focus', 'mirror', null]);
      const s0 = run('scatter', ['weapon', null, null, null]), s1 = run('scatter', ['weapon', 'focus', null, null]);
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', 'focus', null]);
      const J = Game.stats.info.socks[1][0], idle = J.lvOnly && !Game.stats.ops[1].comps.length;  // 只升級：不進組件清單（沒有效果）
      return { ok: near1(a1.d, a0.d * 1.6) && m1.n === 2 && near1(m1.d, m0.d * 1.45) && near1(m2.d, m1.d) && s1.n === SN() && near1(s1.d, s0.d * (1 + Math.max(0, 0.6 - 0.15 * (s1.n - 1)))) && idle,
        got: `雷射 1 發 ${a0.d.toFixed(1)} → ${a1.d.toFixed(1)}；鏡像 ${m1.n} 發 ${m0.d.toFixed(1)} → ${m1.d.toFixed(1)}（插座順序對調 ${m2.d.toFixed(1)}）；散彈 ${s1.n} 發 ${s0.d.toFixed(1)} → ${s1.d.toFixed(1)}；插在迴旋上${idle ? '只升級、沒有效果' : '有效果（錯）'}` };
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
    ['武器命中效果', '重量砲', '電漿・重質電漿・重量砲：自帶移動速度 −15%（真的變慢）；移動速度每慢 1% 傷害 +3%（沒有上限）；重裝甲、被凍住都算', M => {
      const one = (fi, armor, frost) => {
        M.setup('sandbox', 'vanguard', 'plasma', 'B', fi, ['weapon', null, null, null]);
        Game.parts.armor = armor; Game.recalc(); Game.player.frostT = frost ? 1 : 0;
        const L = runOps(Game.stats.ops, 0); return { d: L[0].damage, spd: shipSpeedNow() };
      };
      const O = one(null, 0), A = one(0, 0), B = one(0, 5), C = one(0, 5, true);
      const wantA = 1 + 0.15 * 3, wantB = 1 + (1 - B.spd) * 3, wantC = 1 + (1 - C.spd) * 3;  // 飛船移動直接乘 Game.mech.speed（Player 移動），所以速度 ×0.85 就是真的變慢
      return { ok: near1(O.spd, 1) && near1(A.spd, 0.85) && near1(A.d / O.d, wantA) && near1(B.d / O.d, wantB) && near1(C.d / O.d, wantC) && wantC > 2,
        got: `重質電漿 ${O.d.toFixed(1)}（速度 ×${O.spd.toFixed(2)}）；重量砲 ${A.d.toFixed(1)}（速度 ×${A.spd.toFixed(3)}，要 ×0.85；傷害 ×${(A.d / O.d).toFixed(2)}，要 ×${wantA.toFixed(2)}）；重裝甲 5 層（×${B.spd.toFixed(3)}）×${(B.d / O.d).toFixed(2)}（要 ×${wantB.toFixed(2)}）；再被凍住（×${C.spd.toFixed(3)}）×${(C.d / O.d).toFixed(2)}（要 ×${wantC.toFixed(2)}）` };
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
    ['武器命中效果', '增殖', '電漿・分裂電漿・增殖：小電漿（會追蹤）打中敵人時再分裂成 3 顆（各為大電漿的 35%，一樣追蹤），第二代不再分裂', M => {
      M.setup('sandbox', 'vanguard', 'plasma', 'A', 0, ['weapon', null, null, null]);
      const P = Game.player, es = M.targets([[150, 0], [300, -40], [300, 0], [300, 40], [430, -60], [430, 0], [430, 60]]), log = [];
      for (const e of es) { const h = e.hurt.bind(e); e.hurt = (d, ...r) => { log.push([d, r[2]]); return h(d, ...r); }; }
      P.aim = 0; P.fire(); const big = Game.bullets[0].damage;
      const seen = new Map();  // 小電漿 → 出生時 hitSet 的大小（之後變大 = 打中了）
      for (let f = 0; f < 120; f++) {
        Game.updateBullets(1 / 60);
        for (const b of Game.bullets) if (b.shard && !seen.has(b)) seen.set(b, b.hitSet.size);
      }
      const g = [...seen.keys()], gen1 = g.filter(b => b.shards), gen2 = g.filter(b => !b.shards);
      const hit2 = gen2.filter(b => b.hitSet.size > seen.get(b)).length, homing = g.every(b => b.homing === 4);
      const small = log.filter(x => x[1] === 'shard').map(x => x[0]), allBig = small.every(d => near1(d, big * 0.35));
      return { ok: gen1.length >= 3 && gen2.length >= 3 && gen2.length % 3 === 0 && hit2 >= 2 && homing && allBig && gen2.every(b => !b.shards),
        got: `大電漿 ${big.toFixed(1)}；第一代 ${gen1.length} 顆、第二代 ${gen2.length} 顆（要 3 的倍數）、第二代打中 ${hit2} 次（要至少 2）；${homing ? '全部追蹤' : '有沒追蹤的（錯）'}；小電漿每下 ${allBig ? '都是' : '不全是（錯）'} ${(big * 0.35).toFixed(1)}` };
    }],
    ['武器命中效果', '共鳴', '電漿・分裂電漿・共鳴：被大電漿打中的和小電漿打中的互相連結 2 秒；任何一隻受傷，其他連結的受到 60%（分出去的不再分）；2 秒後斷開', M => {
      M.setup('sandbox', 'vanguard', 'plasma', 'A', 1, ['weapon', null, null, null]);
      const P = Game.player, [a, b, c, far] = M.targets([[150, 0], [290, -85], [290, 85], [0, -500]]);
      P.aim = 0; P.fire(); for (let f = 0; f < 110; f++) Game.updateBullets(1 / 60);  // 小電漿慢慢飄（每秒 220），1.8 秒才飛得到旁邊那隻；連結 2 秒還沒斷
      const L = a.link, n = L ? L.es.length : 0, inB = !!L && (b.link === L || c.link === L), farIn = far.link === L;
      const hb = b.link === L ? b : c, h0 = hb.hp, hf = far.hp; a.hurt(100, 0, 0, 'mc');
      const shared = h0 - hb.hp, farHit = hf !== far.hp;
      for (let f = 0; f < 130; f++) Game.updateLinksQuakes(1 / 60);
      const h1 = hb.hp; a.hurt(100, 0, 0, 'mc'); const after = h1 - hb.hp;
      return { ok: n >= 2 && inB && !farIn && near1(shared, 60) && !farHit && after === 0 && !a.link,
        got: `連結 ${n} 隻（要至少 2，含被打中的那隻）、${farIn ? '連到很遠的那隻（錯）' : '遠的沒連到'}；打第 1 隻 100，連結的受到 ${shared.toFixed(1)}（要 60）；2.2 秒後再打 100，受到 ${after.toFixed(1)}（要 0）` };
    }],
    ['武器命中效果', '餘震', '電漿・新星・餘震：爆炸 0.6 秒後在同一點再炸一次（同半徑、同傷害）', M => {
      M.setup('sandbox', 'vanguard', 'plasma', 'C', 0, ['weapon', null, null, null]);
      const P = Game.player, [a, b] = M.targets([[150, 0], [150, 50]]), log = [];
      const h = b.hurt.bind(b); b.hurt = (d, ...r) => { log.push([Game.time, d, r[2]]); return h(d, ...r); };
      P.aim = 0; P.fire(); for (let f = 0; f < 30 && !Game.quakes.length; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); }
      const q0 = Game.quakes.length, t0 = Game.time;
      for (let f = 0; f < 50; f++) { Game.time += 1 / 60; Game.updateLinksQuakes(1 / 60); }
      const ex = log.filter(x => x[2] === 'explode');
      return { ok: q0 === 1 && ex.length === 2 && near1(ex[0][1], ex[1][1]) && Math.abs(ex[1][0] - t0 - 0.6) < 0.05 && !Game.quakes.length,
        got: `爆炸後排了 ${q0} 個餘震；旁邊那隻被炸 ${ex.length} 次（要 2）${ex.length === 2 ? `，${ex[0][1].toFixed(1)}／${ex[1][1].toFixed(1)}，相隔 ${(ex[1][0] - t0).toFixed(2)} 秒（要 0.6）` : ''}` };
    }],
    ['武器命中效果', '壓縮', '電漿・新星・壓縮：先把 150 內的敵人吸到中心（旗艦不吸）再炸半徑 70；炸到的（含被直擊那隻）第 2 隻起每多 1 隻傷害 +20%；150 外的不動', M => {
      const one = (n, boss) => {
        M.setup('sandbox', 'vanguard', 'plasma', 'C', 1, ['weapon', null, null, null]);
        const P = Game.player, es = M.targets([[150, 0], ...Array.from({ length: n }, (_, i) => [150 + Math.cos(i * 1.3) * 45, Math.sin(i * 1.3) * 45]), [150, 130], [150, 280]]), log = [];
        const pulled = es[es.length - 2], far = es[es.length - 1], fx = far.x, fy = far.y;
        if (boss) pulled.t = { ...pulled.t, boss: true };
        let first = 0, skip = null;  // 只看第一次爆炸；skip = 那次被直擊的（大電漿可能先打中靠近飛船的那隻）
        const ex = Game.explode;
        Game.explode = function (...a) { first++; if (first === 1) skip = a[5]; return ex.apply(this, a); };
        for (const e of es) { const h = e.hurt.bind(e); e.hurt = (d, ...r) => { if (r[2] === 'explode' && first === 1) log.push([e, d]); return h(d, ...r); }; }
        P.aim = 0; P.fire(); const big = Game.bullets[0].damage;
        try { for (let f = 0; f < 30 && !first; f++) Game.updateBullets(1 / 60); } finally { Game.explode = ex; }
        const hitE = es.find(e => e.id === skip) || es[0];
        return { n: log.length, d: log.length ? log[0][1] / (big * 0.8) : 0, pullHit: log.some(x => x[0] === pulled), pd: Math.hypot(pulled.x - hitE.x, pulled.y - hitE.y),
          farHit: log.some(x => x[0] === far), farMoved: far.x !== fx || far.y !== fy, direct: log.some(x => x[0].id === skip) };
      };
      const A = one(0), B = one(3), C = one(1, true);  // A：直擊＋被吸過來的 = 2 隻；B：直擊＋3 隻旁邊＋吸過來 = 5 隻；C：130 外那隻是旗艦（不吸）
      return { ok: A.n === 1 && A.pullHit && A.pd < 80 && near1(A.d, 1.2) && B.n === 4 && near1(B.d, 1.8) && !C.pullHit && C.pd > 120 && near1(C.d, 1.2)
          && ![A, B, C].some(r => r.farHit || r.farMoved || r.direct),
        got: `130 外的一隻：吸到離直擊那隻 ${A.pd.toFixed(0)}（要 < 80）、${A.pullHit ? '有' : '沒有（錯）'}被炸，×${A.d.toFixed(2)}（要 ×1.2）；旁邊 3 隻＋吸過來 1 隻：炸到 ${B.n} 隻（要 4），×${B.d.toFixed(2)}（要 ×1.8）；`
          + `旗艦${C.pullHit || C.pd <= 120 ? '被吸過來（錯）' : '沒被吸'}，×${C.d.toFixed(2)}（要 ×1.2）；280 外的${[A, B, C].some(r => r.farHit || r.farMoved) ? '被吸或被炸（錯）' : '沒動'}；直擊那隻${[A, B, C].some(r => r.direct) ? '又吃爆炸（錯）' : '不吃爆炸'}` };
    }],
    ['武器命中效果', '殘留彈道', '軌道・自動軌道・殘留彈道：子彈飛過的路徑留電軌 1.5 秒，碰到的敵人受到子彈傷害的 50%（每條每隻一次，子彈本身打中的不算）；場上最多 40 條', M => {
      M.setup('sandbox', 'vanguard', 'railgun', 'A', 0, ['weapon', null, null, null]);
      const P = Game.player, dmg = runOps(Game.stats.ops, 0)[0].damage, [a] = M.targets([[200, 0]]);
      const fly = () => { for (let f = 0; f < 60 && Game.bullets.length; f++) Game.updateBullets(1 / 60); };
      P.aim = 0; P.fire(); const ha = a.hp; fly();
      const hit = a.hp < ha, n1 = Game.trails.length, L = Game.trails[0], len = L ? Math.hypot(L.x2 - L.x1, L.y2 - L.y1) : 0;
      const h1 = a.hp; Game.updateTrails(1 / 60); const sameA = a.hp === h1;  // 子彈打中的那隻不再受傷
      const [b] = M.targets([[500, 0]]), hb = b.hp; Game.updateTrails(1 / 60); const db = hb - b.hp;
      const hb2 = b.hp; Game.updateTrails(1 / 60); const once = b.hp === hb2;
      for (let f = 0; f < 90; f++) Game.updateTrails(1 / 60); const gone = Game.trails.length;
      for (let i = 0; i < 50; i++) { P.fire(); fly(); }
      return { ok: hit && n1 === 1 && len > 900 && sameA && near1(db, dmg * 0.5) && once && gone === 0 && Game.trails.length === 40,
        got: `一發留 ${n1} 條（要 1）、長 ${Math.round(len)}（射程 1050）；子彈打中的那隻${sameA ? '不再受傷' : '又受傷（錯）'}；之後走上電軌的受到 ${db.toFixed(1)}（要 ${(dmg * 0.5).toFixed(1)}）、${once ? '只算一次' : '一直受傷（錯）'}；1.5 秒後剩 ${gone} 條（要 0）；連射 50 發場上 ${Game.trails.length} 條（上限 40）` };
    }],
    ['武器命中效果', '連殺裝填', '軌道・自動軌道・連殺裝填：每擊殺一隻，下一發的射擊冷卻立刻歸零', M => {
      const one = fin => {
        M.setup('sandbox', 'vanguard', 'railgun', 'A', fin, ['weapon', null, null, null]);
        const P = Game.player, e = M.targets([[150, 0]])[0]; P.fireCd = 0.5; e.hurt(1e9, 0, 0, 'mc'); return P.fireCd;
      };
      const A = one(1), B = one(0);
      return { ok: A <= 0 && near1(B, 0.5), got: `擊殺後冷卻：連殺裝填 ${A.toFixed(2)}（要 0）；穿牆 ${B.toFixed(2)}（要不變 0.5）` };
    }],
    ['武器命中效果', '碎甲', '軌道・攻城砲・碎甲：每次命中那隻受到傷害 +10%（疊加、沒有上限），3 秒沒被打中掉光；破甲彈頭打中改疊 +25%', M => {
      const run = (chain, shots) => {
        M.setup('sandbox', 'vanguard', 'railgun', 'B', 1, chain);
        const P = Game.player, es = M.targets([[150, 0], [200, 0], [250, 0]]), got = [];
        const e0 = es[0], h = e0.hurt.bind(e0); e0.hurt = (d, ...r) => { const hp = e0.hp; const v = h(d, ...r); if (r[2] === 'direct') got.push(hp - e0.hp); return v; };
        P.aim = 0; for (let i = 0; i < shots; i++) { P.fire(); for (let f = 0; f < 20; f++) Game.updateBullets(1 / 60); }
        return { got, amt: es.map(e => e.shredAmt), e: es[0] };
      };
      const A = run(['weapon', null, null, null], 12), B = run(['weapon', 'shred', null, null], 3);
      const e = A.e; e.shredT = 3; for (let f = 0; f < 190; f++) e.update(1 / 60, Game.player); const left = e.shredT > 0;
      return { ok: near1(A.got[1] / A.got[0], 1.1) && near1(A.got[11] / A.got[0], 2.1) && A.amt.every(x => near1(x, 1.2)) && near1(B.got[2] / B.got[0], 1.5) && !left,
        got: `第 2 發 ×${(A.got[1] / A.got[0]).toFixed(2)}（要 ×1.1）、第 12 發 ×${(A.got[11] / A.got[0]).toFixed(2)}（要 ×2.1，沒有上限）；貫穿的 3 隻都疊到 ${A.amt.map(x => Math.round(x * 100) + '%').join('／')}；插破甲彈頭第 3 發 ×${(B.got[2] / B.got[0]).toFixed(2)}（要 ×1.5）；3 秒沒打${left ? '還在（錯）' : '掉光'}` };
    }],
    ['武器命中效果', '靜電', '軌道・磁暴線圈・靜電：飛船每移動 100 充一格（最多 4 格），下一發每格多 1 道電弧，射出去就用掉', M => {
      M.setup('sandbox', 'vanguard', 'railgun', 'C', 0, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, n0 = runOps(Game.stats.ops, 0)[0].arcs.n;
      Game.tickWeaponFx(P, 1 / 60);
      for (let i = 0; i < 5; i++) { P.x += 50; Game.tickWeaponFx(P, 1 / 60); }
      const k1 = P.staticK, n1 = runOps(Game.stats.ops, 0)[0].arcs.n;
      for (let i = 0; i < 10; i++) { P.x += 50; Game.tickWeaponFx(P, 1 / 60); }
      const k2 = P.staticK;
      let fired = 0; const orig = P.fire; P.fireCd = 0; P.fire = () => { fired = runOps(Game.stats.ops, 0)[0].arcs.n; };
      try { P.tickFire(1 / 60, true); } finally { P.fire = orig; }
      return { ok: n0 === 2 && k1 === 2 && n1 === 4 && k2 === 4 && fired === 6 && P.staticK === 0,
        got: `沒充電 ${n0} 道；移動 250 充 ${k1} 格、${n1} 道；再移動 500 充到 ${k2} 格（上限 4）；開火時 ${fired} 道（要 6），開完剩 ${P.staticK} 格（要 0）` };
    }],
    ['武器命中效果', '導電', '軌道・磁暴線圈・導電：電弧打中後再跳到附近還沒被這道電弧打過的，最多 3 次，每跳一次 ×0.7', M => {
      const run = fin => {
        M.setup('sandbox', 'vanguard', 'railgun', 'C', fin, ['weapon', null, null, null]);
        const P = Game.player, es = M.targets([[150, 0], [150, 120], [150, 240], [150, 360], [150, 480]]), got = new Map();
        for (const e of es) { const h = e.hurt.bind(e); e.hurt = (d, ...r) => { if (r[2] === 'arc') got.set(e, [...(got.get(e) || []), d]); return h(d, ...r); }; }
        P.aim = 0; P.fire(); const arcD = Game.bullets[0].damage * 0.5; for (let f = 0; f < 20; f++) Game.updateBullets(1 / 60);
        return { far: got.get(es[4]) || [], n: [...got.values()].reduce((s, a) => s + a.length, 0), arcD };
      };
      const A = run(null), B = run(1);
      return { ok: A.n === 2 && !A.far.length && B.n > 2 && B.far.length >= 1 && B.far.every(d => near1(d, B.arcD * 0.343)),
        got: `磁暴線圈：電弧打中 ${A.n} 次、最遠那隻${A.far.length ? '被打到（錯）' : '沒打到'}；導電：打中 ${B.n} 次、最遠那隻（隔 4 隻、跳 3 次）受到 ${B.far.map(d => d.toFixed(1)).join('、') || '0'}（要 ${(B.arcD * 0.343).toFixed(1)}）` };
    }],
    ['武器命中效果', '相位刃格擋', '沒裝攔截時刃片不會砍掉敵彈；裝了攔截才會砍掉（選了格擋流不用攔截）', M => {  // 2026-10-12 格擋改成要攔截
      const run = chain => {
        M.setup('sandbox', 'vanguard', 'blade', 'B', 0, chain); M.targets([]);
        const P = Game.player;
        Game.eBullets = [[90, 0], [110, 12], [100, -12], [130, 0]].map(([dx, dy]) => ({ x: P.x + dx, y: P.y + dy, vx: -60, vy: 0, r: 5, life: 3, dmg: 0, from: 'mc' }));
        P.aim = 0; P.fire();
        for (let f = 0; f < 20; f++) { Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
        return Game.eBullets.filter(b => b.life > 0).length;
      };
      const a = run(['weapon', null, null, null]), b = run(['weapon', 'intercept', null, null]);
      return { ok: a === 4 && b <= 1, got: `沒裝攔截：敵彈剩 ${a} 顆（要 4）；裝了攔截：剩 ${b} 顆（要 0～1）` };
    }],
    ['武器命中效果', '格擋流', '相位刃・飛刃・格擋流：不用攔截也會格擋；刃片每砍掉一顆敵彈傷害 +5%（最多 12 層）；2 秒沒砍到開始每 0.25 秒掉 1 層', M => {
      M.setup('sandbox', 'vanguard', 'blade', 'B', 1, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, d0 = runOps(Game.stats.ops, 0)[0].damage;
      Game.eBullets = [[90, 0], [110, 12], [100, -12], [130, 0]].map(([dx, dy]) => ({ x: P.x + dx, y: P.y + dy, vx: -60, vy: 0, r: 5, life: 3, dmg: 0, from: 'mc' }));
      P.aim = 0; P.fire();
      for (let f = 0; f < 20; f++) { Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
      const k = P.parryK, d1 = runOps(Game.stats.ops, 0)[0].damage;
      P.parryK = 12; P.parryT = 99; const d12 = runOps(Game.stats.ops, 0)[0].damage;
      P.parryT = 2; for (let f = 0; f < 60 * 2.6; f++) Game.tickWeaponFx(P, 1 / 60); const kDecay = P.parryK;
      return { ok: k >= 3 && near1(d1 / d0, 1 + 0.05 * k) && near1(d12 / d0, 1.6) && kDecay >= 9 && kDecay <= 11,
        got: `砍掉 ${k} 顆（要至少 3），傷害 ×${(d1 / d0).toFixed(2)}（要 ×${(1 + 0.05 * k).toFixed(2)}）；12 層 ×${(d12 / d0).toFixed(2)}（要 ×1.6）；停 2.6 秒剩 ${kDecay} 層（要 9～11）` };
    }],
    ['武器命中效果', '業火', '相位刃・相位灼燒・業火：燃燒每次命中各自計時、相加（吸能刃那條一般燃燒只留最強的一個）；各層到時間各自熄掉；疊到 5 層爆燃，剩下的火 ×1.5 往四周炸（半徑 90，含牠自己），層數歸零', M => {
      const burn = fin => {
        M.setup('sandbox', 'vanguard', 'blade', 'C', fin, ['weapon', null, null, null]);
        const e = M.targets([[400, 0]])[0], b = new Bullet(e.x, e.y, 0, runOps(Game.stats.ops, 0)[0], 0, null);
        for (let i = 0; i < 3; i++) Game.hitFx(e, b, 1, e.x, e.y);
        const h = e.hp; for (let f = 0; f < 60; f++) e.update(1 / 60, Game.player);
        const d1 = h - e.hp; for (let f = 0; f < 90; f++) e.update(1 / 60, Game.player);
        return { d1, n: e.burnL ? e.burnL.length : 0, on: e.burnT > 0 || !!e.burnL, dps: Game.wp.burn.dps };  // 每秒幾點照武器升級（相位灼燒）
      };
      const A = burn(0), B = burn(1);
      // 爆燃：疊 4 層、燒 0.5 秒，第 5 下 → 剩下的火 ×1.5 往四周炸（半徑 90，含牠自己），層數歸零；200 外的不受影響
      M.setup('sandbox', 'vanguard', 'blade', 'C', 0, ['weapon', null, null, null]);
      const [e, near, far] = M.targets([[400, 0], [470, 0], [600, 0]]);
      const b = new Bullet(e.x, e.y, 0, runOps(Game.stats.ops, 0)[0], 0, null);
      for (let i = 0; i < 4; i++) Game.hitFx(e, b, 1, e.x, e.y);
      for (let f = 0; f < 30; f++) e.update(1 / 60, Game.player);
      const want = (e.burnL.reduce((a, l) => a + l.dps * l.t, 0) + Game.wp.burn.dps * Game.wp.burn.t) * 1.5, h = [e.hp, near.hp, far.hp];
      Game.hitFx(e, b, 1, e.x, e.y);
      const dE = h[0] - e.hp, dN = h[1] - near.hp, dF = h[2] - far.hp;
      return { ok: Math.abs(A.d1 - 3 * A.dps) <= 1 && Math.abs(B.d1 - B.dps) <= 1 && A.n === 0 && !A.on && near1(dE, want) && near1(dN, want) && dF === 0 && !e.burnL,
        got: `點火 3 次，1 秒燒掉 ${A.d1}（要 ${3 * A.dps} = 3 層 × ${A.dps}）、2.5 秒後剩 ${A.n} 層${A.on ? '（還在燒，錯）' : '、熄了'}；吸能刃（一般燃燒）點 3 次 1 秒燒掉 ${B.d1}（要 ${B.dps}）；` +
          `第 5 層爆燃：牠自己 −${dE.toFixed(0)}、旁邊 70 那隻 −${dN.toFixed(0)}（都要 ${want.toFixed(0)} = 剩下的火 ×1.5）、200 外那隻 −${dF.toFixed(0)}（要 0）、爆完${e.burnL ? `還剩 ${e.burnL.length} 層（錯）` : '歸零'}` };
    }],
    ['武器命中效果', '減速相乘', '不同來源的減速（子彈、彗星的冰）剩下的速度相乘，各自計時；同一來源再打中只刷新時間', M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]);
      const e = M.targets([[400, 0]])[0], P = Game.player;
      e.slowBy('shot', 0.4, 2); const a = e.slowAmt;
      e.slowBy('shot', 0.4, 2); const b = e.slowAmt;
      e.slowBy('grav', 0.4, 0.5); const c = e.slowAmt;
      for (let f = 0; f < 60; f++) e.update(1 / 60, P);
      const d = e.slowAmt, spd = e.spdMul;
      for (let f = 0; f < 75; f++) e.update(1 / 60, P);
      return { ok: near1(a, 0.4) && near1(b, 0.4) && near1(c, 0.64) && near1(d, 0.4) && near1(spd, 0.6) && !(e.slowT > 0),
        got: `子彈 ${Math.round(a * 100)}%、同一來源再打 ${Math.round(b * 100)}%（要 40）、加重力井 ${Math.round(c * 100)}%（要 64）；1 秒後重力井那份過期 ${Math.round(d * 100)}%（要 40）、速度 ×${spd.toFixed(2)}；2.25 秒後${e.slowT > 0 ? '還在減速（錯）' : '恢復'}` };
    }],
    ['武器命中效果', '稜鏡', `雷射・稜鏡：碎光射向 ${REFRACT} 內最近的其他敵人（一道一隻，不管在哪個方向）；不夠的折回打原本那隻`, M => {
      const run = pos => {
        M.setup('sandbox', 'vanguard', 'laser', 'A', null, ['weapon', null, null, null]);
        const P = Game.player, es = M.targets(pos), log = [];
        for (const e of es) { const h = e.hurt.bind(e); e.hurt = (d, ...r) => { log.push([es.indexOf(e), d, r[2]]); return h(d, ...r); }; }
        P.aim = 0; P.fire(); for (let f = 0; f < 45 && log.length < 3; f++) Game.updateBullets(1 / 60);
        const base = (log.find(x => x[2] !== 'shard') || [0, 0])[1], sh = log.filter(x => x[2] === 'shard');
        return { n: es.map((_, i) => sh.filter(x => x[0] === i).length), ok: sh.length === 2 && sh.every(x => near1(x[1], base * 0.4)) };
      };
      // 0 號是打中的那隻；1 號在牠的側後方 206（原本往前扇形散開打不到）、2 號在 450 外（太遠）
      const A = run([[150, 0], [100, 200], [150, 450]]), B = run([[150, 0], [150, 450]]);
      return { ok: A.ok && B.ok && A.n.join() === '1,1,0' && B.n.join() === '2,0',
        got: `旁邊有一隻：碎光打中 原本那隻 ${A.n[0]}、側後方那隻 ${A.n[1]}、450 外 ${A.n[2]}（要 1、1、0）；旁邊沒有：原本那隻 ${B.n[0]}、450 外 ${B.n[1]}（要 2、0）${A.ok && B.ok ? '' : '；碎光傷害不是 40%（錯）'}` };
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
    ['武器命中效果', '分散', `雷射・稜鏡・分散：碎光 3 道；碎光每打中一隻射速 +${SPREAD.per * 100}%（最多 12 層）；2 秒沒疊開始每 0.25 秒掉 1 層`, M => {
      M.setup('sandbox', 'vanguard', 'laser', 'A', 1, ['weapon', null, null, null]);
      const P = Game.player; M.targets([[150, 0], [300, -70], [320, 0], [300, 70]]); P.aim = 0;
      let made = 0; for (let i = 0; i < 4; i++) { P.fire(); for (let f = 0; f < 40; f++) { Game.updateBullets(1 / 60); made = Math.max(made, Game.bullets.filter(q => q.spreadSh).length); } }
      const k = P.spreadK;
      P.spreadK = 12; P.spreadT = 99; let n = 0; const orig = P.fire, iv = Game.stats.interval; P.fireCd = 0; P.fire = () => { n++; };
      try { for (let f = 0; f < 240; f++) P.tickFire(1 / 60, true); } finally { P.fire = orig; }
      const want = 4 / (iv / (1 + SPREAD.per * SPREAD.max));
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
    ['武器命中效果', '逆襲','散彈・獨頭彈・逆襲：受傷（護盾擋下也算）之後 5 秒內傷害 ×2.5、命中爆炸（半徑 80）；5 秒後恢復；沒開時被打中那一下傷害減半，開著時照算', M => {
      M.setup('sandbox', 'vanguard', 'scatter', 'B', 0, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, shot0 = () => runOps(Game.stats.ops, 0)[0];
      P.hp = P.maxHp; const a = shot0(), h0 = P.hp; P.iframe = 0; Game.hurtPlayer(10, 'mc', P); const b = shot0(), t1 = P.revengeT, lost1 = h0 - P.hp;
      const h1 = P.hp; P.iframe = 0; Game.hurtPlayer(10, 'mc', P); const lost2 = h1 - P.hp;
      for (let f = 0; f < 310; f++) Game.tickWeaponFx(P, 1 / 60);
      const c = shot0();
      P.shield = 1; P.iframe = 0; const hp0 = P.hp; Game.hurtPlayer(5, 'mc', P); const t2 = P.revengeT, kept = P.hp === hp0;
      return { ok: !a.explode && near1(b.damage / a.damage, 2.5) && b.explode && b.explode.r === 80 && near1(t1, 5) && near1(c.damage, a.damage) && !c.explode && near1(t2, 5) && kept && lost1 > 0 && near1(lost2 / lost1, 2),
        got: `平常 ${a.damage.toFixed(1)}${a.explode ? '（有爆炸，錯）' : ''}；受傷後 ${b.damage.toFixed(1)}（×${(b.damage / a.damage).toFixed(2)}）${b.explode ? `爆炸半徑 ${b.explode.r}` : '沒爆炸（錯）'}、倒數 ${t1.toFixed(1)} 秒；被打中扣 ${lost1.toFixed(1)}、逆襲中再被打扣 ${lost2.toFixed(1)}（要 2 倍）；5.2 秒後 ${c.damage.toFixed(1)}${c.explode ? '（還在爆，錯）' : ''}；護盾擋下：倒數 ${t2.toFixed(1)} 秒、${kept ? '沒扣血' : '扣血了（錯）'}` };
    }],
    ['武器命中效果', '空格苦行', '散彈・獨頭彈・空格苦行：電路上每個沒裝晶片的空格傷害 +50%（組件插座不算）', M => {
      const one = chain => { M.setup('sandbox', 'vanguard', 'scatter', 'B', 1, chain); return runOps(Game.stats.ops, 0)[0].damage; };
      M.setup('sandbox', 'vanguard', 'scatter', 'B', null, ['weapon', null, null, null]);
      const base = runOps(Game.stats.ops, 0)[0].damage;
      const A = one(['weapon', null, null, null]), B = one(['weapon', 'rear', null, null]), C = one(['weapon', 'rear', 'stand', 'charge']);
      return { ok: near1(A / base, 2.5) && near1(B / base, 2) && near1(C / base, 1),
        got: `獨頭彈 ${base.toFixed(1)}；3 個空格 ${A.toFixed(1)}（×${(A / base).toFixed(2)}，要 ×2.5）；2 個 ${B.toFixed(1)}（×${(B / base).toFixed(2)}，要 ×2）；沒空格 ${C.toFixed(1)}（×${(C / base).toFixed(2)}，要 ×1）` };
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
      return { ok: n === SN() && left === SN() && far && burn === 12 && gone === 0 && Game.flames.length === 60,
        got: `一槍 ${n} 顆，消失後留 ${left} 團（要 ${SN()}）、${far ? '都在射程盡頭' : '位置不對（錯）'}；火上的敵人燃燒每秒 ${burn}（要 12）；2.4 秒後剩 ${gone} 團（要 0）；連射 20 槍場上 ${Game.flames.length} 團（上限 60）` };
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
    ['機體', '射速加成相加','疾風（移動中）+20%、急冷（散熱片 2 層）+30% 相加 = +50%（不是相乘的 +56%；散熱片本身不加射速，2026-10-10 改成能量容量）', M => {
      const count = () => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
        Game.parts.sink = 2; Game.parts.booster = 2; Game.recalc();
        const P = Game.player, iv = Game.stats.interval; let n = 0; const orig = P.fire; P.fire = () => { n++; };
        P.moving = true; P.fireCd = 0;
        try { for (let f = 0; f < 600; f++) { P.quenchT = 1; P.tickFire(1 / 60, true); } } finally { P.fire = orig; }
        return n / (10 / iv);
      };
      const a = count();
      return { ok: Math.abs(a - 1.5) < 0.03, got: `射速 ×${a.toFixed(2)}（要 ×1.50）` };
    }],
    ['電路晶片', '牆反彈', '子彈碰到場地邊緣反彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'wallbounce', null, null]); M.targets([]);
      Game.player.x = CFG.WORLD_W - 40;
      M.run(40);
      const back = Game.bullets.filter(b => Math.cos(b.angle) < 0), marked = back.filter(b => b.bounced).length;
      return { ok: back.length > 0 && marked === back.length, got: `${back.length} 發往回飛，其中 ${marked} 發標成反彈過（打中才算玩法擊殺）` };
    }],
    ['電路晶片', '威力倍增器', '實際命中傷害 ×2', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]);
      const d = M.firstHit();
      return { ok: near1(d, LD() * 2), got: `單發命中 ${d.toFixed(1)}（基礎 ${LD()}）` };
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
        return { ok: back && missHome && wallOk && near1(dmg, LD() * 1.4) && home, got: (back && missHome ? '沒打中：盡頭折返、回到飛船' : '沒打中：沒有折返回來（錯誤）') + `；撞牆${wallOk ? '折返' : '沒折返（錯誤）'}；單發打一隻：${Math.round(dmg)}（應為 7 + 7）${home ? '，回到飛船' : '，沒回到飛船'}` };
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
    ['電路晶片', '環繞', '按住射擊時存在飛船旁繞圈（Lv1 最多 10 發，散彈一次的全部彈丸算一發），碰到敵人照打、打到就消失；衝刺不會放出；放開後全部從所在位置朝滑鼠那一點射出，Lv1 繞滿 3 秒速度與傷害 ×1.5；搭加速時從 1.5 往上加（不相乘）', M => {
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
      return { ok: sc === SN() * 10 && kept && stored === 10 && hit > 0 && orb.length < 10 && out === orb.length && out > 0 && dmgOk && am > 1.52 && am < 1.7,
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
    ['電路晶片', '黏著', '子彈黏上敵人，2 秒後一起爆炸（Lv1 ×1.5＋0.1／發，最多 ×3）；會穿透的子彈每穿過一隻留一份；Lv3 爆炸時立刻引爆周圍敵人身上的子彈（沒有波及傷害）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', null, null]); const e = M.targets([[120, 0]])[0];
      M.run(20); const n = e.stuck ? e.stuck.length : 0, hp = e.hp; Game.bullets = [];
      for (let f = 0; f < 150; f++) { Game.time += 1 / 60; Game.updateEnemies(1 / 60); }
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', 'sticky', null, null]); const row = M.targets([[120, 0], [180, 0], [240, 0], [300, 0], [360, 0]]);
      M.run(1); for (let f = 0; f < 30; f++) Game.updateBullets(1 / 60);
      const each = row.map(r => r.stuck ? r.stuck.length : 0).join('');
      const want = n * LD() * Math.min(3, 1.5 + 0.1 * n);
      // 連鎖引爆（Lv3）：爆炸時把 90 內敵人身上的子彈立刻引爆，不再有波及傷害
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', 'focus', 'focus', null]); const [c0, c1, c2, c3] = M.targets([[120, 0], [120, 70], [120, 300], [200, 40]]);
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
      return { ok: normal.length > 2 && normal.every(x => near1(x, LD())) && near1(d[0], LD() * 5) && d.length > 1 && d.slice(1).every(x => near1(x, LD())),
        got: `按住連射 ${normal.length} 發（${normal[0]}）；停火 2 秒後：${d.map(x => Math.round(x)).join('、')}` };
    }],
    ['電路晶片', '命中觸發器', '命中時用武器再射一次（50%）；觸發射出的子彈不會進環繞的圈；連放 4 個觸發器，最多只展開 3 層', M => M.all([
      M => {  // 命中觸發器
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', null, null]); M.targets(M.cone);
        const r = M.run(90);
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'orbit', null]); M.targets([[200, 0]]);
        Game.player.wantFire = true; const r2 = M.run(40);  // 回響可以打到被命中的那一隻，常常一出來就打中消失：數射出過幾發，不數場上剩的
        const trig = r2.created - r2.fired, inRing = Game.bullets.filter(b => b.depth > 0 && b.mode === 'orbit').length;
        return { ok: r.created > r.fired && r.hits.some(h => near1(h, LD() / 2)) && trig > 0 && inRing === 0,
          got: `開火 ${r.fired} 次，回響 ${r.created - r.fired} 發，回響傷害 ${LD() / 2}；接環繞時觸發 ${trig} 發、進圈 ${inRing} 發` };
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
      const hitSelf = (h1 - one.hp) > LD() * 1.4;  // 雷射 ＋ 回響（50%）
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
    ['航圖與戰鬥', '子彈不穿過薄牆', '大地圖：軌道砲（一幀飛 25）射向厚度 25 以下的牆（多半是牆尖），要撞到牆；只擦過牆角（進牆不到 1）的不算', M => {
      let n = 0, thru = 0, maps = 0;
      for (let m = 0; m < 150 && n < 8; m++) {
        M.setup('run', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
        Game.node = { type: 'combat', L: 5, id: 'mc' + m }; Game.startCombat({ level: 5, wavesTotal: 2, elites: 0 });
        if (Arena.rect) continue;
        maps++; Game.enemies = []; Game.objs = []; Objects.buildGrid();
        const P = Game.player;
        for (let t = 0; t < 800 && n < 8; t++) {
          const x = Math.random() * Arena.W, y = Math.random() * Arena.H, a = Math.random() * TAU;
          if (Arena.f(x, y) < 40) continue;
          let inWall = 0, out = 0, deep = 0;
          for (let d = 20; d < 700; d += 2) {
            const f = Arena.f(x + Math.cos(a) * d, y + Math.sin(a) * d);
            if (f < 0) { inWall = inWall || d; deep = Math.min(deep, f); } else if (inWall) { out = d; break; }
          }
          if (!inWall || !out || out - inWall > 25 || deep > -1 || Arena.gateCross(x, y, x + Math.cos(a) * (out + 60), y + Math.sin(a) * (out + 60))) continue;
          n++; P.x = x; P.y = y; P.aim = a; Game.bullets = []; P.fire();
          const b = Game.bullets[0];
          for (let f = 0; f < 40 && !b.dead; f++) { b.update(1 / 60); if (Math.hypot(b.x - x, b.y - y) > out + 10) { thru++; break; } }
        }
      }
      return { ok: n >= 3 && thru === 0, got: `${maps} 張地圖找到 ${n} 段薄牆，子彈穿過去 ${thru} 次（要 0）` };
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
    ['電路晶片', '擊退不疊加', '同一幀被同方向打中 25 發，速度最多是單發的擊退；單發照常擊退', M => {  // 以前每發都加上去，散彈＋鏡像會把敵人推進牆裡
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const [a, b] = M.targets([[150, 0], [150, 120]], 'swarmer'); a.hp = b.hp = 1e9; a.vx = a.vy = b.vx = b.vy = 0;
      for (let i = 0; i < 25; i++) a.hurt(1, 300, 0);
      b.hurt(1, 300, 0);
      const va = Math.hypot(a.vx, a.vy), vb = Math.hypot(b.vx, b.vy);
      return { ok: Math.abs(va - 300) < 1 && Math.abs(vb - 300) < 1, got: `25 發後速度 ${Math.round(va)}（要 300）；單發 ${Math.round(vb)}（要 300）` };
    }],
    ['電路晶片', '吸引不疊加', '同一幀被吸引 25 次，往中心的速度還是 380', M => {  // 以前每次 +380，散彈＋鏡像會把敵人甩進牆裡
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'pull', null, null]);
      const [a, b] = M.targets([[150, 0], [150, 70]]); b.vx = b.vy = 0;
      for (let i = 0; i < 25; i++) Game.pullAt({ pull: 1, x: a.x, y: a.y, owner: null }, a);
      const d = Math.hypot(a.x - b.x, a.y - b.y), vn = (b.vx * (a.x - b.x) + b.vy * (a.y - b.y)) / d;
      return { ok: Math.abs(vn - 380) < 1 && a.vx === 0 && a.vy === 0, got: `旁邊那隻往中心的速度 ${vn.toFixed(0)}（要 380）；被打中的那隻速度 ${Math.round(Math.hypot(a.vx, a.vy))}（要 0）` };
    }],
    ['電路晶片', '元素組件', '跟武器升級相加：新星＋爆裂 = 爆炸 130%（半徑取大的：新星 120）；磁暴線圈＋電擊 = 3 道電弧；冰封＋冰凍 = 減速 64%（剩下的速度相乘）；雷射＋燃燒實際打中：每秒燒 30% 命中傷害、3 秒；破甲 +25%，加弱點標記 +50%，沒有上限（破甲 37.5%＋標記 = +62.5%）', M => {
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
      return { ok: !!ex && near1(ex.ratio, 1.3) && ex.r === 120 && !!ar && ar.n === 3 && near1(sl, 0.64) && ok4 && ok5,
        got: `新星＋爆裂 ${ex ? Math.round(ex.ratio * 100) + '%、半徑 ' + ex.r : '沒有爆炸'}；磁暴＋電擊 ${ar ? ar.n : 0} 道；冰封＋冰凍 ${Math.round((sl || 0) * 100)}%；雷射打中 ${hit.toFixed(1)}、燃燒每秒 ${e.burnDps.toFixed(1)}、${e.burnT.toFixed(1)} 秒；破甲 10 → ${d1.toFixed(1)}、加弱點標記 ${d2.toFixed(1)}、破甲 37.5%＋標記 ${d3.toFixed(1)}（沒有上限；應為 12.5／15／16.25）` };
    }],
    ['電路晶片', '鏡像迴路', '再來一次，插哪個插座都一樣：武器［鏡像］= 2 發、武器［分裂、鏡像］和［鏡像、分裂］都是 6 發；蓄力［倍增、鏡像］蓄滿 2 發、各 +100%；黏著［鏡像］有作用；吸引［鏡像］沒有效果（只升級）', M => {
      const cnt = flat => { M.setup('sandbox', 'vanguard', 'laser', null, null, flat); return Game.stats.count; };
      const a = cnt(['weapon', 'mirror', null, null]), b = cnt(['weapon', 'split', 'mirror', null]), c = cnt(['weapon', 'mirror', 'split', null]);
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', 'amp', 'mirror']);
      Game.chargeC = 1; const ch = runOps(Game.stats.ops, 0); Game.chargeC = null;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', 'mirror', null]);
      const st = !Game.stats.info.socks[1][0].idle;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'pull', 'mirror', null]);
      const pl = Game.stats.info.socks[1][0].lvOnly;
      return { ok: a === 2 && b === 6 && c === 6 && ch.length === 2 && ch.every(x => near1(x.hb, 1)) && st && pl,
        got: `鏡像 ${a} 發；分裂＋鏡像 ${b}、鏡像＋分裂 ${c} 發；蓄滿 ${ch.length} 發（晶片加成 ${ch.map(x => '+' + Math.round(x.hb * 100) + '%').join('、')}）；黏著［鏡像］${st ? '有作用' : '沒作用（錯誤）'}；吸引［鏡像］${pl ? '只升級' : '有效果（錯誤）'}` };
    }],
    ['電路晶片', '沒有子彈上限', '散彈分裂兩次 = 36 發（4 顆 × 9），全部射出', M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'split', 'split', null]);
      const a = Game.stats, want = WEAPONS.scatter.base.damage * WEAPONS.scatter.base.count * 0.16 * 9;  // 4 顆 × 分裂兩次（×0.4 × 3，兩次）
      return { ok: a.count === WEAPONS.scatter.base.count * 9 && near1(a.dmg, want), got: `${a.count} 發，總傷害 ${a.dmg.toFixed(1)}（應為 ${want.toFixed(1)}）` };
    }],

    ['構築系統', '插座：規則', '插座滿了多的組件沒作用；超頻插在玩法晶片上沒效果（只升級）；武器插 3 個倍增 +300%（不打折）；武器上的倍增不作用在回響；遠征開局武器 0 個插座（插了沒作用）；兩層相乘：蓄力［倍增］蓄滿 = 10 ×（1 ＋ 4）×（1 ＋ 1）= 100', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.chain = ['weapon', chipId('sticky', 1), null, null]; Game.socks = [[], ['amp', 'amp']]; Game.recalc();
      const SI = Game.stats.info.socks[1], full = !SI[0].idle && SI[1].idle;
      Game.chain = ['weapon', chipId('sticky', 2), null, null]; Game.socks = [[], ['overclock']]; Game.recalc();
      const oc = Game.stats.info.socks[1][0].lvOnly && !Game.stats.heatLimit;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', 'amp', 'amp']);
      const d3 = Game.stats.dmg;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', 'trigger']);
      const echo = Game.stats.layers[0] ? Game.stats.layers[0].dmg : 0;
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]);
      const ws0 = Game.wSock, w0 = ws0 === 0 && Game.stats.info.socks[0][0].idle;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', 'amp']);
      Game.chargeC = 1; const ch = runOps(Game.stats.ops, 0)[0]; Game.chargeC = null;
      return { ok: full && oc && near1(d3, LD() * 4) && near1(echo, LD() / 2) && w0 && near1(ch.damage, LD() * 10),
        got: `1 個插座插 2 個倍增：第 2 個${full ? '沒作用' : '有作用（錯誤）'}；超頻插黏著${oc ? '只升級' : '沒標只升級（錯誤）'}；武器 3 個倍增 ${d3}；回響 ${echo}（應為 ${LD() / 2}）；遠征開局武器插座 ${ws0} 個${w0 ? '、倍增沒作用' : ''}；蓄力［倍增］蓄滿 ${ch.damage.toFixed(1)}` };
    }],
    ['構築系統', '插座組合（雷射）', '武器、13 個玩法晶片、3 種觸發器 × 分裂／穿甲／倍增／巨彈／鏡像／五種元素：效果出現在那個晶片的產物上（環繞放出時、迴旋折返時、黏著爆炸…）；疾射減速後插在上面的倍增失效', M => SockCheck.summary(SockCheck.rows('laser'))],
    ['構築系統', '插座組合（散彈）', '同上，散彈（一次好幾顆）', M => SockCheck.summary(SockCheck.rows('scatter'))],
    ['構築系統', '插座組合（相位刃）', '同上，相位刃（刃片、無限穿透、射程很短）', M => SockCheck.summary(SockCheck.rows('blade'))],
    ['構築系統', '武器、觸發器插座只算直擊', '插在武器上的倍增：迴旋回程、環繞放出、加速 1.5 倍以上、反彈後、反向往後、蓄滿、衝刺、攔截回射、黏著爆炸、感染爆出都不吃；插在觸發器上的倍增：回響的迴旋回程不吃', M => SockCheck.summary(SockCheck.direct())],
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
      const N = 400, part = id => String(id).startsWith('part:'), play = id => !part(id) && hasLv(id);
      let early = 0, last = 0, dry = 0;
      for (let i = 0; i < N; i++) { Game.playDry = false; const o = Game.rewardOptions(); if (part(o[0]) || part(o[1])) early++; if (part(o[2])) last++; }
      for (let i = 0; i < N; i++) { Game.playDry = true; if (!Game.rewardOptions().some(play)) dry++; }
      Game.chain = ['weapon', 'boomerang', 'orbit', 'trigger'];
      let full = 0;
      for (let i = 0; i < N; i++) { const o = Game.rewardOptions(); if (part(o[0]) || part(o[1])) full++; }
      return { ok: early === 0 && last > 0 && dry === 0 && full > 0,
        got: `有空格：前兩格出現零件 ${early} 次、最後一格 ${last} 次；保底時沒有玩法晶片 ${dry} 次；電路滿了前兩格出現零件 ${full} 次（各 ${N} 次）` };
    }],
    ['構築系統', '組件升級', `玩法晶片的等級 = 1 ＋ 插在它上面的組件數（最多 Lv${CFG.MAX_CHIP_LV} 進化）；超過插座數、沒電的不算；放錯的組件（吸引插鏡像）只升級、編輯器不擋；拿到重複的不會合成、獎勵不再出現；晶片 id 不帶等級；奇異點的好結果照插座數`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.acquire('boomerang');
      const noMerge = !Game.chipOffers().includes('boomerang') && Game.chipOffers().includes('amp');
      Game.inventory = Game.inventory.map(() => null); Game.cap = 99;
      const lvWith = (id, S) => { Game.chain = ['weapon', id, null, null]; Game.socks = [[], S]; Game.recalc(); return slotLv(1); };
      const b2 = chipId('boomerang', 2), r = {
        l0: lvWith(b2, []), l1: lvWith(b2, ['amp']), name: lvName(b2, slotLv(1)), l2: lvWith(b2, ['amp', 'split']), evo: lvName(b2, slotLv(1)),
        l3: lvWith(chipId('boomerang', 3), ['amp', 'split', 'pierce']),  // 第 3 個只有效果
        over: lvWith(chipId('boomerang', 1), ['amp', 'split']),  // 第 2 個超過插座數
        pull: lvWith(chipId('pull', 2), ['mirror']), pj: (Game.stats.info.socks[1] || [])[0] || {},
        pullIdle: typeof Editor === 'undefined' ? 0 : Editor.idleList().length,
      };
      Game.cap = CHIPS.boomerang.cost; r.nopow = lvWith(b2, ['amp']);  // 晶片有電、組件沒電
      Game.cap = 99; Game.chain = ['weapon', b2, null, null]; Game.socks = [[], ['amp', 'split']]; Game.recalc();
      r.pw = Game.stats.ops.find(o => o.key === 'boomerang').pw;  // 等級的效果強度（每級 +50%）有傳給晶片
      const idOk = !/#/.test(Game.chain[1]) && parseChipId('boomerang~2') === 'boomerang~2' && parseChipId('boomerang#2~2') === null;
      const bh = [bhGood('amp'), bhGood(chipId('rear', 1)), bhGood(chipId('rear', 3))].map(x => Math.round(x * 100));
      const ok = noMerge && r.l0 === 1 && r.l1 === 2 && r.l2 === 3 && r.l3 === 3 && r.over === 2 && r.pull === 2 && r.pj.lvOnly && !r.pj.idle && r.pullIdle === 0
        && r.nopow === 1 && near1(r.pw, lvMulOf(3)) && idOk && bh.join() === [0, 0, 2].map(i => Math.round(BH_GOOD[i] * 100)).join() && /Lv2/.test(r.name) && r.evo.includes(CHIPS.boomerang.evo);
      return { ok, got: `${noMerge ? '不合成' : '會合成（錯誤）'}；插 0／1／2／3 個 → Lv${r.l0}／${r.l1}／${r.l2}／${r.l3}（${r.name}、${r.evo}）；1 個插座插 2 個 → Lv${r.over}；吸引插鏡像 → Lv${r.pull}（${r.pj.lvOnly ? '只升級' : '沒標只升級'}、編輯器擋 ${r.pullIdle} 個）；組件沒電 → Lv${r.nopow}；強度 ×${r.pw}；id ${idOk ? '不帶等級' : '還帶等級（錯誤）'}；奇異點 組件／1 插座／3 插座 ${bh.join('／')}%` };
    }],
    ['構築系統', '玩法擊殺', '照玩法打中後 1 秒內敵人死掉，記一次那個晶片的玩法擊殺；散彈多顆打中同一隻只算一次；刺殼也只算一次；超過 1 秒不算', M => {
      const kill = (weapon, type, wait) => {
        M.setup('sandbox', 'vanguard', weapon, null, null, ['weapon', 'rear', null, null]);
        // 在飛船後面，先打不死。距離 80：散彈反向那 4 顆扇形中間有空隙（每顆偏 6～7°），擺在 120 遠時蟲群偶爾 4 顆都擦過（約 4%）
        const e = M.targets([[-80, 0]], type, true, 0.01)[0]; e.hp = e.maxHp = 1e6;
        Game.playKills = {};
        M.run(20);
        for (let f = 0; f < wait * 60; f++) Game.time += 1 / 60;
        e.hp = 1; e.hurt(5, 0, 0, 'direct', null);
        return Game.playKills.rear || 0;
      };
      const a = kill('laser', 'swarmer', 0), b = kill('scatter', 'swarmer', 0), c = kill('laser', 'brute', 0), d = kill('laser', 'swarmer', 3);
      return { ok: a === 1 && b === 1 && c === 1 && d === 0, got: `雷射殺蟲群 +${a}；散彈殺蟲群 +${b}；雷射殺刺殼 +${c}；打中 3 秒後才死 +${d}` };
    }],
    ['稀有晶片', 'id 與同步', '稀有晶片的 id = 玩法晶片~插座!詞條＋等級；多人同步照 id 還原；組件、觸發器、不認得的詞條不收；有電的才算（電路統計的 rares）', M => {
      const id = chipId('boomerang', 2, { k: 'aftershock', lv: 2 });
      const back = parseChipId(id), bad = [parseChipId('amp!reap1'), parseChipId('trigger~1!reap1'), parseChipId('boomerang~2!nope1')];
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', id, null, null]);
      const r = Game.stats.rares.boomerang;
      Game.cap = 0; Game.recalc();
      const off = !Game.stats.rares.boomerang;  // 沒電：詞條不算
      const ok = id === 'boomerang~2!aftershock2' && back === id && bad.every(x => x === null) && r && r.k === 'aftershock' && r.lv === 2 && off && CHIPS[id].name.includes(RARE.aftershock.name);
      return { ok, got: `${id} → ${back}；組件／觸發器／不認得的詞條 → ${bad.map(x => x === null ? '不收' : x).join('、')}；電路統計 ${r ? r.k + r.lv : '沒有'}、沒電時${off ? '不算' : '還算（錯誤）'}` };
    }],
    ['稀有晶片', '三選一出現', `一般戰鬥每格玩法晶片 ${CFG.RARE.chance * 100}% 變稀有；精英、旗艦保證一格（刷新也保證）；擊沉旗艦先三選一，選完（或跳過）回到勝利畫面`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      const N = 600, has = o => o.some(rareOf);
      let combat = 0, elite = 0, eliteRe = 0;
      for (let i = 0; i < N; i++) { if (has(Game.rewardOptions('combat'))) combat++; if (has(Game.rewardOptions('elite'))) elite++; }
      Game.credits = 1e6; Game.openReward('elite');
      for (let i = 0; i < 50; i++) { Game.rerollReward(); if (has(Game.reward.options)) eliteRe++; }
      Game.victory = { pick: 'part', rew: false }; Game.openReward('boss');
      const bossRare = has(Game.reward.options);
      Game.takeReward(null);
      const back = Game.state === 'victory' && Game.victory.rew === true && bossDone(Game.victory), rate = combat / N;
      return { ok: rate > 0.01 && rate < 0.12 && elite === N && eliteRe === 50 && bossRare && back,
        got: `一般戰鬥有稀有 ${(rate * 100).toFixed(1)}%；精英 ${elite}/${N}、刷新 ${eliteRe}/50；旗艦${bossRare ? '有' : '沒有'}稀有、跳過後${back ? '回到勝利畫面' : `在 ${Game.state}（錯誤）`}` };
    }],
    ['稀有晶片', '變稀有、替換／增強', '身上已經有的晶片拿到稀有版本：留在原本的格子、組件不動、插座數取多的、倉庫滿了也能拿；同一個詞條 +1 級（最多 3）；不同詞條可以替換（新詞條 Lv1）或增強（原本的 +1 級）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.chain[1] = chipId('boomerang', 1); Game.socks[1] = ['amp']; Game.inventory = Game.inventory.map(() => 'split'); Game.recalc();  // 倉庫塞滿
      const take = (sk, k, lv, mode) => { Game.reward = { kind: 'combat', options: [] }; Game.takeReward(chipId('boomerang', sk, { k, lv }), mode); return Game.chain[1]; };
      const can = Game.canAcquire(chipId('boomerang', 3, { k: 'aftershock', lv: 1 }));
      const a = take(3, 'aftershock', 1), sockOk = Game.socks[1].join() === 'amp' && socketsOf(a) === 3;
      const b = take(1, 'aftershock', 2);  // 同一個詞條：+1 級（不看卡片上的等級）
      const c = take(2, 'purge', 2, 'boost'), d = take(1, 'purge', 3, 'replace');
      take(1, 'purge', 1); take(1, 'purge', 1);
      const e = take(1, 'purge', 1);  // 最多 3 級
      const invOk = Game.inventory.every(x => x === 'split');
      const ok = can && a === 'boomerang~3!aftershock1' && sockOk && b === 'boomerang~3!aftershock2' && c === 'boomerang~3!aftershock3' && d === 'boomerang~3!purge1' && e === 'boomerang~3!purge3' && invOk;
      return { ok, got: `倉庫滿了${can ? '可以拿' : '不能拿（錯誤）'}；${[a, b, c, d, e].join(' → ')}；組件 ${Game.socks[1].join()}、倉庫${invOk ? '沒動' : '被動到（錯誤）'}` };
    }],
    ['稀有晶片', '詞條效果', '餘波（震波推開＋傷害、冷卻）、淨空（清掉範圍內的敵彈）、迅捷（衝刺冷卻）、狂熱（射速層數、3 秒消失）、爆發（照發動頻率充滿後 8 個方向開槍，射出的子彈不再觸發詞條）、反擊（受傷時強制發動，冷卻 2 秒）、結晶（N 次玩法擊殺 1 層護盾）、收割（回血，每秒最多 3）', M => {
      const rig = (base, k, lv = 1) => { M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', chipId(base, 1, { k, lv }), null, null]); Game.state = 'play'; const p = Game.player; p.iframe = 0; return p; };
      const kill = (base, n) => { for (let i = 0; i < n; i++) Game.rareRun('kill', base, null, Game.player.x, Game.player.y); };
      return M.all([
        M => {  // 餘波
          const p = rig('boomerang', 'aftershock', 3), [e] = M.targets([[60, 0]]), hp = e.hp, x0 = e.x;
          Game.rareAct('boomerang', e.x - 20, e.y, null); const d1 = hp - e.hp;
          Game.rareAct('boomerang', e.x - 20, e.y, null); const d2 = hp - e.hp - d1;  // 冷卻中
          for (let f = 0; f < 10; f++) e.update(1 / 60, p);
          return { ok: near1(d1, Game.wp.damage * RARE.aftershock.dmg) && d2 === 0 && e.x > x0 + 1, got: `餘波 ${d1.toFixed(1)}（應為 ${(Game.wp.damage * RARE.aftershock.dmg).toFixed(1)}）、冷卻中 +${d2}、推開 ${(e.x - x0).toFixed(1)}` };
        },
        M => {  // 淨空
          const p = rig('rear', 'purge', 1), eb = (dx) => ({ x: p.x + dx, y: p.y, vx: 0, vy: 0, r: 5, dmg: 1, life: 3, from: 'test' });
          Game.eBullets = [eb(30), eb(200)]; Game.rareAct('rear', p.x, p.y, null);
          return { ok: Game.eBullets.length === 1 && Game.eBullets[0].x === p.x + 200, got: `清完剩 ${Game.eBullets.length} 顆（應剩 200 外的 1 顆）` };
        },
        M => {  // 迅捷
          const p = rig('rear', 'swift', 2); p.dashCd = 1; Game.rareAct('rear', p.x, p.y, null);
          return { ok: near1(p.dashCd, 1 - RARE.swift.v[1]), got: `衝刺冷卻 1 → ${p.dashCd.toFixed(2)}` };
        },
        M => {  // 狂熱
          const p = rig('boomerang', 'frenzy', 3); kill('boomerang', 6);
          const a = rareRateAdd(p); Game.time += RARE.frenzy.t + 0.1; const b = rareRateAdd(p);
          return { ok: near1(a, RARE.frenzy.max * RARE.frenzy.v[2]) && b === 0, got: `6 次擊殺 → 射速 +${Math.round(a * 100)}%（最多 ${RARE.frenzy.max} 層）；${RARE.frenzy.t} 秒後 +${Math.round(b * 100)}%` };
        },
        M => {  // 爆發
          const p = rig('sticky', 'burst', 1), n = Math.ceil(CHIPS.sticky.actRate * RARE.burst.v[0] - 1e-9), per = runOps(Game.stats.ops, 0).length;
          Game.bullets = [];
          for (let i = 0; i < n - 1; i++) Game.rareAct('sticky', p.x, p.y, null);
          const before = Game.bullets.length; Game.rareAct('sticky', p.x, p.y, null);
          return { ok: before === 0 && Game.bullets.length === RARE.burst.dirs * per, got: `發動 ${n - 1} 次 ${before} 發、第 ${n} 次 ${Game.bullets.length} 發（應為 ${RARE.burst.dirs} × ${per}）` };
        },
        M => {  // 爆發不連鎖：蓄力發動 1 次就充滿，爆發射出的蓄滿子彈不再充能（以前會一直爆發到當掉）
          const p = rig('charge', 'burst', 1), per = runOps(Game.stats.ops, 0).length;
          Game.bullets = []; Game.chargeC = 1; Game.rareAct('charge', p.x, p.y, null); Game.chargeC = 0;  // 開火那一刻蓄滿：爆發射出的也是蓄滿的子彈
          const one = Game.bullets.length;
          // 加速：爆發射出的子彈之後在飛行中加速到 2 倍（= 加速發動），不能再充能（以前隔幾幀又爆發，越爆越多到記憶體用光）
          const q = rig('accel', 'burst', 1), st = Game.rareSt(q, 'accel');
          Game.bullets = []; st.c = 1 - 1e-6; Game.rareAct('accel', q.x, q.y, null);
          const shot = Game.bullets.length, fast = () => Game.bullets.filter(b => b.accelMul >= 2).length;
          for (let f = 0; f < 120; f++) for (const b of Game.bullets) b.update(1 / 60);
          const sped = fast(), c = st.c || 0;
          return { ok: one === RARE.burst.dirs * per && shot > 0 && sped > 0 && c === 0,
            got: `蓄力的爆發：${one} 發（應為 ${RARE.burst.dirs} × ${per}，只爆一次）；加速的爆發 ${shot} 發、之後 ${sped} 發加速到 2 倍，充能 ${c.toFixed(2)}（應為 0）` };
        },
        M => {  // 反擊（蓄力：強制發動 = 下一發蓄滿）
          const p = rig('charge', 'retort', 1), hit = () => { p.chargeC = 0; p.iframe = 0; Game.hurtPlayer(1, 'test'); return p.chargeC; };
          const a = hit(), b = hit(); Game.time += RARE.retort.cd + 0.1; const c = hit();
          return { ok: a === 1 && b === 0 && c === 1, got: `受傷 → 蓄力 ${a}；冷卻中再受傷 → ${b}；${RARE.retort.cd} 秒後 → ${c}` };
        },
        M => {  // 結晶
          const p = rig('sticky', 'crystal', 1), v = RARE.crystal.v[0]; p.shield = 0;
          kill('sticky', v - 1); const a = p.shield; kill('sticky', 1); const b = p.shield; kill('sticky', v); const c = p.shield;
          return { ok: !a && b === 1 && c === 1, got: `${v - 1} 次 → 護盾 ${a || 0}；${v} 次 → ${b}；再 ${v} 次 → ${c}（最多 1）` };
        },
        M => {  // 收割
          const p = rig('boomerang', 'reap', 3); p.hp = p.maxHp - 50;
          const h0 = p.hp; kill('boomerang', 10); const a = p.hp - h0; Game.time += 1.1; kill('boomerang', 1); const b = p.hp - h0 - a;
          return { ok: near1(a, RARE.reap.cap) && near1(b, RARE.reap.v[2]), got: `同一秒 10 次 → 回 ${a}（每秒最多 ${RARE.reap.cap}）；下一秒 1 次 → 回 ${b}` };
        },
      ]);
    }],
    ['稀有晶片', '發動點', '13 個玩法晶片照玩法打都會發動（詞條「發動時」「爆發」照這個觸發）：迴旋折返、環繞放出、地雷衝出去、加速過 2 倍、反彈、反向射出、蓄滿射出、黏著爆炸、感染爆出、吸引拉到、衝刺射擊、架設疊滿、攔截擋下', M => {
      const got = new Set(), orig = Game.rareAct;
      Game.rareAct = function (base, ...a) { got.add(base); return orig.call(this, base, ...a); };
      const P = () => Game.player, R = () => Game.wp.speed * Game.wp.life, set = flat => M.setup('sandbox', 'vanguard', 'laser', null, null, flat);
      try {
        set(['weapon', 'boomerang', null, null]); M.targets([[150, 0]]); M.run(60);
        set(['weapon', 'orbit', null, null]); M.run(10);
        set(['weapon', 'stasis', null, null]); M.targets([[R() * 0.5 + 40, 0]]); M.run(150);
        set(['weapon', 'accel', null, null]); M.run(90);
        set(['weapon', 'wallbounce', null, null]); P().x = CFG.WORLD_W - 60; M.run(20);
        set(['weapon', 'rear', null, null]); M.run(3);
        set(['weapon', 'charge', null, null]); Game.chargeC = 1; P().fire(); Game.chargeC = null;
        set(['weapon', 'sticky', null, null]); { const [e] = M.targets([[120, 0]]); M.run(20); for (let f = 0; f < 150 && !got.has('sticky'); f++) { Game.time += 1 / 60; Game.updateEnemies(1 / 60); } }
        set(['weapon', 'infect', null, null]); M.targets([[120, 0]], 'swarmer', true, 0.01); M.run(30);
        set(['weapon', 'pull', null, null]); M.targets([[150, 0], [150, 50]]); M.run(30);
        set(['weapon', 'dashfire', null, null]); P().wasDash = true; P().dashT = 0; P().tickDash();
        set(['weapon', 'stand', null, null]); P().standT = 5; P().moving = false; P().fireCd = 0; P().tickFire(1 / 60, true);
        set(['weapon', 'intercept', null, null]); {
          const gp = P(); M.targets([[300, 0]], 'swarmer', true, 1);
          spawnShots([shot({ angle: 0, speed: 600, damage: 10, life: 1, intercept: 1 })], gp.x, gp.y, 0, 0, null);
          Game.eBullets = [{ x: gp.x + 60, y: gp.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'test' }];
          for (let f = 0; f < 30; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
        }
      } finally { Game.rareAct = orig; }
      const all = NORMAL_IDS.filter(hasLv), miss = all.filter(b => !got.has(b));
      return { ok: !miss.length, got: miss.length ? `沒有發動：${miss.map(b => CHIPS[b].name).join('、')}` : `${all.length} 個玩法晶片都發動了` };
    }],
    ['構築系統', '傷害統計', '武器＋倍增器（×2）：兩者各分到一半，合計等於總傷害；結算的傷害總計 = 敵人實際被扣的血量，並分出來源；往前的子彈不算反向的；多射出來的那發基礎傷害算反向；攔截回射算「攔截回射」和攔截晶片（不是回響）；迴旋回程打中的傷害算迴旋；回射打中後 1 秒內擊殺，才算攔截的玩法擊殺', M => M.all([
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
      M => {  // 分裂：分出來的子彈算分裂，中間那顆算原本的來源（2026-10-13）
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'split', null, null]); M.targets([]);
        const one = runOps(Game.stats.ops, 0).map(b => b.src);
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'split', 'split', null]); M.targets([]);
        const L2 = runOps(Game.stats.ops, 0), two = L2.map(b => b.src), d = splitDamage(10, { src: L2[1].src, cr: L2[1].cr }, null);
        const cnt = (a, k) => a.filter(x => x === k).length;
        return { ok: one.length === 3 && cnt(one, 'weapon') === 1 && cnt(one, 'split') === 2 && two.length === 9 && cnt(two, 'weapon') === 1 && cnt(two, 'split') === 8 && near1(d.split || 0, 10),
          got: `1 個分裂：${one.length} 顆，武器 ${cnt(one, 'weapon')}、分裂 ${cnt(one, 'split')}（要 1、2）；2 個分裂：${two.length} 顆，武器 ${cnt(two, 'weapon')}、分裂 ${cnt(two, 'split')}（要 1、8）；分出來的那顆打 10 → ${JSON.stringify(d)}` };
      },
      M => {  // 傷害歸屬：攔截回射、迴旋回程
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'intercept', null, null]);
        const e = M.targets([[300, 0]], 'swarmer', true, 1)[0], gp = Game.player; e.hp = 3;  // 回射一下就打死
        spawnShots([shot({ angle: 0, speed: 600, damage: 10, life: 1, intercept: 1 })], gp.x, gp.y, 0, 0, null);
        Game.eBullets = [{ x: gp.x + 60, y: gp.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'test' }];
        for (let f = 0; f < 60; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
        const R = Game.runStats, ic = Math.round(R.dmg.counter || 0), echo = Math.round(R.dmg.echo || 0), icChip = Math.round(R.chips.intercept || 0), g = Game.playKills.intercept || 0;
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); M.targets([[150, 0]]);
        M.run(60);
        const bm = Math.round(Game.runStats.chips.boomerang || 0);
        return { ok: ic > 0 && echo === 0 && icChip > 0 && e.dead && g === 1 && bm > 0,
          got: '攔截回射 ' + ic + '、回響 ' + echo + '、攔截晶片 ' + icChip + '、攔截玩法擊殺 +' + g + '；迴旋晶片 ' + bm };
      },
    ])],
    ['構築系統', '能量容量', '容量 = 飛船開局（先鋒號 7、星門號 8）＋散熱片每層 +2＋補給站買一次 +2（每間 1 次）；擊沉旗艦不給；能量不影響射速', M => {
      Game.newRun('run', 'gate', 'laser');
      const g0 = Game.energyCap();  // 直接開局（M.setup 會把容量設成 99）
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'orbit', 'boomerang', 'rear']);
      Game.cap = SHIPS.vanguard.cap; Game.recalc();
      const c0 = Game.energyCap(), iv = cap => { Game.cap = cap; Game.recalc(); return Game.stats.interval; };
      const i0 = iv(99), i1 = iv(1);  // 容量 1：晶片全部沒電，射擊間隔照樣
      Game.cap = SHIPS.vanguard.cap; Game.parts.sink = 2; Game.recalc(); const cs = Game.energyCap(); Game.parts.sink = 0; Game.recalc();
      Game.credits = 999; Game.shop = { items: [], slotBought: false, capBought: false, healed: false };
      const b0 = Game.cap; Game.buyCap(); const b1 = Game.cap; Game.buyCap(); const b2 = Game.cap;
      Game.node = { type: 'boss', L: 6, id: 'mcCap' }; Game.inArena = true; Game.state = 'play'; Game.combatWon(); const k1 = Game.cap;
      return { ok: g0 === 8 && c0 === 7 && near1(i1, i0) && cs === 11 && b1 === b0 + 2 && b2 === b1 && k1 === b2,
        got: `開局容量 星門號 ${g0}（要 8）、先鋒號 ${c0}（要 7）；容量 99 → 1：射擊間隔 ${i0.toFixed(3)} → ${i1.toFixed(3)}（要一樣）；散熱片 2 層 ${cs}（要 11）；補給站買 ${b0} → ${b1}、再買一次 ${b2}（每間限 1 次）；擊沉旗艦 ${b2} → ${k1}（要不變）` };
    }],
    ['構築系統', '供電順序', '從左往右供電：武器插座的組件 → 晶片 → 它插座上的組件 → 下一格；第一個電不夠的和右邊全部沒電（不跳過便宜的）；沒電的不給效果、不算玩法擊殺；編輯器不擋沒電的擺法', M => {
      // 武器［分裂 2］→ 迴旋 2［倍增 3］→ 反向 2 → 黏著 1（全部 10）
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'split', 'boomerang', 'amp', 'rear', 'sticky']);
      const at = cap => {
        Game.cap = cap; Game.recalc();
        const I = Game.stats.info, P = i => I[i].nopow ? '✗' : '✓', Q = (i, k) => (I.socks[i][k] || {}).nopow ? '✗' : '✓';
        return { used: Game.stats.used, off: Game.stats.off, count: Game.stats.count, map: `分裂${Q(0, 0)} 迴旋${P(1)} 倍增${Q(1, 0)} 反向${P(2)} 黏著${P(3)}` };
      };
      const a = at(99), b = at(8), c = at(6), d = at(3), e = at(1);
      const idleOk = typeof Editor === 'undefined' || Editor.idleList().length === 0;  // 容量 1：全部沒電，但編輯器不算「擺了沒作用」
      // 沒電的迴旋不給效果、不算玩法擊殺（遠征：容量 1，迴旋 ⚡2 沒電）
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.cap = 1; Game.recalc(); Game.playKills = {}; M.targets([[150, 0]]); M.run(60);
      const bm = Math.round(Game.runStats.chips.boomerang || 0), g = Game.playKills.boomerang || 0;
      const ok = a.off === 0 && a.used === 10 && b.used === 7 && b.off === 2 && b.map === '分裂✓ 迴旋✓ 倍增✓ 反向✗ 黏著✗'
        && c.used === 4 && c.off === 3 && c.map === '分裂✓ 迴旋✓ 倍增✗ 反向✗ 黏著✗' && d.used === 2 && d.off === 4 && d.map === '分裂✓ 迴旋✗ 倍增✗ 反向✗ 黏著✗'
        && e.used === 0 && e.off === 5 && e.count < d.count && a.count > b.count && idleOk && bm === 0 && g === 0;
      return { ok, got: `容量 99：用 ${a.used}、沒電 ${a.off}｜8：${b.map}（用 ${b.used}；黏著 ⚡1 放得下也不接）｜6：${c.map}｜3：${d.map}｜1：沒電 ${e.off}、每發 ${e.count} 顆（3：${d.count}；反向有電 99：${a.count}、沒電 8：${b.count}）｜編輯器擋${idleOk ? '：沒有' : '了'}｜沒電的迴旋傷害 ${bm}、玩法擊殺 ${g}` };
    }],
    ['構築系統', '子彈上限防呆', '我方子彈超過 CFG.BULLET_CAP.mine、敵方超過 enemy：刪最舊的（陣列前面的，標成消失），留最新的；觸發記進遊玩紀錄（幾幀、刪幾顆、最多幾顆、在哪、第一次在哪、最多那次的子彈來源前 3 名和當時電路）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'trigger'], []);
      // 我方：每 3 顆有 2 顆是分裂的回響子彈、1 顆是武器的；敵方都是盾衛反彈的
      const C = CFG.BULLET_CAP, mk = n => Array.from({ length: n }, (_, i) => ({ id: i, dead: false, att: { src: i % 3 ? 'split' : 'weapon' }, depth: i % 3 ? 1 : 0, from: '盾衛' }));
      const B = mk(C.mine + 100), E = mk(C.enemy + 50), old = B[0];
      Game.bullets = B; Game.eBullets = E; Game.runStats.cap = { n: 0, cut: 0, max: 0, at: '', first: '', src: [], chain: [] };
      Game.capBullets();
      const R = Game.runStats.cap, okB = Game.bullets.length === C.mine && Game.bullets[0].id === 100 && old.dead, okE = Game.eBullets.length === C.enemy && Game.eBullets[0].id === 50;
      const n1 = R.n; Game.capBullets(); const still = n1 === 1 && R.n === 1;  // 同一幀兩邊都超過算 1 幀；沒超過就不再觸發
      Game.bullets = []; Game.eBullets = [];
      const src = R.src.map(([k, v]) => k + v).join(' '), wantSrc = `${CHIPS.split.name}・回響${Math.floor((C.mine + 100) * 2 / 3)} ${CHIPS.weapon.name}${Math.ceil((C.mine + 100) / 3)}`;
      const okSrc = src === wantSrc && R.chain.join('｜') === `${CHIPS.weapon.name}｜${CHIPS.trigger.name}` && !!R.first;
      return { ok: okB && okE && still && okSrc && R.cut === 150 && R.max === C.mine + 100,
        got: `我方 ${C.mine + 100} → ${okB ? C.mine + '（刪掉最舊的 100 顆）' : '不對（錯誤）'}；敵方 ${C.enemy + 50} → ${okE ? C.enemy : '不對（錯誤）'}；紀錄：觸發 ${R.n} 幀、刪 ${R.cut} 顆、最多 ${R.max} 顆（${R.at}）、第一次（${R.first}）${still ? '' : '（沒超過也記了，錯誤）'}；來源 ${src}${src === wantSrc ? '' : `（應為 ${wantSrc}，錯誤）`}；電路 ${R.chain.join('｜')}` };
    }],
    ['構築系統', '奇異點：強化格子', '投入 1 個晶片 → 隨機一格得到屬性（晶片消失）；效果 ×1.5 放在觸發器那格：插在觸發器上的倍增 +150%（回響 5 → 12.5）；能量歸零', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'amp', null], ['split']);
      Game.openBlackhole(); Game.bhToggle('inv:0'); Game.bhFuse();
      const n = Game.slotAttr.filter(Boolean).length, gone = !Game.inventory[0], where = Game.slotAttr.findIndex(Boolean);
      Game.state = 'map';
      Game.slotAttr = [null, 'eff']; Game.recalc();
      const d = (Game.stats.layers[0] || { dmg: 0 }).dmg;
      Game.slotAttr = [null, 'free']; Game.recalc();
      const heat = Game.stats.heat;  // 觸發器不算，插在上面的倍增照算 3
      return { ok: n === 1 && gone && where >= 0 && near1(d, LD() * 1.25) && heat === 3,
        got: `強化 ${n} 格（第 ${where + 1} 格）、晶片${gone ? '消失' : '還在'}；效果 ×1.5 回響 ${d}（應為 ${LD() * 1.25}）；能量歸零 ⚡${heat}` };
    }],
    ['構築系統', '奇異點：每種屬性', '觸發器［倍增］放在強化格：效果 ×1.5／×0.7 → 回響 12.5／8.5；能量歸零／+2；超載・威力 +50%、貫穿 +1、導引、頻率（射速變快）；間歇失效（第 6～8 秒沒作用）；武器格效果 ×1.5（武器上的倍增 +150%）', M => {
      const at = (a, slot = 1, flat = ['weapon', 'trigger', 'amp', null]) => { M.setup('sandbox', 'vanguard', 'laser', null, null, flat); Game.slotAttr = []; Game.slotAttr[slot] = a; Game.recalc(); return Game.stats; };
      const echo = s => s.layers[0] ? s.layers[0].dmg : 0, e1 = s => { const P = runOps(s.ops, 0)[0].payload; return P ? runOps(P, 1)[0] : {}; };
      const base = at(null), r = {};
      r.eff = echo(at('eff')); r.weak = echo(at('weak'));
      r.free = at('free').heat; r.heavy = at('heavy').heat;
      r.power = echo(at('ov_power')); r.pierce = e1(at('ov_pierce')).pierce; r.seek = e1(at('ov_seek')).homing; r.rate = at('ov_rate').interval / base.interval;
      at('flaky'); Game.time = 7; Game.recalc(); r.off = echo(Game.stats); Game.time = 1; Game.recalc(); r.on = echo(Game.stats);
      r.w = at('eff', 0, ['weapon', 'amp', null, null]).dmg;
      const ok = near1(r.eff, LD() * 1.25) && near1(r.weak, LD() * 0.85) && r.free === 3 && r.heavy === 6 && near1(r.power, LD() * 1.25) && r.pierce === 1 && r.seek >= 3 && near1(r.rate, 0.8)
        && r.off === 0 && near1(r.on, LD()) && near1(r.w, LD() * 2.5);
      return { ok, got: `回響：×1.5 ${r.eff}、×0.7 ${r.weak}、威力 ${r.power}；能量 ${r.free}／${r.heavy}；貫穿 ${r.pierce}、導引 ${r.seek}、射擊間隔 ×${r.rate.toFixed(2)}；間歇失效 ${r.on} → ${r.off}；武器格 ×1.5 ${r.w}` };
    }],
    ['構築系統', '軍械台升級', '武器進入第一段、第二段', M => {
      M.setup('run', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]);
      Game.upgradeWeapon('C', 'armory');
      const s1 = !!Game.wp.explode;
      Game.upgradeWeapon('0', 'armory');
      return { ok: s1 && !!Game.wp.aftershock && Game.weapon.final === 0, got: weaponTitle(Game.weapon) };  // 新星・餘震
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
    ['機體', '堡壘號：灰血', '受傷的 40% 變成灰血（最多最大 HP 的 25%）；4 秒沒被打才開始回、每秒 6；戰鬥結束時剩下的回滿；其他飛船沒有灰血', M => {
      M.setup('run', 'bulwark', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, G = CFG.GRAY; Game.state = 'play'; Game.resetMechCombat(p); p.hp = p.maxHp; p.drRec = 0;
      p.iframe = 0; p.dashT = 0; Game.hurtPlayer(30, 'mc', p);
      const hp1 = p.hp, rec = p.drRec, lost = p.maxHp - hp1;  // 實際扣的血（重裝甲、厚甲會減）
      for (let i = 0; i < 60 * (G.delay - 0.1); i++) Game.tickMech(p, 1 / 60);
      const early = p.hp - hp1;
      for (let i = 0; i < 60 * 3; i++) Game.tickMech(p, 1 / 60);
      const back = p.hp - hp1;
      p.hp = p.maxHp; p.drRec = 0;
      for (let i = 0; i < 4; i++) { p.iframe = 0; Game.hurtPlayer(25, 'mc', p); }  // 連續挨打（不會死）：灰血到上限
      const cap = p.drRec, hpEnd0 = p.hp;
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.inArena = true; Game.combatWon();
      const end = p.hp, endRec = p.drRec;
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const q = Game.player; Game.state = 'play'; q.iframe = 0; q.dashT = 0; Game.hurtPlayer(30, 'mc', q);
      const other = q.drRec || 0;
      const ok = Math.abs(rec - lost * G.share) < 0.01 && early === 0 && Math.abs(back - rec) < 0.5 && Math.abs(cap - p.maxHp * G.cap) < 0.01 && endRec === 0 && Math.abs(end - (hpEnd0 + cap)) < 0.01 && other === 0;
      return { ok, got: `扣 ${lost.toFixed(1)} 血：灰血 ${rec.toFixed(1)}；${G.delay - 0.1} 秒內回 ${early}、之後回 ${back.toFixed(1)}；連續挨打：灰血上限 ${cap.toFixed(1)}（最大 HP ${p.maxHp} 的 ${G.cap * 100}%）；戰鬥結束 ${Math.round(hpEnd0)} → ${Math.round(end)}（灰血剩 ${endRec}）；先鋒號灰血 ${other}` };
    }],
    ['機體', '幻影號：殘影', '衝刺時在起點留下殘影：附近 400 內的敵人追殘影（400 外照樣追玩家），1.5 秒後消失；其他飛船沒有殘影', M => {
      M.setup('sandbox', 'wraith', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player;
      Game.startCombat({ sandbox: true, level: 0, wavesTotal: 99 }); Game.combat.waveTimer = 1e9; Game.state = 'play'; Game.enemies = [];
      p.dashSX = p.x; p.dashSY = p.y; p.onDash();
      const d = Game.decoys[0];
      p.x += 600;
      const near = new Enemy('brute', d.x + 200, d.y, 1), far = new Enemy('brute', d.x - 500, d.y, 1);
      const tn = Game.enemyTarget(near), tf = Game.enemyTarget(far);
      for (let i = 0; i < 60 * (CFG.DECOY.t + 0.1); i++) Game.update(1 / 60);
      const gone = !Game.decoys.length;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const q = Game.player; Game.decoys = []; q.dashSX = q.x; q.dashSY = q.y; q.onDash();
      const none = !Game.decoys.length;
      return { ok: !!d && tn === d && tf === p && gone && none,
        got: `衝刺：${d ? '留下殘影' : '沒有殘影（錯誤）'}；200 外的敵人追${tn === d ? '殘影' : '玩家（錯誤）'}；500 外的追${tf === p ? '玩家' : '殘影（錯誤）'}；${CFG.DECOY.t} 秒後${gone ? '消失' : '還在（錯誤）'}；先鋒號${none ? '沒有殘影' : '也有殘影（錯誤）'}` };
    }],
    ['機體', '哨兵號：砲台', `衝刺時在起點留下砲台（${CFG.TURRET.t} 秒，每人同時一座）：用整條電路朝射程內最近的敵人開火，傷害 ×${CFG.TURRET.dmg}，傷害統計記在「砲台」；多人：隊友的砲台用隊友的武器；砲台在場上時換電路，下一發就照新的；其他飛船沒有砲台`, M => {
      M.setup('sandbox', 'sentry', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, down = Input.down, auto = Input.autoFire;
      Game.startCombat({ sandbox: true, level: 0, wavesTotal: 99 }); Game.combat.waveTimer = 1e9; Game.state = 'play';
      const e = M.targets([[250, 0]], 'brute', true, 999)[0];
      p.dashSX = p.x; p.dashSY = p.y; p.onDash(); p.onDash();  // 衝刺兩次：還是只有一座
      const nT = Game.turrets.length, one = nT === 1;
      p.x -= 2000; Input.down = false; Input.autoFire = false;  // 玩家走遠、不開火：只剩砲台打得到
      let shots = 0, dmg1 = null, ang = null;
      try {
        for (let i = 0; i < 60; i++) { Game.update(1 / 60); for (const b of Game.bullets) if (b.turret && !b.seen) { b.seen = true; shots++; if (dmg1 == null) { dmg1 = b.damage; ang = b.angle; } } }
        for (let i = 0; i < 60 * CFG.TURRET.t; i++) Game.update(1 / 60);
      } finally { Input.down = down; Input.autoFire = auto; }
      const half = dmg1 != null && Math.abs(dmg1 - WEAPONS.laser.base.damage * CFG.TURRET.dmg) < 0.01, aimed = ang != null && Math.abs(angleDiff(ang, 0)) < 0.05;
      const rec = Math.round(Game.runStats.dmg.turret || 0), gone = !Game.turrets.length;
      // 多人：隊友（散彈）的砲台一次射出散彈的彈丸數，子彈算隊友的
      const m = M.coop('scatter'); m.ship = SHIPS.sentry; Game.turrets = []; Game.bullets = [];
      M.targets([[0, 500]], 'brute', true, 999);
      m.dashSX = m.x; m.dashSY = m.y; m.onDash(); Game.updateTurrets(1 / 60);
      const mb = Game.bullets.filter(b => b.turret), mateOk = mb.length === WEAPONS.scatter.base.count && mb.every(b => b.owner === m.L);
      // 砲台還在時隊友換了電路（房主收到新電路，跟 net.js 一樣重算）：下一發照新的（武器插上鏡像迴路 = 多射一次）
      const r = splitChain(['weapon', 'mirror'].map(fullChip));
      m.L.wSock = CFG.WEAPON_SOCKETS; m.L.chain = r.chain; m.L.socks = r.socks; Game.withLoadout(m.L, () => { Game.stats = analyzeChain(Game.chain); });
      Game.bullets = []; Game.turrets[0].cd = 0; Game.updateTurrets(1 / 60);
      const swapN = Game.bullets.filter(b => b.turret).length, swapOk = swapN === WEAPONS.scatter.base.count * 2 && Game.turrets.length === 1;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const q = Game.player; Game.turrets = []; q.dashSX = q.x; q.dashSY = q.y; q.onDash();
      const none = !Game.turrets.length;
      return { ok: one && shots >= 3 && half && aimed && rec > 0 && gone && mateOk && swapOk && none,
        got: `衝刺兩次：砲台 ${nT} 座${one ? '' : '（要 1 座）'}；1 秒開火 ${shots} 發、每發 ${dmg1 == null ? '—' : +dmg1.toFixed(2)}（雷射 ${WEAPONS.laser.base.damage} × ${CFG.TURRET.dmg}）、${aimed ? '朝著敵人' : '方向不對'}；傷害統計「砲台」${rec}；${CFG.TURRET.t} 秒後${gone ? '消失' : '還在（錯誤）'}；`
          + `隊友（散彈）的砲台一次 ${mb.length} 發${mateOk ? '、算隊友的' : '（錯誤）'}；砲台還在時換成插鏡像迴路：一次 ${swapN} 發${swapOk ? '' : '（要 ' + WEAPONS.scatter.base.count * 2 + '）'}；先鋒號${none ? '沒有砲台' : '也有砲台（錯誤）'}` };
    }],
    ['機體', '星門號：傳送門','衝刺開出一對門，子彈穿過從另一個門出來；門開在飛船身上不會馬上傳送；衝刺途中穿門不會把門越拉越長', M => {
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
      return { ok: true, got: `子彈從 ${Math.round(q.bx - x0)} 的門進去，從 ${Math.round(at - x0)} 出來` };
    }],
    ['機體', '先鋒號：相位跳躍', '衝刺變成瞬移（同一幀到，之後不往前滑）；無敵時間跟一般衝刺一樣；穿過小行星落到另一邊；落點在小行星裡就停在前面；大地圖：穿過同一區的牆、跳過打開的閘門到下一區；關著的閘門、走過的閘門跳不過去；其他飛船照常衝刺', M => {
      const D = CFG.PHASE.dist, keys = new Set(Input.keys);
      const dash = p => { Input.keys = new Set(['d']); Input.dash = true; p.dashCd = 0; try { p.update(1 / 60); } finally { Input.keys = keys; Input.dash = false; } };
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); Game.enemies = []; Game.objs = [];
      const p = Game.player, x0 = p.x, rock = (dx, r) => ({ type: 'rock', x: x0 + dx, y: p.y, r, hp: 999, maxHp: 999 });
      dash(p); const d1 = p.x - x0;
      const invT = s => { let n = 1; for (let f = 0; f < 20; f++) { s.update(1 / 60); if (s.invuln) n++; } return n / 60; };  // 衝刺那一幀起算、無敵幾秒
      const inv = invT(p);
      const slide = p.x - x0 - d1;
      p.x = x0; Game.objs = [rock(75, 40)]; dash(p); const thru = p.x - x0;
      p.x = x0; Game.objs = [rock(D, 40)]; dash(p); const land = p.x - x0, landFree = Objects.shipFree(p, p.x, p.y);
      M.setup('sandbox', 'wraith', 'laser', null, null, ['weapon', null, null, null]); Game.enemies = []; Game.objs = [];
      const w = Game.player, wx = w.x; dash(w); const wd = w.x - wx, winv = invT(w);
      // 大地圖
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 3, id: 'mc' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
      const q = Game.player, g = Arena.gates[0], side = () => (q.x - g.x) * g.nx + (q.y - g.y) * g.ny;
      const jump = (x, y, a, zone) => { q.x = x; q.y = y; q.zone = zone; q.dashA = a; q.phaseJump(); Arena.collide(q, q.r, Arena.shipPass(q)); Arena.updateZone(q); };
      const fwd = Math.atan2(g.ny, g.nx);
      g.open = false; jump(g.x - g.nx * 60, g.y - g.ny * 60, fwd, 0);
      const closed = q.zone === 0 && side() <= 0;
      g.open = true; jump(g.x - g.nx * 60, g.y - g.ny * 60, fwd, 0);
      const opened = q.zone === 1 && side() > 0;
      jump(g.x + g.nx * 40, g.y + g.ny * 40, fwd + Math.PI, 1);
      const noBack = q.zone === 1 && side() > 0;
      // 同一區的牆：找一個起點和方向，中間是牆、落點是同一區的空地（隨機地圖每張都找得到：試過 30 張）
      let wall = null;
      for (let y = 20; y < Arena.H && !wall; y += 20) for (let x = 20; x < Arena.W && !wall; x += 20) for (let k = 0; k < 16 && !wall; k++) {
        const a = k / 16 * TAU, c = Math.cos(a), s = Math.sin(a), ex = x + c * D, ey = y + s * D, z = Arena.zoneOf(x, y);
        if (Arena.zoneOf(ex, ey) !== z || !Objects.shipFree(q, x, y) || !Objects.shipFree(q, ex, ey) || Arena.f(ex, ey) < q.r + 6) continue;
        let solid = false; for (let d = 16; d < D - 16; d += 4) if (Arena.f(x + c * d, y + s * d) < 0) solid = true;
        if (solid) wall = [x, y, a, ex, ey, z];
      }
      let wallOk = false, otherZone = false;
      if (wall) {
        jump(wall[0], wall[1], wall[2], wall[5]); wallOk = Math.hypot(q.x - wall[3], q.y - wall[4]) < 1 && q.zone === wall[5];
        // 同一個位置，但飛船已經在下一區（這一區走過了）：這一區的落點都不算，現在的地圖區與區之間的牆比瞬移距離厚，只能這樣測
        jump(wall[0], wall[1], wall[2], wall[5] + 1); otherZone = Math.hypot(q.x - wall[3], q.y - wall[4]) > 1;
      }
      const ok = Math.abs(d1 - D) < 1 && Math.abs(slide) < 1 && Math.abs(thru - D) < 1 && land <= D - 40 - p.r && land > D - 40 - p.r - 6 && landFree && wd < 30 && Math.abs(inv - winv) < 0.02
        && closed && opened && noBack && wallOk && otherZone;
      return { ok, got: `空地 ${d1.toFixed(1)}（之後滑 ${slide.toFixed(1)}）；穿小行星 ${thru.toFixed(1)}；落點在小行星裡 → 停在 ${land.toFixed(1)}${landFree ? '' : '（陷在裡面）'}；幻影號第一幀 ${wd.toFixed(1)}；無敵 ${inv.toFixed(2)} 秒（幻影號一般衝刺 ${winv.toFixed(2)}）；`
        + `關著的閘門${closed ? '跳不過' : '跳過去了'}；打開的閘門${opened ? '跳到下一區' : '沒過去'}；往回${noBack ? '跳不回去' : '跳回去了'}；同一區的牆${wall ? wallOk ? '穿過去了' : '沒穿過' : '（地圖上找不到）'}；已經在下一區時${otherZone ? '跳不回這一區' : '跳回這一區了'}` };
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
    ['地圖物件', '小行星帶', '10 傷害打不動；打爆掉晶體（耐久每 32 一顆），不算玩法擊殺；小行星後面的敵人看不到；感測器 4 層看得到；敵人不會穿過小行星，從帶子的縫鑽過來追到玩家；飛船（含衝刺）鑽不過比自己窄的縫', M => M.all([
      M => {  // 小行星：重武器才打得動
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
        const o = { type: 'rock', x: 0, y: 0, r: 20, hp: 80, maxHp: 80 };
        Game.objs = [o]; Game.pickups = [];
        Objects.hitRock(o, 10, null, 0, 0); const hp1 = o.hp;
        Objects.hitRock(o, 100, null, 0, 0);
        const drops = Game.pickups.length, want = Math.round(80 / 32);
        return { ok: hp1 === 80 && o.dead && drops === want && !Game.playKills.boomerang, got: `小彈後 HP ${hp1}，大彈後${o.dead ? '碎裂' : '還在'}，掉 ${drops} 顆晶體（應為 ${want}），迴旋玩法擊殺 ${Game.playKills.boomerang || 0}（應為 0）` };
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
      M => {  // 飛船：兩顆小行星中間 11 寬的縫（飛船直徑 24）走路、衝刺都鑽不過去（先鋒號的相位跳躍是瞬移，另外檢查；以前衝刺會被兩邊輪流推、擠過去卡進凹洞）
        const go = dash => {
          M.setup('sandbox', 'bulwark', 'laser', null, null, ['weapon', null, null, null]); Game.enemies = [];
          const p = Game.player, rx = p.x + 80, keys = new Set(Input.keys);
          p.y += 3;  // 稍微偏一邊（剛好在正中間的話兩邊推力抵銷）
          Game.objs = [-1, 1].map(k => ({ type: 'rock', x: rx, y: p.y - 3 + k * (26 + 5.5), r: 26, hp: 999, maxHp: 999 }));
          let deep = 0;
          Input.keys = new Set(['d']); Input.dash = false; Input.dashHeld = dash;
          try {
            for (let f = 0; f < 60 * 3; f++) {
              p.update(1 / 60);
              for (const o of Game.objs) deep = Math.max(deep, o.r + p.r - Math.hypot(p.x - o.x, p.y - o.y));
            }
          } finally { Input.keys = keys; Input.dashHeld = false; Input.dash = false; }
          return { through: p.x > rx, deep };
        };
        const w = go(false), d = go(true);
        return { ok: !w.through && !d.through && w.deep < 2 && d.deep < 2,
          got: `走路${w.through ? '鑽過去了' : '過不去'}（最多陷進 ${w.deep.toFixed(1)}）；衝刺${d.through ? '鑽過去了' : '過不去'}（最多陷進 ${d.deep.toFixed(1)}）` };
      },
    ])],
    ['地圖物件', '小行星凹洞：敵人鑽得出來', `敵人被擠進小行星中間的凹洞（站在尋路走不到的格子）時，先朝最近走得到的格子走出來；出口朝著黑洞也一樣（繞黑洞的轉向不會把牠轉回凹洞）；被圍死（出口也被小行星擋住）${OBJ.ESC_GHOST} 秒後穿過小行星出來`, M => {
      // pocket(rocks, hole, player)：蟲群從 (ex, ey) 出發，1.5 秒內要離開 30 以上、站到走得到的格子，而且沒穿進小行星
      //   ghost：被圍死（走得到的格子都在小行星外面）：容許穿過小行星，3 秒內出來
      const pocket = (ex, ey, rocks, hole, pp, ghost = false) => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const p = Game.player; p.x = ex + pp[0]; p.y = ey + pp[1];
        const e = M.targets([[-pp[0], -pp[1]]], 'swarmer', false, 1)[0]; e.t = { ...e.t, dmg: 0 };
        Game.objs = rocks.map(([dx, dy, r]) => ({ type: 'rock', x: ex + dx, y: ey + dy, r, hp: 999, maxHp: 999 }));
        Game.objs.push({ type: 'hole', x: ex + hole[0], y: ey + hole[1], r: OBJ.HOLE_CORE, R: OBJ.HOLE_R, tick: 0 });
        Objects.flowT = 0;
        const free = () => { const F = Objects.fields && Objects.fields.get(p), C = OBJ.FLOW_CELL; return !!F && F.dist[Math.floor(e.y / C) * F.W + Math.floor(e.x / C)] >= 0; };
        let inside = false, tOut = null;
        for (let f = 0; f < (ghost ? 180 : 90) && tOut == null; f++) {
          Game.time += 1 / 60; Objects.update(1 / 60); e.update(1 / 60, p);
          p.x = ex + pp[0]; p.y = ey + pp[1];  // 玩家不動（不被黑洞拉走）
          if (Game.objs.some(o => o.type === 'rock' && dist2(e.x, e.y, o.x, o.y) < (o.r + e.r - 3) ** 2)) inside = true;
          if (f > 0 && Math.hypot(e.x - ex, e.y - ey) > 30 && free()) tOut = f / 60;
        }
        return { ok: (ghost || !inside) && tOut != null, got: `${ghost ? '圍死：' : ''}${tOut != null ? `${tOut.toFixed(2)} 秒離開凹洞` : `${ghost ? 3 : 1.5} 秒還在凹洞（離起點 ${Math.round(Math.hypot(e.x - ex, e.y - ey))}）`}${inside && !ghost ? '、穿進小行星了' : ''}` };
      };
      return M.all([
        // 2026-10-16 整局模擬（相刃第 74 局）卡住的地形：蟲群貼著 3 顆小行星，右上 330 有黑洞，玩家在右下 80；以前一直撞小行星、刃片也被擋住，212 秒打不完（格子對齊照原本那局）
        () => pocket(556, 800, [[46, -1, 27], [34, 11, 24], [-11, 38, 22], [119, -61, 24], [160, -84, 18], [259, -174, 18], [316, -213, 32], [346, -230, 21]], [291, -154], [78, 22]),
        // 出口朝著黑洞：左右、下面是小行星，上面 330 是黑洞，玩家在下面
        () => pocket(1200, 900, [[-35, 0, 24], [35, 0, 24], [0, 36, 24], [-60, 30, 24], [60, 30, 24]], [0, -330], [0, 160]),
        // 圍死：6 顆小行星圍一圈、互相重疊，沒有縫（2026-10-18 整局模擬：列隊蟲被小行星擠進牆裡，182 秒不動）；黑洞放遠一點
        () => pocket(1200, 900, [0, 1, 2, 3, 4, 5].map(i => [Math.cos(i / 6 * TAU) * 40, Math.sin(i / 6 * TAU) * 40, 24]), [900, 900], [0, 200], true),
      ]);
    }],
    ['地圖物件', '黑洞：正中間也扣血', `敵人在黑洞核心裡每秒扣最大 HP 的 ${OBJ.HOLE_PCT * 100}%（至少每 0.25 秒 10），剛好在正中間也一樣`, M => {
      // 2026-10-16 整局模擬（散彈第 66 局）：蟲群被拉到正中間（離中心不到 1）又自己走出一點、來回擺，以前那一段整個跳過、永遠不扣血，戰鬥卡住
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, hx = p.x + 400, hy = p.y;
      Game.objs = [{ type: 'hole', x: hx, y: hy, r: OBJ.HOLE_CORE, R: OBJ.HOLE_R, tick: 0 }];
      const e = M.targets([[400, 0]], 'swarmer', true, 1)[0], hp0 = e.hp;
      for (let f = 0; f < 60; f++) { Game.time += 1 / 60; e.x = hx; e.y = hy; Objects.update(1 / 60); }
      return { ok: e.hp < hp0 - 10 || e.dead, got: `正中間 1 秒：HP ${Math.round(hp0)} → ${e.dead ? '死了' : Math.round(e.hp)}` };
    }],
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
    ['地圖物件', '敵人不生在行星裡', '敵人的出生點離行星、小行星表面至少 40（生在裡面會被推進物件中間的死角出不來）', M => {  // 2026-10-13 以前沒檢查：整局模擬相刃第 91 局蟲群生在行星裡、卡進死角，刃片打不到
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player;
      Game.objs = [{ type: 'planet', x: p.x + 650, y: p.y, r: 200 }, { type: 'rock', x: p.x - 600, y: p.y + 200, r: 60, hp: 999 }, { type: 'rock', x: p.x, y: p.y - 650, r: 60, hp: 999 }];
      let bad = 0, n = 0;
      for (let k = 0; k < 200; k++) { Game.enemies = []; Game.spawnEnemy('swarmer'); const e = Game.enemies[0]; if (!e) continue; n++; if (Objects.onSolid(e, 39)) bad++; }
      return { ok: n === 200 && bad === 0, got: `生了 ${n} 隻，壓到或貼著行星／小行星的 ${bad} 隻（要 0）` };
    }],
    ['地圖物件', '黑洞邊不卡住','敵人在黑洞範圍邊上，要走的方向偏向「決定好要繞的另一邊」：閃避後的方向不能是 0（兩股力量剛好抵銷時，敵人會停在範圍邊上進進出出）', M => {  // 以前會抵銷；用 2026-10-09 整局模擬卡住那一局的數值
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, hx = p.x + 450, hy = p.y - 200;
      Game.objs = [{ type: 'hole', x: hx, y: hy, r: 34, R: 280, tick: 0 }];
      const e = new Enemy('lurker', hx - 300, hy - 76, 1); e.spawnT = 0; e.holeSide = 1; Game.enemies = [e];
      const [sx, sy] = Objects.steer(e, 0.51, 0.86), d = Math.hypot(e.x - hx, e.y - hy);  // 那一局的尋路方向（玩家在黑洞右下）
      const len = Math.hypot(sx, sy), side = (sx * -(e.y - hy) + sy * (e.x - hx)) / d;  // 繞的分量（照 holeSide 那一邊）
      return { ok: len > 0.5 && side > 0.5, got: `閃避後的方向長度 ${len.toFixed(2)}（要 > 0.5），往繞的那一邊 ${side.toFixed(2)}（要 > 0.5）` };
    }],
    ['地圖物件', '尋路繞開黑洞範圍', '玩家和敵人中間有黑洞：敵人的路線繞在閃避範圍（R + 30）外面（不會走到範圍邊上被推開卡住）', M => {  // 以前路線直接穿過去
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
    ['敵人', '列隊蟲', `6 節排成一列跟著走；頭被打死，下一節變成頭；身體被小行星擋住、離前一節超過 ${CFG.WORM_CUT.gap} 達 ${CFG.WORM_CUT.t} 秒就斷開自己當頭（會尋路繞出來）`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, W = [];
      for (let i = 0; i < 6; i++) { const w = new Enemy('worm', p.x + 600 + i * 22, p.y, 1); w.spawnT = 0; w.t = { ...w.t, dmg: 0 }; w.ahead = W[i - 1] || null; W.push(w); }
      Game.enemies = W.slice();
      for (let f = 0; f < 120; f++) { Game.time += 1 / 60; for (const w of W) w.update(1 / 60, p); }
      const gap = Math.max(...W.slice(1).map((w, i) => Math.hypot(w.x - W[i].x, w.y - W[i].y)));
      W[0].dead = true; W[1].update(1 / 60, p);
      // 被擋住：第 2 節在小行星圍成的 U 形裡（開口朝左），頭在右邊 200、不動；直線跟會一直撞小行星
      Game.objs = [-90, -45, 0, 45, 90].map(a => ({ type: 'rock', x: p.x + 300 + Math.cos(a * Math.PI / 180) * 40, y: p.y + Math.sin(a * Math.PI / 180) * 40, r: 22, hp: 999, maxHp: 999 }));
      const hd = new Enemy('worm', p.x + 500, p.y, 1), bd = new Enemy('worm', p.x + 300, p.y, 1);
      hd.spawnT = bd.spawnT = 0; hd.t = { ...hd.t, dmg: 0, speed: 0 }; bd.t = { ...bd.t, dmg: 0 }; bd.ahead = hd; Game.enemies = [hd, bd]; Objects.flowT = 0;
      p.x += 700;  // 玩家在頭的右邊
      let cut = null;
      for (let f = 0; f < 60 * 6; f++) { Game.time += 1 / 60; Objects.update(1 / 60); hd.update(1 / 60, p); bd.update(1 / 60, p); if (cut == null && !bd.ahead) cut = f / 60; }
      const out = bd.x > p.x - 700 + 300 + 40;
      return { ok: gap < 40 && W[1].ahead === null && cut != null && out, got: '最大間距 ' + Math.round(gap) + '；頭死後第 2 節' + (W[1].ahead === null ? '變成頭' : '還在跟')
        + `；被小行星擋住：${cut != null ? cut.toFixed(1) + ' 秒斷開自己當頭' : '一直沒斷開'}、6 秒後${out ? '繞出來了' : `還在凹洞（${Math.round(bd.x - (p.x - 700))}）`}` };
    }],
    ['敵人', '盾衛', '打到盾（朝固定方向）的子彈反彈回去變成敵彈，不扣血；從背面打照常受傷；待機的被打在盾上也會醒', M => {
      const shoot = ang => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const e = M.targets([[150, 0]], 'shield', true, 1)[0]; e.shieldA = ang; const hp = e.hp;
        e.alert = false; e.home = [e.x, e.y];  // 待機（警戒）：發現距離暫時設 0，只看被子彈打到會不會醒
        const see = CFG.ALERT.see; CFG.ALERT.see = 0;
        try { M.run(10); } finally { CFG.ALERT.see = see; }
        return { dmg: hp - e.hp, eb: Game.eBullets.length, woke: e.alert };
      };
      const front = shoot(Math.PI), back = shoot(0);
      // 擦到盾的外緣（沒碰到身體，離中心 r + 9）也要反彈
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const g = M.targets([[150, 0]], 'shield', true, 1)[0]; g.shieldA = Math.PI;
      const off = g.r + 9, b = new Bullet(g.x - 120, g.y + off, 0, shot({ angle: 0, speed: 900, damage: 10, radius: 3, life: 1 }), 0, null);
      Game.bullets = [b];
      for (let f = 0; f < 20 && !b.dead; f++) Game.updateBullets(1 / 60);
      const edge = Game.eBullets.length;
      return { ok: front.dmg === 0 && front.eb > 0 && front.woke && back.dmg > 0 && back.eb === 0 && back.woke && edge > 0, got: '正面：扣 ' + Math.round(front.dmg) + '、反彈 ' + front.eb + ' 發、' + (front.woke ? '醒了' : '沒醒（錯誤）') + '；背面：扣 ' + Math.round(back.dmg) + '、反彈 ' + back.eb + ' 發、' + (back.woke ? '醒了' : '沒醒（錯誤）') + '；擦到盾外緣：反彈 ' + edge + ' 發' };
    }],
    ['敵人', '盾衛的盾是實心的', '飛船撞到盾（盾那一側）會被推到盾外、往外彈開並受撞擊傷害；背面同樣距離沒事；靠牆時不會被推進牆裡（改推盾衛、飛船照樣能操控）', M => {
      const bump = ang => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const p = Game.player, e = M.targets([[150, 0]], 'shield', true, 1)[0]; e.shieldA = ang; e.t = { ...e.t, dmg: ENEMY_TYPES.shield.dmg };
        p.x = e.x - (e.r + p.r + 6); p.y = e.y; p.iframe = 0; p.vx = p.vy = 0; const hp = p.hp;
        Game.updateEnemies(1 / 60);
        return { dmg: hp - p.hp, d: Math.hypot(p.x - e.x, p.y - e.y), R: e.r + SHIELD_OUT + p.r, out: -p.vx };  // 盾朝左：往外 = 往左
      };
      const front = bump(Math.PI), back = bump(0);
      // 靠牆（2026-10-10）：飛船貼著左邊界、盾衛在右邊盾朝左 → 飛船不能被推出場地，改推盾衛；之後 60 幀飛船照樣能操控（kbT 不會一直被重設）
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const P = Game.player, S = M.targets([[150, 0]], 'shield', false, 1)[0]; S.shieldA = Math.PI; S.spawnT = 0; S.t = { ...S.t, dmg: 0 };
      P.x = P.r; P.y = 800; S.x = P.x + S.r + P.r + 4; S.y = 800; P.iframe = 99; P.vx = P.vy = 0; const sx0 = S.x;
      let kbFrames = 0, minX = P.x;
      for (let f = 0; f < 60; f++) { Game.updateEnemies(1 / 60); if (P.kbT > 0) kbFrames++; minX = Math.min(minX, P.x); P.kbT = Math.max(0, (P.kbT || 0) - 1 / 60); }
      const wall = { inside: minX >= P.r - 0.01, shoved: S.x - sx0, kbFrames, x: minX };
      return { ok: front.dmg > 0 && front.d >= front.R - 0.5 && front.out > 300 && back.dmg === 0 && back.d < back.R - 1 && wall.inside && wall.shoved > 5 && wall.kbFrames === 0, got: '盾那側：扣 ' + Math.round(front.dmg) + '、推到 ' + Math.round(front.d) + '（盾外緣 ' + front.R + '）、往外彈 ' + Math.round(front.out) + '；背面：扣 ' + Math.round(back.dmg) + '、距離 ' + Math.round(back.d) + '；靠牆：飛船最左 ' + wall.x.toFixed(1) + '（不能小於 ' + Game.player.r + '）、盾衛被推開 ' + Math.round(wall.shoved) + '、不能操控的幀 ' + wall.kbFrames + '（要 0）' };
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
    ['敵人', '母巢', '每 4 秒生 2 隻蟲群，最多 8 隻；生出來的不算玩法擊殺；不吃擊退、吸引拉不動（位置不變）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'rear', null, null]);
      const p = Game.player, h = M.targets([[300, 0]], 'hive', true, 1)[0]; h.cd = 0.05;
      for (let f = 0; f < 60 * 30; f++) { Game.time += 1 / 60; h.update(1 / 60, p); }
      const kids = Game.enemies.filter(q => q.type === 'swarmer' && !q.dead), k = kids[0];
      const x0 = h.x, y0 = h.y;  // 重擊退的一下＋吸引那種直接加速度，之後走 30 幀
      h.hurt(1, 600, 300, 'direct', null, 3); h.vx += 500;
      for (let f = 0; f < 30; f++) h.update(1 / 60, p);
      const moved = Math.hypot(h.x - x0, h.y - y0);
      Game.playKills = {}; Game.tagPlay(k, null, 'rear'); k.hurt(9999, 0, 0, 'direct', null);
      return { ok: kids.length === 8 && !(Game.playKills.rear > 0) && moved < 0.01, got: '生了 ' + kids.length + ' 隻；打死一隻玩法擊殺 +' + (Game.playKills.rear || 0) + '；被擊退＋拉之後移動 ' + moved.toFixed(2) + '（要 0）' };
    }],
    ['敵人', '寶藏無人機：出現、逃跑、打掉保證稀有', `只在指定的那一區出場；往離玩家的反方向逃；打掉：這場的三選一保證稀有晶片（刷新也保證）、不掉晶體`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 2, elites: 0, treasure: 2 });
      Game.startWave(1); const w1 = Game.combat.pending.includes('treasure');
      Game.startWave(2); const w2 = Game.combat.pending.filter(x => x === 'treasure').length;
      Arena.reset(); Game.objs = [];  // 逃跑量在方形場地：大地圖是隨機的，玩家擺的位置可能貼牆，寶藏被牆擋住跑不遠（約 1/50）；大地圖生的小行星、行星也清掉（留著會擋住牠）
      const p = Game.player, e = M.targets([[200, 0]], 'treasure', false, 1)[0], d0 = Math.hypot(e.x - p.x, e.y - p.y);
      for (let f = 0; f < 120; f++) { Game.time += 1 / 60; e.update(1 / 60, p); }
      const d1 = Math.hypot(e.x - p.x, e.y - p.y);
      Game.pickups = []; e.hurt(1e6, 0, 0, 'direct', null);
      const drops = Game.pickups.length, got = (Game.combat.bonus || []).join() === 'treasure';
      Game.inArena = true; Game.state = 'play'; Game.credits = 1e6; Game.combatWon();
      const has = () => Game.state === 'reward' && Game.reward.options.some(rareOf);
      let re = 0; const first = has();
      for (let i = 0; i < 30; i++) { Game.rerollReward(); if (has()) re++; }
      return { ok: !w1 && w2 === 1 && d1 > d0 + 250 && got && drops === 0 && first && re === 30,
        got: `第 1 區${w1 ? '有（錯誤）' : '沒有'}、第 2 區 ${w2} 隻；2 秒內距離 ${Math.round(d0)} → ${Math.round(d1)}；打掉${got ? '' : '沒'}記下、掉晶體 ${drops}；三選一${first ? '有' : '沒有'}稀有、刷新 ${re}/30 有` };
    }],
    ['敵人', '寶藏無人機：逃走', `出場 ${CFG.TREASURE.life} 秒沒打掉就躍遷離開：不算擊殺、不掉晶體，三選一不保證稀有`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0, treasure: 1 });
      const p = Game.player, e = M.targets([[200, 0]], 'treasure', false, 1)[0], k0 = Game.kills;
      let tGone = null;
      for (let f = 0; f < 60 * (CFG.TREASURE.life + 1) && tGone == null; f++) { Game.time += 1 / 60; e.update(1 / 60, p); if (e.dead) tGone = f / 60; }
      const alive = tGone == null ? '沒有離開' : `${tGone.toFixed(1)} 秒離開`;
      Game.inArena = true; Game.state = 'play'; Game.combatWon();
      const add = Game.reward.rareAdd || 0;
      return { ok: tGone != null && Math.abs(tGone - CFG.TREASURE.life) < 0.1 && Game.kills === k0 && Game.pickups.length === 0 && !(Game.combat.bonus || []).length && add === 0,
        got: `${alive}；擊殺 +${Game.kills - k0}、晶體 ${Game.pickups.length}；三選一多保證 ${add} 格` };
    }],
    ['敵人', '蟲潮', `那一區全是蟲群：數量 ×${CFG.SWARM.count}（照一般一波的預算）、血量 ×${CFG.SWARM.hp}；每 ${CFG.SWARM.clump} 隻從同一個地方湧出，出場間隔 ${CFG.SWARM.gap} 秒；其他區照常`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 3, id: 'mc' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, swarm: 2 });
      const C = Game.combat;
      Game.startWave(1); const w1 = C.swarmArea;
      Game.startWave(2);
      const want = Math.round((5 + 2 * 3 + 3 * 3) * CFG.WAVE_MUL * CFG.SWARM.count), L = [...C.pending], allBug = L.every(x => x === 'swarmer');
      Game.enemies = []; C.spawnClock = 0;
      for (let i = 0; i < 100; i++) Game.updateWaves(0.01);  // 1 秒
      const per1s = Game.enemies.length, E = Game.enemies;
      const tight = E.slice(1, CFG.SWARM.clump).every(e => Math.hypot(e.x - E[0].x, e.y - E[0].y) < CFG.SWARM.jitter * 1.5 + 1);
      C.swarmArea = false; Game.spawnEnemy('swarmer'); const normal = Game.enemies[Game.enemies.length - 1].maxHp;
      const k = E[0].maxHp / normal;
      return { ok: !w1 && allBug && L.length === want && Math.abs(per1s - 1 / CFG.SWARM.gap) <= 2 && tight && Math.abs(k - CFG.SWARM.hp) < 0.01,
        got: `第 1 區${w1 ? '是蟲潮（錯誤）' : '照常'}；第 2 區 ${L.length} 隻（應為 ${want}）${allBug ? '全是蟲群' : '混了別的（錯誤）'}；1 秒出場 ${per1s} 隻；前 ${CFG.SWARM.clump} 隻${tight ? '擠在一起' : '散開（錯誤）'}；血量 ×${k.toFixed(2)}` };
    }],
    ['敵人', '精英亂入', `3 區的一般戰鬥、第 2 區以後：這一區都出場、剩 ${CFG.INTRUDE.at * 100}% 以下時闖進一隻帶詞綴的精英（只闖一次）；分裂的兩隻都打掉：這場的三選一保證稀有`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.node = { type: 'combat', L: 3, id: 'mc' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, intrude: 2 });
      const C = Game.combat, els = () => Game.enemies.filter(e => e.intruder);
      Game.startWave(1); C.pending = []; Game.enemies = []; Game.updateWaves(0.01); const w1 = els().length;
      Game.startWave(2); const inList = C.pending.includes('elite');
      C.pending.push('worm');  // 列隊蟲名單上一隻、場上 6 節：「剩一半」要照場上的數量算
      while (C.pending.length) Game.spawnEnemy(C.pending.shift());
      const spawned = Game.enemies.length;
      Game.updateWaves(0.01); const early = els().length;
      Game.enemies = Game.enemies.slice(0, Math.floor(spawned * CFG.INTRUDE.at));
      Game.updateWaves(0.01); Game.updateWaves(0.01);
      const L = els(), e = L[0], nAff = e ? (e.affixes || []).length : 0;
      if (!e) return { ok: false, got: `還很多時闖進 ${early} 隻；剩一半時場上沒有亂入的精英` };
      e.setAffixes(['split']); e.doSplit();
      const k = Game.enemies[Game.enemies.length - 1];
      e.hurt(1e9, 0, 0, 'direct', null); const after1 = (C.bonus || []).length;
      k.hurt(1e9, 0, 0, 'direct', null); const after2 = (C.bonus || []).join();
      Game.inArena = true; Game.state = 'play'; Game.combatWon();
      const rare = Game.state === 'reward' && Game.reward.options.some(rareOf) && Game.reward.rareAdd === CFG.BONUS.intrude.rare;
      return { ok: w1 === 0 && !inList && early === 0 && L.length === 1 && nAff === affixCount(Game.sector) && k.intruder === e.intruder && after1 === 0 && after2 === 'intrude' && rare,
        got: `第 1 區闖進 ${w1} 隻；第 2 區出場名單${inList ? '有精英（錯誤）' : '沒有精英'}、出場 ${spawned} 隻、還很多時 ${early} 隻、剩一半時 ${L.length} 隻（${nAff} 個詞綴）；分裂後打掉一隻${after1 ? '就給了（錯誤）' : '還沒給'}、兩隻都打掉：${after2 || '沒給'}；三選一${rare ? '保證稀有' : '沒有保證（錯誤）'}` };
    }],
    ['敵人', '寶藏無人機：不傷人', '不開火、撞到也不扣血、不給無敵時間', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player; Game.state = 'play'; p.iframe = 0; p.dashT = 0;
      const e = M.targets([[0, 0]], 'treasure', false, 1)[0], hp0 = p.hp;
      let touch = 0;
      for (let f = 0; f < 120; f++) { Game.time += 1 / 60; e.x = p.x; e.y = p.y; Game.updateEnemies(1 / 60); if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r) touch++; }
      return { ok: touch > 0 && p.hp === hp0 && !(p.iframe > 0) && Game.eBullets.length === 0, got: `貼著 ${touch} 幀：HP ${hp0} → ${p.hp}、無敵 ${(p.iframe || 0).toFixed(2)}、敵彈 ${Game.eBullets.length}` };
    }],
    ['敵人', '警戒：待機、看到才追、打到會叫醒同伴', `分區的戰鬥出場先待機（在出生點 ${CFG.ALERT.wander} 內晃、不開火）；玩家 ${CFG.ALERT.see} 以內或被打到才追，並叫醒身邊 ${CFG.ALERT.call} 以內的同伴（被叫醒的不再往外叫）；精英亂入、寶藏無人機、不分區的戰鬥不待機；母巢待機時照生蟲群（在旁邊晃），醒了一起醒`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 3, id: 'mc' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 }); Arena.reset();
      const p = Game.player, dt = 1 / 60;
      p.x = 500; p.y = 900;  // 方形場地（2400×1600）左邊：右邊、上面擺的敵人都在場地裡
      const sp = (type, o) => { Game.spawnEnemy(type, o); const e = Game.enemies[Game.enemies.length - 1]; e.spawnT = 0; return e; };
      Game.enemies = [];
      const put = (e, dx, dy) => { e.x = p.x + dx; e.y = p.y + dy; e.home = [e.x, e.y]; e.zone = 0; return e; };
      // a、b 相距 100（各晃 70，最遠 240 < call）；c 離 a 420（最近 280 > call）
      const a = put(sp('spitter'), 600, 0), b = put(sp('spitter'), 700, 0), c = put(sp('spitter'), 600, -420);
      const idle0 = !a.alert && !b.alert && !c.alert;
      const step = (n, L = Game.enemies) => { for (let f = 0; f < n; f++) { Game.time += dt; for (const e of L) if (!e.dead) e.update(dt, p); } };
      step(120, [a, b, c]);
      const drift = Math.max(...[a, b, c].map(e => Math.hypot(e.x - e.home[0], e.y - e.home[1])));
      const still = !a.alert && !b.alert && !c.alert && Game.eBullets.length === 0 && drift <= CFG.ALERT.wander + 20;
      a.hurt(1, 0, 0, 'direct', null);
      const bCall = b.alert, cCall = c.alert, called = a.alert && a.alertT > 0 && bCall && !cCall;
      p.x = c.x - CFG.ALERT.see + 30; p.y = c.y; step(1, [c]);
      const seen = c.alert;
      // 不待機的：精英亂入、寶藏無人機、不分區的戰鬥
      const intr = sp('elite', { intruder: true }), tre = sp('treasure');
      Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 }); Arena.reset(); Game.enemies = [];
      const one = sp('spitter');
      const awake = intr.alert && tre.alert && one.alert;
      // 母巢：待機時照生，生出來的在旁邊晃、也待機；母巢醒了一起醒
      Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 }); Arena.reset(); Game.enemies = [];
      p.x = 500; p.y = 900;
      const h = put(sp('hive'), 700, 0); h.cd = 0;
      step(60 * 5);
      const kids = Game.enemies.filter(e => e.type === 'swarmer'), kIdle = kids.length > 0 && kids.every(k => !k.alert && Math.hypot(k.x - h.x, k.y - h.y) < 45 + CFG.ALERT.wander + 30);
      h.hurt(1, 0, 0, 'direct', null);
      const kWake = kids.every(k => k.alert);
      return { ok: idle0 && still && called && seen && awake && kIdle && kWake,
        got: `出場${idle0 ? '待機' : '就追（錯誤）'}；2 秒內離出生點最遠 ${Math.round(drift)}、敵彈 ${Game.eBullets.length}；打 a：a ${a.alert ? '醒' : '沒醒'}、100 外的 b ${bCall ? '醒' : '沒醒（錯誤）'}、420 外的 c ${cCall ? '醒（錯誤）' : '沒醒'}；靠近 c 到 ${CFG.ALERT.see - 30}：${seen ? '醒' : '沒醒'}；精英亂入／寶藏／不分區：${[intr, tre, one].map(e => e.alert ? '醒' : '待機').join('／')}；母巢 5 秒生 ${kids.length} 隻${kIdle ? '、在旁邊待機' : '（沒待機或跑遠，錯誤）'}、打母巢後${kWake ? '全醒' : '沒全醒'}` };
    }],
    ['敵人', '警報艇', `分區的戰鬥第 ${CFG.ALARM.from} 區以後每區 ${CFG.ALARM.chance * 100}% 放 1 隻（蟲潮那區不放）；不攻擊、撞到不扣血；被打到開始響、往遠離玩家的方向逃，${CFG.ALARM.delay} 秒後開始每 ${CFG.ALARM.every} 秒叫醒身邊 ${CFG.ALARM.r} 以內待機的敵人（邊逃邊叫）；倒數內打掉就完全不會叫`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 3, id: 'mc' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, swarm: 3 }); Arena.reset();
      Game.objs = [];  // 開戰時隨機放的地圖物件（行星、小行星帶）會擋住逃跑路線
      const p = Game.player, dt = 1 / 60, A = CFG.ALARM, ch0 = A.chance;
      A.chance = 1;
      let n1, n2, n3;
      try { Game.startWave(1); n1 = Game.combat.pending.filter(x => x === 'alarm').length; Game.startWave(2); n2 = Game.combat.pending.filter(x => x === 'alarm').length; Game.startWave(3); n3 = Game.combat.pending.filter(x => x === 'alarm').length; }
      finally { A.chance = ch0; }
      // 方形場地：玩家 (600, 800)、警報艇在右邊 300；近的（離警報艇約 320）、前方遠的（700，警報艇往右逃才會進到 r 內）、身後的（離玩家 540：晃 70 也還在發現距離外；離警報艇 840）
      const sp = (type, x, y) => { Game.spawnEnemy(type); const e = Game.enemies[Game.enemies.length - 1]; e.spawnT = 0; e.x = x; e.y = y; e.home = [x, y]; e.zone = 0; return e; };
      const run = kill => {
        Game.enemies = []; p.x = 600; p.y = 800;
        const al = sp('alarm', 900, 800), near = sp('spitter', 1100, 1050), ahead = sp('spitter', 1700, 800), behind = sp('brute', 60, 800);
        const step = n => { for (let f = 0; f < n; f++) { Game.time += dt; for (const e of Game.enemies) if (!e.dead) e.update(dt, p); p.x = 600; p.y = 800; } };
        al.hurt(1, 0, 0, 'direct', null);
        step(Math.round(60 * (A.delay - 0.2)));
        const early = [near, ahead, behind].filter(e => e.alert).length, ringing = al.modeT > 0;
        if (kill) al.hurt(1e9, 0, 0, 'direct', null);
        step(18);  // 第一次叫人之後
        const first = { near: near.alert, ahead: ahead.alert };
        step(60 * 2);
        return { early, ringing, first, ahead: ahead.alert, behind: behind.alert, fled: al.x - 900 };
      };
      const r1 = run(false), r2 = run(true);
      // 撞到不扣血
      Game.enemies = []; Game.eBullets = []; Game.state = 'play'; p.iframe = 0;  // 前面叫醒的噴吐者開過火：清掉，只看警報艇自己
      const al = sp('alarm', p.x, p.y), hp0 = p.hp;
      for (let f = 0; f < 30; f++) { al.x = p.x; al.y = p.y; Game.updateEnemies(dt); }
      const yes = b => b ? '醒' : '沒醒';
      return { ok: n1 === 0 && n2 === 1 && n3 === 0 && r1.ringing && r1.early === 0 && r1.first.near && !r1.first.ahead && r1.ahead && !r1.behind && r1.fled > 150
          && r2.early === 0 && !r2.first.near && !r2.ahead && p.hp === hp0 && Game.eBullets.length === 0,
        got: `機率 100% 時：第 1／2／3（蟲潮）區 ${n1}／${n2}／${n3} 隻；打到後 ${A.delay - 0.2} 秒${r1.ringing ? '在響' : '沒在響'}、醒了 ${r1.early} 隻；第一次叫人：近的${yes(r1.first.near)}、前方 700 的${yes(r1.first.ahead)}；再 2 秒：前方的${yes(r1.ahead)}、身後的${yes(r1.behind)}（逃了 ${Math.round(r1.fled)}）；倒數內打掉：近的${yes(r2.first.near)}、前方的${yes(r2.ahead)}；撞到 HP ${hp0} → ${p.hp}` };
    }],
    ['事件', '航圖：？事件節點', `每張圖 ${CFG.EVENT.count[0]}～${CFG.EVENT.count[1]} 個（大多 2 個）、只在第 2～5 層、同一個分岔不會有兩個；每個都有事件種類；星圖情報的 2 個目標是走得到的一般戰鬥；雙人同步航圖時事件和寶藏星域都帶著`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      let bad = [], two = 0, N = 60;
      for (let i = 0; i < N; i++) {
        const m = genMap(), all = m.flat(), byId = id => all.find(n => n.id === id), ev = all.filter(n => n.type === 'event');
        if (ev.length >= 2) two++;
        if (ev.length < CFG.EVENT.count[0] || ev.length > CFG.EVENT.count[1]) bad.push(`${ev.length} 個`);
        if (ev.some(n => n.L < 1 || n.L > 4)) bad.push('層數');
        if (ev.some(n => !EVENTS[n.ev])) bad.push('沒有種類');
        if ([m[0], ...all.map(n => n.next.map(byId))].some(o => o.filter(n => n.type === 'event').length > 1)) bad.push('同一分岔兩個');
        for (const n of ev.filter(n => n.ev === 'chart')) { const T = hoardIds(n).map(byId); if (T.length !== 2 || T[0] === T[1] || T.some(t => !t || t.type !== 'combat' || !descendants(n, byId).includes(t))) bad.push('星圖情報的目標'); }
        if (!mapOk(m)) bad.push('保底規則');
      }
      const m = genMap(), e = m.flat().find(n => n.type === 'event'), t = m[m.length - 2][0];
      e.ev = 'chart'; e.evArg = t.id + '|' + m[m.length - 2][1].id; t.hoard = true;
      const back = Net.unpackMap(JSON.parse(JSON.stringify(Net.packMap(m)))).flat(), e2 = back.find(n => n.id === e.id);
      const sync = e2.ev === 'chart' && e2.evArg === e.evArg && back.find(n => n.id === t.id).hoard && back.filter(n => n.hoard).length === 1;
      return { ok: !bad.length && two >= N * 0.9 && sync, got: `${N} 張：${bad.length ? '問題 ' + [...new Set(bad)].join('、') : '都符合'}；2 個以上的 ${two} 張；同步${sync ? '帶著事件和寶藏星域' : '少了東西（錯誤）'}` };
    }],
    ['事件', '漂流殘骸', `搜刮：HP −最大 HP 的 ${CFG.EVENT.wreck.hp * 100}%（最少留 1）、晶片三選一；拆反應爐 ${CFG.EVENT.wreck.core.chance * 100}%：先揭曉，再三選一保證 ${CFG.EVENT.wreck.core.rare} 格稀有，失敗 HP −${CFG.EVENT.wreck.core.hp * 100}%；離開：什麼都不變`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, node = { id: 'mcev', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'wreck' };
      Game.openEvent(node); const st0 = Game.state, hp0 = p.hp;
      Game.evChoose(2); const leave = Game.state === 'map' && p.hp === hp0;
      Game.openEvent(node); Game.evChoose(0);
      const lost = hp0 - p.hp, rew = Game.state === 'reward' && Game.reward.kind === 'event';
      p.hp = 3; Game.openEvent(node); Game.evChoose(0); const low = p.hp;
      p.hp = p.maxHp; Game.openEvent(node); M.luck(0, () => Game.evChoose(1));
      const wait = Game.state === 'event' && !!Game.ev.res && p.hp === p.maxHp;
      Game.evNext(); const win = Game.state === 'reward' ? Game.reward.options.filter(rareOf).length : -1;
      Game.openEvent(node); M.luck(0.99, () => Game.evChoose(1)); const boom = p.maxHp - p.hp; Game.evNext(); const back = Game.state;
      return { ok: st0 === 'event' && leave && lost === Math.round(p.maxHp * CFG.EVENT.wreck.hp) && rew && low === 1 && wait && win === CFG.EVENT.wreck.core.rare && boom === Math.round(p.maxHp * CFG.EVENT.wreck.core.hp) && back === 'map',
        got: `進去是${st0}；離開${leave ? '沒變' : '有變（錯誤）'}；搜刮扣 ${lost}（最大 HP ${p.maxHp}）、${rew ? '三選一' : '沒有三選一（錯誤）'}；HP 3 時搜刮剩 ${low}；拆反應爐成功：${wait ? '先揭曉' : '沒停在揭曉（錯誤）'}、稀有 ${win} 格；失敗扣 ${boom}、之後回到 ${back}` };
    }],
    ['事件', '黑市商人', `改造晶片 ◆${CFG.EVENT.market.price}：三選一保證 ${CFG.EVENT.market.rare} 格稀有、這一局最大 HP ×${1 - CFG.EVENT.market.hpCut}（可以疊）；走私零件 ◆${CFG.EVENT.market.part}：零件三選一；神祕包裹 ◆${CFG.EVENT.market.box.price}：稀有／一般晶片／空包（價格都隨星區上漲）；錢不夠不能選`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, node = { id: 'mcev', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'market' }, hp0 = p.maxHp, K = CFG.EVENT.market, price = Game.shopPrice(K.price);
      Game.credits = price - 1; Game.openEvent(node); Game.evChoose(0); const poor = Game.state === 'event' && Game.boons.hp === 0;
      Game.credits = 1000; Game.evChoose(0);
      const paid = 1000 - Game.credits, hp1 = p.maxHp, nRare = Game.state === 'reward' ? Game.reward.options.filter(rareOf).length : -1;
      Game.takeReward(null); Game.credits = 1000; Game.openEvent(node); Game.evChoose(0); const hp2 = p.maxHp; Game.takeReward(null);
      const k = K.hpCut, want1 = Math.round(hp0 * (1 - k)), want2 = Math.round(hp0 * (1 - k) ** 2);
      Game.credits = 1000; Game.openEvent(node); Game.evChoose(1);
      const parts = Game.state === 'reward' && Game.reward.options.every(id => id.startsWith('part:')) && 1000 - Game.credits === Game.shopPrice(K.part);
      Game.rerollReward(); const parts2 = Game.reward.options.every(id => id.startsWith('part:')); Game.takeReward(null);
      const box = v => { Game.inventory = Game.inventory.map(() => null); Game.openEvent(node); M.luck(v, () => Game.evChoose(2)); const got = Game.inventory.filter(Boolean); Game.evNext(); return got; };
      const b1 = box(0), b2 = box(K.box.rare + 0.01), b3 = box(0.99);
      const boxOk = b1.length === 1 && !!rareOf(b1[0]) && b2.length === 1 && !rareOf(b2[0]) && b3.length === 0;
      return { ok: poor && paid === price && nRare === K.rare && Math.abs(hp1 - want1) <= 1 && Math.abs(hp2 - want2) <= 1 && parts && parts2 && boxOk,
        got: `錢不夠${poor ? '不能交易' : '還是交易了（錯誤）'}；改造晶片付 ◆${paid}、稀有 ${nRare} 格、最大 HP ${hp0} → ${hp1} → ${hp2}（應為 ${want1} → ${want2}）；走私零件${parts ? '' : '不對（錯誤）'}、刷新${parts2 ? '還是零件' : '變了（錯誤）'}；包裹：${[b1, b2, b3].map(b => b.length ? (rareOf(b[0]) ? '稀有' : '一般') : '空').join('／')}` };
    }],
    ['事件', '求救訊號', `全力救援：下一場一般戰鬥或精英戰敵人 ×${CFG.EVENT.sos.full.mul}（照一波的預算）、打贏保證 ${CFG.BONUS.sos.rare} 格稀有；只護送：敵人 ×${CFG.EVENT.sos.escort.mul}、打贏多一次三選一；只算一場`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const COST = { brute: 6, spitter: 3, swarmer: 1, elite: 0 }, cost = () => Game.combat.pending.reduce((a, k) => a + COST[k], 0);
      const fight = cfg => { Game.node = { type: 'combat', L: 3, id: 'mc', next: [] }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, ...cfg }); Game.combat.themes = { list: [], share: 0 }; Game.startWave(1); return cost(); };
      const ev = i => { Game.node = null; Game.openEvent({ id: 'mcev', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'sos' }); Game.evChoose(i); };
      const base = (5 + 3 + 3 * 3) * CFG.WAVE_MUL, c0 = fight({});
      ev(0); const flag = Game.sos && Game.sos.mine === 'full';
      Game.map = [[{ id: 'mce', L: 0, k: 0, n: 1, type: 'elite', next: [] }]]; Game.node = null; Game.enterNode(Game.map[0][0]);
      const elite = Game.combat.sos === CFG.EVENT.sos.full.mul && Game.combat.sosKey === 'full' && !Game.sos;
      const c1 = fight({ sos: CFG.EVENT.sos.full.mul, sosKey: 'full' });
      Game.inArena = true; Game.state = 'play'; Game.combatWon();
      const add = Game.state === 'reward' ? Game.reward.rareAdd || 0 : -1, rare = Game.state === 'reward' && Game.reward.options.some(rareOf);
      Game.takeReward(null);
      ev(1); const esc = Game.takeSos(); const c2 = fight(esc);
      Game.inArena = true; Game.state = 'play'; Game.combatWon(); Game.takeReward(null);
      const again = Game.state === 'reward' && Game.reward.kind === 'combat'; Game.takeReward(null); const done = Game.state === 'map';
      // 隊友回應（fromNet）：倍數取大的；自己選了沒獎勵的（被發現）→ 照隊友的獎勵
      Game.sos = null; Game.addSos('escort'); Game.addSos('full', true); const team = Game.takeSos();
      Game.sos = null; Game.addSos('caught'); Game.addSos('escort', true); const team2 = Game.takeSos();
      const want = m => Math.ceil(base * m), sc = CFG.EVENT.sos;
      return { ok: flag && elite && c0 === Math.ceil(base) && c1 === want(sc.full.mul) && add === CFG.BONUS.sos.rare && rare && c2 === want(sc.escort.mul) && again && done &&
          team.sos === sc.full.mul && team.sosKey === 'escort' && team2.sos === sc.caught.mul && team2.sosKey === 'escort',
        got: `全力救援${flag ? '記下' : '沒記下（錯誤）'}；下一場精英戰${elite ? '帶著、用掉了' : '沒帶到（錯誤）'}；一波的預算 ${c0} → ${c1}（應為 ${want(sc.full.mul)}）；打贏多保證 ${add} 格${rare ? '' : '、沒有稀有（錯誤）'}；` +
          `只護送：預算 ${c2}（應為 ${want(sc.escort.mul)}）、${again ? '多一次三選一' : '沒有多一次（錯誤）'}、${done ? '之後回航圖' : '沒回航圖（錯誤）'}；隊友全力＋自己護送：×${team.sos}、拿${team.sosKey}；自己被發現＋隊友護送：×${team2.sos}、拿${team2.sosKey}` };
    }],
    ['事件', '終焉護殼', `裝上：這一局一次受到致命傷害時留 1 HP、無敵 ${CFG.EVENT.ward.iframe} 秒，受到的傷害 +${CFG.EVENT.ward.taken * 100}%，用掉之後再受到致命傷害就會被擊墜；拆下核心：回復最大 HP 的 ${CFG.EVENT.ward.heal * 100}%`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc', next: [] }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 });
      const p = Game.player, t0 = Game.mech.taken, node = { id: 'mcev', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'ward' };
      Game.node = null; p.hp = 10; Game.openEvent(node); Game.evChoose(1); const healed = p.hp - 10;
      Game.openEvent(node); Game.evChoose(0);
      const t1 = Game.mech.taken, w0 = Game.boons.ward, hud = Game.wardOf(p);
      Game.state = 'play'; Game.inArena = true; p.iframe = 0; p.hp = 5; Game.hurtPlayer(500, 'mc');
      const saved = Game.state === 'play' && p.hp === 1 && p.iframe >= CFG.EVENT.ward.iframe - 0.01 && Game.boons.ward === 0 && Game.wardOf(p) === 0;
      p.iframe = 0; Game.hurtPlayer(500, 'mc');
      const died = Game.state === 'dead';
      return { ok: healed === Math.round(p.maxHp * CFG.EVENT.ward.heal) && w0 === 1 && hud === 1 && Math.abs(t1 - t0 - CFG.EVENT.ward.taken) < 1e-9 && saved && died,
        got: `拆下核心回 ${healed}；裝上後免死 ${w0} 次（血條旁顯示 ${hud}）、受到的傷害 ×${t0.toFixed(2)} → ×${t1.toFixed(2)}；第一次致命傷害${saved ? '留 1 HP、無敵、標示消失' : `沒擋下（HP ${p.hp}）`}；第二次${died ? '被擊墜' : '沒死（錯誤）'}` };
    }],
    ['事件', '星圖情報：寶藏星域', `解讀座標：標出產生航圖時決定的第 1 場；強行破解 ${CFG.EVENT.chart.chance * 100}%：標出 2 場，失敗：下一場敵人 ×${CFG.EVENT.sos.caught.mul}、什麼都沒標；寶藏星域每一區都有一架寶藏無人機，打掉幾架三選一就多保證幾格稀有（最多 2 格：一定留一格組件）`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      let m, e;
      for (let i = 0; i < 50 && !e; i++) { m = genMap(); e = m.flat().find(n => n.type === 'event' && n.ev === 'chart'); }
      if (!e) return { ok: false, got: '50 張圖都沒有星圖情報' };
      const nH = () => m.flat().filter(n => n.hoard).length, clear = () => m.flat().forEach(n => { n.hoard = false; });
      Game.map = m; const [a, b] = hoardIds(e).map(id => Game.nodeById(id));
      Game.openEvent(e); const before = nH();
      Game.evChoose(0); const one = nH() === 1 && a.hoard && Game.state === 'map';
      clear(); Game.openEvent(e); M.luck(0, () => Game.evChoose(1)); Game.evNext(); const two = nH() === 2 && a.hoard && b.hoard && !Game.sos;
      clear(); Game.openEvent(e); M.luck(0.99, () => Game.evChoose(1)); Game.evNext(); const fail = nH() === 0 && Game.sos && Game.sos.mul === CFG.EVENT.sos.caught.mul && Game.sosPay(Game.sos) === null;
      Game.sos = null;
      Game.node = a; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0, hoard: true });
      const per = [1, 2, 3].map(n => { Game.startWave(n); return Game.combat.pending.filter(k => k === 'treasure').length; });
      for (let i = 0; i < 3; i++) { Game.spawnEnemy('treasure'); Game.enemies[Game.enemies.length - 1].hurt(1e9, 0, 0, 'direct', null); }
      Game.inArena = true; Game.state = 'play'; Game.combatWon();
      const nRare = Game.state === 'reward' ? Game.reward.options.filter(rareOf).length : -1;
      return { ok: before === 0 && one && two && fail && per.join() === '1,1,1' && nRare === 2,
        got: `進來時標了 ${before} 格；解讀${one ? '標 1 格' : '不對（錯誤）'}；破解成功${two ? '標 2 格' : '不對（錯誤）'}；失敗${fail ? '沒標、下一場變難、沒有獎勵' : '不對（錯誤）'}；每一區寶藏無人機 ${per.join('／')}；打掉 3 架 → 稀有 ${nRare} 格（最多 2 格：三選一一定留一格組件）` };
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
    ['章節', '章節設定', '第一章 = 星區 1～3、三隻王照順序、倍率 1（跟改之前一樣）；每章從自己的第一個星區開始、王照章節設定；打完最後一個星區之後才是無盡（無盡強度從那裡開始算）', M => {
      const out = [];
      let ok = true;
      for (const ch of CHAPTERS) {
        Game.chapterId = ch.id;
        Game.newRun('run', 'vanguard', 'laser');
        const [a, b] = ch.sectors, secs = Array.from({ length: b - a + 1 }, (_, i) => a + i);
        const startOk = Game.sector === a && Game.bossId === ch.bosses[a];
        const bossOk = secs.every(s => Game.bossFor(s) === ch.bosses[s]);
        Game.sector = b; const lastOk = !Game.isEndless() && endlessK() === 0;
        Game.sector = b + 1; const endOk = Game.isEndless() && endlessK() === 1 && CFG.BOSS_ORDER.includes(Game.bossFor(b + 1));
        const good = startOk && bossOk && lastOk && endOk;
        ok = ok && good;
        out.push(`${ch.name}${good ? '' : ' ✗'}：星區 ${a}～${b}${startOk ? '' : '（開局星區或王不對）'}${bossOk ? '' : '（各星區的王不對）'}${lastOk && endOk ? '' : '（無盡分界不對）'}`);
      }
      const c1 = chapterById(1);
      const same = c1.sectors[0] === 1 && c1.sectors[1] === 3 && c1.hp === 1 && c1.dmg === 1 && !c1.start &&
        [1, 2, 3].every(s => c1.bosses[s] === CFG.BOSS_ORDER[s - 1]);
      Game.chapterId = 1;
      return { ok: ok && same, got: out.join('；') + (same ? '；第一章跟改之前一樣' : '；第一章跟改之前不一樣（錯誤）') };
    }],
    ['章節', '章節倍率', '敵人血量 × 章節的 hp、飛船受到的傷害 × 章節的 dmg（第一章都是 1）', M => {
      const probe = id => {
        Game.chapterId = id;
        Game.newRun('run', 'vanguard', 'laser');
        Game.bonusPicks = 0;  // 開局補償的三選一不影響這項
        Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 });
        Game.combat.wave = 1; Game.spawnEnemy('swarmer');
        const e = Game.enemies[Game.enemies.length - 1], p = Game.player;
        p.iframe = 0; p.dashT = 0; p.shield = 0;  // invuln 是 getter（iframe／dashT 算出來的）
        const hp0 = p.hp; Game.hurtPlayer(10, 'mc');
        return { ehp: e.maxHp, taken: hp0 - p.hp };
      };
      const base = probe(1), out = [];
      let ok = true;
      for (const ch of CHAPTERS.slice(1)) {
        const r = probe(ch.id), hpK = r.ehp / base.ehp, dmgK = r.taken / base.taken;
        const good = near1(hpK, ch.hp) && near1(dmgK, ch.dmg);
        ok = ok && good;
        out.push(`${ch.name}：血量 ×${hpK.toFixed(2)}（應為 ${ch.hp}）、受傷 ×${dmgK.toFixed(2)}（應為 ${ch.dmg}）${good ? '' : ' ✗'}`);
      }
      Game.chapterId = 1;
      return { ok, got: out.join('；') };
    }],
    ['章節', '章節進度', '只開第一章；通關第 N 章開第 N+1 章；存檔壞掉（不是 JSON、cleared 不是陣列、有奇怪的值）當成只開第一章；機制檢查的模擬局不寫進度', M => {
      let saved = null;
      try { saved = localStorage.getItem(CHAPTER_KEY); } catch (e) {}
      const put = v => { try { if (v == null) localStorage.removeItem(CHAPTER_KEY); else localStorage.setItem(CHAPTER_KEY, v); } catch (e) {} };
      const out = [];
      try {
        put(null);
        const fresh = chapterUnlocked(1) && !chapterUnlocked(2);
        out.push(fresh ? '新存檔只開第一章' : '新存檔不對（錯誤）');
        markChapterCleared(1);
        const next = chapterUnlocked(2) && !chapterUnlocked(3) && chapterProgress().join() === '1';
        markChapterCleared(1);
        const once = chapterProgress().length === 1;
        out.push(next && once ? '通關第一章開第二章（重複通關不重複記）' : '通關後解鎖不對（錯誤）');
        const bad = ['{', '{"cleared":5}', '{"cleared":["x",null,2.5]}', 'null'].every(v => { put(v); return chapterProgress().length === 0 && chapterUnlocked(1) && !chapterUnlocked(2); });
        out.push(bad ? '壞掉的存檔當成只開第一章' : '壞掉的存檔處理不對（錯誤）');
        put(null);
        Game.chapterId = 1; Game.newRun('run', 'vanguard', 'laser');
        Game.sector = Game.lastSector(); Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = Game.bossFor(Game.sector);
        Game.combatWon();
        const noWrite = chapterProgress().length === 0;
        out.push(noWrite ? '模擬局沒有寫進度' : '模擬局寫進了進度（錯誤）');
        return { ok: fresh && next && once && bad && noWrite, got: out.join('；') };
      } finally { put(saved); Game.chapterId = 1; }
    }],
    ['精英詞綴', '詞綴數量與互斥', '第 1 星區 1 個、第 2 星區 2 個、第 3 星區以後 3 個；不重複；閃現＋隱形、召喚＋統帥不會一起出現；名字「A・B的虛空獵手」', M => {
      const out = [];
      for (const [s, want] of [[1, 1], [2, 2], [3, 3], [5, 3]]) {
        let bad = 0;
        for (let i = 0; i < 300; i++) {
          const R = rollAffixes(affixCount(s));
          if (R.length !== want || new Set(R).size !== R.length || AFFIX_BAN.some(([a, b]) => R.includes(a) && R.includes(b))) bad++;
        }
        out.push(`星區 ${s}：${want} 個${bad ? `（${bad} 次不對，錯誤）` : ''}`);
      }
      const nm = eliteName({ affixes: ['split', 'rage'], t: ENEMY_TYPES.elite });
      out.push(nm);
      return { ok: !out.some(t => t.includes('錯誤')) && nm === '分裂・狂暴的虛空獵手', got: out.join('；') };
    }],
    ['精英詞綴', '精英的場子', '精英戰最後一區：精英（精英池抽的任一種）最先出場、護衛只有一般一波的 30% 左右、出場橫幅寫那種精英的名字；詞綴數照星區（第 2 星區 2 個）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.sector = 2;
      const cost = list => list.reduce((a, k) => a + (ENEMY_TYPES[k].elite ? 0 : k === 'swarmer' ? 1 : k === 'spitter' ? 3 : k === 'brute' ? 6 : THEMES[k] ? THEMES[k].cost : 0), 0);
      let esc = 0, norm = 0, first = true, n = 0, banner = '', want = '';
      for (let i = 0; i < 20; i++) {
        Game.startCombat({ level: 3, wavesTotal: 2, elites: 1 }); Game.startWave(2);
        const e0 = ENEMY_TYPES[Game.combat.pending[0]];
        first = first && e0.elite; esc += cost(Game.combat.pending);
        n = Game.combat.eliteRolls[0].length;
        if (!i) { banner = FX.banner ? FX.banner.text : ''; want = e0.group || e0.name; }
        Game.startCombat({ level: 3, wavesTotal: 2, elites: 0 }); Game.startWave(2);
        norm += cost(Game.combat.pending);
      }
      Game.enemies = [];
      const k = esc / norm;
      return { ok: first && k > 0.2 && k < 0.42 && n === 2 && banner.startsWith('⚠') && banner.includes(want),
        got: `精英${first ? '最先出場' : '不是最先（錯誤）'}；護衛 = 一般一波的 ${(k * 100).toFixed(0)}%；詞綴 ${n} 個；橫幅「${banner}」` };
    }],
    ['精英詞綴', '護盾', '盾一開始朝著玩家，正面打過去的子彈反彈；玩家繞到背後，盾每秒最多轉 60°', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]], 'elite', true, 1)[0];
      e.setAffixes(['shield'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      const face = Math.abs(angleDiff(e.shieldA, Math.PI)) < 0.01;
      const hp0 = e.hp; M.run(40);
      const refl = Game.eBullets.filter(b => b.col).length, lost = hp0 - e.hp;
      p.x = e.x + 300; p.y = e.y; const a0 = e.shieldA;
      for (let i = 0; i < 30; i++) e.update(1 / 60, p);
      const turned = Math.abs(angleDiff(e.shieldA, a0)) * 180 / Math.PI;
      return { ok: face && refl > 0 && lost === 0 && Math.abs(turned - 30) < 2,
        got: `盾${face ? '朝著玩家' : '沒朝著玩家（錯誤）'}；正面打 40 幀：反彈 ${refl} 發、精英掉血 ${Math.round(lost)}；繞到背後 0.5 秒盾轉了 ${turned.toFixed(1)}°` };
    }],
    ['精英詞綴', '分裂', '血量剩一半時分成兩隻：各 35% 血、體型 ×0.7、其他詞綴照抄（分裂除外）、晶體兩隻平分', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]], 'elite', true, 1)[0];
      e.setAffixes(['split', 'rage'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      const mx0 = e.maxHp, r0 = e.r;
      e.hurt(mx0 * 0.4, 0, 0); e.update(1 / 60, p);
      const one = Game.enemies.filter(x => x.t.elite).length;
      e.hurt(mx0 * 0.15, 0, 0); e.update(1 / 60, p);
      const E2 = Game.enemies.filter(x => x.t.elite && !x.dead), k = E2.find(x => x !== e);
      const ok = one === 1 && E2.length === 2 && k && E2.every(x => Math.abs(x.maxHp - mx0 * 0.35) < 1 && Math.abs(x.r - r0 * 0.7) < 0.01)
        && !k.has('split') && k.has('rage') && e.credits + k.credits === ENEMY_TYPES.elite.credits;
      return { ok, got: `60% 血：${one} 隻；45% 血：${E2.length} 隻，各 ${E2.map(x => `${Math.round(x.maxHp / mx0 * 100)}% 血、體型 ×${(x.r / r0).toFixed(2)}`).join('／')}；分出來的詞綴 ${k ? k.affixes.join(',') : '—'}；晶體 ${e.credits}＋${k ? k.credits : '?'}` };
    }],
    ['精英詞綴', '召喚', '每 5 秒叫出 3 隻蟲群，同時最多 6 隻；叫出來的不掉晶體、不算玩法擊殺', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]], 'elite', true, 1)[0];
      e.setAffixes(['summon'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      const kids = () => Game.enemies.filter(x => x.type === 'swarmer' && !x.dead);
      const at = sec => { for (let i = 0; i < sec * 60; i++) { for (const x of [...Game.enemies]) if (x === e) x.update(1 / 60, p); } return kids().length; };
      const a = at(4.9), b = at(0.2), c = at(15);
      const tag = kids().every(x => x.summoned && x.noPlay);
      return { ok: a === 0 && b === 3 && c === 6 && tag, got: `4.9 秒 ${a} 隻、5.1 秒 ${b} 隻、20 秒 ${c} 隻（上限 6）；${tag ? '都不掉晶體、不算玩法擊殺' : '有會掉晶體的（錯誤）'}` };
    }],
    ['精英詞綴', '狂暴', '血量低於一半：移動速度 ×1.4、出招間隔 ×0.6（血量高時不變）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]], 'elite', true, 1)[0];
      e.setAffixes(['rage'], p.x, p.y); p.iframe = 1e9;
      e.hurt(e.maxHp * 0.45, 0, 0); e.skillCd = 10; e.update(1 / 60, p);
      const before = !e.enraged && e.spdMul === 1, cd0 = e.skillCd;
      e.hurt(e.maxHp * 0.1, 0, 0); e.update(1 / 60, p);
      e.skillCd = 10; e.update(1 / 60, p);
      const used = 10 - e.skillCd;
      return { ok: before && e.enraged && Math.abs(e.spdMul - 1.4) < 1e-9 && Math.abs(used - 1 / 60 / 0.6) < 1e-6 && Math.abs(10 - cd0 - 1 / 60) < 1e-6,
        got: `55% 血：${before ? '沒狂暴' : '已經狂暴（錯誤）'}；45% 血：${e.enraged ? '狂暴' : '沒狂暴（錯誤）'}、速度 ×${e.spdMul.toFixed(2)}、一幀出招倒數 ${(used * 60).toFixed(2)} 幀` };
    }],
    ['精英詞綴', '閃現', '每掉 20% 血：落點先閃 0.4 秒，時間到才瞬移，離原本的位置 300～400；剩 80% 以上不閃', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]], 'elite', true, 1)[0];
      e.setAffixes(['blink'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      const x0 = e.x, y0 = e.y;
      e.hurt(e.maxHp * 0.15, 0, 0); e.update(1 / 60, p);
      const none = !(e.blinkT > 0);
      e.hurt(e.maxHp * 0.1, 0, 0); e.update(1 / 60, p);
      const warn = e.blinkT > 0 && e.x === x0;
      for (let i = 0; i < 20; i++) e.update(1 / 60, p);
      const mid = e.x === x0 && e.y === y0;
      for (let i = 0; i < 10; i++) e.update(1 / 60, p);
      const d = Math.hypot(e.x - x0, e.y - y0);
      return { ok: none && warn && mid && d >= 299 && d <= 401, got: `掉 15%：${none ? '不閃' : '閃了（錯誤）'}；掉 25%：${warn ? '先閃紅圈' : '沒有預告（錯誤）'}、0.35 秒時${mid ? '還在原地' : '已經走了（錯誤）'}、0.5 秒後瞬移 ${Math.round(d)}` };
    }],
    ['精英詞綴', '統帥', '身邊 300 內的小兵移動 ×1.25、受到的傷害 ×0.8；300 外的不受影響', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, E = M.targets([[300, 0], [300, 150], [300, 500]], 'elite', true, 1);
      const e = E[0], near = new Enemy('brute', E[1].x, E[1].y, 1), far = new Enemy('brute', E[2].x, E[2].y, 1);
      near.spawnT = far.spawnT = 0; near.t = far.t = { ...ENEMY_TYPES.brute, speed: 0, dmg: 0 }; near.rollCd = far.rollCd = Infinity;
      Game.enemies = [e, near, far];
      e.setAffixes(['command'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      for (let i = 0; i < 3; i++) for (const x of Game.enemies) x.update(1 / 60, p);
      const h1 = near.hp, h2 = far.hp; near.hurt(100, 0, 0); far.hurt(100, 0, 0);
      const dn = h1 - near.hp, df = h2 - far.hp;
      return { ok: Math.abs(near.spdMul - 1.25) < 1e-9 && far.spdMul === 1 && Math.abs(dn - 80) < 0.01 && Math.abs(df - 100) < 0.01,
        got: `150 內：速度 ×${near.spdMul.toFixed(2)}、打 100 扣 ${dn.toFixed(0)}；500 外：速度 ×${far.spdMul.toFixed(2)}、打 100 扣 ${df.toFixed(0)}` };
    }],
    ['敵人', '雙子獵艦', '一次出兩艘、共用一條血（打另一艘、燒另一艘都扣同一條）；兩艘都在隊形上時中間連著光束，碰到受傷；一艘衝鋒時光束斷掉', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = 'boss4'; Game.startCombat({ level: 6, wavesTotal: 1, elites: 0, boss: true });
      Game.startWave(1); Game.spawnEnemy(Game.combat.pending.shift());
      const S = Game.enemies.filter(e => e.type === 'boss4'), A = S.find(e => !e.share), B = S.find(e => e.share);
      const two = S.length === 2 && A && B && B.share === A && A.pair === B.pair;
      for (const e of S) { e.spawnT = 0; e.skillCd = 1e9; }
      const h0 = A.hp; B.hurt(100, 0, 0); const shared = Math.abs(h0 - A.hp - 100) < 0.01 && B.hp === A.hp;
      B.burnT = 1; B.burnDps = 60; B.burnAcc = 0; const h1 = A.hp; for (let i = 0; i < 30; i++) B.update(1 / 60, Game.player); B.burnT = 0;
      const burned = h1 - A.hp > 20;
      const p = Game.player; p.iframe = 0; p.hp = p.maxHp = 1000;
      Game.time += 1 / 60; const L = Game.bossBeams().filter(x => !x.warn);  // 光束同一幀只算一次（照 Game.time）
      [p.x, p.y] = [(A.x + B.x) / 2, (A.y + B.y) / 2]; const hp0 = p.hp; Game.beamHits(); const hit = hp0 - p.hp;
      B.mode = 'charge'; Game.time += 1 / 60; const off = Game.bossBeams().length === 0; B.mode = 'chase';
      Game.enemies = [];
      return { ok: two && shared && burned && L.length === 1 && hit > 0 && off,
        got: `${two ? '兩艘、另一艘接到主艦' : '不是兩艘（錯誤）'}；打另一艘 100：主艦${shared ? '也扣 100' : '沒扣（錯誤）'}；燒另一艘 0.5 秒主艦掉 ${Math.round(h1 - A.hp)}；光束 ${L.length} 條、站在中間扣 ${Math.round(hit)}；一艘衝鋒時光束${off ? '斷掉' : '還在（錯誤）'}` };
    }],
    ['敵人', '星環守門者', '核心在場地正中間不動、身邊 4 座砲塔；光束先停（最後 0.9 秒預警線）再開 5 秒（2 條、暴走 3 條，碰到受傷）；打掉環形砲塔就不再放它的環形彈', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'boss', L: 6, id: 'mc' }; Game.bossId = 'boss5'; Game.startCombat({ level: 6, wavesTotal: 1, elites: 0, boss: true });
      Game.startWave(1); Game.spawnEnemy(Game.combat.pending.shift());
      const W = CFG.WARDEN, C = Game.enemies.find(e => e.type === 'boss5'), T = Game.enemies.filter(e => e.t.turret);
      const centered = C && Math.hypot(C.x - Arena.center.x, C.y - Arena.center.y) < 1 && T.length === 4 && T.every(k => k.core === C);
      for (const e of Game.enemies) e.spawnT = 0;
      C.skillCd = 1e9; const p = Game.player; p.iframe = 1e9;
      const step = sec => { for (let i = 0; i < Math.round(sec * 60); i++) { Game.time += 1 / 60; for (const e of [...Game.enemies]) if (!e.dead) e.update(1 / 60, p); } };
      const n0 = Game.bossBeams().length;
      step(W.rest - W.warn + 0.1); const warn = Game.bossBeams(), warnOk = warn.length === 2 && warn.every(b => b.warn && !b.dmg);
      step(W.warn); const on = Game.bossBeams(), onOk = on.length === 2 && on.every(b => !b.warn && b.dmg > 0);
      const a0 = C.rot; step(1); const turned = C.rot - a0;
      C.enraged = true; Game.time += 1 / 60; const rage3 = Game.bossBeams().length === 3; C.enraged = false;
      // 砲塔跟著核心轉
      const k0 = T[1], att = Math.abs(Math.hypot(k0.x - C.x, k0.y - C.y) - (C.r + W.turretR)) < 1;
      // 打掉環形砲塔：之後不再有它的環形彈
      const ringT = T.find(k => k.type === 'wt_ring'); ringT.hurt(1e9, 0, 0);
      Game.eBullets = []; step(ENEMY_TYPES.wt_ring.turret.cd + 0.5);
      const fromRing = Game.eBullets.filter(b => b.from === ENEMY_TYPES.wt_ring.name).length;
      Game.enemies = []; Game.eBullets = []; Game.zones = [];
      return { ok: centered && n0 === 0 && warnOk && onOk && Math.abs(turned - W.spin) < 0.01 && rage3 && att && fromRing === 0,
        got: `${centered ? '核心在正中間、4 座砲塔' : '位置或砲塔不對（錯誤）'}；一開始光束 ${n0} 條；預警 ${warn.length} 條${warnOk ? '' : '（不對）'}；開 ${on.length} 條${onOk ? '' : '（不對）'}；1 秒轉 ${turned.toFixed(2)}；暴走 ${rage3 ? '3 條' : '不是 3 條（錯誤）'}；砲塔${att ? '貼著核心' : '沒貼著核心（錯誤）'}；拆掉環形砲塔後它的子彈 ${fromRing} 發` };
    }],
    ['精英', '精英池', 'CFG.ELITE_POOL：第 1 星區只出 from ≤ 1 的，第 2 星區起全部都出；章節的 eliteW 再乘（第二章三艦編隊 ×2）；編隊不會抽到分裂、召喚、閃現，砲艦不會抽到護盾', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const P = CFG.ELITE_POOL, cnt = (sector, ch) => { Game.chapterId = ch; const c = {}; for (let i = 0; i < 2000; i++) { const k = Game.pickElite(sector); c[k] = (c[k] || 0) + 1; } return c; };
      const s1 = cnt(1, 1), s2 = cnt(2, 1), c2 = cnt(3, 2);
      Game.chapterId = 1;
      const want1 = Object.keys(P).filter(k => P[k].from <= 1), only1 = Object.keys(s1).every(k => want1.includes(k)) && want1.every(k => s1[k] > 0);
      const all2 = Object.keys(P).every(k => s2[k] > 300), wing2 = c2.wing / 2000;  // 4 種、第二章編隊權重 2：2 / 5 = 40%
      let bad = 0; for (let i = 0; i < 300; i++) for (const ty of ['wing', 'artillery']) if (rollAffixes(3, ty).some(id => ENEMY_TYPES[ty].noAffix.includes(id))) bad++;  // 編隊不抽分裂、召喚、閃現；砲艦不抽護盾
      return { ok: only1 && all2 && wing2 > 0.34 && wing2 < 0.46 && bad === 0,
        got: `星區 1：${Object.entries(s1).map(([k, v]) => ENEMY_TYPES[k].name + v).join(' ')}；星區 2：${Object.entries(s2).map(([k, v]) => ENEMY_TYPES[k].name + v).join(' ')}；第二章編隊 ${(wing2 * 100).toFixed(0)}%（應約 40%）；編隊、砲艦抽到不該有的詞綴 ${bad} 次` };
    }],
    ['精英', '砲艦', '蓄力 0.5 秒後砲擊 3 個落點（第一個在目標前進方向 0.5 秒後的位置，紅圈 1.2 秒後爆炸）；靠太近會逃；被追到 220 內近身散射 5 發', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const A = CFG.ARTILLERY, p = Game.player, e = M.targets([[500, 0]], 'artillery', false, 1)[0];
      p.iframe = 1e9; p.vx = 100; p.vy = 0; Game.zones = []; e.skillCd = 0; e.shotCd = 1e9;
      e.update(1 / 60, p);
      const wind = e.mode === 'windup';
      for (let i = 0; i < Math.ceil(A.windup * 60) + 1; i++) e.update(1 / 60, p);
      const Z = Game.zones, z0 = Z[0], lead = z0 && Math.hypot(z0.x - (p.x + 100 * A.lead), z0.y - p.y);
      const volley = Z.length === A.n && lead < 1 && Z.every(z => z.r === A.r && Math.abs(z.t - A.delay) < 1e-9 && Math.hypot(z.x - z0.x, z.y - z0.y) <= A.spread + 1);
      // 靠太近：往外逃
      const f = M.targets([[250, 0]], 'artillery', false, 1)[0]; f.skillCd = 1e9; f.shotCd = 1e9; p.vx = 0;
      for (let i = 0; i < 60; i++) f.update(1 / 60, p);
      const fled = Math.hypot(f.x - p.x, f.y - p.y) - 250;
      // 近身散射
      const g = M.targets([[150, 0]], 'artillery', false, 1)[0]; g.skillCd = 1e9; Game.eBullets = [];
      g.update(1 / 60, p);
      const fan = Game.eBullets.length;
      Game.zones = []; Game.eBullets = [];
      return { ok: wind && volley && fled > 30 && fan === A.shot,
        got: `${wind ? '先蓄力' : '沒蓄力（錯誤）'}；砲擊 ${Z.length} 個落點、第一個離預測位置 ${lead != null ? lead.toFixed(1) : '?'}${volley ? '' : '（不對）'}；離 250 時 1 秒逃開 ${Math.round(fled)}；150 內散射 ${fan} 發` };
    }],
    ['精英', '拖曳艦', '鎖定 0.7 秒 → 牽引 1.8 秒（每秒把目標往牠拉 230，拉到身邊 90 停）；衝刺掙脫：光束斷、拖曳艦暈 1 秒；拉完沒掙脫立刻近身散射', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const T = CFG.TRACTOR, p = Game.player, e = M.targets([[400, 0]], 'tractor', false, 1)[0];
      p.iframe = 1e9; e.skillCd = 0; e.shotCd = 1e9;
      e.update(1 / 60, p);
      const aim = e.mode === 'aim' && e.tgt === 1;
      for (let i = 0; i < Math.ceil(T.aim * 60) + 1; i++) e.update(1 / 60, p);
      const pull = e.mode === 'pull';
      const d0 = Math.hypot(e.x - p.x, e.y - p.y);
      for (let i = 0; i < 30; i++) { Game.beamPull(p, 1 / 60); e.update(1 / 60, p); }
      const moved = d0 - Math.hypot(e.x - p.x, e.y - p.y);
      p.dashT = 0.1; const x1 = p.x; Game.beamPull(p, 1 / 60); const dashNoPull = p.x === x1;
      e.update(1 / 60, p); p.dashT = 0;
      const broke = e.mode === 'stun' && e.tgt === 0;
      // 沒掙脫：拉完整段 → 立刻散射
      const f = M.targets([[300, 0]], 'tractor', false, 1)[0]; f.skillCd = 0; f.shotCd = 1e9; Game.eBullets = [];
      for (let i = 0; i < Math.ceil((T.aim + T.pull) * 60) + 3; i++) { Game.beamPull(p, 1 / 60); f.update(1 / 60, p); }
      const dEnd = Math.hypot(f.x - p.x, f.y - p.y), shot = Game.eBullets.length;
      Game.eBullets = [];
      return { ok: aim && pull && Math.abs(moved - T.speed * 0.5) < 15 && dashNoPull && broke && dEnd < f.r + p.r + T.stop + 20 && shot >= T.shot,
        got: `${aim ? '鎖定 1P' : '沒鎖定（錯誤）'}→${pull ? '牽引' : '沒牽引（錯誤）'}；0.5 秒被拉近 ${Math.round(moved)}（應約 ${T.speed * 0.5}）；衝刺中${dashNoPull ? '不拉' : '還在拉（錯誤）'}、${broke ? '光束斷、拖曳艦暈' : '光束沒斷（錯誤）'}；沒掙脫：拉到距離 ${Math.round(dEnd)}、散射 ${shot} 發` };
    }],
    ['精英', '三艦編隊', '一次出 3 艘、共用編隊（繞同一個中心轉、詞綴一樣）；打掉一艘轉得更快、開火間隔變短；最後一艘打掉才算打倒一隻精英；叫醒一艘整隊一起醒', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const W = CFG.WING, p = Game.player, e = M.targets([[350, 0]], 'wing', false, 1)[0];
      p.iframe = 1e9; e.setAffixes(['shield'], p.x, p.y);
      e.alert = false; const G = Game.makeFleet(e), F = e.fleet;
      const three = G.length === 3 && Game.enemies.length === 3 && G.every(m => m.fleet === F && m.affixes && m.affixes[0] === 'shield' && m.alert === false);
      Game.wakeEnemy(G[1]);
      const woke = G.every(m => m.alert);
      // 編隊每幀只算一次（照 Game.time 判斷），所以每幀要推進時間
      const step = () => { const a = F.ang; Game.time += 1 / 60; for (const m of [...Game.enemies]) if (!m.dead) m.update(1 / 60, p); return F.ang - a; };
      for (let i = 0; i < 120; i++) step();
      const inForm = G.every(m => Math.abs(Math.hypot(m.x - F.x, m.y - F.y) - W.radius) < 12);
      const s3 = step(), el0 = Game.runStats.elites || 0;
      G[0].hurt(1e9, 0, 0);
      const el1 = Game.runStats.elites || 0, s2 = step();
      G[1].hurt(1e9, 0, 0); G[2].hurt(1e9, 0, 0);
      const el3 = Game.runStats.elites || 0;
      Game.enemies = [];
      return { ok: three && woke && inForm && Math.abs(s2 / s3 - (1 + W.lost)) < 0.01 && el1 === el0 && el3 === el0 + 1,
        got: `${three ? '3 艘同一隊、詞綴一樣' : '編隊不對（錯誤）'}；叫醒一艘：${woke ? '整隊醒' : '沒有整隊醒（錯誤）'}；2 秒後${inForm ? '都在隊形上' : '沒排好隊形（錯誤）'}；少一艘轉速 ×${(s2 / s3).toFixed(2)}；打倒精英：打掉 1 艘 +${el1 - el0}、全滅 +${el3 - el0}` };
    }],
    ['精英詞綴', '追蹤彈', '環形彈射出後 1.5 秒內轉向最近的玩家（每秒最多 40°），之後直線飛', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]], 'elite', true, 1)[0];
      e.setAffixes(['homing'], p.x, p.y); e.skillCd = 0; e.nextSkill = 'ring'; p.iframe = 1e9;
      e.update(1 / 60, p); e.skillCd = 1e9;
      const B = Game.eBullets.filter(b => b.home > 0), b = B.find(x => Math.abs(angleDiff(Math.atan2(x.vy, x.vx), Math.PI / 2)) < 0.2);  // 往下飛（跟玩家垂直）的那一發
      const a0 = b ? Math.atan2(b.vy, b.vx) : 0;
      for (let i = 0; i < 30; i++) Game.updateEnemyBullets(1 / 60);
      const turn = b ? Math.abs(angleDiff(Math.atan2(b.vy, b.vx), a0)) * 180 / Math.PI : 0;
      const toward = b ? Math.abs(angleDiff(Math.atan2(b.vy, b.vx), Math.atan2(p.y - b.y, p.x - b.x))) < Math.abs(angleDiff(a0, Math.atan2(p.y - b.y, p.x - b.x))) : false;  // 轉向玩家（不是轉開）
      for (let i = 0; i < 70; i++) Game.updateEnemyBullets(1 / 60);
      const a1 = b ? Math.atan2(b.vy, b.vx) : 0;
      for (let i = 0; i < 30; i++) Game.updateEnemyBullets(1 / 60);
      const after = b ? Math.abs(angleDiff(Math.atan2(b.vy, b.vx), a1)) * 180 / Math.PI : 99;
      return { ok: B.length === 20 && !!b && toward && Math.abs(turn - 20) < 1.5 && after < 0.01,
        got: `${B.length} 發會追；往旁邊飛的那發 0.5 秒${toward ? '轉向玩家' : '轉開了（錯誤）'} ${turn.toFixed(1)}°；1.7 秒後再 0.5 秒轉了 ${after.toFixed(2)}°` };
    }],
    ['精英詞綴', '佈雷', '移動時每 1.2 秒留一顆地雷（不動不放）；碰到爆炸，60 內的玩家受 20 傷害', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[600, 0]], 'elite', false, 1)[0];
      e.setAffixes(['mine'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      for (let i = 0; i < 180; i++) { Game.time += 1 / 60; e.update(1 / 60, p); }
      const mines = Game.eBullets.filter(b => b.mine).length;
      Game.eBullets = [{ x: p.x + 5, y: p.y, vx: 0, vy: 0, r: AFFIX.mine.size, dmg: AFFIX.mine.dmg, life: 8, mine: true, from: '測試（地雷）' }];
      p.iframe = 0; p.dashT = 0; p.hp = p.maxHp = 500; Game.state = 'play';
      Game.updateEnemyBullets(1 / 60);
      const lost = 500 - p.hp, gone = !Game.eBullets.length;
      return { ok: mines === 2 && lost > 0 && gone, got: `移動 3 秒放了 ${mines} 顆；碰到：${gone ? '爆炸' : '沒爆（錯誤）'}、扣 ${Math.round(lost)} 血` };
    }],
    ['精英詞綴', '磁場', '精英身邊 140 內的子彈速度 ×0.5（射程不變）；外面的照常', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[600, 0]], 'elite', true, 1)[0];
      e.setAffixes(['field'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      p.fire(); const b = Game.bullets[0];
      if (!b) return { ok: false, got: '沒射出子彈' };
      const step = (x) => { b.x = b.px = x; b.y = b.py = e.y; const x0 = b.x; Game.updateBullets(1 / 60); return b.x - x0; };
      const out = step(e.x - 400), inn = step(e.x - 100);
      return { ok: Math.abs(inn / out - 0.5) < 0.02, got: `一幀：場外 ${out.toFixed(1)}、場內 ${inn.toFixed(1)}（×${(inn / out).toFixed(2)}）` };
    }],
    ['精英詞綴', '隱形', '離玩家 200 外慢慢隱形（自動瞄準、追蹤鎖不到）；靠近 200 內或衝鋒時馬上現形', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[400, 0]], 'elite', true, 1)[0];
      e.setAffixes(['cloak'], p.x, p.y); e.skillCd = 1e9; p.iframe = 1e9;
      for (let i = 0; i < 30; i++) e.update(1 / 60, p);
      const far = e.cloak;
      const lock = !nearestEnemy(p.x, p.y, 2000, null, true);
      p.x = e.x - 150; e.update(1 / 60, p);
      const near = e.cloak;
      return { ok: far > 0.99 && lock && near === 0, got: `400 遠：隱形 ${far.toFixed(2)}、${lock ? '自動瞄準鎖不到' : '鎖得到（錯誤）'}；150 內：隱形 ${near}` };
    }],
    ['獎勵', '三選一的種類', '出發前、戰鬥、精英都是同一個三選一，差別照 CFG.REWARDS：刷新價格（第一次、之後每次多多少）、精英多一張電路擴充', M => {
      const out = [];
      for (const kind of ['start', 'combat', 'elite']) {
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        Game.sector = 1; Game.credits = 999;
        Game.openReward(kind);
        const K = CFG.REWARDS[kind], R = Game.reward, first = R.reroll;
        Game.rerollReward(); const second = R.reroll, paid = 999 - Game.credits;
        const ok = R.options.length === 3 && first === K.reroll && paid === K.reroll && second === K.reroll + K.rerollUp && !!R.slot === K.slotCard;
        out.push(`${kind}：刷新 ◆${first} → ◆${second}、電路擴充${R.slot ? '有' : '沒有'}${ok ? '' : '（錯誤）'}`);
      }
      return { ok: !out.some(t => t.includes('錯誤')) && CFG.REWARDS.elite.reroll > CFG.REWARDS.combat.reroll, got: out.join('；') };
    }],
    ['章節', '通關判斷','打掉這章最後一個星區的王（旗艦獎勵畫面）才算打完這章；無盡模式算打完；最後一個星區還在打、前面星區的旗艦獎勵都不算', M => {
      const G = Game, out = [];
      G.newRun('run', 'vanguard', 'laser');
      const at = (sector, state) => { G.sector = sector; G.state = state; return G.chapterDone(); };
      const last = G.lastSector(), cases = [[last, 'victory', true], [last, 'play', false], [last, 'map', false], [last - 1, 'victory', false], [last + 1, 'map', true]];
      const nm = { victory: '旗艦獎勵', play: '戰鬥中', map: '航圖' };
      for (const [s, st, want] of cases) { const got = at(s, st); out.push(`星區 ${s} ${nm[st]}：${got ? '打完' : '沒打完'}${got === want ? '' : '（錯誤）'}`); }
      return { ok: !out.some(t => t.includes('錯誤')), got: out.join('；') };
    }],
    ['章節', '機制檢查固定第一章','玩家選了別章再跑機制檢查：setup 一律從第一章的星區 1 開始', M => {
      Game.chapterId = CHAPTERS[CHAPTERS.length - 1].id;
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const ok = Game.chapterId === 1 && Game.sector === 1;
      return { ok, got: `setup 之後：第 ${Game.chapterId} 章、星區 ${Game.sector}` };
    }],
    ['章節', '開局補償', '有開局補償的章節：開局晶體、武器插座、電路格照設定加上去；先連續選完幾次三選一（跳過也算一次）才到航圖；第一章沒有補償', M => {
      const out = [];
      Game.chapterId = 1; Game.newRun('run', 'vanguard', 'laser');
      const plain = Game.state === 'map' && Game.credits === 0 && Game.wSock === CFG.START_WSOCK && Game.chain.length === CFG.START_SLOTS;
      out.push(plain ? '第一章：直接到航圖、沒有補償' : `第一章不對（錯誤）：${Game.state}、◆${Game.credits}、插座 ${Game.wSock}、電路 ${Game.chain.length}`);
      const ch = CHAPTERS.find(c => c.start);
      if (!ch) return { ok: false, got: '沒有任何章節有開局補償（錯誤）' };
      const S = ch.start;
      Game.chapterId = ch.id; Game.newRun('run', 'vanguard', 'laser');
      const given = Game.credits === S.credits && Game.wSock === CFG.START_WSOCK + S.wSock && Game.chain.length === CFG.START_SLOTS + S.slots;
      out.push(given ? `${ch.name}：◆${S.credits}、插座 +${S.wSock}、電路 +${S.slots}` : `${ch.name} 補償不對（錯誤）：◆${Game.credits}、插座 ${Game.wSock}、電路 ${Game.chain.length}`);
      let screens = 0;
      for (let i = 0; i < S.picks + 2 && Game.state === 'reward'; i++) {
        if (Game.reward.kind !== 'start') break;
        screens++;
        Game.takeReward(null);  // 跳過（◆ +10）也算用掉一次
        if (Game.state === 'editor') Game.toggleEditor();
      }
      const picksOk = screens === S.picks && Game.state === 'map' && Game.bonusPicks === 0;
      out.push(picksOk ? `連續 ${screens} 次三選一後到航圖` : `三選一次數不對（錯誤）：出現 ${screens} 次，最後在 ${Game.state}`);
      Game.chapterId = 1;
      return { ok: plain && given && picksOk, got: out.join('；') };
    }],
    // ---- 雙人（房主這邊，用本機的隊友，不連線）：改成多人架構時的安全網 ----
    ['多人', '隊友的子彈算隊友的', '隊友開火：子彈的擁有者是隊友的配裝、環繞類跟著隊友的船；傷害記在隊友身上，房主的傷害是 0', M => {
      const m = M.coop(), dt = 1 / 60;
      M.targets([[250, 300]]);  // 隊友正前方 250
      let mine = 0, other = 0;
      for (let f = 0; f < 120; f++) {
        Game.time += dt; m.wantFire = true;
        Net.hostUpdateMates(dt);
        for (const b of Game.bullets) if (b.owner === m.L && b.ownerP === m) mine++; else other++;
        Game.updateBullets(dt);
      }
      const sum = R => Object.values(R.dmg).reduce((a, b) => a + b, 0), md = sum(m.L.R), hd = sum(Game.runStats);
      return { ok: mine > 0 && other === 0 && md > 0 && hd === 0, got: `隊友的子彈 ${mine}、別人的 ${other}；隊友傷害 ${Math.round(md)}、房主傷害 ${Math.round(hd)}` };
    }],
    ['多人', '吸血補開火的人', '隊友的子彈吸血：補隊友的血，房主的血不變', M => {
      const m = M.coop(), P = Game.player, dt = 1 / 60;
      M.targets([[250, 300]]);
      m.hp = 50; P.hp = 50;
      for (let f = 0; f < 120; f++) {
        Game.time += dt; m.wantFire = true;
        Net.hostUpdateMates(dt);
        for (const b of Game.bullets) b.lifesteal = 2;
        Game.updateBullets(dt);
      }
      return { ok: m.hp > 50 && P.hp === 50, got: `隊友 HP 50 → ${Math.round(m.hp)}、房主 HP 50 → ${Math.round(P.hp)}` };
    }],
    ['多人', '擊殺效果給打最後一擊的人', '連殺裝填、無傷連殺：記在打出最後一擊的那個人身上（隊友殺的給隊友、房主殺的給房主）', M => {
      const m = M.coop(), P = Game.player;
      m.L.wp = { ...m.L.wp, reload: true }; Game.wp = { ...Game.wp, reload: true };
      const streakOn = mc => ({ ...mc, traits: { ...mc.traits, streak: true } });
      m.L.mech = streakOn(m.L.mech); Game.mech = streakOn(Game.mech);
      m.fireCd = 5; P.fireCd = 5; m.streak = 0; P.streak = 0;
      Game.onReloadKill({ killer: m.L }); Game.onStreakKill({ killer: m.L });
      const a = m.fireCd === 0 && P.fireCd === 5 && m.streak === 1 && P.streak === 0;
      Game.onReloadKill({ killer: null }); Game.onStreakKill({ killer: null });
      const b = P.fireCd === 0 && P.streak === 1 && m.streak === 1;
      return { ok: a && b, got: `${a ? '隊友殺的給隊友' : '隊友殺的給錯人（錯誤）'}；${b ? '房主殺的給房主' : '房主殺的給錯人（錯誤）'}` };
    }],
    ['多人', '救援', '一人被擊墜（另一人還活著 → 不結束）；活著的人待在旁邊 2 秒救起來，分出自己一半的血；房主、隊友互救都可以', M => {
      const m = M.coop(), P = Game.player, dt = 1 / 60;
      const save = (down, helper) => {
        down.dead = false; helper.dead = false; down.reviveT = 0;
        helper.hp = 80; Game.playerDown(down);
        const stillPlay = Game.state === 'play';
        helper.x = down.x + 30; helper.y = down.y;
        for (let f = 0; f < 60 * (CFG.REVIVE.time + 0.2); f++) Game.updateRevive(dt);
        return stillPlay && !down.dead && near1(down.hp, 40) && near1(helper.hp, 40);
      };
      const a = save(m, P), b = save(P, m);
      return { ok: a && b, got: `房主救隊友${a ? '' : '（錯誤）'}；隊友救房主${b ? '' : '（錯誤）'}` };
    }],
    ['局外成長', '解鎖進度', '一局結束把成績加進進度（跨局累計），回傳新達成的；打倒精英、回響擊殺有記；UNLOCK_ALL 時全部能選；關掉時基地裡沒達成的飛船換不過去、武器裝不了', M => {
      const keep = [UNLOCK_KEY, CHAPTER_KEY, RECORDS_KEY].map(k => [k, localStorage.getItem(k)]), all = CFG.UNLOCK_ALL, sh = Screen.show;
      const html = fn => { let h = ''; Screen.show = x => { h = x; }; try { fn(); } finally { Screen.show = sh; } return h; };
      try {
        for (const [k] of keep) localStorage.removeItem(k);  // 玩家自己的紀錄也先拿開，不然會被拿去補解鎖
        const ids = L => L.map(u => u.id).sort().join(',');
        const a = unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 100, elites: 2, echoK: 5, play: { boomerang: 60 } });
        const b = unlockAddRun({ sector: 1, bossIds: [], weapon: 'scatter', kills: 50, play: { boomerang: 50 } });
        const P = unlockLoad(), sum = P.runs === 2 && P.kills === 150 && P.sector === 2 && P.play.boomerang === 110 && P.elites === 2;
        const firstOk = ids(a) === 'focus,railgun,wraith', secondOk = ids(b) === 'wallbounce';
        // 精英被回響打死：這一局的精英、回響擊殺各 +1
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const e = M.targets([[100, 0]], 'elite', true, 1)[0]; e.hurt(e.hp + 1, 0, 0, 'echo', null);  // 打死時遊戲自己算擊殺（onEnemyKilled）
        const killOk = Game.runStats.elites === 1 && Game.runStats.echoK === 1;
        CFG.UNLOCK_ALL = true;
        const hs = Hub.shipId; Hub.enter(); Hub.setShip('vanguard');
        const allOpen = isUnlocked('ship', 'gate') && Hub.pick('gate');
        CFG.UNLOCK_ALL = false; Hub.setShip('vanguard');
        const lockOk = !isUnlocked('ship', 'gate') && isUnlocked('ship', 'wraith') && isUnlocked('ship', 'vanguard') && !isUnlocked('weapon', 'blade');
        const gray = !Hub.pick('gate') && Hub.shipId === 'vanguard' && Hub.pick('wraith');
        Hub.setShip(hs);
        const hw = Hub.weaponId; Hub.weaponId = 'laser';
        const sb = !Hub.equip('blade') && Hub.weaponId === 'laser' && Hub.equip('scatter');  // 相位刃沒解鎖：裝不了；散彈開局就有
        Hub.weaponId = hw;
        return { ok: sum && firstOk && secondOk && killOk && allOpen && lockOk && gray && sb,
          got: `第 1 局新達成 ${ids(a) || '無'}（要 focus,railgun,wraith）、第 2 局 ${ids(b) || '無'}（要 wallbounce）；累計 ${P.runs} 局、擊殺 ${P.kills}、迴旋 ${P.play.boomerang}${sum ? '' : '（錯誤）'}；`
            + `回響打死精英：精英 ${Game.runStats.elites}、回響擊殺 ${Game.runStats.echoK}；全開時${allOpen ? '都能選' : '有鎖（錯誤）'}；上鎖時${lockOk ? '照進度' : '不對'}、基地${gray ? '換不到星門號、換得到幻影號' : '星門號沒鎖（錯誤）'}、武器架${sb ? '裝不了相位刃、裝得了散彈' : '鎖住的也裝得了（錯誤）'}` };
      } finally {
        CFG.UNLOCK_ALL = all;
        for (const [k, v] of keep) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
    }],
    ['局外成長', '基地', '開飛船的基地：停機坪換船（沒解鎖的換不過去）；靠近門按 E 打開那個面板；發射台用選的章出發（沒解鎖的章用第一章）；剛解鎖的東西在停機坪、門上有「新」，靠近停機坪、打開面板之後就沒了', M => {
      const keep = [UNLOCK_KEY, CHAPTER_KEY, RECORDS_KEY, UNLOCK_SEEN_KEY].map(k => [k, localStorage.getItem(k)]), all = CFG.UNLOCK_ALL, sh = Screen.show, hs = Hub.shipId, ch = Game.chapterId;
      const html = fn => { let h = ''; Screen.show = x => { h = x; }; try { fn(); } finally { Screen.show = sh; } return h; };
      const goTo = id => { const z = Hub.zone(id), s = Hub.ship; s.x = z.x; s.y = z.y; s.vx = s.vy = 0; Hub.update(0); return Hub.near && Hub.near.id; };
      try {
        for (const [k] of keep) localStorage.removeItem(k);
        CFG.UNLOCK_ALL = false;
        html(() => Screen.title()); Hub.setShip('vanguard');
        const nearPad = goTo('pad:gate'), lockSwap = Hub.interact() && Hub.shipId === 'vanguard';  // 鎖住：按 E 不會換
        const door = goTo('armory') === 'armory' && html(() => Hub.interact()).includes('⚔ 軍械庫');
        Game.chapterId = 2; const chLock = Hub.chapter() === 1;  // 第二章還沒解鎖：用第一章
        localStorage.setItem(CHAPTER_KEY, JSON.stringify({ cleared: [1] })); Game.chapterId = 2;
        const launch = goTo('launch') === 'launch' && html(() => Hub.interact()).includes('data-act="depart"');
        const go = html(() => Screen.depart()), goOk = go.includes('起始晶片') && go.includes(`:${Hub.weaponId}:`) && Game.chapterId === 2;  // 出發 → 直接起始晶片（武器在基地裝好了）
        unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'scatter', play: {} });  // 解鎖幻影號、軌道砲（第一章已通關 → 哨兵號也一起）
        const padZ = Hub.zone('pad:wraith'), doorZ = Hub.zone('armory');
        const newBefore = Screen.hubNew(padZ) === 1 && Screen.hubNew(doorZ) === 1;
        goTo('pad:wraith'); Screen.hubInfo(Hub.near);  // 靠近幻影號的停機坪 = 看過
        html(() => Screen.basePanel('armory'));       // 打開軍械庫 = 武器看過
        const newAfter = Screen.hubNew(padZ) === 0 && Screen.hubNew(doorZ) === 0 && Screen.hubNew(Hub.zone('pad:sentry')) === 1;
        const swap = Hub.interact() && Hub.shipId === 'wraith';
        return { ok: nearPad === 'pad:gate' && lockSwap && door && chLock && launch && goOk && newBefore && newAfter && swap,
          got: `鎖住的停機坪${nearPad === 'pad:gate' ? '' : '沒偵測到（錯誤）'}按 E ${lockSwap ? '不換' : '換了（錯誤）'}；門口按 E ${door ? '打開軍械庫' : '沒打開（錯誤）'}；沒解鎖的章${chLock ? '改用第一章' : '照樣選了（錯誤）'}；`
            + `發射台${launch ? '打開' : '沒打開（錯誤）'}、出發${goOk ? '到起始晶片（用裝好的武器）、第二章' : '不對（錯誤）'}；「新」：解鎖後停機坪、門${newBefore ? '都有' : '數量不對（錯誤）'}，看過之後${newAfter ? '沒了（哨兵號還在）' : '不對（錯誤）'}；解鎖的停機坪按 E ${swap ? '換成幻影號' : '沒換（錯誤）'}` };
      } finally {
        CFG.UNLOCK_ALL = all; Hub.setShip(hs); Game.chapterId = ch;
        for (const [k, v] of keep) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
    }],
    ['局外成長', '多人在基地準備', '多人房間是共用的基地：上方是房間列（房號、離開）；發射台按 E 是「準備」，準備 → 起始晶片（多人）；終端機不能用', M => {
      const sh = Screen.show, st = Game.state, ch = Net.chapter;
      const html = fn => { let h = ''; Screen.show = x => { h = x; }; try { fn(); } finally { Screen.show = sh; } return h; };
      const goTo = id => { const z = Hub.zone(id), s = Hub.ship; s.x = z.x; s.y = z.y; s.vx = s.vy = 0; Hub.update(0); return Hub.near && Hub.near.id; };
      try {
        Net.chapter = 1; Game.state = 'pick';
        const view = html(() => Screen.hubPick()), banner = view.includes('房號') && view.includes('data-act="title">離開');
        const launch = goTo('launch') === 'launch' && html(() => Hub.interact()).includes('準備：選起始晶片');
        const go = html(() => Screen.depart()), goOk = go.includes('起始晶片') && go.includes('data-arg="coop:');
        goTo('coop'); const termH = html(() => Hub.interact()), term = Game.state === 'pick' && !termH;  // 沒有開大廳、沒換畫面
        return { ok: banner && launch && goOk && term,
          got: `基地上方${banner ? '是房間列（房號＋離開）' : '沒有房間列（錯誤）'}；發射台${launch ? '是準備' : '不對（錯誤）'}；準備${goOk ? '到起始晶片（多人）' : '不對（錯誤）'}；終端機${term ? '不能用' : '還能用（錯誤）'}` };
      } finally { Game.state = st; Net.chapter = ch; }
    }],
    ['局外成長', '基地配置', '基地（分區太空站）照數量自動排（hubLayout）：每艘飛船、每把武器、每台終端機、每個操作台都有位置；互動點都在房間裡、開得到、互動範圍不重疊；每個房間都走得到，而且大廳有開口直接通到每間房。現在的數量和假的「8 艘飛船、7 把武器、3 台終端機」都要過', M => {
      const check = L => {
        const bad = [], Z = L.zones;
        const free = (x, y, r) => hubFree(L, x, y, r);
        for (const z of Z) if (!free(z.x, z.y, 14)) bad.push(`${z.id} 開不到`);
        for (let i = 0; i < Z.length; i++) for (let j = i + 1; j < Z.length; j++) { const a = Z[i], b = Z[j]; if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5) bad.push(`${a.id}／${b.id} 重疊`); }
        // 走得到：從出生點（大廳正中）用 20 的格子往外擴（飛船半徑 12），每個互動點附近要有走到的格子
        const G = 20, seen = new Set(), q = [[Math.round(L.spawn.x / G), Math.round(L.spawn.y / G)]];
        if (!free(L.spawn.x, L.spawn.y, 14)) bad.push('出生點不在房間裡');
        for (const T of L.targets) {  // 標靶機：整個（含底座）在軍械庫裡、不壓到武器架和操作台
          if (!hubFree({ walk: [L.rooms.armory] }, T.x, T.y, T.r + 12)) bad.push('標靶機不在軍械庫裡');
          for (const z of Z) if (Math.hypot(z.x - T.x, z.y - T.y) < z.r + T.r + 12) bad.push(`標靶機壓到 ${z.id}`);
        }
        while (q.length) { const [i, j] = q.pop(), key = i + ',' + j; if (seen.has(key) || !free(i * G, j * G, 12)) continue; seen.add(key); q.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]); }
        for (const z of Z) { let ok = false; for (let i = -3; i <= 3 && !ok; i++) for (let j = -3; j <= 3 && !ok; j++) ok = seen.has((Math.round(z.x / G) + i) + ',' + (Math.round(z.y / G) + j)); if (!ok) bad.push(`${z.id} 走不到`); }
        // 大廳每間房都進得去：有一個開口同時碰到大廳和那間房
        const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
        for (const r of Object.values(L.rooms)) if (r !== L.rooms.hall && !L.doors.some(d => hit(d, r) && hit(d, L.rooms.hall))) bad.push(`${r.id} 沒有直接通大廳`);
        return bad;
      };
      const ships = Object.keys(SHIPS), weapons = Object.keys(WEAPONS);
      const allNow = ships.every(id => HUB.zones.some(z => z.ship === id)) && weapons.every(id => HUB.zones.some(z => z.weapon === id)) && HUB_TERMS.every(t => Hub.zone(t.id)) && ['armory', 'chips', 'stats'].every(id => Hub.zone(id));
      const big = hubLayout(Array.from({ length: 8 }, (_, i) => ships[i] || 'ship' + i), Array.from({ length: 7 }, (_, i) => weapons[i] || 'wpn' + i), [...HUB_TERMS, { id: 't3', label: 'T3', color: '#fff' }]);
      const allBig = big.zones.filter(z => z.kind === 'pad').length === 8 && big.zones.filter(z => z.kind === 'rack').length === 7 && big.zones.filter(z => z.kind === 'term').length === 3;
      const b1 = check(HUB), b2 = check(big);
      return { ok: allNow && allBig && !b1.length && !b2.length,
        got: `現在 ${Math.round(HUB.W)}×${Math.round(HUB.H)}：${allNow ? '每樣都有位置' : '有東西沒位置（錯誤）'}${b1.length ? '；' + b1.slice(0, 4).join('、') + '（錯誤）' : '、開得到、走得到、不重疊'}；`
          + `假的 8 艘／7 把／3 台：${Math.round(big.W)}×${Math.round(big.H)}${allBig ? '' : '（數量不對，錯誤）'}${b2.length ? '；' + b2.slice(0, 4).join('、') + '（錯誤）' : '、開得到、走得到、不重疊'}` };
    }],
    ['局外成長', '記住上次的飛船和武器', '換船、換武器就存進瀏覽器（HUB_LAST_KEY）；重新整理後（記憶體裡沒有選擇）進基地，拿回存的那組', M => {
      const keep = localStorage.getItem(HUB_LAST_KEY), g0 = [Game.shipId, Game.weapon, Hub.shipId, Hub.weaponId];
      const S = Object.keys(SHIPS).filter(id => isUnlocked('ship', id)), W = Object.keys(WEAPONS).filter(id => isUnlocked('weapon', id));
      const s1 = S[S.length - 1], w1 = W[W.length - 1];
      try {
        localStorage.setItem(HUB_LAST_KEY, JSON.stringify({ ship: s1, weapon: w1 }));
        Game.shipId = null; Game.weapon = { id: 'laser', path: null, final: null }; Hub.shipId = Hub.weaponId = null;  // 剛打開遊戲：基地沒有選擇，Game.weapon 是預設的雷射（不能蓋掉存的）
        Hub.enter();
        const back = Hub.shipId === s1 && Hub.weaponId === w1;
        Hub.pick(S[0]); Hub.equip(W[0]);
        const L = Hub.last(), saved = L.ship === S[0] && L.weapon === W[0];
        localStorage.setItem(HUB_LAST_KEY, '{壞掉'); Hub.shipId = Hub.weaponId = null; Hub.enter();
        const broken = Hub.shipId === S[0] && Hub.weaponId === W[0];  // 存檔壞掉：當成沒有，用第一個解鎖的
        return { ok: S.length > 1 && W.length > 1 && back && saved && broken,
          got: `存 ${SHIPS[s1].name}＋${WEAPONS[w1].name} → 重新整理後${back ? '拿回來了' : `是 ${Hub.shipId}＋${Hub.weaponId}（錯誤）`}；換成 ${SHIPS[S[0]].name}＋${WEAPONS[W[0]].name} → 存的${saved ? '跟著變' : '沒變（錯誤）'}；存檔壞掉${broken ? '用第一個解鎖的' : '出錯（錯誤）'}` };
      } finally {
        if (keep == null) localStorage.removeItem(HUB_LAST_KEY); else localStorage.setItem(HUB_LAST_KEY, keep);
        [Game.shipId, Game.weapon, Hub.shipId, Hub.weaponId] = g0;
      }
    }],
    ['局外成長', '基地射擊', '基地按住左鍵用裝備的武器射：照武器的射速、一次幾發（散彈 4 發）；子彈撞牆就消失、在那裡爆火花；放開就停', M => {
      const st = Game.state, down = Input.down, hw = Hub.weaponId, keep = { x: Hub.ship && Hub.ship.x, y: Hub.ship && Hub.ship.y, aim: Hub.ship && Hub.ship.aim };
      try {
        Game.state = 'title'; Hub.enter(); Hub.shots = []; Hub.sparks = []; Hub.fireCd = 0;
        const s = Hub.ship; s.x = HUB.spawn.x; s.y = HUB.spawn.y; s.aim = -Math.PI / 2;  // 從大廳正中朝上牆射
        Hub.weaponId = 'scatter'; Input.down = true;
        Hub.updateShots(0.016); const first = Hub.shots.length;
        Hub.updateShots(0.016); const cd = Hub.shots.length === first;  // 冷卻中不會再射
        Input.down = false;
        for (let i = 0; i < 300; i++) Hub.updateShots(0.016);  // 5 秒：子彈都撞到牆或飛完
        const gone = Hub.shots.length === 0;
        Hub.weaponId = 'laser'; Hub.fireCd = 0; Input.down = true; s.aim = -Math.PI / 2; s.y = HUB.rooms.hall.y + 40;  // 貼著上牆射：一定撞牆
        let maxSpark = 0; for (let i = 0; i < 30; i++) { Hub.updateShots(0.016); maxSpark = Math.max(maxSpark, Hub.sparks.length); }
        Input.down = false;
        return { ok: first === 4 && cd && gone && maxSpark > 0,
          got: `散彈一次射出 ${first} 發（要 4）；冷卻中${cd ? '不會' : '會（錯誤）'}再射；放開 5 秒後子彈${gone ? '都消失' : '還在（錯誤）'}；貼著牆射${maxSpark ? '有火花' : '沒有火花（錯誤）'}` };
      } finally {
        Input.down = down; Game.state = st; Hub.weaponId = hw; Hub.shots = []; Hub.sparks = [];
        if (Hub.ship && keep.x != null) Object.assign(Hub.ship, keep);
      }
    }],
    ['局外成長', '基地靶場', '軍械庫的標靶機：打中跳傷害數字、頭上算每秒傷害（照武器傷害）；多人房間裡別人的子彈打到自己：被往子彈方向推開、閃白，不會掉血', M => {
      const st = Game.state, down = Input.down, hw = Hub.weaponId, keep = { x: Hub.ship && Hub.ship.x, y: Hub.ship && Hub.ship.y, aim: Hub.ship && Hub.ship.aim };
      try {
        Game.state = 'title'; Hub.enter(); Hub.shots = []; Hub.sparks = []; Hub.nums = []; Hub.hits = []; Hub.fireCd = 0; Hub.kick = { x: 0, y: 0 }; Hub.hitN = 0;
        const T = HUB.targets[0], s = Hub.ship; s.x = T.x - 160; s.y = T.y; s.aim = 0;  // 站在第一個靶左邊，朝右射
        Hub.weaponId = 'laser'; Input.down = true;
        for (let i = 0; i < 40; i++) Hub.updateShots(0.016);
        Input.down = false;
        const dmg = Math.round(weaponParams({ id: 'laser', path: null, final: null }).damage), hit = Hub.hits.filter(h => h.i === 0), dps = Hub.dps(0);
        const okT = hit.length > 0 && hit.every(h => h.dmg === dmg) && dps === Math.round(hit.length * dmg / HUB.DPS_WIN) && Hub.nums.length > 0;
        // 別人（2P）在自己左邊朝右開火：子彈打到自己 → 往右推
        Hub.shots = []; s.x = T.x - 300; s.y = T.y + 200; const hp = Game.player ? Game.player.hp : 0;
        Hub.addFire(2, s.x - 120, s.y, 0, 'laser');
        for (let i = 0; i < 30; i++) Hub.updateShots(0.016);
        const okHit = Hub.hitN > 0 && Hub.kick.x > 100 && Hub.hitT > 0;
        Hub.addFire(0, s.x - 120, s.y, 0, 'laser'); const n0 = Hub.hitN;  // 自己的子彈不會打到自己
        for (let i = 0; i < 30; i++) Hub.updateShots(0.016);
        const selfSafe = Hub.hitN === n0, noHp = !Game.player || Game.player.hp === hp;
        return { ok: okT && okHit && selfSafe && noHp,
          got: `標靶機打中 ${hit.length} 發、每發 ${hit.length ? hit[0].dmg : 0}（雷射 ${dmg}）、每秒 ${dps}${okT ? '' : '（錯誤）'}；2P 的子彈打到自己：${okHit ? `被推（推力 ${Math.round(Hub.kick.x)}）` : '沒反應（錯誤）'}；自己的子彈${selfSafe ? '不會' : '會（錯誤）'}打到自己；血量${noHp ? '不變' : '變了（錯誤）'}` };
      } finally {
        Input.down = down; Game.state = st; Hub.weaponId = hw; Hub.shots = []; Hub.sparks = []; Hub.nums = []; Hub.hits = []; Hub.kick = { x: 0, y: 0 }; Hub.hitT = 0;
        if (Hub.ship && keep.x != null) Object.assign(Hub.ship, keep);
      }
    }],
    ['局外成長', '晶片池上鎖', '上鎖時三選一（含稀有、保底組件）、商店、開局晶片都不會出現沒解鎖的晶片；條件達成後就會出現；UNLOCK_ALL 時全部都會出現', M => {
      const keep = [UNLOCK_KEY, CHAPTER_KEY, RECORDS_KEY].map(k => [k, localStorage.getItem(k)]), all = CFG.UNLOCK_ALL;
      const seen = () => {  // 抽很多次，看出現過哪些晶片
        const got = new Set(), add = id => { if (CHIPS[id]) got.add(baseOf(id)); };
        for (let i = 0; i < 300; i++) {
          Game.rewardOptions('combat', 2).forEach(add);
          Game.openShop(); Game.shop.items.forEach(it => add(it.id));
          startChipPicks().forEach(add);
        }
        return got;
      };
      try {
        for (const [k] of keep) localStorage.removeItem(k);
        CFG.UNLOCK_ALL = false;
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const locked = UNLOCKS.filter(u => u.kind !== 'ship' && u.kind !== 'weapon').map(u => u.id);
        const a = seen(), leak = locked.filter(id => a.has(id)), openMiss = NORMAL_IDS.filter(id => chipOpen(id) && !a.has(id));
        unlockAddRun({ sector: 1, bossIds: [], weapon: 'laser', play: { sticky: 100 } });  // 黏著 100 次 → 感染
        const b = seen(), infect = b.has('infect') && !b.has('wallbounce');
        CFG.UNLOCK_ALL = true;
        const c = seen(), allIn = NORMAL_IDS.every(id => c.has(id));
        return { ok: !leak.length && !openMiss.length && infect && allIn,
          got: `上鎖時出現沒解鎖的：${leak.join('、') || '無'}；解鎖的沒出現過：${openMiss.join('、') || '無'}；黏著 100 次後${infect ? '出現感染' : '感染沒出現或牆反彈也出現（錯誤）'}；全開時${allIn ? '全部都出現' : '有沒出現的（錯誤）'}` };
      } finally {
        CFG.UNLOCK_ALL = all;
        for (const [k, v] of keep) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
    }],
    ['局外成長', '存檔升級', '第一次讀進度時：2.20.0 以前的遊玩紀錄刪掉、章節進度只照 2.20.0 以後通關（或打到無盡）的紀錄重來（只做一次）；以後加的新成績用 2.20.0 以後的紀錄補一次，已經在記的不重複算', M => {
      const rec = (build, o) => ({ build, ship: '先鋒號', weapon: WEAPONS.laser.name + '・聚焦', chapter: 1, result: 'dead', endless: false, sector: 1, bosses: [], kills: 100, mech: { playKills: {} }, ...o });
      const recs = [rec('mp-2.21.0（2026-10-19 10:00）', { kills: 50, ulk: { sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 50, elites: 3, echoK: 0, play: {} } }),
        rec('mp-2.20.0（2026-10-18 03:59）', { chapter: 2, result: 'cleared', sector: 3, bosses: [ENEMY_TYPES.boss2.name, ENEMY_TYPES.boss.name], kills: 900, mech: { playKills: { [CHIPS.sticky.name]: 70 } } }),
        rec('mp-2.19.3（2026-10-17 10:00）', { chapter: 1, result: 'cleared', kills: 400 }), rec(undefined, { chapter: 3, endless: true })];
      // 2.20.0 的存檔（已經記了 2.20.0 以後的成績）：只刪紀錄、章節重來，成績不重複加
      const P = unlockParse({ runs: 2, kills: 950, sector: 3, boss: { boss: 1, boss2: 1 }, ch: [1, 2, 3] }), a = unlockUpgrade(P, recs);
      const keepOk = a.recs.length === 2 && a.ch.join() === '2' && P.ch.join() === '2' && P.mig === 1 && P.kills === 950 && P.runs === 2;
      const b = unlockUpgrade(P, a.recs), onceOk = b.ch === null && b.recs.length === 2;
      // 以後加的新成績（假的「擊殺加倍」）：用 2.20.0 以後的兩筆紀錄補一次
      UNLOCK_STATS.mcTest = (Q, r) => { Q.mcT = (Q.mcT || 0) + (r.kills || 0) * 2 + (r.elites || 0); };
      let newOk = false, newGot = '';
      try {
        unlockUpgrade(P, a.recs); const t1 = P.mcT; unlockUpgrade(P, a.recs);
        newOk = t1 === (50 * 2 + 3) + 900 * 2 && P.mcT === t1 && P.kills === 950;
        newGot = `新成績補了 ${t1}（要 ${50 * 2 + 3 + 900 * 2}）、再讀一次 ${P.mcT}`;
      } finally { delete UNLOCK_STATS.mcTest; }
      // 2.20.0 的紀錄換回成績：旗艦名稱 → id、武器名稱 → id、玩法擊殺的晶片名稱 → id
      const r0 = recordRun(recs[1]), convOk = r0.bossIds.join() === 'boss2,boss' && r0.weapon === 'laser' && r0.play.sticky === 70 && r0.kills === 900;
      return { ok: keepOk && onceOk && newOk && convOk,
        got: `留下 ${a.recs.length} 筆紀錄（要 2）、章節 ${a.ch.join(',') || '無'}（要 2）、成績 ${P.runs} 局擊殺 ${P.kills}（不變）${keepOk ? '' : '（錯誤）'}；第二次${onceOk ? '不再刪' : '又做了一次（錯誤）'}；${newGot}${newOk ? '' : '（錯誤）'}；`
          + `2.20.0 紀錄換回：王 ${r0.bossIds.join(',')}、武器 ${r0.weapon}、黏著 ${r0.play.sticky}${convOk ? '' : '（錯誤）'}` };
    }],
    ['介面', '設定', '設定頁的值存在瀏覽器、重新讀回來一樣；壞掉的存檔用預設值；主音量乘在音效上；關掉畫面震動就不會震', M => {
      const keep = localStorage.getItem(SETTINGS_KEY), old = { vol: Settings.vol, musicVol: Settings.musicVol, shake: Settings.shake, fps: Settings.fps, detail: Settings.detail };
      try {
        Settings.set('vol', 0.5); Settings.set('shake', false); Settings.set('fps', false);
        Settings.vol = 1; Settings.shake = true; Settings.fps = true; Settings.load();  // 重新讀
        const saved = Settings.vol === 0.5 && !Settings.shake && !Settings.fps && Settings.musicVol === old.musicVol;
        const m = SFX.muted; SFX.muted = false; const gain = Math.abs(SFX.gainNow() - SFX.VOLUME * 0.5) < 1e-9; SFX.muted = m;
        FX.shake = 0; Events.emit('shake', 12); const noShake = FX.shake === 0;
        Settings.set('shake', true); Events.emit('shake', 12); const shakes = FX.shake === 12; FX.shake = 0;
        localStorage.setItem(SETTINGS_KEY, '{"vol":"大聲","shake":3,"musicVol":9}'); Settings.load();
        const bad = Settings.vol === 1 && Settings.shake === true && Settings.musicVol === 1;
        return { ok: saved && gain && noShake && shakes && bad,
          got: `存了再讀：${saved ? '主音量 0.5、震動關、FPS 關' : '不對（錯誤）'}；音效音量${gain ? '照主音量' : '沒乘（錯誤）'}；震動關掉${noShake ? '不震' : '還在震（錯誤）'}、打開${shakes ? '會震' : '不震（錯誤）'}；壞掉的存檔${bad ? '用預設值' : '沒處理（錯誤）'}` };
      } finally {
        if (keep == null) localStorage.removeItem(SETTINGS_KEY); else localStorage.setItem(SETTINGS_KEY, keep);
        Object.assign(Settings, old);
      }
    }],
    ['多人', '人數和敵人數量',`一波的敵人：單人 ×1、雙人 ×${CFG.COOP_COUNT[0]}（第 1 星區開頭）；三、四人每多一個在線的人再 +${CFG.COOP_EXTRA}；離線的不算`, M => {
      const wave = () => {  // 第 1 星區開頭的一波（難度 0）；亂數固定 0.99 → 全部是蟲群，數量 = 預算
        Game.combat = { level: 0, wave: 0, wavesTotal: 3, elites: 0, boss: false, sandbox: false, themes: { list: [], share: 0 }, pending: [] };
        M.luck(0.99, () => Game.startWave(1));
        return Game.combat.pending.length;
      };
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const solo = wave();
      M.coop();
      const add = () => { const q = new Player(SHIPS.vanguard); q.L = Game.mates[0].L; q.slot = Game.mates.length + 2; Game.mates.push(q); };
      const two = wave(); add(); const three = wave(); add(); const four = wave();
      Game.mates[2].gone = true; const left = wave();  // 四人房、一個人離線 = 三人
      const b0 = (5 + 3) * CFG.WAVE_MUL, want = n => Math.ceil(b0 * (CFG.COOP_COUNT[0] + CFG.COOP_EXTRA * Math.max(0, n - 2)) - 1e-9);  // 第 1 波、難度 0 的預算（見 Game.startWave）
      const near = (v, n) => Math.abs(v - want(n)) <= 1;
      return { ok: near(two, 2) && near(three, 3) && near(four, 4) && left === three,
        got: `單人 ${solo}、雙人 ${two}（要 ${want(2)}）、三人 ${three}（要 ${want(3)}）、四人 ${four}（要 ${want(4)}）；四人房一人離線 ${left}（${left === three ? '跟三人一樣' : '錯誤'}）` };
    }],
    ['多人', '在場的玩家','兩人都在：在場 2 人、算多人難度、敵人找最近的那個；隊友離線或倒下：只剩房主、恢復單人難度（離線）', M => {
      const m = M.coop(), P = Game.player;
      const both = Game.players().length === 2 && Game.coopOn() && Game.nearestPlayer(m.x, m.y) === m && Game.nearestPlayer(P.x, P.y) === P;
      m.gone = true;
      const gone = Game.players().length === 1 && !Game.coopOn() && Game.nearestPlayer(m.x, m.y) === P;
      m.gone = false; m.dead = true;
      const dead = Game.players().length === 1 && Game.coopOn() && Game.nearestPlayer(m.x, m.y) === P;
      return { ok: both && gone && dead, got: `兩人都在${both ? '' : '（錯誤）'}；隊友離線${gone ? '' : '（錯誤）'}；隊友倒下${dead ? '' : '（錯誤）'}` };
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
  spawned(src, fn) {  // 跑 fn 的時候，記下某個來源射出的子彈（src 可以是陣列：產物上的分裂分出來的子彈來源是分裂）
    const got = [], orig = window.spawnShots;
    window.spawnShots = (list, ...rest) => { for (const s of list) if ([].concat(src).includes(s.src)) got.push(s); return orig(list, ...rest); };
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
  // 組件插在玩法晶片上會升級：沒插組件的基準也插一個只升級的收束透鏡，兩邊同等級，只比組件本身的效果
  lvFill(host) { return hasLv(host) ? ['focus'] : []; },
  shots(mode, charge, stand) { Game.fireMode = mode; Game.chargeC = charge; Game.standFull = !!stand; try { return runOps(Game.stats.ops, 0); } finally { Game.fireMode = null; Game.chargeC = null; Game.standFull = false; } },
  launch(w, host, c) {
    const grab = flat => {
      this.setup(w, flat);
      if (host === 'rear') { const L = this.shots(null, 0); return { prod: L.filter(b => b.rear), other: L.filter(b => !b.rear) }; }
      if (host === 'charge') return { prod: this.shots(null, 1), other: this.shots(null, 0) };
      if (host === 'dashfire') return { prod: this.shots('dashfire', 0), other: this.shots(null, 0) };
      if (host === 'stand') return { prod: this.shots(null, 0, 1), other: this.shots(null, 0) };  // 架設：滿層時射出的
      if (host === 'intercept') return { prod: this.shots('intercept', 0), other: this.shots(null, 0) };
      return { prod: this.shots(null, 0), other: [] };  // 其他：出手就是產物
    };
    const A = grab(['weapon', host, ...this.lvFill(host)]), B = grab(['weapon', host, c]);
    const avg = (L, k) => L.length ? L.reduce((a, b) => a + (b[k] || 0), 0) / L.length : 0;
    const ok = this.EL[c] ? this.elUp(c, A.prod[0], B.prod[0]) && (!B.other.length || !this.elUp(c, A.other[0], B.other[0])) : c === 'mirror' ? B.prod.length === 2 * A.prod.length && B.other.length === A.other.length : c === 'amp' ? avg(B.prod, 'hb') > 0.9 && avg(B.other, 'hb') === 0 : c === 'split' ? B.prod.length === 3 * A.prod.length && B.other.length === A.other.length
      : c === 'pierce' ? B.prod[0].pierce - A.prod[0].pierce >= 2 : B.prod[0].radius > A.prod[0].radius * 1.3;
    return { ok, got: `產物 ${A.prod.length} → ${B.prod.length} 發（加成 ${avg(B.prod, 'hb').toFixed(1)}、穿透 ${A.prod[0].pierce}→${B.prod[0].pierce}、半徑 ${A.prod[0].radius.toFixed(1)}→${B.prod[0].radius.toFixed(1)}）；其他子彈 ${B.other.length} 發（加成 ${avg(B.other, 'hb').toFixed(1)}）` };
  },
  sticky(w, c) {  // 黏著：爆炸是產物
    const run = flat => {
      this.setup(w, flat);
      const d = Math.min(150, this.range() * 0.6);
      // 巨彈看「爆炸範圍變大、波及到第二個靶」：靶放離中線 90（70 時散彈的彈丸偶爾直接擦到它、黏住爆炸，被當成波及；2026-10-11）
      //   其他組件照舊 70（爆裂靠波及到第二個靶算多一下爆炸）
      this.targets([[d, 0], [d, c === 'bigshot' ? 90 : 70]]);
      let spawned = [];
      const all = this.hurtLog(null, () => { spawned = this.spawned(['sticky', 'split'], () => { Game.player.fire(); this.step(150); }); });
      const e0 = Game.enemies[0];
      // 第二個靶自己被彈丸直接打中（散彈扇形邊緣偶爾擦到、黏在牠身上爆炸）：牠身上的爆炸不算（不是波及，2026-10-11 偶發失敗的原因）
      const hit1 = all.some(x => x.i === 1 && x.t === 'direct');
      return { log: all.filter(x => x.t === 'explode' && !(hit1 && x.i === 1)), arcs: all.filter(x => x.t === 'arc').length, burn: !!(e0 && e0.burnT > 0), slow: !!(e0 && e0.slowT > 0), shred: !!(e0 && e0.shredT > 0), spawned, pierce: runOps(Game.stats.ops, 0)[0].pierce };
    };
    const A = run(['weapon', 'sticky', ...this.lvFill('sticky')]), B = run(['weapon', 'sticky', c]);
    const ex = r => r.log.filter(x => x.i === 0).reduce((a, x) => a + x.d, 0), side = r => r.log.filter(x => x.i === 1).length;
    const ok = c === 'blast' ? B.log.length > A.log.length : c === 'ignite' ? B.burn && !A.burn : c === 'frost' ? B.slow && !A.slow : c === 'shock' ? B.arcs > A.arcs : c === 'shred' ? B.shred && !A.shred
      : c === 'amp' || c === 'mirror' ? ex(B) > ex(A) * 1.8 : c === 'split' ? B.spawned.length >= 3 : c === 'pierce' ? B.pierce - A.pierce >= 2 : side(B) > side(A);
    return { ok, got: `爆炸 ${A.log.length}→${B.log.length} 下、燃燒 ${B.burn}、減速 ${B.slow}、電弧 ${A.arcs}→${B.arcs}；爆炸 ${ex(A).toFixed(1)} → ${ex(B).toFixed(1)}、碎片 ${B.spawned.length}、穿透 ${A.pierce}→${B.pierce}、波及 ${side(A)}→${side(B)}` };
  },
  infect(w, c) {  // 感染：爆出來的子彈是產物
    const run = flat => {
      this.setup(w, flat);
      MechCheck.targets([[Math.min(100, this.range() * 0.6), 0]], 'swarmer', true, 0.01);  // 100：散彈 4 顆正中間沒有彈丸，150 外蟲群會從中間漏掉
      return this.spawned(['infect', 'split'], () => { Game.player.fire(); this.step(40); });
    };
    const A = run(['weapon', 'infect', ...this.lvFill('infect')]), B = run(['weapon', 'infect', c]);
    const hb = L => L.length ? L.reduce((x, s) => x + (s.hb || 0), 0) / L.length : 0;
    const ok = !!A.length && !!B.length && (this.EL[c] ? this.elUp(c, A[0], B[0]) : c === 'mirror' ? B.length >= A.length * 2 : c === 'amp' ? hb(B) > 0.9 : c === 'split' ? B.length >= A.length * 3
      : c === 'pierce' ? B[0].pierce - A[0].pierce >= 2 : B[0].radius > A[0].radius * 1.3);
    return { ok, got: `爆出 ${A.length} → ${B.length} 發、加成 ${hb(B).toFixed(1)}、穿透 ${A[0] ? A[0].pierce : '-'}→${B[0] ? B[0].pierce : '-'}` };
  },
  pull(w, c) {  // 吸引：只有巨彈有效果（範圍 ×1.5），其他組件只升級
    this.setup(w, ['weapon', 'pull', c]);
    const I = Game.stats.info.socks[1][0], L = runOps(Game.stats.ops, 0);
    return { ok: c === 'bigshot' ? !I.idle && L[0].pullMul > 1.4 : I.lvOnly && !I.idle && !(L[0].pullMul > 1), got: c === 'bigshot' ? `拉力範圍 ×${L[0].pullMul}` : I.lvOnly ? `只升級（${I.why}）` : '有效果（錯誤）' };
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
    return out;
  },
  // 武器（和觸發器）插座上的倍增：傷害加成只算直擊，產物不吃
  direct() {
    const out = [], P = () => Game.player;
    const check = (name, fn) => { let r; try { r = fn(); } catch (e) { r = { ok: false, got: '執行錯誤：' + e.message }; } out.push({ h: name, ...r }); };
    check('迴旋', () => { this.setup('laser', ['weapon', 'amp', 'boomerang']); this.targets([[150, 0]]); const H = this.hurtLog(null, () => { P().fire(); this.step(60); }).map(x => Math.round(x.d));
      const go = Math.round(LD() * 1.4), back = Math.round(LD() * 0.7);
      return { ok: H.includes(go) && H.includes(back), got: `去程／回程 ${[...new Set(H)].join('、')}（應有 ${go} 和 ${back}）` }; });
    const after = (name, flat, run, pick) => check(name, () => { this.setup('laser', flat); run(); const b = Game.bullets.find(pick);
      return { ok: !!b && Math.abs(b.bonus) < 0.01, got: b ? `產物的武器加成 ${b.bonus.toFixed(2)}` : '找不到產物' }; });
    after('環繞', ['weapon', 'amp', 'orbit'], () => { P().wantFire = true; this.step(20, true); P().wantFire = false; this.step(3); }, b => b.orbShot);
    after('加速', ['weapon', 'amp', 'accel'], () => { P().fire(); this.step(40); }, b => b.accelMul >= 1.5);
    after('牆反彈', ['weapon', 'amp', 'wallbounce'], () => { P().x = CFG.WORLD_W - 60; P().fire(); this.step(20); }, b => b.bounced);
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
    evoSplit('迴旋風暴＋分裂', ['weapon', 'amp', chipId('boomerang', 2), 'split', 'focus'], () => { this.targets([[150, 0]]); P().fire(); }, b => b.mode === 'return', 9);
    evoSplit('稜鏡＋分裂', ['weapon', 'amp', chipId('wallbounce', 2), 'split', 'focus'], () => { P().x = CFG.WORLD_W - 60; P().fire(); }, b => b.bounced, 6);
    check('觸發器（回響的迴旋）', () => { this.setup('laser', ['weapon', 'trigger', 'amp', 'boomerang']); this.targets([[120, 0], [320, 0]]);
      const H = this.hurtLog('echo', () => { P().fire(); this.step(180); }).map(x => +x.d.toFixed(1));
      const go = +(LD() * 0.7).toFixed(1), back = +(LD() * 0.35).toFixed(1);  // 回響 50% × 倍增 ×2 × 迴旋 0.7；回程不吃倍增
      return { ok: H.some(d => Math.abs(d - go) < 0.05) && H.some(d => Math.abs(d - back) < 0.05), got: `回響 ${[...new Set(H)].join('、')}（去程 ${go}，回程不吃觸發器上的倍增 ${back}）` }; });
    return out;
  },
  // 機制檢查的一項：全部過才算過，沒過的列出來
  summary(rows, label = r => `${r.h === 'weapon' ? '武器' : CHIPS[r.h] ? CHIPS[r.h].short : r.h}${r.c ? '［' + CHIPS[r.c].short + '］' : ''}${r.note || ''}`) {
    const bad = rows.filter(r => !r.ok);
    return { ok: !bad.length, got: bad.length ? `${rows.length - bad.length}/${rows.length}；沒過：` + bad.map(r => `${label(r)} ${r.got}`).join('；') : `${rows.length} 組全部有作用` };
  },
};
