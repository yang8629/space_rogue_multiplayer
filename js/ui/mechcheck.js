// 星環電路 雙人版 · mechcheck.js：機制觸發檢查（59 項，總覽的「機制檢查」分頁）
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
    Game.chain = chain.slice();
    Game.inventory = [...inv, null, null, null, null, null, null].slice(0, CFG.INV_SLOTS);
    Game.recalc();
    const p = Game.player;
    p.x = 1200; p.y = 800; p.aim = 0; p.vx = p.vy = 0;
    Game.bullets = []; Game.eBullets = []; Game.triggerQueue = []; Game.rings = []; Game.pickups = [];
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
    ['電路晶片', '巨彈', '散彈 5 發兩兩合併成 3 發，總傷害 +30%', M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'bigshot', null, null]);
      const list = runOps(Game.stats.ops, 0), sum = list.reduce((a, b) => a + b.damage, 0);
      const base = WEAPONS.scatter.base.damage * 5;  // 散彈一次 5 顆的總傷害
      return { ok: list.length === 3 && near1(sum, base * 1.3), got: `${list.length} 發，總傷害 ${sum.toFixed(1)}（應為 ${(base * 1.3).toFixed(1)}）` };
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
    ['電路晶片', '迴旋', '沒打中就飛到盡頭消失；打中敵人時穿過去折返，回程再打牠一次，飛回飛船；刃片揮到盡頭時有砍到敵人就飛回飛船；沒砍到就消失；迴旋的子彈打中時留一份黏著，照常折返（不會黏住就消失）', M => M.all([
      M => {  // 迴旋
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); M.targets([]);
        M.run(1); const b = Game.bullets[0];
        let back = false;
        for (let f = 0; f < 120 && b && !b.dead; f++) { Game.updateBullets(1 / 60); if (b.mode === 'return') back = true; }
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); const e = M.targets([[150, 0]])[0];
        M.run(1); const c = Game.bullets[0];
        for (let f = 0; f < 300 && c && !c.dead; f++) Game.updateBullets(1 / 60);
        const dmg = e.maxHp - e.hp;
        const home = c.dead && Math.hypot(c.x - Game.player.x, c.y - Game.player.y) < 40;
        return { ok: !back && b.dead && near1(dmg, 14) && home, got: (back ? '沒打中也折返了' : '沒打中：飛到盡頭消失') + `；單發打一隻：${Math.round(dmg)}（應為 7 + 7）${home ? '，回到飛船' : '，沒回到飛船'}` };
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
        return { ok: hit.ret > 0 && hit.home && miss.ret === 0, got: `砍到：${hit.ret} 片折返${hit.home ? '、都飛回來了' : '、還沒回來'}；沒砍到：${miss.ret} 片折返` };
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
    ['電路晶片', '黏著', '子彈黏上敵人，2 秒後一起爆炸（Lv1 ×1.5＋0.1／發，最多 ×3）；會穿透的子彈每穿過一隻留一份', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', null, null]); const e = M.targets([[120, 0]])[0];
      M.run(20); const n = e.stuck ? e.stuck.length : 0, hp = e.hp; Game.bullets = [];
      for (let f = 0; f < 150; f++) { Game.time += 1 / 60; Game.updateEnemies(1 / 60); }
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', 'sticky', null, null]); const row = M.targets([[120, 0], [180, 0], [240, 0], [300, 0], [360, 0]]);
      M.run(1); for (let f = 0; f < 30; f++) Game.updateBullets(1 / 60);
      const each = row.map(r => r.stuck ? r.stuck.length : 0).join('');
      const want = n * 10 * Math.min(3, 1.5 + 0.1 * n);
      return { ok: n > 0 && near1(hp - e.hp, want) && each === '11110', got: `雷射黏了 ${n} 發，爆炸 ${Math.round(hp - e.hp)}（應為 ${Math.round(want)}）；軌道砲（穿甲 3）一排 5 隻各黏 ${each}` };
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
        Game.player.wantFire = true; M.run(40);
        const trig = Game.bullets.filter(b => b.depth > 0), inRing = trig.filter(b => b.mode === 'orbit').length;
        return { ok: r.created > r.fired && r.hits.some(h => near1(h, 5)) && trig.length > 0 && inRing === 0,
          got: `開火 ${r.fired} 次，回響 ${r.created - r.fired} 發，回響傷害 5；接環繞時觸發 ${trig.length} 發、進圈 ${inRing} 發` };
      },
      M => {  // 觸發巢狀上限
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'trigger', 'trigger', 'trigger', null]); M.targets(M.cone);
        const r = M.run(120);
        return { ok: r.maxDepth === 3 && Game.stats.layers.length === 3, got: `實際最深第 ${r.maxDepth} 層` };
      },
    ])],
    ['電路晶片', '衝刺射擊／攔截', '衝刺結束時用整條電路朝準星開一槍（×1.5）；散彈照樣 5 發散射；攔截：子彈打掉敵彈（沒有穿甲就消失），並用整條電路回射', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'intercept', 'split', null]); M.targets([[300, 200]]);
      const gp = Game.player, gn = runOps(Game.stats.ops, 0).length;
      spawnShots([shot({ angle: 0, speed: 600, damage: 10, life: 1, intercept: 1 })], gp.x, gp.y, 0, 0, null);
      const mine = Game.bullets[0];
      Game.eBullets = [{ x: gp.x + 60, y: gp.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'test' }];
      for (let f = 0; f < 10 && Game.eBullets.length; f++) { Game.updateBullets(1 / 60); Game.updateEnemyBullets(1 / 60); }
      const back = Game.bullets.filter(b => b.depth === 1).length;
      if (Game.eBullets.length || !mine.dead || back !== gn) return { ok: false, got: `敵彈${Game.eBullets.length ? '沒被打掉' : '被打掉'}；子彈${mine.dead ? '消失了' : '還在'}；回射 ${back} 發（整條電路一槍 ${gn} 發）` };
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'dashfire', null, null]); M.targets([]);
      const p = Game.player, n0 = runOps(Game.stats.ops, 0), d0 = n0[0].damage;
      p.aim = Math.PI / 2; p.dashT = 0.05; p.vx = 900; p.vy = 0;
      p.tickDash(); p.dashT = 0; p.tickDash();
      const B = Game.bullets, aimOk = B.length && Math.abs(angleDiff(B.reduce((a, b) => a + b.angle, 0) / B.length, Math.PI / 2)) < 0.05;
      return { ok: B.length === n0.length && B.every(b => b.dashShot && near1(b.damage, d0 * 1.5)) && aimOk,
        got: `一般一槍 ${n0.length} 發；衝刺射出 ${B.length} 發，傷害 ${B.length && B[0].damage.toFixed(1)}（一般 ${d0.toFixed(1)}）${aimOk ? '，朝準星' : '，方向不對'}` };
    }],
    ['電路晶片', '鏡像迴路', '放在武器右邊 = 武器多射一次；接在玩法晶片（蓄力）後面沒有效果', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'mirror', null, null]); M.targets([]);
      const r = M.run(30);
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', 'mirror', null]); M.targets([]);
      const p = Game.player; p.chargeC = 0;
      for (let f = 0; f < 120; f++) p.tickFire(1 / 60, false);
      p.tickFire(1 / 60, true);
      const d = Game.bullets[0] ? Game.bullets[0].damage : 0;
      return { ok: r.created === r.fired * 2 && near1(d, 50), got: `開火 ${r.fired} 次，射出 ${r.created} 發；蓄力＋鏡像蓄滿一發 ${Math.round(d)}（應為 50，不是 250）` };
    }],
    ['電路晶片', '子彈上限 32 發', '超過的數量換算成傷害，總傷害不變', M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'split', 'split', null]);
      const a = Game.stats, want = WEAPONS.scatter.base.damage * 5 * 0.16 * 9;  // 5 顆 × 分裂兩次（×0.4 × 3，兩次）
      return { ok: a.count === 32 && near1(a.dmg, want), got: `${a.count} 發，總傷害 ${a.dmg.toFixed(1)}（應為 ${want.toFixed(1)}）` };
    }],

    ['構築系統', '晶片合成升級', '拿到第 2 個分裂 → Lv2，分裂成 4 發', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'split', null, null]);
      Game.acquire('split');
      return { ok: Game.chain[1] === leveledId('split', 2) && Game.stats.count === 4, got: `${CHIPS[Game.chain[1]].name}，每次 ${Game.stats.count} 發` };
    }],
    ['構築系統', '用量成長', '迴旋回程命中 180 次 → Lv2，540 次 → 進化「迴旋風暴」；拿到重複的不會合成，獎勵也不再出現；照玩法打中後 1 秒內敵人死掉，晶片成長 + 牠的晶體值；散彈多顆打中同一隻只算一份；超過 1 秒不算', M => M.all([
      M => {  // 用量成長
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
        Game.acquire('boomerang');
        const noMerge = Game.chain[1] === 'boomerang' && !Game.chipOffers().includes('boomerang') && Game.chipOffers().includes('amp');
        if (!noMerge) return { ok: false, got: '改玩法的晶片拿到重複的還是會合成升級，或獎勵還會出現' };
        Game.inventory = Game.inventory.map(() => null);
        const G1 = CHIPS.boomerang.grow.need; Game.grow(null, 'boomerang', G1[0]); const a = Game.chain[1];
        Game.grow(null, 'boomerang', G1[1] - G1[0]); const b = Game.chain[1];
        return { ok: a === leveledId('boomerang', 2) && b === leveledId('boomerang', 3), got: `${CHIPS[a].name} → ${CHIPS[b].name}` };
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
    ['構築系統', '倉庫被動', '穿甲放倉庫：受傷 -10%', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null], ['pierce']);
      const p = Game.player; p.hp = p.maxHp; Game.state = 'play';
      Game.hurtPlayer(20);
      return { ok: p.maxHp === 100 && near1(p.maxHp - p.hp, 18), got: `最大 HP ${p.maxHp}，受 20 傷害實扣 ${(p.maxHp - p.hp).toFixed(1)}` };
    }],
    ['構築系統', '黑洞融合（成功）', '兩個晶片合成一格，再加超載詞綴', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const before = Object.keys(CHIPS).length;
      const sg = fuseChips('split', 'amp');
      Game.chain[1] = sg; Game.recalc();
      const ok = Game.stats.count === 3 && Game.stats.dmg >= 10 * 0.4 * 3 * 2;
      const got = `每次 ${Game.stats.count} 發，傷害 ${Game.stats.dmg.toFixed(1)}`;
      Game.chain[1] = null; Game.recalc();  // 先從電路拿掉，再刪除測試用的奇異點，不留在這一場
      delete CHIPS[sg]; singularityCount--;
      return { ok: ok && Object.keys(CHIPS).length === before, got };
    }],
    ['構築系統', '廢鐵', '沒有效果、不能移動、維修站可拆除', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'scrap', null, null]);
      const dmg = Game.stats.dmg;
      Editor.dropOn(Game.chain, 1, { from: 'lib', id: 'amp' });
      const stuck = Game.chain[1] === 'scrap';
      Game.credits = 100; Game.state = 'repair';
      Game.removeScrap();
      return { ok: near1(dmg, 10) && stuck && Game.chain[1] === null && Game.credits === 100 - CFG.SCRAP_REMOVE,
        got: `傷害 ${dmg}、放晶片${stuck ? '被擋下' : '成功（錯誤）'}、拆除後花 ◆${100 - Game.credits}` };
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
    ['機體', '堡壘號・厚甲', '開局重裝甲 2 層：HP 140，單次受傷最多扣 20%（28）', M => {
      M.setup('run', 'bulwark', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player; p.hp = p.maxHp; Game.state = 'play';
      Game.hurtPlayer(100);
      return { ok: p.maxHp === 140 && near1(p.maxHp - p.hp, 28), got: `最大 HP ${p.maxHp}，受 100 傷害實扣 ${(p.maxHp - p.hp).toFixed(1)}` };
    }],
    ['機體', '衝撞（重裝甲 4 層）', '撞到敵人造成 80 傷害，自己不扣血', M => {
      M.setup('run', 'bulwark', 'laser', null, null, ['weapon', null, null, null]);
      Game.parts.armor = 4; Game.recalc();
      const p = Game.player; p.hp = p.maxHp; Game.state = 'play';
      const e = M.targets([[10, 0]], 'brute', true, 60)[0], hp = e.hp; e.t = { ...e.t, dmg: 25 };
      Game.updateEnemies(1 / 60);
      return { ok: near1(hp - e.hp, 80) && p.hp === p.maxHp, got: `敵人受到 ${Math.round(hp - e.hp)}，自己 HP ${p.hp}/${p.maxHp}` };
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
    ['地圖物件', '彗星', '有預警線；打爆後碎片往前炸出 10 發', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      Game.objs = [];
      Objects.spawnComet();
      const c = Game.objs[0], warned = c.warn > 0;
      c.warn = 0; c.lastAtt = { src: 'weapon', cr: null, owner: null };
      Objects.breakComet(c);
      return { ok: warned && Game.bullets.length === 10, got: `預警${warned ? '有' : '沒有'}，碎片 ${Game.bullets.length} 發` };
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
      for (let i = 0; i < 60 * 14; i++) {
        b.update(1 / 60, Game.player);
        if (b.mode === 'windup') windup = true;
        if (b.mode === 'charge') charged = true;
        maxShots = Math.max(maxShots, Game.eBullets.length);
      }
      const minions = Game.enemies.filter(e => e.type === 'spitter').length;
      return { ok: windup && charged && maxShots > 0 && b.enraged && minions > 0,
        got: `預警${windup ? '有' : '沒有'}、衝鋒${charged ? '有' : '沒有'}，彈幕最多 ${maxShots} 發，${b.enraged ? '已暴走' : '沒有暴走'}，部署 ${minions} 隻噴吐者` };
    }],
    ['敵人', '終焉核心：缺口環形波與護衛', '環形波留有缺口，會召喚刺殼', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const b = M.targets([[400, 0]], 'boss3', false, 1)[0]; b.t = { ...b.t, dmg: 0 };
      b.skillCd = 0;
      b.update(1 / 60, Game.player);  // 第一招：缺口環形波（第一圈立刻發射）
      b.update(1 / 60, Game.player);
      const first = Game.eBullets.length;
      for (let i = 0; i < 60 * 16; i++) b.update(1 / 60, Game.player);
      const brutes = Game.enemies.filter(e => e.type === 'brute').length;
      return { ok: first > 0 && first < 32 && brutes > 0, got: `第一圈 ${first} 發（滿圈 32），召喚 ${brutes} 隻刺殼` };
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
    ['敵人', '彈幕艇', '停在遠處，閃 0.6 秒後放一圈 10 發慢速彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[470, 0]], 'gunboat', false, 1)[0]; e.cd = 0.1;
      let wind = false;
      for (let f = 0; f < 90; f++) { Game.time += 1 / 60; e.update(1 / 60, p); if (e.mode === 'windup') wind = true; }
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      return { ok: wind && Game.eBullets.length === 10 && d > 380, got: (wind ? '有預警' : '沒預警') + '，放了 ' + Game.eBullets.length + ' 發，距離 ' + Math.round(d) };
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
      return { ok: front.dmg === 0 && front.eb > 0 && back.dmg > 0 && back.eb === 0, got: '正面：扣 ' + Math.round(front.dmg) + '、反彈 ' + front.eb + ' 發；背面：扣 ' + Math.round(back.dmg) + '、反彈 ' + back.eb + ' 發' };
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
      for (let i = 0; i < 60 * 12; i++) b.update(1 / 60, Game.player);
      const minions = Game.enemies.filter(e => e.type === 'swarmer').length;
      return { ok: b.enraged && minions > 0, got: `${b.enraged ? '已暴走' : '沒有暴走'}，召喚 ${minions} 隻蟲群` };
    }],
  ],

  // ---------- 執行：存檔 → 逐項檢查 → 還原 ----------
  runAll() {
    const saved = {};
    for (const k of Object.keys(Game)) if (typeof Game[k] !== 'function') saved[k] = Game[k];
    const savedWeaponChip = { ...CHIPS.weapon }, savedMuted = SFX.muted;
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
    SFX.muted = savedMuted;
    this.results = { list: results, ms: performance.now() - t0, at: new Date() };
    Game.restoreScreen();
    return this.results;
  },
};
const near1 = (a, b) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.02);
