// 星環電路 雙人版 · mechcheck.js：機制觸發檢查（53 項，總覽的「機制檢查」分頁）
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
    ['武器命中效果', '追蹤（相位刃・飛刃・追蹤飛刃）', '子彈轉向打中偏離準心的敵人', M => {
      M.setup('sandbox', 'vanguard', 'blade', 'B', 0, ['weapon', null, null, null]); M.targets([[220, 110]]);
      const n = M.trackOne();
      return { ok: n === 1, got: n ? '偏離準心 27° 的敵人被打中' : '沒有打中' };
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
      return { ok: list.length === 3 && near1(sum, 30 * 1.3), got: `${list.length} 發，總傷害 ${sum.toFixed(1)}` };
    }],
    ['電路晶片', '牆反彈', '子彈碰到場地邊緣反彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'wallbounce', null, null]); M.targets([]);
      Game.player.x = CFG.WORLD_W - 40;
      M.run(40);
      const back = Game.bullets.some(b => Math.cos(b.angle) < 0);
      return { ok: (Game.growth.wallbounce || 0) > 0 && back, got: `反彈 ${Game.growth.wallbounce || 0} 次${back ? '，子彈往回飛' : ''}` };
    }],
    ['電路晶片', '威力倍增器', '實際命中傷害 ×2', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]);
      const d = M.firstHit();
      return { ok: near1(d, 20), got: `單發命中 ${d.toFixed(1)}（基礎 10）` };
    }],
    ['電路晶片', '迴旋', '子彈飛到盡頭後飛回飛船', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]); M.targets([]);
      M.run(1); const b = Game.bullets[0];
      let back = false;
      for (let f = 0; f < 120 && b && !b.dead; f++) { Game.updateBullets(1 / 60); if (b.mode === 'return') back = true; }
      return { ok: back && b.dead, got: back ? `折返後回到飛船${b.dead ? '（消失）' : '（還在飛）'}` : '沒有折返' };
    }],
    ['電路晶片', '超頻模組', '同樣時間內開火次數變多', M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
      const a = M.run(180).fired;
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', 'overclock', null, null]); M.targets([]);
      const b = M.run(180).fired;
      return { ok: b > a, got: `3 秒開火 ${a} → ${b} 次` };
    }],
    ['電路晶片', '超頻模組・過熱', '連續射擊 3 秒後過熱，停火 1.5 秒', M => {
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
    }],
    ['電路晶片', '環繞', '子彈繞著飛船轉，碰到敵人不會消失', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'orbit', null, null]); M.targets([[50, 0]]);
      M.run(90);
      const p = Game.player, near = Game.bullets.filter(b => b.mode === 'orbit' && Math.hypot(b.x - p.x, b.y - p.y) < 60).length;
      return { ok: near > 0 && Game.enemies[0].hp < Game.enemies[0].maxHp, got: `飛船旁有 ${near} 發在繞，敵人被打 ${Math.round(Game.enemies[0].maxHp - Game.enemies[0].hp)}` };
    }],
    ['電路晶片', '黏著', '子彈黏上敵人，2 秒後一起爆炸（×2）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'sticky', null, null]); const e = M.targets([[120, 0]])[0];
      M.run(20); const n = e.stuck ? e.stuck.length : 0, hp = e.hp; Game.bullets = [];
      for (let f = 0; f < 150; f++) { Game.time += 1 / 60; Game.updateEnemies(1 / 60); }
      return { ok: n > 0 && near1(hp - e.hp, n * 10 * 2), got: `黏了 ${n} 發，爆炸 ${Math.round(hp - e.hp)}（應為 ${n * 20}）` };
    }],
    ['電路晶片', '感染', '被擊殺的敵人爆出 3 發子彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'infect', null, null]); M.targets([[120, 0]], 'swarmer', true, 0.1);
      const r = M.run(40);
      return { ok: r.created >= r.fired + 3, got: `開火 ${r.fired} 次，另外爆出 ${r.created - r.fired} 發` };
    }],
    ['電路晶片', '蓄力', '按住蓄滿，放開射出一發 ×5 傷害', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'charge', null, null]); M.targets([]);
      const p = Game.player;
      for (let f = 0; f < 50; f++) p.tickFire(1 / 60, true);
      const early = Game.bullets.length;
      for (let f = 0; f < 20; f++) p.tickFire(1 / 60, true);
      const b = Game.bullets[0];
      return { ok: early === 0 && b && near1(b.damage, 50), got: b ? `蓄滿前 ${early} 發，蓄滿後一發 ${b.damage.toFixed(1)}` : '沒有射出' };
    }],
    ['電路晶片', '命中觸發器', '命中時用武器再射一次（50%）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', null, null]); M.targets(M.cone);
      const r = M.run(90);
      return { ok: r.created > r.fired && r.hits.some(h => near1(h, 5)), got: `開火 ${r.fired} 次，回響 ${r.created - r.fired} 發，回響傷害 5` };
    }],
    ['電路晶片', '觸發巢狀上限', '連放 4 個觸發器，最多只展開 3 層', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'trigger', 'trigger', 'trigger', 'trigger', null]); M.targets(M.cone);
      const r = M.run(120);
      return { ok: r.maxDepth === 3 && Game.stats.layers.length === 3, got: `實際最深第 ${r.maxDepth} 層` };
    }],
    ['電路晶片', '衝刺射擊', '衝刺結束時從落點噴出 6 發', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'dashfire', null, null]); M.targets([]);
      const p = Game.player; p.dashT = 0.05; p.vx = 900; p.vy = 0;
      p.tickDash(); p.dashT = 0; p.tickDash();
      return { ok: Game.bullets.length === 6 && Game.bullets.every(b => b.dashShot), got: `射出 ${Game.bullets.length} 發` };
    }],
    ['電路晶片', '鏡像迴路', '放在武器右邊 = 武器多射一次', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'mirror', null, null]); M.targets([]);
      const r = M.run(30);
      return { ok: r.created === r.fired * 2, got: `開火 ${r.fired} 次，射出 ${r.created} 發` };
    }],
    ['電路晶片', '子彈上限 32 發', '超過的數量換算成傷害，總傷害不變', M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'split', 'split', null]);
      const a = Game.stats;
      return { ok: a.count === 32 && near1(a.dmg, 30 * 0.16 * 9), got: `${a.count} 發，總傷害 ${a.dmg.toFixed(1)}（應為 ${(30 * 0.16 * 9).toFixed(1)}）` };
    }],

    ['構築系統', '晶片合成升級', '拿到第 2 個分裂 → Lv2，分裂成 4 發', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'split', null, null]);
      Game.acquire('split');
      return { ok: Game.chain[1] === leveledId('split', 2) && Game.stats.count === 4, got: `${CHIPS[Game.chain[1]].name}，每次 ${Game.stats.count} 發` };
    }],
    ['構築系統', '用量成長', '迴旋回程命中 120 次 → Lv2，360 次 → 進化「迴旋風暴」', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.grow(null, 'boomerang', 120); const a = Game.chain[1];
      Game.grow(null, 'boomerang', 240); const b = Game.chain[1];
      return { ok: a === leveledId('boomerang', 2) && b === leveledId('boomerang', 3), got: `${CHIPS[a].name} → ${CHIPS[b].name}` };
    }],
    ['構築系統', '晶片傷害統計', '武器＋倍增器（×2）：兩者各分到一半，合計等於總傷害', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', null, null]); M.targets([[120, 0]]);
      M.run(60);
      const C = Game.runStats.chips, total = Object.values(Game.runStats.dmg).reduce((a, b) => a + b, 0);
      const sum = Object.values(C).reduce((a, b) => a + b, 0), share = sum ? (C.amp || 0) / sum : 0;
      const sec = Object.values(Game.sectorStats.chips).reduce((a, b) => a + b, 0);
      return { ok: total > 0 && near1(sum, total) && near1(sec, total) && near1(share, 0.5),
        got: `總傷害 ${Math.round(total)}，晶片合計 ${Math.round(sum)}，倍增器佔 ${Math.round(share * 100)}%` };
    }],
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
    ['構築系統', '結算傷害統計', '結算的傷害總計 = 敵人實際被扣的血量，並分出來源', M => {
      M.setup('run', 'vanguard', 'plasma', 'C', null, ['weapon', 'trigger', null, null]); M.targets(M.cone);
      const r = M.run(150), D = Game.runStats.dmg, total = Object.values(D).reduce((a, b) => a + b, 0);
      return { ok: near1(total, r.dmg) && D.direct > 0 && D.explode > 0 && D.echo > 0,
        got: `統計 ${Math.round(total)}／實際 ${Math.round(r.dmg)}（直擊 ${Math.round(D.direct)}、回響 ${Math.round(D.echo)}、爆炸 ${Math.round(D.explode)}）` };
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
    ['機體', '均衡', '5 種零件各 1 層：好處 +30%（HP 100 + (20+10)×1.3 − 10 = 129）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      for (const id of PART_IDS) Game.addPart(id);
      return { ok: Game.mech.traits.balance && Game.player.maxHp === 129, got: `均衡${Game.mech.traits.balance ? '開啟' : '沒開'}，最大 HP ${Game.player.maxHp}` };
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
    ['機體', '星門號：傳送門', '衝刺開出一對門，子彈穿過從另一個門出來', M => {
      M.setup('sandbox', 'gate', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player, x0 = p.x;
      p.dashT = 0.1; p.vx = 900; p.tickDash();
      p.x += 200; p.dashT = 0; p.tickDash();
      const q = Game.portals[0];
      if (!q) return { ok: false, got: '沒有開門' };
      spawnShots([shot({ angle: 0, speed: 300, damage: 10, life: 2 })], q.bx - 30, q.by, 0, 0, null);
      const b = Game.bullets[Game.bullets.length - 1];
      let at = null;
      for (let i = 0; i < 20 && at == null; i++) { Game.updateBullets(1 / 60); if (b.portalT) at = b.x; }
      return { ok: at != null && Math.abs(at - q.ax) < 60, got: at == null ? `門在 ${Math.round(q.ax - x0)} 與 ${Math.round(q.bx - x0)}，子彈沒有穿門` : `子彈從 ${Math.round(q.bx - x0)} 的門進去，從 ${Math.round(at - x0)} 出來` };
    }],
    ['地圖物件', '行星：擋子彈、彈弓', '正對行星的子彈被擋住；從旁邊經過的電漿球被彎過去', M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
      const p = Game.player;
      Game.objs = [{ type: 'planet', x: p.x + 300, y: p.y, r: 70 }];
      spawnShots([shot({ angle: 0, speed: 300, damage: 10, life: 3 })], p.x, p.y, 0, 0, null);
      spawnShots([shot({ angle: 0, speed: 300, damage: 10, life: 3 })], p.x, p.y + 130, 0, 0, null);
      const [hit, pass] = Game.bullets;
      for (let i = 0; i < 90; i++) Game.updateBullets(1 / 60);
      return { ok: hit.dead && hit.x < p.x + 300 && Math.abs(pass.angle) > 0.05,
        got: `正對的子彈${hit.dead ? '被擋下' : '穿過去了'}；旁邊的子彈轉了 ${(pass.angle * 180 / Math.PI).toFixed(1)}°` };
    }],
    ['地圖物件', '小行星：重武器才打得動', '10 傷害打不動；打爆時電路上的晶片成長 +8', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      const o = { type: 'rock', x: 0, y: 0, r: 20, hp: 80, maxHp: 80 };
      Game.objs = [o];
      Objects.hitRock(o, 10, null, 0, 0); const hp1 = o.hp;
      Objects.hitRock(o, 100, null, 0, 0);
      return { ok: hp1 === 80 && o.dead && Game.growth.boomerang === 8, got: `小彈後 HP ${hp1}，大彈後${o.dead ? '碎裂' : '還在'}，迴旋成長 ${Game.growth.boomerang || 0}` };
    }],
    ['地圖物件', '小行星：擋住視野', '小行星後面的敵人看不到；感測器 4 層看得到', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[300, 0]])[0];
      Game.objs = [{ type: 'rock', x: p.x + 150, y: p.y, r: 30, hp: 100, maxHp: 100 }];
      const hidden = !!Objects.blocker(p, e);
      Game.parts.sensor = 4; Game.recalc();
      const seen = !Objects.blocker(p, e);
      return { ok: hidden && seen, got: `一般${hidden ? '看不到' : '看得到'}，感測器 4 層${seen ? '看得到' : '看不到'}` };
    }],
    ['地圖物件', '黑洞', '把附近的敵人往中心拉，核心吞掉子彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, e = M.targets([[400, 150]], 'brute', true, 60)[0];
      Game.objs = [{ type: 'hole', x: p.x + 400, y: p.y, r: 34, R: 280, tick: 0 }];
      const d0 = Math.hypot(e.x - (p.x + 400), e.y - p.y);
      for (let i = 0; i < 60; i++) Objects.update(1 / 60);
      spawnShots([shot({ angle: 0, speed: 400, damage: 10, life: 3 })], p.x + 300, p.y, 0, 0, null);
      const b = Game.bullets[0];
      for (let i = 0; i < 30; i++) Game.updateBullets(1 / 60);
      const d1 = Math.hypot(e.x - (p.x + 400), e.y - p.y);
      return { ok: d1 < d0 - 20 && b.dead, got: `敵人離中心 ${Math.round(d0)} → ${Math.round(d1)}，子彈${b.dead ? '被吞掉' : '還在'}` };
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

    ['敵人', '精英：衝鋒與環形彈幕', '會蓄力衝鋒，也會放 14 發環形彈', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const e = M.targets([[400, 0]], 'elite', false, 1)[0]; e.t = { ...e.t, dmg: 0 };
      let charged = false, maxShots = 0;
      for (let i = 0; i < 60 * 8; i++) {
        e.update(1 / 60, Game.player);
        if (e.mode === 'charge') charged = true;
        maxShots = Math.max(maxShots, Game.eBullets.length);
      }
      return { ok: charged && maxShots >= 14, got: `衝鋒${charged ? '有' : '沒有'}發生，彈幕最多 ${maxShots} 發` };
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
