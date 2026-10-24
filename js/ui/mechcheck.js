// 星環電路 多人版 · mechcheck.js：機制觸發檢查（總覽的「機制檢查」分頁）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// MECH CHECK — 機制觸發檢查：用真正的遊戲引擎在測試靶場跑一遍，確認每個機制有觸發
//   跑之前把 Game 的狀態整份存起來，跑完還原，不影響正在進行的遊戲
// =====================================================================
// 檢查裡的期望值照武器資料算（2026-10-10 改過雷射傷害、散彈顆數，以前寫死 10 和 5）
const LD = () => WEAPONS.laser.base.damage, SN = () => 4;
// 武器原型的檢查用：推進 n 幀（玩家的武器每幀處理、開火、敵人、子彈都跑；不碰 Input）
const W_ = {
  step(n, fire = false) {
    const P = Game.player, dt = 1 / 60;
    for (let f = 0; f < n; f++) {
      Game.time += dt; P.wantFire = fire;
      P.tickAlt(dt); P.tickFire(dt, fire);
      for (const e of Game.enemies) e.update(dt, P);
      Game.updateBullets(dt); Game.updateEnemyBullets(dt);
    }
  },
};  // SN：「一次射出好幾顆」的測法用 4 顆（雷射把 count 改成 4，見環繞）
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
    const r = splitChain(chain.map(fullChip));  // 晶片給滿插座；插件寫在晶片後面 = 插在它的插座上（不佔電路格，電路維持原本格數）
    while (r.chain.length < chain.length) { r.chain.push(null); r.socks.push([]); }
    Game.chain = r.chain; Game.socks = r.socks;
    Game.inventory = [...inv, null, null, null, null, null, null].slice(0, CFG.INV_SLOTS);
    Game.recalc();
    const p = Game.player;
    p.x = 1200; p.y = 800; p.aim = 0; p.vx = p.vy = 0;
    Game.bullets = []; Game.eBullets = []; Game.triggerQueue = []; Events.emit('fxClear'); Game.pickups = [];
  },
  // 雙人（房主這邊）：加一個本機的隊友（不連線），擺在房主下方 300；回傳隊友的飛船（p.L 是它的配裝）
  //   隊友放進 Game 的寫法只在這裡，其他檢查都透過回傳值拿隊友
  coop(mateWeapon = 'laser', mateChain = ['weapon', null, null, null], hostWeapon = 'laser') {
    this.setup('coop', 'vanguard', hostWeapon, null, null, ['weapon', null, null, null]);
    const L = Net.makeLoadout({ ship: 'vanguard', weapon: mateWeapon, chip: null });
    const r = splitChain(mateChain.map(fullChip));
    while (r.chain.length < mateChain.length) { r.chain.push(null); r.socks.push([]); }
    L.chain = r.chain; L.socks = r.socks; L.cap = 99;
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.boons); });
    const m = new Player(SHIPS.vanguard);
    m.L = L; m.hp = m.maxHp = Game.maxHpOf(m.ship, L.passives, L.mech);
    m.x = Game.player.x; m.y = Game.player.y + 300; m.aim = 0; m.dashSeq = 0; m.wantFire = false;
    m.slot = 2; Game.mates = [m];
    Game.state = 'play'; Game.inArena = true;  // 戰場裡（勾隊友這類只在戰鬥中生效的，以前靠前面的檢查剛好留著 true）
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
    const s = weaponShots().reduce((a, c) => Math.abs(c.angle) < Math.abs(a.angle) ? c : a);
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
    ['武器命中效果', '貼臉命中', '敵人貼在船身上也打得到', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([[3, 2]]);
      const r = M.run(30);
      return { ok: r.dmg > 0, got: `造成 ${Math.round(r.dmg)} 傷害` };
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
    ['機體', '無傷連殺', '輕裝甲 4 層：沒被打中時每擊殺 1 隻傷害 +3%（最多 15 層）；護盾擋下不歸零，被打中歸零', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.parts.larmor = 4; Game.recalc();
      const P = Game.player, d = () => weaponShots()[0].damage, kill = n => { for (const e of M.targets(Array.from({ length: n }, (_, i) => [200, i * 20]))) e.hurt(1e9, 0, 0, 'mc'); };
      const d0 = d(); kill(5); const s5 = P.streak, d5 = d();
      kill(20); const s20 = P.streak;
      P.shield = 1; P.iframe = 0; Game.hurtPlayer(5, 'mc', P); const sSh = P.streak;
      P.iframe = 0; Game.hurtPlayer(5, 'mc', P); const sHit = P.streak;
      return { ok: Game.mech.traits.streak && s5 === 5 && near1(d5 / d0, 1.15) && s20 === 15 && sSh === 15 && sHit === 0,
        got: `殺 5 隻 ${s5} 層，傷害 ×${(d5 / d0).toFixed(2)}（要 ×1.15）；再殺 20 隻 ${s20} 層（要 15）；護盾擋下 ${sSh} 層；被打中 ${sHit} 層（要 0）` };
    }],
    // ---- 武器原型（2026-10-21）：每把武器的左鍵、右鍵、代表性的升級 ----
    ['武器原型', '能量刃：連段與彈反', `左鍵 ${COMBO.steps.map(s => s.name).join(' → ')} 循環、重斬傷害 ×${COMBO.steps[2].dmg}；右鍵彈反：格擋時間內碰到的敵彈反射回去、不扣血、擋到後冷卻剩 ${PARRY.hitCd} 秒，下一刀 ×${PARRY.boost}`, M => {
      M.setup('sandbox', 'vanguard', 'blade', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, names = [], dmg = [];
      for (let i = 0; i < 4; i++) { P.fireCd = 0; P.comboT = 1; const L = WEAPON_PLAY.blade.onFire(P, weaponShots()); names.push(P.comboName); dmg.push(L[0].damage); }
      const order = names.join(' → ') === [...COMBO.steps.map(s => s.name), COMBO.steps[0].name].join(' → ') && near1(dmg[2] / dmg[0], COMBO.steps[2].dmg);
      Game.slashQ = []; P.altCd = PARRY.cd; WEAPON_PLAY.blade.alt(P); P.iframe = 0; const hp0 = P.hp;  // 冷卻照 tickAlt：按下就是 PARRY.cd
      Game.eBullets = [{ x: P.x + 30, y: P.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'mc' }];
      W_.step(3);
      const refl = Game.bullets.some(b => b.shape === 'reflect'), safe = P.hp === hp0, up = P.edgeT > 0 && near1(P.altCd, PARRY.hitCd);
      const L = WEAPON_PLAY.blade.onFire(P, weaponShots());
      const boosted = near1(L[0].damage / dmg[0], PARRY.boost * COMBO.steps[2].dmg);  // 彈反成功：下一刀直接是強化的重斬
      return { ok: order && refl && safe && up && boosted, got: `連段 ${names.join(' → ')}（重斬 ×${(dmg[2] / dmg[0]).toFixed(2)}）；彈反${refl ? '反射了' : '沒反射（錯）'}、${safe ? '不扣血' : '扣血（錯）'}、${up ? `冷卻剩 ${P.altCd.toFixed(2)}` : `冷卻剩 ${P.altCd.toFixed(2)}（要 ${PARRY.hitCd}，錯）`}；下一刀 ×${(L[0].damage / dmg[0]).toFixed(2)}` };
    }],
    ['武器原型', '能量刃的升級', `無盡連段疊滿 ${ENDLESS.max} 層後每刀都是重斬、被打中歸零；旋風重斬 360°；血祭重斬扣血不低於 ${pct(BLOOD.floor)}、重斬打死的回 ${pct(BLOOD.kill)}（一般刀打死的不回）；吸能刃回到 ${pct(LEECH.cap)} 為止`, M => {
      const P = () => Game.player, swing = () => { P().fireCd = 0; const L = WEAPON_PLAY.blade.onFire(P(), weaponShots()); Game.slashQ = []; return L; };
      M.setup('sandbox', 'vanguard', 'blade', 'A', 0, ['weapon', null, null, null]);
      const seq = []; for (let i = 0; i < 14; i++) { swing(); seq.push(P().comboName); }
      const loop = seq.slice(ENDLESS.max).every(n => n === COMBO.steps[2].name) && P().endN === ENDLESS.max;
      WEAPON_PLAY.blade.onHurt(P()); const reset = P().endN === 0;
      M.setup('sandbox', 'vanguard', 'blade', 'A', 1, ['weapon', null, null, null]); P().comboI = COMBO4.length - 1; P().comboT = 1;
      const whirl = swing(), round = whirl.length === 2 * WEAPONS.blade.base.count;
      M.setup('sandbox', 'vanguard', 'blade', 'C', 1, ['weapon', null, null, null]); P().hp = P().maxHp;
      for (let i = 0; i < 40; i++) { P().comboI = COMBO.steps.length - 1; P().comboT = 1; swing(); }
      const bloodHp = P().hp, floor = near1(bloodHp, P().maxHp * BLOOD.floor);
      const [eH, eN] = M.targets([[60, 0], [60, 40]]), kill = (b, e) => { const h0 = P().hp; WEAPON_PLAY.blade.onHit(P(), b, e); e.hurt(1e9); return P().hp - h0; };  // 重斬（帶 sig）打死、一般刀打死
      const healH = kill({ sig: { done: true } }, eH), healN = kill({ sig: null }, eN), bloodKill = near1(healH, P().maxHp * BLOOD.kill) && healN === 0;
      M.setup('sandbox', 'vanguard', 'blade', 'C', 0, ['weapon', null, null, null]); P().hp = 1;
      for (let i = 0; i < 400; i++) WEAPON_PLAY.blade.onHit(P());
      const leech = near1(P().hp, P().maxHp * LEECH.cap);
      return { ok: loop && reset && round && floor && bloodKill && leech, got: `無盡連段 ${seq.join(' ')}${loop ? '' : '（錯）'}、被打中${reset ? '歸零' : '沒歸零（錯）'}；旋風重斬 ${whirl.length} 片；血祭後 HP ${Math.round(bloodHp)}、重斬打死回 ${Math.round(healH)}、一般刀打死回 ${Math.round(healN)}${bloodKill ? '' : '（錯）'}／吸能刃到 ${Math.round(P().hp)}` };
    }],
    ['武器原型', '熱能光束：過熱與排熱', `每發加熱 ${pct(HEAT.per)}，滿了過熱停火；右鍵排熱射出 ${HEAT.n} 道衝擊波、清掉 ${HEAT.r} 內的敵彈、熱度歸零；熔芯過熱不停火；分段排熱一次只排一半`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, W = WEAPON_PLAY.laser;
      let n = 0; while (W.canFire(P) && n < 100) { W.onFire(P, weaponShots()); n++; }
      const lock = P.hLock > 0 && n === Math.ceil(1 / HEAT.per - 1e-9);
      P.hLock = 0; P.hHeat = 0.6; Game.eBullets = [{ x: P.x + 50, y: P.y, vx: 0, vy: 0, r: 5, dmg: 10, life: 3, from: 'mc' }]; Game.bullets = [];
      W.alt(P); const vent = Game.bullets.length === HEAT.n && Game.eBullets[0].life === 0 && P.hHeat === 0;
      M.setup('sandbox', 'vanguard', 'laser', 'A', 0, ['weapon', null, null, null]); Game.player.hHeat = 1;
      W.onFire(Game.player, weaponShots()); const melt = !(Game.player.hLock > 0);
      M.setup('sandbox', 'vanguard', 'laser', 'B', 0, ['weapon', null, null, null]); Game.player.hHeat = 0.8;
      W.alt(Game.player); const half = near1(Game.player.hHeat, 0.4);
      return { ok: lock && vent && melt && half, got: `${n} 發過熱${lock ? '' : '（錯）'}；排熱 ${Game.bullets.length} 道${vent ? '、清彈、熱度歸零' : '（錯）'}；熔芯${melt ? '不停火' : '停火了（錯）'}；分段排熱 0.8 → ${Game.player.hHeat.toFixed(2)}` };
    }],
    ['武器原型', '熱能光束：停火後才降溫', `最後一發之後 ${HEAT.wait} 秒內熱度不掉，之後每秒降 ${pct(HEAT.cool)}`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, W = WEAPON_PLAY.laser, dt = 1 / 60;
      P.hHeat = 0.5; W.onFire(P, weaponShots()); P.wantFire = false;
      const h0 = P.hHeat, run = s => { for (let f = 0; f < Math.round(s * 60); f++) W.tick(P, dt); return P.hHeat; };
      const early = run(HEAT.wait - 0.1), late = run(1.1);  // 等待時間到之前、之後 1 秒（多 0.1 秒是剛好到的那一下）
      const want = h0 - HEAT.cool * 1;
      return { ok: near1(early, h0) && Math.abs(late - want) < 0.03, got: `開一發後熱度 ${h0.toFixed(2)}；${(HEAT.wait - 0.1).toFixed(1)} 秒後 ${early.toFixed(2)}（要不變）；再 1.1 秒後 ${late.toFixed(2)}（要約 ${want.toFixed(2)}）` };
    }],
    ['武器原型', '迴旋飛輪：停住與召回', `飛輪飛到盡頭停住、最多 ${DISC.max} 個（滿了不能擲）；召回全部飛回手上、回程 ×${DISC.back}；疊輪：同一處的疊成一個`, M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, W = WEAPON_PLAY.scatter;
      for (let i = 0; i < 5; i++) { if (W.canFire(P)) P.fire(); W_.step(40); }
      const D = ownShots(P, 'disc'), parked = D.length === DISC.max && D.every(b => b.mode === 'park') && !W.canFire(P);
      const d0 = D[0].damage; W.alt(P); const back = D.every(b => b.mode === 'return') && near1(D[0].damage, d0 * DISC.back);
      W_.step(90); const caught = ownShots(P, 'disc').length === 0;
      M.setup('sandbox', 'vanguard', 'scatter', 'A', 0, ['weapon', null, null, null]); M.targets([]);
      for (let i = 0; i < 3; i++) { Game.player.fire(); W_.step(40); }
      const S = ownShots(Game.player, 'disc'), stack = S.length === 1 && S[0].lvl === 3;
      return { ok: parked && back && caught && stack, got: `停住 ${D.length} 個${parked ? '、滿了不能擲' : '（錯）'}；召回${back ? '回程加傷' : '（錯）'}、${caught ? '都接回' : '沒接回（錯）'}；疊輪 ${S.map(b => b.lvl || 1).join('、')}` };
    }],
    ['武器原型', '重力井：吸怪與塌縮', `重力井把 ${WELL.r} 內的敵人往中心吸（旗艦不吸）；塌縮炸半徑 ${WELL.boom}，每多 1 隻 +${pct(WELL.per)}（最多算 ${WELL.capN} 隻）；殘留：塌縮後留小井`, M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]);
      const P = Game.player, R = WEAPONS.plasma.base.speed * WEAPONS.plasma.base.life;
      const T = M.targets([[R, 100], [R, -100]]);  // 固定的靶（速度 0、不滾）
      const boss = M.targets([[R, 100]], 'boss', true, 1)[0]; boss.update = () => {}; boss.knockResist = 99; Game.enemies.push(...T);  // 王不自己動，只看會不會被吸
      P.fire(); W_.step(60); const d0 = Math.hypot(T[0].x - P.x - R, T[0].y - P.y); W_.step(60);
      const d1 = Math.hypot(T[0].x - P.x - R, T[0].y - P.y), pulled = d1 < d0 - 20, bossStay = Math.abs(boss.y - P.y - 100) < 1;
      let ex = null; const o = Game.explode; Game.explode = function (...a) { ex = a; return o.apply(this, a); };
      WEAPON_PLAY.plasma.alt(P); Game.explode = o;
      const n = Game.enemies.filter(e => !e.dead && dist2(e.x, e.y, ex[0], ex[1]) < (WELL.boom + e.r) ** 2)
        .reduce((s, e) => s + (hitPts(e) ? Math.max(1, hitPts(e).filter(q => dist2(q.x, q.y, ex[0], ex[1]) < WELL.boom ** 2).length) : 1), 0);  // 旗艦算罩到的命中點
      const dmgOk = !!ex && near1(ex[3], WELL.dmg * (1 + WELL.per * clamp(n - 1, 0, WELL.capN)));
      M.setup('sandbox', 'vanguard', 'plasma', 'B', 1, ['weapon', null, null, null]); M.targets([]);
      Game.player.fire(); W_.step(60); WEAPON_PLAY.plasma.alt(Game.player);
      const res = Game.bullets.filter(b => b.small && b.mode === 'park').length === 1;
      return { ok: pulled && bossStay && dmgOk && res, got: `吸 ${Math.round(d0)} → ${Math.round(d1)}${pulled ? '' : '（錯）'}；旗艦${bossStay ? '不動' : '被吸了（錯）'}；塌縮 ${ex ? Math.round(ex[3]) : '沒炸（錯）'}（範圍內 ${n} 隻）；殘留${res ? '有小井' : '沒有（錯）'}` };
    }],
    ['武器原型', '旗艦命中點：塌縮照體型算隻數', `旗艦身上半徑每 ${CFG.HIT_PT.per} 一個命中點；重力井塌縮罩到幾點算幾隻（只算數量、傷害扣一次）；只擦到邊、沒罩到點算 1 隻`, M => {
      const boom = d => {  // 旗艦擺在重力井旁 d 的地方，回傳塌縮傷害和旗艦掉的血
        M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]);
        const P = Game.player, R = WEAPONS.plasma.base.speed * WEAPONS.plasma.base.life;
        const B = M.targets([[R + d, 0]], 'boss', true, 50)[0]; B.update = () => {}; B.knockResist = 99;
        P.fire(); W_.step(60);
        let ex = null; const o = Game.explode; Game.explode = function (...a) { ex = a; return o.apply(this, a); };
        const h0 = B.hp; WEAPON_PLAY.plasma.alt(P); Game.explode = o;
        return { dmg: ex ? ex[3] : 0, lost: h0 - B.hp, r: B.r };
      };
      const mid = boom(0), edge = boom(WELL.boom + 40), N = Math.max(1, Math.round(mid.r / CFG.HIT_PT.per));
      const want = k => WELL.dmg * (1 + WELL.per * clamp(k - 1, 0, WELL.capN));
      const okMid = near1(mid.dmg, want(N)) && N > 1, okEdge = edge.dmg > 0 && near1(edge.dmg, want(1)), once = mid.lost > 0 && mid.lost < want(N) * 1.5;
      return { ok: okMid && okEdge && once, got: `正中（半徑 ${Math.round(mid.r)}、${N} 點）塌縮 ${Math.round(mid.dmg)}（要 ${Math.round(want(N))}）；擦邊 ${Math.round(edge.dmg)}（要 ${Math.round(want(1))}）；旗艦掉血 ${Math.round(mid.lost)}${once ? '' : '（重複扣血，錯）'}` };
    }],
    ['武器原型', '牽引鉤：勾住、甩擊、打王', `勾住敵人拉到飛船前方 ${HOOK.hold}；甩擊撞到別隻受 ${HOOK.dmg}；旗艦勾不動：釘住每秒撕扯 ${HOOK.tear}，右鍵一扯 ${HOOK.rip}`, M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const P = Game.player, T = M.targets([[200, 0], [300, 0]], 'brute', true, 60), [a, b] = T;
      P.fire(); W_.step(45);
      const hooked = P.hookE === a && Math.abs(a.x - P.x - HOOK.hold) < 5;
      const hb = b.hp; WEAPON_PLAY.railgun.alt(P); W_.step(30);
      const slam = near1(hb - b.hp, HOOK.dmg);
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const B = M.targets([[200, 0]], 'boss', true, 50)[0], bx = B.x;
      Game.player.fire(); W_.step(20); const h0 = B.hp; W_.step(60);
      const tear = Game.player.hookE === B && Math.abs(B.x - bx) < 10 && Math.abs(h0 - B.hp - HOOK.tear) < 3;  // 王拉不動（鉤爪的擊退會推一點點）
      const h1 = B.hp; WEAPON_PLAY.railgun.alt(Game.player); const rip = near1(h1 - B.hp, HOOK.rip) && !Game.player.hookE;
      return { ok: hooked && slam && tear && rip, got: `${hooked ? '勾住拉到前方' : '沒勾住（錯）'}；甩擊撞擊 ${Math.round(hb - b.hp)}；旗艦${tear ? `釘住、1 秒撕扯 ${Math.round(h0 - h1)}` : '撕扯不對（錯）'}；一扯 ${Math.round(h1 - B.hp)}` };
    }],
    ['武器原型', '牽引鉤：勾住的不攻擊', `勾住的敵人暈住（不動、不攻擊）：彈幕艇被勾住的 ${HOOK.t} 秒內不開火；沒勾住的照常開火（對照組）`, M => {
      const shots = hook => {
        M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
        const P = Game.player, e = M.targets([[200, 0]], 'gunboat', false)[0]; e.alert = true;
        if (hook) { P.fire(); for (let f = 0; f < 30 && P.hookE !== e; f++) W_.step(1); }
        const held = P.hookE === e; e.cd = 0; Game.eBullets = [];  // cd 歸零：沒暈住的話下一幀就起手
        W_.step(Math.floor(60 * (HOOK.t - 0.6)));
        return { n: Game.eBullets.filter(b => b.from === e.t.name).length, held: held && P.hookE === e };
      };
      const free = shots(false), hooked = shots(true);
      return { ok: free.n > 0 && hooked.held && hooked.n === 0, got: `沒勾住開火 ${free.n} 發${free.n ? '' : '（對照組沒開火，檢查無效）'}；勾住${hooked.held ? '' : '（沒勾住，錯）'}開火 ${hooked.n} 發` };
    }],
    ['武器連段', '光束：四快一慢', `連射第 ${BEAT.n} 發前後都慢一拍（間隔 ×${BEAT.slow}）、傷害 ×${BEAT.dmg}、大小 ×${BEAT.grow}；停火 ${BEAT.reset} 秒從頭算`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const seen = new Set(), shots = [];
      const watch = n => { for (let f = 0; f < n; f++) { W_.step(1, true); for (const b of Game.bullets) if (!seen.has(b.nid)) { seen.add(b.nid); shots.push({ t: Game.time, d: b.damage, r: b.r }); } } };
      watch(Math.ceil(60 * Game.stats.interval * 12));
      const d0 = shots[0].d, gap = i => shots[i].t - shots[i - 1].t, iv = gap(2);
      const beat = shots.slice(0, 10).every((s, i) => near1(s.d, d0 * (i % BEAT.n === BEAT.n - 1 ? BEAT.dmg : 1)));
      const g4 = gap(4), g5 = gap(5), slow = Math.abs(g4 - iv * BEAT.slow) < 0.04 && Math.abs(g5 - iv * BEAT.slow) < 0.04 && shots[4].r > shots[3].r * (BEAT.grow - 0.1);
      W_.step(Math.ceil(60 * (BEAT.reset + Game.stats.interval * BEAT.slow)) + 2, false); shots.length = 0; watch(Math.ceil(60 * Game.stats.interval * 2));
      const reset = shots.length > 0 && near1(shots[0].d, d0);
      return { ok: beat && slow && reset, got: `前 10 發傷害${beat ? '照四快一慢' : '不對（錯）'}；第 5 發前隔 ${g4.toFixed(2)}、後隔 ${g5.toFixed(2)} 秒（一般 ${iv.toFixed(2)}）${slow ? '、變大' : '（錯）'}；停火後${reset ? '從頭算' : '沒從頭算（錯）'}` };
    }],
    ['武器原型', '飛輪：停住旋轉傷害加倍', `停住的飛輪每 ${DISC.rehit} 秒打一次、每下傷害 ×${DISC.parkMul}（飛出去的照子彈傷害）`, M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', null, null, null]);
      const P = Game.player, R = WEAPONS.scatter.base.speed * WEAPONS.scatter.base.life, e = M.targets([[R + 4, 0]], 'brute', true, 999)[0], d = Game.wp.damage;
      P.fire(); W_.step(Math.ceil(60 * WEAPONS.scatter.base.life) + 2);
      const parked = Game.bullets.some(b => !b.dead && b.mode === 'park'), hits = [], o = e.hurt;
      e.hurt = function (dmg, ...a) { hits.push(dmg); return o.call(this, dmg, ...a); };
      W_.step(Math.round(60 * DISC.rehit * 3)); e.hurt = o;
      const per = hits.length ? Math.max(...hits) : 0;
      return { ok: parked && hits.length >= 2 && per > d * 1.5 && near1(per, d * DISC.parkMul), got: `${parked ? '停住' : '沒停住（錯）'}；${hits.length} 下、每下 ${per.toFixed(1)}（子彈 ${d}，要 ${d * DISC.parkMul}）` };
    }],
    ['武器原型', '飛輪：時間到自己飛回', `停住 ${DISC.park} 秒後不消失、自己飛回手上；回程打到路上的敵人（傷害 ×1，召回才 ×${DISC.back}）；自己飛回不觸發武器線`, M => {
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', null, null, null]);
      const P = Game.player, R = WEAPONS.scatter.base.speed * WEAPONS.scatter.base.life, e = M.targets([[R + 400, 300]], 'brute', true, 999)[0], d = Game.wp.damage;
      P.aim = 0; P.fire(); W_.step(Math.ceil(60 * WEAPONS.scatter.base.life) + 2);
      const disc = Game.bullets.find(b => !b.dead && b.mode === 'park');
      e.x = P.x + R / 2; e.y = P.y;  // 擺在回程的路上
      let sig = 0; const o = Game.lineSig; Game.lineSig = function (...a) { sig++; return o.apply(this, a); };
      const hits = [], oh = e.hurt; e.hurt = function (dmg, ...r) { hits.push(dmg); return oh.call(this, dmg, ...r); };
      let back = false;
      try { for (let f = 0; f < 60 * (DISC.park + 2) && !(disc && disc.dead); f++) { W_.step(1); if (disc && disc.mode === 'return') back = true; } } finally { Game.lineSig = o; e.hurt = oh; }
      const caught = !!disc && disc.dead && WEAPON_PLAY.scatter.count(P) === 0;
      return { ok: !!disc && back && caught && hits.length >= 1 && near1(hits[0], d) && sig === 0, got: `${back ? '時間到飛回來' : '沒飛回（錯）'}、${caught ? '接回手上' : '沒接回（錯）'}；回程打到 ${hits.length} 下、每下 ${hits.length ? Math.round(hits[0]) : 0}（要 ${d}）；觸發武器線 ${sig} 次（要 0）` };
    }],
    ['武器原型', '光束排熱冷卻、飛輪撿起來', `排熱冷卻 ${HEAT.cd} 秒（分段排熱：第一下後 ${VENT2.cd} 秒能排第二下、第二下後照正常冷卻）；停住的飛輪開過去碰到就收回手上`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      let P = Game.player; P.hHeat = 1; P.altQ = true; P.tickAlt(1 / 60); const cd = P.altCd;
      M.setup('sandbox', 'vanguard', 'laser', 'B', 0, ['weapon', null, null, null]); M.targets([]);
      P = Game.player; P.hHeat = 1; P.altQ = true; P.tickAlt(1 / 60); const c1 = P.altCd; P.altCd = 0; P.altQ = true; P.tickAlt(1 / 60); const c2 = P.altCd;
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', null, null, null]); M.targets([]);
      P = Game.player; P.aim = 0; P.fire(); W_.step(Math.ceil(60 * WEAPONS.scatter.base.life) + 2);
      const disc = Game.bullets.find(b => !b.dead && b.mode === 'park'); P.x = disc.x - 5; P.y = disc.y; W_.step(1);
      const picked = disc.dead && WEAPON_PLAY.scatter.count(P) === 0;
      const ok = near1(cd, HEAT.cd) && near1(c1, VENT2.cd) && near1(c2, HEAT.cd) && picked;
      return { ok, got: `排熱冷卻 ${cd.toFixed(2)}；分段排熱 第一下後 ${c1.toFixed(2)}、第二下後 ${c2.toFixed(2)}；飛輪${picked ? '撿起來了' : '沒撿起來（錯）'}` };
    }],
    ['武器連段', '飛輪：全接快擲', `丟滿 ${DISC.max} 個再召回、全部接回 → 下一擲速度 ×${DISC_FAST.speed}、傷害 ×${DISC_FAST.dmg}；沒丟滿召回不算`, M => {
      const run = n => {
        M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', null, null, null]); M.targets([]);
        const P = Game.player, base = Game.wp.damage;
        for (let i = 0; i < n; i++) { P.fire(); W_.step(30); }
        WEAPON_PLAY.scatter.alt(P); W_.step(90);
        P.fire(); const b = Game.bullets[Game.bullets.length - 1];
        return { k: b.damage / base, v: b.speed / Game.wp.speed };
      };
      const full = run(DISC.max), part = run(DISC.max - 1);
      const ok = full.k > part.k + 0.5 && near1(full.k, DISC_FAST.dmg) && near1(full.v, DISC_FAST.speed) && near1(part.k, 1);  // 第一項：期望值不照 DISC_FAST 算（關掉快擲時也要抓得到）
      return { ok, got: `丟滿召回後下一擲 傷害 ×${full.k.toFixed(2)}、速度 ×${full.v.toFixed(2)}；沒丟滿 ×${part.k.toFixed(2)}` };
    }],
    ['武器連段', '重力井：疊井', `新的井停在舊井範圍裡合併（最多 ${WELL_STACK.max} 次）：吸引範圍 ×${WELL_STACK.r}、塌縮傷害 ×${WELL_STACK.dmg}`, M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player, wells = () => Game.bullets.filter(b => !b.dead && b.park && b.park.kind === 'well' && b.mode === 'park');
      P.fire(); W_.step(70); P.fire(); W_.step(70);
      const W = wells(), one = W.length === 1 && W[0].stack === 1;
      let ex = null; const o = Game.explode; Game.explode = function (...a) { ex = a; return o.apply(this, a); };
      WEAPON_PLAY.plasma.alt(P); Game.explode = o;
      const dmgOk = !!ex && near1(ex[3], WELL.dmg * WELL_STACK.dmg);
      return { ok: one && dmgOk, got: `射兩發同一點 → ${W.length} 個井${one ? '（疊 1 次）' : '（錯）'}；塌縮 ${ex ? Math.round(ex[3]) : '沒炸'}（要 ${Math.round(WELL.dmg * WELL_STACK.dmg)}）` };
    }],
    ['武器連段', '重力井：碰到才疊', '飛行中的重力彈碰到停著的井本體才併進去：停在旁邊沒碰到 → 另一個井；從井身上穿過去、會停在更遠 → 併進去', M => {
      const R = WEAPONS.plasma.base.speed * WEAPONS.plasma.base.life, wells = () => Game.bullets.filter(b => !b.dead && b.park && b.park.kind === 'well' && b.mode === 'park');
      const setup = () => { M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]); const P = Game.player; P.aim = 0; P.fire(); W_.step(60); return P; };
      let P = setup(); P.y -= 40; P.fireCd = 0; P.fire(); W_.step(60);  // 平移 40：停在舊井旁邊（吸引範圍 ${WELL.r} 內）、沒碰到
      const side = wells().length;
      P = setup(); P.x += 100; P.fireCd = 0; P.fire(); W_.step(60);  // 往前 100 再射：飛行中穿過舊井、本來會停在舊井後面 100
      const W = wells(), thru = W.length === 1 && W[0].stack === 1;
      return { ok: side === 2 && thru, got: `停在旁邊沒碰到：${side} 個井（要 2）；穿過舊井：${W.length} 個井、疊 ${W.map(b => b.stack || 0).join('／')}（要 1 個、疊 1）` };
    }],
    ['武器連段', '重力井：連射疊井不會被擠掉', `朝同一點一直射：疊滿的井留著（上限 ${WELL.max} 只算停住的井，疊進去的不算新的），4.5 秒後 ${WELL.max} 個、前兩個疊滿 ${WELL_STACK.max} 層`, M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player; P.aim = 0;
      W_.step(Math.round(60 * 4.5), true);
      const W = Game.bullets.filter(b => !b.dead && b.park && b.park.kind === 'well' && b.mode === 'park'), full = W.filter(b => (b.stack || 0) === WELL_STACK.max).length;
      return { ok: W.length === WELL.max && full >= 2 && WEAPON_PLAY.plasma.count(P) === WELL.max, got: `${W.length} 個井（疊 ${W.map(b => b.stack || 0).join('／')}），左上角顯示 ${WEAPON_PLAY.plasma.count(P)}` };
    }],
    ['武器連段', '牽引鉤：扯、扯、重摔', `勾住時左鍵改成扯（不射新鉤爪）；第 ${YANK.n} 扯重摔：傷害 ×${YANK.slam}、${YANK.r} 內的敵人一起吃`, M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const P = Game.player, [a, b] = M.targets([[200, 0], [HOOK.hold, 45]], 'brute', true, 60), d = Game.wp.damage;
      P.fire(); W_.step(45);
      const hooked = P.hookE === a, n0 = Game.bullets.length, ha = a.hp, hb = b.hp;
      P.fire(); P.fire();
      const yank = near1(ha - a.hp, d * 2) && Game.bullets.length === n0 && hb === b.hp;
      const ha2 = a.hp; P.fire();
      const slam = near1(ha2 - a.hp, d * YANK.slam) && near1(hb - b.hp, d * YANK.slam);
      return { ok: hooked && yank && slam, got: `${hooked ? '勾住' : '沒勾住（錯）'}；扯兩下 ${Math.round(ha - ha2)}（要 ${Math.round(d * 2)}）${Game.bullets.length === n0 ? '' : '、射了新鉤爪（錯）'}；重摔 勾住的 ${Math.round(ha2 - a.hp)}、旁邊的 ${Math.round(hb - b.hp)}（要 ${Math.round(d * YANK.slam)}）` };
    }],
    ['武器連段', '牽引鉤：扯不照射速、勾住的不撞人', `勾住時按住左鍵每 ${YANK.every} 秒扯一下（不是射速 ${WEAPONS.railgun.base.interval} 秒）：${(YANK.every * YANK.n).toFixed(1)} 秒內重摔；拉在身前的敵人碰到飛船不算撞擊`, M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const P = Game.player, a = M.targets([[200, 0]], 'brute', false, 60)[0];
      P.fire(); W_.step(45);
      const hooked = P.hookE === a, hp0 = P.hp;
      W_.step(Math.ceil(60 * YANK.every * YANK.n) + 3, true);
      const fast = hooked && P.slammed;
      a.x = P.x + 10; a.y = P.y; P.iframe = 0;
      const held = P.hookE === a; Game.update(1 / 60);
      const noRam = held && P.hp === hp0;
      return { ok: fast && noRam, got: `${hooked ? '勾住' : '沒勾住（錯）'}；${(YANK.every * YANK.n).toFixed(1)} 秒內${P.slammed ? '重摔了' : '還沒重摔（錯）'}；勾住的貼到飛船${P.hp === hp0 ? '沒掉血' : `掉了 ${Math.round(hp0 - P.hp)}（錯）`}` };
    }],
    ['幀率', '高幀率不會改變動作', '同樣 1 秒：60fps 和 120fps 的晶體飛行距離、敵人起手煞車後的速度要一樣（每幀衰減照時間換算，見 decay）', M => {
      const fly = fps => { const c = { x: 0, y: 0, vx: 0, vy: 0, vacuum: true }, p = { x: 500, y: 0 }; for (let i = 0; i < fps; i++) stepPickup(c, p, 0, dist2(c.x, c.y, p.x, p.y), 1 / fps); return c.x; };
      const brake = fps => { M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); const e = M.targets([[300, 0]], 'gunboat', false)[0]; e.alert = true; e.mode = 'windup'; e.modeT = 5; e.vx = 300; e.vy = 0; for (let i = 0; i < fps / 2; i++) e.update(1 / fps, Game.player); return e.vx; };
      const a = fly(60), b = fly(120), c = brake(60), d = brake(120);
      const ok = Math.abs(a - b) / a < 0.05 && Math.abs(c - d) < Math.max(1, c * 0.1);
      return { ok, got: `晶體 1 秒飛 ${Math.round(a)}／${Math.round(b)}（60／120fps）；彈幕艇起手 0.5 秒後速度 ${c.toFixed(1)}／${d.toFixed(1)}` };
    }],
    ['武器連段', '牽引鉤：扯有音效、拉人不穿牆', '扯不射子彈，自己發打中事件（音效）；勾住的敵人被牆擋住就過不來（走 Enemy.move，不直接改位置）', M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const P = Game.player, a = M.targets([[200, 0]], 'brute', true, 60)[0];
      P.fire(); W_.step(45);
      let hits = 0; const em = Events.emit; Events.emit = function (ev, ...r) { if (ev === 'hit') hits++; return em.call(this, ev, ...r); };
      try { P.fire(); } finally { Events.emit = em; }
      // 基地：標靶機貼在牆這一側，要拉到的點（飛船前方 HOOK.hold）在牆正對面、離得遠（260 以上：一幀移動超過牆厚才會穿過去，近的話碰撞會推回來）
      const save = Hub.weaponId; Hub.weaponId = 'railgun';
      let wall = false, d = 0;  // wall：找得到測試位置；d：這一幀的移動穿過牆幾次
      try {
        const T0 = HUB.targets[0]; Hub.build(T0.x - 200, T0.y, 0);
        const Q = Game.player, e = Game.enemies[0];
        let pick = null;
        for (let x = 40; x < HUB.W && !pick; x += 20) for (let y = 40; y < HUB.H && !pick; y += 20) {
          const v = Arena.f(x, y); if (v < e.r + 4 || v > e.r + 20) continue;
          const [gx, gy] = Arena.grad(x, y), l = Math.hypot(gx, gy) || 1, ux = -gx / l, uy = -gy / l;  // 往牆裡
          for (let s = 260; s <= 420 && !pick; s += 20) { const bx = x + ux * s, by = y + uy * s; if (Arena.f(bx, by) > e.r + 30 && Arena.f(bx + ux * HOOK.hold, by + uy * HOOK.hold) > 20 && Arena.losBlocked(x, y, bx, by, 0)) pick = [x, y, bx, by, ux, uy]; }
        }
        if (pick) {
          const [x, y, bx, by, ux, uy] = pick; e.x = x; e.y = y; Q.x = bx + ux * HOOK.hold; Q.y = by + uy * HOOK.hold;
          Q.hookE = e; Q.hookX = []; Q.hookT = HOOK.t; wall = true;
          for (let f = 0; f < 40; f++) { Q.aim = Math.atan2(-uy, -ux); const px = e.x, py = e.y; Hub.update(1 / 60); if (Arena.losBlocked(px, py, e.x, e.y, 0)) d++; }
        }
      } finally { Hub.weaponId = save; }
      return { ok: hits === 1 && wall && d === 0, got: `扯一下發打中事件 ${hits} 次；${wall ? `牆的另一邊拉 40 幀，標靶機穿牆 ${d} 次` : '找不到測試位置（錯）'}` };
    }],
    ['多人', '王鎖定輪替、轟炸分給每個人', `多人時旗艦鎖定一個人追（就算別人比較近），每 ${CFG.BOSS_LOCK.t} 秒換成這段時間打它最痛的人、沒人打就輪到下一個、鎖定的人倒下馬上換；落點轟炸的紅圈分給每個人；單人不鎖`, M => {
      const m = M.coop(), p = Game.player, B = M.targets([[400, 0]], 'boss3', true, 1)[0], T = CFG.BOSS_LOCK.t, tick = s => Game.bossLockTick(B, s);
      tick(0); const first = B.lock;
      B.hurt(50, 0, 0, 'direct', { owner: m }); tick(T + 0.1);
      const toMate = B.lock === 2 && Game.enemyTarget(B) === m;  // 隊友比較遠（房主在王旁邊 400、隊友 500）也追他
      tick(T + 0.1); const rotate = B.lock === 1;  // 沒人打：輪到下一個
      B.hurt(50, 0, 0, 'direct', { owner: m }); tick(T + 0.1); m.dead = true; tick(0.01); const swap = Game.enemyTarget(B) === p; m.dead = false;  // 兩人剩一個 = 不鎖、追活著的那個
      Game.zones = []; B.lockT = 99; B.mode = 'chase'; B.skillCd = 0; B.pickSkill = () => 'bomb'; B.update(1 / 60, Game.enemyTarget(B));
      const near = q => Game.zones.filter(z => Math.hypot(z.x - q.x, z.y - q.y) < 300).length, split = near(p) > 0 && near(m) > 0;
      Game.mates = []; Game.bossLockTick(B, T + 0.1); const solo = B.lock === 0 && Game.enemyTarget(B) === p;
      return { ok: first === 1 && toMate && rotate && swap && split && solo,
        got: `一開始鎖 ${first}P；隊友打王後鎖${toMate ? '隊友' : '（錯）'}；沒人打${rotate ? '輪到房主' : '沒輪換（錯）'}；鎖定的人倒下${swap ? '馬上換' : '沒換（錯）'}；紅圈 房主 ${near(p)}、隊友 ${near(m)}；單人${solo ? '不鎖' : '有鎖（錯）'}` };
    }],
    ['敵人', '王的標記圈：集合圈、分攤圈', `紅圈套在一個人身上跟著跑 ${CFG.MARK.follow} 秒、定住 ${CFG.MARK.hold} 秒後爆發；集合圈：圈外的人受傷；分攤圈：圈裡的人（＋被標的人）平分傷害，一個人就吃全部`, M => {
      const m = M.coop(), p = Game.player, B = M.targets([[400, 0]], 'boss3', true, 1)[0], MK = CFG.MARK, T = MK.follow + MK.hold;
      const run = s => { for (let i = 0; i < Math.round(s * 60); i++) Game.updateZones(1 / 60); };
      const reset = () => { for (const q of [p, m]) { q.hp = q.maxHp; q.iframe = 0; q.dashT = 0; } Game.zones = []; }, lost = q => q.maxHp - q.hp;
      reset(); B.lock = 1; B.markCast('gather'); const z = Game.zones[0];
      p.x += 60; run(MK.follow / 2); const follow = Math.hypot(z.x - p.x, z.y - p.y) < 1;
      run(MK.follow / 2 + 0.05); const x0 = z.x; p.x += 60; run(0.1); const held = Math.abs(z.x - x0) < 1;
      p.x = z.x; p.y = z.y; run(T); const gHost = lost(p), gMate = lost(m);  // 房主回到圈裡、隊友在 300 外
      reset(); m.x = p.x + 20; m.y = p.y; B.markCast('share'); run(T + 0.05); const sHost = lost(p), sMate = lost(m);
      reset(); m.x = p.x; m.y = p.y + 600; B.markCast('share'); run(T + 0.05); const solo = lost(p), soloMate = lost(m);
      const ok = follow && held && gHost === 0 && gMate > 0 && sHost > 0 && Math.abs(sHost - sMate) < 0.5 && solo > sHost * 1.5 && soloMate === 0;
      return { ok, got: `${follow ? '先跟著跑' : '沒跟著跑（錯）'}、${held ? '再定住' : '沒定住（錯）'}；集合圈：圈裡的房主扣 ${gHost}、圈外的隊友扣 ${gMate}；分攤圈：兩人都在圈裡各扣 ${+sHost.toFixed(1)}／${+sMate.toFixed(1)}，隊友不在圈裡：房主扣 ${+solo.toFixed(1)}、隊友扣 ${soloMate}` };
    }],
    ['多人', '子彈變大會重送給隊友', '疊井、疊輪、磨盤讓停住的子彈變大：位置沒變也要重送（Net.bulletRows 只送預測會錯的）', M => {
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]); M.targets([]);
      Game.player.fire(); W_.step(70);
      const b = Game.bullets.find(o => !o.dead && o.mode === 'park'), q = {}, rows = () => Net.bulletRows(q, () => true, c => c).b.filter(r => r[0] === b.nid).length;
      const first = rows(), same = rows(); b.r *= 1.3; const grown = rows();
      return { ok: first === 1 && same === 0 && grown === 1, got: `第一次送 ${first}、沒變 ${same}、變大後 ${grown}（要 1／0／1）` };
    }],
    ['武器原型', '牽引鉤：勾住的敵人當盾牌', `勾住的敵人擋下碰到牠的敵彈、照子彈傷害扣血；終極「反射盾」：擋下的彈回去打最近的敵人（×${HOOK_UP.reflect}，不打勾住的那隻）`, M => {
      const run = final => {
        M.setup('sandbox', 'vanguard', 'railgun', final ? 'C' : null, final, ['weapon', null, null, null]);
        const P = Game.player, [a, far] = M.targets([[200, 0], [400, 150]], 'brute', true, 60);
        P.fire(); W_.step(45);
        const b = { x: a.x + 10, y: a.y, vx: -200, vy: 0, r: 5, dmg: 10, life: 3, from: 'mc' }; Game.eBullets = [b];
        const n0 = Game.bullets.length, h0 = a.hp; WEAPON_PLAY.railgun.tick(P, 1 / 60);
        const ref = Game.bullets.slice(n0).find(o => o.shape === 'reflect');
        return { hooked: P.hookE === a, blocked: !(b.life > 0), lost: h0 - a.hp, ref: ref ? Math.round(ref.damage) : 0, aimFar: ref ? Math.abs(angleDiff(ref.angle, Math.atan2(far.y - b.y, far.x - b.x))) < 0.2 : false };
      };
      const base = run(null), rs = run(1);
      const ok = base.hooked && base.blocked && near1(base.lost, 10) && near1(rs.lost, 10) && !base.ref && rs.blocked && near1(rs.ref, 10 * HOOK_UP.reflect) && rs.aimFar;
      return { ok, got: `勾住時子彈${base.blocked ? '被擋下' : '穿過去（錯）'}${base.ref ? '、卻反彈了（錯）' : ''}、盾牌扣血 ${Math.round(base.lost)}／${Math.round(rs.lost)}（要 10）；反射盾 反彈 ${rs.ref}（要 ${10 * HOOK_UP.reflect}）${rs.aimFar ? '、打向別隻' : '、方向不對（錯）'}` };
    }],
    ['基地', '基地的右鍵是武器技能', '基地開著船按滑鼠右鍵 = 武器技能（跟戰鬥一樣），不是衝刺；不在開船時按沒反應', M => {
      const st = Game.state, drv = Hub.driving, save = Hub.weaponId; Hub.weaponId = 'scatter';
      try {
        const T0 = HUB.targets[0]; Hub.build(T0.x - 250, T0.y, 0); Game.state = 'title'; Hub.driving = true;
        const P = Game.player; P.fire(); for (let f = 0; f < 20; f++) Hub.update(1 / 60);
        const out = WEAPON_PLAY.scatter.count(P);
        Input.alt = Input.dash = false; Input.right(); const alt = Input.alt, dash = Input.dash;
        for (let f = 0; f < 3; f++) Hub.update(1 / 60);
        const recalled = WEAPON_PLAY.scatter.count(P) < out;
        Hub.driving = false; Input.alt = Input.dash = false; Input.right(); const idle = !Input.alt && !Input.dash;
        return { ok: alt && !dash && recalled && idle, got: `基地開船按右鍵：${alt ? '武器技能' : dash ? '變成衝刺（錯）' : '沒反應（錯）'}${recalled ? '、飛輪召回了' : '、飛輪沒召回（錯）'}；沒開船時${idle ? '沒反應' : '有反應（錯）'}` };
      } finally { Game.state = st; Hub.driving = drv; Hub.weaponId = save; Input.alt = Input.dash = Input.dashHeld = false; }
    }],
    ['基地', '基地跑戰場那一套', '基地每幀呼叫 Game.step（跟戰鬥同一個函式：戰場加了東西基地就會有）；牽引鉤勾得走標靶機', M => {
      const save = Hub.weaponId; Hub.weaponId = 'railgun';
      try {
        const T0 = HUB.targets[0]; Hub.build(T0.x - 250, T0.y, 0);
        let steps = 0; const o = Game.step; Game.step = function (dt) { steps++; return o.call(this, dt); };
        const P = Game.player, e = Game.enemies[0];
        try { P.fire(); for (let f = 0; f < 60; f++) Hub.update(1 / 60); } finally { Game.step = o; }
        const moved = Math.hypot(e.x - T0.x, e.y - T0.y);
        return { ok: steps === 60 && P.hookE === e && moved > 100, got: `60 幀呼叫 Game.step ${steps} 次；${P.hookE === e ? '勾住標靶機' : '沒勾住（錯）'}、拉離原位 ${Math.round(moved)}` };
      } finally { Hub.weaponId = save; }
    }],
    ['基地', '武器架按 Q 看升級路線', '靠近武器架（鎖住的也行）按 Q：發出 hubPaths（畫面打開電路總覽的武器頁、捲到那把）；武器頁每把武器那段都標了 data-wpn；靠近別的東西按 Q 沒反應', M => {
      const near = Hub.near, emit = Events.emit, got = [];
      Events.emit = function (k, d) { if (k === 'hubPaths') { got.push(d); return; } return emit.apply(this, arguments); };  // 只記下來，不真的打開總覽
      try {
        Hub.near = HUB.zones.find(z => z.kind === 'rack' && z.weapon === 'blade'); Hub.paths();
        Hub.near = HUB.zones.find(z => z.kind === 'pad'); Hub.paths();
      } finally { Events.emit = emit; Hub.near = near; }
      const html = Codex.weapons(), miss = Object.keys(WEAPONS).filter(id => !html.includes(`data-wpn="${id}"`));
      return { ok: got.join() === 'blade' && !miss.length,
        got: `武器架（能量刃）、停機位各按一次 Q：發出 ${got.length ? got.join('、') : '沒有'}（要只有 blade）；武器頁${miss.length ? `少了 ${miss.join('、')}（錯）` : '每把都有標記'}` };
    }],
    ['基地', '房間的切角', `房間的角斜切掉 ${HUB.CHAMFER}（旁邊有門的角、發射甲板不切）：切掉的角算牆（Arena、hubFree），飛船往角落一直開也停在斜邊外`, M => {
      const r = HUB.rooms.hangar, q = r.cuts.find(c => c.sx > 0 && c.sy > 0);
      if (!q) return { ok: false, got: '機庫左上角沒有切（錯）' };
      Hub.build(q.x + 120, q.y + 120, 0); const P = Game.player;  // build 會換一艘新的飛船：之後才拿
      const inCut = [q.x + 12, q.y + 12], past = [q.x + 40, q.y + 40];  // 斜邊內（12＋12 < 44）、斜邊外（40＋40 > 44）
      const wallOk = Arena.f(...inCut) < 0 && !hubFree(HUB, ...inCut, 0) && Arena.f(...past) > 0 && hubFree(HUB, ...past, 0);
      const joy0 = Input.joy; Input.joy = { bx: 0, by: 0, x: -42, y: -42 };  // 朝左上角一直開
      try { for (let f = 0; f < 120; f++) Hub.update(1 / 60); } finally { Input.joy = joy0; }
      const gap = ((P.x - q.x) + (P.y - q.y) - r.C) / Math.SQRT2 - P.r;  // 飛船外緣離斜邊多遠（負的 = 壓進切角）
      return { ok: wallOk && gap > -3, got: `切角${wallOk ? '算牆' : '沒算成牆（錯）'}；往角落開 2 秒後飛船外緣離斜邊 ${gap.toFixed(1)}${gap > -3 ? '' : '（壓進切角，錯）'}` };
    }],
    ['武器原型', '無人機蜂群：牽繩、耐久、收攏', `無人機最遠離飛船 ${DRONE.leash}（加上圍繞半徑）；飛出去被打 ${DRONE.hp} 下壞、${DRONE.respawn} 秒後重生；收攏最多擋 ${DRONE.blockN} 顆`, M => {
      M.setup('sandbox', 'vanguard', 'drone', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player; P.aimD = 2000;
      for (let f = 0; f < 120; f++) { Game.time += 1 / 60; P.wantFire = true; WEAPON_PLAY.drone.tick(P, 1 / 60); }
      const far = Math.max(...P.drones.map(d => Math.hypot(d.x - P.x, d.y - P.y))), leash = far <= DRONE.leash + DRONE.spread + 1 && far > DRONE.leash - DRONE.spread;
      const d = P.drones[0];
      for (let i = 0; i < DRONE.hp; i++) { Game.eBullets = [{ x: d.x, y: d.y, vx: 0, vy: 0, r: 5, dmg: 5, life: 3, from: 'mc' }]; WEAPON_PLAY.drone.tick(P, 1 / 60); }
      const broke = d.down > 0;
      for (let f = 0; f < 60 * DRONE.respawn + 5; f++) WEAPON_PLAY.drone.tick(P, 1 / 60);
      const back = !(d.down > 0) && d.hp === DRONE.hp;
      P.wantFire = false; WEAPON_PLAY.drone.alt(P);
      Game.eBullets = Array.from({ length: DRONE.blockN + 3 }, (_, i) => ({ x: P.x + 20 * Math.cos(i), y: P.y + 20 * Math.sin(i), vx: 0, vy: 0, r: 5, dmg: 5, life: 3, from: 'mc' }));
      WEAPON_PLAY.drone.tick(P, 1 / 60);
      const blocked = Game.eBullets.filter(b => b.life <= 0).length;
      return { ok: leash && broke && back && blocked === DRONE.blockN, got: `最遠 ${Math.round(far)}${leash ? '' : '（錯）'}；打 ${DRONE.hp} 下${broke ? '壞了' : '沒壞（錯）'}、${back ? '重生' : '沒重生（錯）'}；收攏擋 ${blocked} 顆（要 ${DRONE.blockN}）` };
    }],
    ['控制', '控制抗性（共用架構）', 'CFG.CC[等級][控制種類]：一般／精英／旗艦各查各的；ccDur 照規則（沒規則照控制本身）、ccEnd 開始免疫、ccImmune 時間到解除', M => {
      const save = CFG.CC; CFG.CC = { elite: { mc: { t: 1, immune: 2 } }, boss: { mc: { immune: 5 } } };
      try {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const [n, el, bo] = [M.targets([[200, 0]], 'brute')[0], M.targets([[200, 0]], 'elite')[0], M.targets([[200, 0]], 'boss')[0]];
        const dur = [n, el, bo].map(e => e.ccDur('mc', 9)), ends = [n, el, bo].map(e => e.ccEnd('mc'));
        const imm0 = [n, el, bo].map(e => e.ccImmune('mc'));
        Game.time += 3; const imm3 = [n, el, bo].map(e => e.ccImmune('mc'));
        Game.time += 3; const imm6 = [n, el, bo].map(e => e.ccImmune('mc'));
        const other = el.ccImmune('hook');
        const ok = dur.join() === '9,1,9' && ends.join() === 'false,true,true' && imm0.join() === 'false,true,true' && imm3.join() === 'false,false,true' && imm6.join() === 'false,false,false' && !other;
        return { ok, got: `控制時間 一般／精英／旗艦 ${dur.join('／')}（要 9／1／9）；結束後免疫 ${imm0.join('／')} → 3 秒後 ${imm3.join('／')} → 6 秒後 ${imm6.join('／')}；別種控制${other ? '也被免疫（錯）' : '不受影響'}` };
      } finally { CFG.CC = save; }
    }],
    ['武器原型', '牽引鉤：甩出去的也擋子彈', `右鍵甩出去、還在飛的敵人擋下碰到的敵彈、照子彈傷害扣血（飛行 ${HOOK.flyT} 秒內）`, M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const P = Game.player, a = M.targets([[200, 0]], 'brute', true, 60)[0];
      P.aim = 0; P.fire(); W_.step(45); WEAPON_PLAY.railgun.alt(P); W_.step(3);
      const flying = (P.flung || []).some(f => f.e === a), h0 = a.hp;
      const b = { x: a.x + 5, y: a.y, vx: 0, vy: 0, r: 5, dmg: 10, life: 3, from: 'mc' }; Game.eBullets = [b];
      WEAPON_PLAY.railgun.tick(P, 1 / 60);
      return { ok: flying && !(b.life > 0) && near1(h0 - a.hp, 10), got: `${flying ? '飛行中' : '沒在飛（錯）'}：子彈${b.life > 0 ? '穿過去（錯）' : '被擋下'}、牠扣 ${Math.round(h0 - a.hp)}（要 10）` };
    }],
    ['多人', '牽引鉤：勾隊友、衝刺掙脫、甩出去', `鉤爪打中隊友就勾住、他被拉到前方 ${HOOK.hold}；他衝刺就掙脫；被勾住的人不能勾隊友（不會互勾繞圈）；右鍵把隊友甩出去：飛行中無敵、撞到的敵人受 ${HOOK.dmg}`, M => {
      const run = n => { for (let i = 0; i < n; i++) Game.update(1 / 60); };
      // 1. 隊友勾房主：房主被拉到隊友前方
      let m = M.coop('railgun'), P = Game.player; m.x = P.x; m.y = P.y + 300; m.aim = -Math.PI / 2;
      Game.withLoadout(m.L, () => m.fire()); run(40);
      const hooked1 = m.hookShip === P && P.grabBy === 2, pulled = Math.hypot(P.x - m.x, P.y - (m.y - HOOK.hold)) < 30;
      // 2. 房主勾隊友；被勾住的隊友勾房主 → 勾不到（不會繞圈）；隊友衝刺 → 掙脫
      m = M.coop('railgun', ['weapon', null, null, null], 'railgun'); P = Game.player; m.x = P.x; m.y = P.y + 300; P.aim = Math.PI / 2; m.aim = -Math.PI / 2;
      P.fire(); run(25);
      const hooked2 = P.hookShip === m && m.grabBy === 1;
      Game.withLoadout(m.L, () => { m.fireCd = 0; m.fire(); }); run(20);
      const noLoop = !m.hookShip && !P.grabBy;
      m.dashT = CFG.DASH_TIME; run(2);
      const broke = !P.hookShip && !m.grabBy;
      // 3. 再勾一次、右鍵甩出去：隊友飛行中無敵，撞到路上的敵人
      m.dashT = 0; m.x = P.x; m.y = P.y + 250; P.fireCd = 0; P.fire(); run(25);
      const e = M.targets([[0, 260]], 'brute', true, 99)[0]; const h0 = e.hp;
      Game.withLoadout(Game.L, () => WEAPON_PLAY.railgun.alt(P));
      const flung = (m.flingSeq || 0) === 1 && m.iframe > 0 && !P.hookShip;
      if (m.flingV) for (let i = 0; i < 20; i++) { m.x += m.flingV[0] / 60; m.y += m.flingV[1] / 60; run(1); }  // 隊友的船在他自己電腦上飛：這裡照速度推
      const hit = near1(h0 - e.hp, HOOK.dmg);
      const ok = hooked1 && pulled && hooked2 && noLoop && broke && flung && hit;
      return { ok, got: `隊友勾房主${hooked1 ? '' : '（沒勾住，錯）'}、${pulled ? '拉到隊友前方' : '沒拉過去（錯）'}；房主勾隊友${hooked2 ? '' : '（沒勾住，錯）'}；被勾住的隊友反勾${noLoop ? '勾不到' : '勾到了（錯）'}；衝刺${broke ? '掙脫' : '沒掙脫（錯）'}；甩出去${flung ? '（無敵）' : '（錯）'}撞到敵人 ${Math.round(h0 - e.hp)}（要 ${HOOK.dmg}）` };
    }],
    ['武器原型', '牽引鉤：鉤索被牆擋住會放開', `鉤索把飛船拉向牆上的點；被擋住拉不過去（或拉超過 ${HOOK_UP.grapple.maxT} 秒）就放開，飛船能再自己移動（以前會被定住一整場）`, M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]); M.targets([]);
      const P = Game.player; P.x = 40; P.grap = { x: -40, y: P.y, hit: new Set() };  // 目標在場地外：飛船最多到 x = 半徑，永遠差 ${HOOK_UP.grapple.stop} 以上
      for (let f = 0; f < 120; f++) Game.update(1 / 60);  // 要跑飛船移動（撞到場地邊緣被推回來）：W_.step 只跑武器
      const freed = !P.grap; P.vx = 200; const x0 = P.x; Game.update(1 / 60); const moves = P.x !== x0;
      return { ok: freed && moves, got: `${freed ? '放開了' : '還拉著（錯）'}；之後飛船${moves ? '能移動' : '還是動不了（錯）'}` };
    }],
    ['武器原型', '牽引鉤：精英會掙脫', `精英勾 ${CFG.CC.elite.hook.t} 秒就掙脫（「勾」升級的 +${HOOK_UP.t} 秒照加），之後 ${CFG.CC.elite.hook.immune} 秒勾不住；一般敵人照樣勾 ${HOOK.t} 秒（控制抗性 CFG.CC）`, M => {
      const held = (type, path) => {  // 勾住後幾秒放開；放開後馬上再射一發勾不勾得住
        M.setup('sandbox', 'vanguard', 'railgun', path, null, ['weapon', null, null, null]);
        const P = Game.player, e = M.targets([[200, 0]], type, true, 60)[0];
        P.aim = 0; P.fire(); let f = 0; for (; f < 60 && P.hookE !== e; f++) W_.step(1);
        let h = 0; for (; h < 600 && P.hookE === e; h++) W_.step(1);
        P.fireCd = 0; P.fire(); for (let k = 0; k < 40 && P.hookE !== e; k++) W_.step(1);
        return { t: h / 60, again: P.hookE === e };
      };
      const el = held('elite', null), up = held('elite', 'A'), br = held('brute', null);
      const ok = Math.abs(el.t - CFG.CC.elite.hook.t) < 0.1 && !el.again && Math.abs(up.t - CFG.CC.elite.hook.t - HOOK_UP.t) < 0.1 && Math.abs(br.t - HOOK.t) < 0.1 && br.again;
      return { ok, got: `精英勾 ${el.t.toFixed(1)} 秒、放開馬上再勾${el.again ? '勾到了（錯）' : '勾不住'}；升級後精英 ${up.t.toFixed(1)} 秒；刺殼勾 ${br.t.toFixed(1)} 秒、放開${br.again ? '能再勾' : '勾不住（錯）'}` };
    }],
    ['武器原型', '牽引鉤：甩出去砸到會受傷、跳數字', `右鍵甩出去的敵人撞到別隻：被砸的受 ${HOOK.dmg}、被甩的受 ${pct(HOOK.self)}，兩隻都跳傷害數字（武器直接傷害 wHit 都會跳）`, M => {
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', null, null, null]);
      const P = Game.player, [a, b] = M.targets([[200, 0], [HOOK.hold + 150, 0]], 'brute', true, 60);
      P.aim = 0; P.fire(); W_.step(45);
      const ha = a.hp, hb = b.hp, nums = [], em = Events.emit;
      Events.emit = function (ev, d, ...r) { if (ev === 'floatText' && /^\d+$/.test(String(d.text))) nums.push(Math.hypot(d.x - a.x, d.y - a.y) < 80 ? 'a' : 'b'); return em.call(this, ev, d, ...r); };
      try { WEAPON_PLAY.railgun.alt(P); W_.step(30); } finally { Events.emit = em; }
      const da = ha - a.hp, db = hb - b.hp;
      return { ok: near1(db, HOOK.dmg) && near1(da, HOOK.dmg * HOOK.self) && nums.length >= 2, got: `被砸的扣 ${Math.round(db)}（要 ${HOOK.dmg}）、被甩的扣 ${Math.round(da)}（要 ${Math.round(HOOK.dmg * HOOK.self)}）；跳了 ${nums.length} 個數字${nums.length >= 2 ? '' : '（要 2，錯）'}` };
    }],
    ['武器原型', '無人機：準星在飛船上、一直瞄著目標', `游標放在飛船上（準星距離 0）按住射擊：無人機圍在飛船旁（不飛到前面 250）；機頭一直朝要打的目標，轉向是慢慢轉（每秒最多 ${DRONE.turn} 弧度，不瞬間轉過去）`, M => {
      M.setup('sandbox', 'vanguard', 'drone', null, null, ['weapon', null, null, null]);
      const P = Game.player, e = M.targets([[150, 60]], 'brute', true, 999)[0];
      P.aim = 0; P.aimD = 0;
      for (let f = 0; f < 90; f++) { Game.time += 1 / 60; P.wantFire = true; WEAPON_PLAY.drone.tick(P, 1 / 60); }
      const far = Math.max(...P.drones.map(d => Math.hypot(d.x - P.x, d.y - P.y))), near = far <= DRONE.spread + 10;
      W_.step(20, true); P.y += 40; P.wantFire = true; WEAPON_PLAY.drone.tick(P, 1 / 60);  // 飛船一動，無人機跟著飛：機頭還是朝目標（以前只有開火後一小段時間朝目標）
      const up = P.drones.filter(d => !(d.down > 0)), faced = up.length > 0 && up.every(d => Math.abs(angleDiff(d.a, Math.atan2(e.y - d.y, e.x - d.x))) < 0.35);
      const d0 = up[0], a0 = Math.atan2(e.y - d0.y, e.x - d0.x) + Math.PI; d0.a = a0; P.wantFire = false; WEAPON_PLAY.drone.tick(P, 1 / 60);  // 機頭轉到背對目標：下一幀只能轉一點點（以前開火那一下直接轉過去）
      const turned = Math.abs(angleDiff(a0, d0.a)), smooth = turned > 0 && turned <= DRONE.turn / 60 + 1e-6;
      return { ok: near && faced && smooth, got: `準星在飛船上：無人機最遠離飛船 ${Math.round(far)}${near ? '' : `（要 ≤ ${DRONE.spread + 10}，錯）`}；${up.length} 架${faced ? '機頭都朝目標' : '有的沒朝目標（錯）'}；背對目標時一幀轉 ${turned.toFixed(3)} 弧度${smooth ? '' : `（要 0～${(DRONE.turn / 60).toFixed(3)}，錯）`}` };
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
    ['航圖與戰鬥', '大地圖的牆', '會反彈的子彈（武器的反彈）照牆面法線反彈（入射角 = 反射角）、沒有反彈的子彈打到牆消失；敵人、敵彈不會穿牆；彗星碎片會打到飛船', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 2, elites: 0 });
      const p = Game.player;
      // 1. 反彈：從出生點朝 8 個方向各找一面牆，在牆前 160 朝牆射（斜 25°）
      let tries = 0, okRef = 0, nRef = 0, diesOk = 0, nDie = 0, worst = 0;
      const nearGate = (x, y) => Arena.gates.some(g => segDist2(g.x - g.ny * g.L, g.y + g.nx * g.L, g.x + g.ny * g.L, g.y - g.nx * g.L, x, y) < 60 * 60);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * TAU, ux = Math.cos(a), uy = Math.sin(a);
        let d = 0;
        while (d < 3000 && Arena.f(Arena.start.x + ux * d, Arena.start.y + uy * d) > 0) d += 10;
        if (d < 260 || d >= 3000 || Arena.gateCross(Arena.start.x, Arena.start.y, Arena.start.x + ux * d, Arena.start.y + uy * d)) continue;
        tries++;
        for (const bounce of [1, 0]) {
          Game.objs = []; Game.recalc(); Game.wp = { ...Game.wp, bounce };
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
          if (!bounce && b.dead && !b.bounced && !nearGate(b.x, b.y) && b.life > 0) { nDie++; if (Arena.f(b.x, b.y) < 2) diesOk++; }  // 射程用完才消失的不算
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
      return { ok: tries >= 3 && nRef >= 3 && okRef === nRef && nDie >= 3 && diesOk === nDie && worst > -40 && seenE > 100 && inWall === 0 && ebBad === 0 && shardHit,
        got: `反彈 ${okRef} / ${nRef} 次角度正確，沒反彈的子彈 ${diesOk} / ${nDie} 撞牆消失（最深進牆 ${(-worst).toFixed(0)}）；敵人 ${inWall ? inWall + ' 次在牆裡或別區（錯誤）' : '沒有穿牆'}（${seenE} 隻·幀），敵彈 ${eb} 個·幀 ${ebBad ? '有 ' + ebBad + ' 個在牆裡（錯誤）' : '沒有穿牆'}；彗星碎片${shardHit ? `打到飛船（-${Math.round(hp0 - P.hp)}）` : '沒打到飛船（錯誤）'}` };
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
    ['電路晶片', '擊退不疊加', '同一幀被同方向打中 25 發，速度最多是單發的擊退；單發照常擊退', M => {  // 以前每發都加上去，散彈＋鏡像會把敵人推進牆裡
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const [a, b] = M.targets([[150, 0], [150, 120]], 'swarmer'); a.hp = b.hp = 1e9; a.vx = a.vy = b.vx = b.vy = 0;
      for (let i = 0; i < 25; i++) a.hurt(1, 300, 0);
      b.hurt(1, 300, 0);
      const va = Math.hypot(a.vx, a.vy), vb = Math.hypot(b.vx, b.vy);
      return { ok: Math.abs(va - 300) < 1 && Math.abs(vb - 300) < 1, got: `25 發後速度 ${Math.round(va)}（要 300）；單發 ${Math.round(vb)}（要 300）` };
    }],
    ['線', '武器線：照觸發係數觸發', `武器命中照武器的觸發係數累積，滿 1 觸發下一格一次（熱能光束 ${WEAPONS.laser.trig}：第 ${Math.ceil(1 / WEAPONS.laser.trig - 1e-9)} 下觸發）；多的留著；武器線後面沒有晶片時武器的子彈不帶線`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null]);
      const L0 = Game.stats.line, e = M.targets([[200, 0]])[0], b = { ln: { line: L0, k: -1 }, owner: null, angle: 0 };
      const n = []; for (let i = 0; i < 6; i++) { Game.linePass(b, 'hit', e); n.push(Game.triggerQueue.length); }
      const want = WEAPONS.laser.trig, first = n.indexOf(1) + 1, six = Math.floor(6 * want + 1e-9);
      Game.updateBullets(1 / 60);
      const blades = Game.bullets.filter(q => q.att.src === 'boomerang').length;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null]); const bare = weaponShots().every(q => !q.ln);
      const need = Math.ceil(1 / want - 1e-9);
      return { ok: first === need && n[5] === six && blades === six && bare,
        got: `第 ${first} 下觸發（係數 ${want.toFixed(2)}，要第 ${need} 下）；6 下觸發 ${n[5]} 次（要 ${six}）；放出迴旋刃 ${blades} 片；沒接晶片時子彈${bare ? '不帶線' : '帶線（錯誤）'}` };
    }],
    ['線', '產物往下傳', '迴旋刃命中照迴旋的係數往下傳（0.35：第 3 下觸發佈雷）；佈雷爆炸往下傳；感染只有擊殺才往下傳（命中不算）；最後一格的產物不再往下傳', M => {
      const first = flat => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, flat);
        const L0 = Game.stats.line, e = M.targets([[200, 0]])[0], b = { ln: { line: L0, k: 0 }, owner: null, angle: 0 };
        let hit = 0, kill = 0;
        for (let i = 0; i < 4 && !hit; i++) { Game.linePass(b, 'hit', e); if (Game.triggerQueue.length) hit = i + 1; }
        Game.triggerQueue = []; Game.linePass(b, 'kill', e); kill = Game.triggerQueue.length;
        Game.triggerQueue = []; Game.L.lnAcc = null;
        const T = Game.triggerQueue; Game.linePass({ ln: { line: L0, k: L0.cells.length - 1 }, owner: null, angle: 0 }, 'hit', e); Game.linePass({ ln: { line: L0, k: L0.cells.length - 1 }, owner: null, angle: 0 }, 'kill', e);
        return { hit, kill, last: T.length };
      };
      const bm = first(['weapon', 'boomerang', 'stasis']), st = first(['weapon', 'stasis', 'boomerang']), inf = first(['weapon', 'infect', 'boomerang']);
      return { ok: bm.hit === Math.ceil(1 / CHIPS.boomerang.coef) && st.hit === 1 && inf.hit === 0 && inf.kill === 1 && !bm.last && !inf.last,
        got: `迴旋：第 ${bm.hit} 下命中才傳；佈雷：第 ${st.hit} 下就傳；感染：命中${inf.hit ? '也傳（錯誤）' : '不傳'}、擊殺傳 ${inf.kill} 次；最後一格${bm.last || inf.last ? '還在傳（錯誤）' : '不再往下傳'}` };
    }],
    ['線', '招牌動作觸發武器線', '一般命中照觸發係數累積；招牌動作（排熱、塌縮每個井、重斬第一下、收攏有擋到、召回每個飛輪回程第一下（時間到自己飛回的不算）、甩擊第一次撞到）直接觸發武器線 1 次；武器線沒接晶片就不觸發', M => {
      const Q = () => Game.triggerQueue.length;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null]); M.targets([]);
      Game.player.hHeat = 0.6; Game.triggerQueue = []; WEAPON_PLAY.laser.alt(Game.player); const vent = Q();
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null]); M.targets([]);
      Game.player.hHeat = 0.6; Game.triggerQueue = []; WEAPON_PLAY.laser.alt(Game.player); const none = Q();
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', 'boomerang', null]); M.targets([]);
      Game.player.fire(); W_.step(60); Game.triggerQueue = []; WEAPON_PLAY.plasma.alt(Game.player); const well = Q();
      M.setup('sandbox', 'vanguard', 'blade', null, null, ['weapon', 'boomerang', null]); const [e] = M.targets([[60, 0]]);
      const b = { sig: { done: false }, angle: 0 }; Game.triggerQueue = []; WEAPON_PLAY.blade.onHit(Game.player, b, e); WEAPON_PLAY.blade.onHit(Game.player, b, e); const heavy = Q();
      M.setup('sandbox', 'vanguard', 'drone', null, null, ['weapon', 'boomerang', null]); M.targets([]);
      const P = Game.player; P.guardT = 0.01; P.blocked = 2; Game.triggerQueue = []; WEAPON_PLAY.drone.tick(P, 0.02); const guard = Q();
      M.setup('sandbox', 'vanguard', 'scatter', null, null, ['weapon', 'boomerang', null]); const [e2] = M.targets([[60, 0]]);
      const disc = { mode: 'return', recall: true, angle: 0 }; Game.triggerQueue = []; WEAPON_PLAY.scatter.onHit(Game.player, disc, e2); WEAPON_PLAY.scatter.onHit(Game.player, disc, e2);
      WEAPON_PLAY.scatter.onHit(Game.player, { mode: 'park', angle: 0 }, e2); WEAPON_PLAY.scatter.onHit(Game.player, { mode: 'return', angle: 0 }, e2); const recall = Q();  // 最後一顆：停住時間到自己飛回的，不算
      M.setup('sandbox', 'vanguard', 'railgun', null, null, ['weapon', 'boomerang', null]); const [a, c] = M.targets([[100, 0], [100, 0]]);
      a.vx = 300; Game.player.flung = [{ e: a, t: 1, hit: new Set(), bounce: 0 }]; Game.triggerQueue = []; WEAPON_PLAY.railgun.tick(Game.player, 1 / 60); const fling = Q();
      return { ok: vent === 1 && none === 0 && well === 1 && heavy === 1 && guard === 1 && recall === 1 && fling === 1,
        got: `排熱 ${vent} 次（沒接晶片 ${none}）；塌縮 1 個井 ${well} 次；重斬打 2 下 ${heavy} 次；收攏 ${guard} 次；召回回程打 2 下 ${recall} 次；甩擊撞到 ${fling} 次` };
    }],
    ['線', '武器插件作用在右鍵', '插在飛船晶片上的插件也作用在右鍵、升級傷害、衝刺撞擊：傷害照乘、元素照套（排熱的衝擊波帶電；塌縮傷害 ×傷害插件；突擊的衝刺撞擊帶燃燒）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', 'shock', null]); M.targets([]);
      Game.player.hHeat = 0.6; Game.bullets = []; WEAPON_PLAY.laser.alt(Game.player);
      const b = Game.bullets[0], vent = near1(b.damage, HEAT.dmg * 0.6 * (1 + PLUG.dmg)) && !!b.arcs;
      M.setup('sandbox', 'vanguard', 'plasma', null, null, ['weapon', 'amp', null]); M.targets([]);
      Game.player.fire(); W_.step(60);
      let ex = null; const o = Game.explode; Game.explode = function (...a) { ex = a; return o.apply(this, a); };
      WEAPON_PLAY.plasma.alt(Game.player); Game.explode = o;
      const well = !!ex && near1(ex[3], WELL.dmg * (1 + PLUG.dmg));
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'ignite', null]); const [t] = M.targets([[30, 0]]);  // 突擊的衝刺撞擊：帶元素（燃燒）
      const P = Game.player; Game.mech.traits.assault = true; P.dashT = 0.1; P.wasDash = false; P.tickDash(); Game.mech.traits.assault = false;
      const dash = t.burnT > 0;
      return { ok: vent && well && dash, got: `排熱一道 ${b ? Math.round(b.damage) : '沒有'}${b && b.arcs ? '、帶電' : '、沒帶電'}；塌縮 ${ex ? Math.round(ex[3]) : '沒炸'}（應為 ${Math.round(WELL.dmg * (1 + PLUG.dmg))}）；衝刺撞擊${dash ? '帶燃燒' : '沒帶燃燒（錯誤）'}` };
    }],
    ['線', '插件往下傳', '插件傳給同一條線上它後面的所有晶片、同種加總：武器插 1 個傷害、迴旋再插 1 個 → 迴旋 2 個、佈雷也 2 個；大小同理；元素層數也加總；插件不影響等級', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'amp', 'shock', 'boomerang', 'amp', 'bigshot', 'stasis', null]);
      const [bm, st] = Game.stats.line.cells, w = Game.stats.line.plug;
      const ok1 = w.dmg === 1 && w.el.shock === 1 && bm.plug.dmg === 2 && bm.plug.size === 1 && bm.plug.el.shock === 1 && st.plug.dmg === 2 && st.plug.size === 1 && st.plug.el.shock === 1;
      const lvOk = bm.lv === 1 && st.lv === 1;
      return { ok: ok1 && lvOk, got: `武器 傷害${w.dmg}電擊${w.el.shock}；迴旋 傷害${bm.plug.dmg}大小${bm.plug.size}電擊${bm.plug.el.shock} Lv${bm.lv}；佈雷 傷害${st.plug.dmg}大小${st.plug.size}電擊${st.plug.el.shock} Lv${st.lv}` };
    }],
    ['線', '稀有晶片', '每種晶片自己的稀有版（RARE_INFO）：id 帶 !、合成保留稀有；迴旋只有回程傳（每次 1）、碎片 6 片打同一隻多傳 1 次、感染第二代也傳、佈雷消失時自爆並傳、追蹤彈彈去下一隻、漩渦吸 5 隻傳 2 次、回響從飛船打；精英／寶藏的三選一保證一張', M => {
      const R = id => chipId(id, 3, 1, true), cnt = () => { let n = 0; const o = Game.lineQueue.bind(Game); Game.lineQueue = (...a) => { n++; return o(...a); }; return () => { Game.lineQueue = o; return n; }; };
      const idOk = parseChipId(R('infect')) === R('infect') && parseChipId('amp!') === null && rareOf(mergedChip(R('shard'), chipId('shard', 1))) && lvName(R('shard')).startsWith('★');
      const setup = (k, n = 1) => { M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', R(k), 'stasis', null]); return { L0: Game.stats.line, es: M.targets(Array.from({ length: n }, (_, i) => [200 + i * 8, (i % 3 - 1) * 8]), 'brute', true, 400) }; };
      // 迴旋：去程不傳、回程每下傳 1
      let { L0, es } = setup('boomerang'); let done = cnt();
      Game.linePass({ ln: { line: L0, k: 0 }, owner: null, angle: 0, mode: 'fly' }, 'hit', es[0]); const flyN = done();
      done = cnt(); Game.linePass({ ln: { line: L0, k: 0 }, owner: null, angle: 0, mode: 'return' }, 'hit', es[0]); const retN = done();
      // 碎片：6 片打同一隻 → 0.2×6 照常 1 次＋額外 1 次
      ({ L0, es } = setup('shard')); done = cnt(); const g = new Map();
      for (let i = 0; i < 6; i++) Game.linePass({ ln: { line: L0, k: 0 }, owner: null, angle: 0, grp: g }, 'hit', es[0]); const shardN = done();
      // 感染：第二代孢子帶線（一般的不帶）
      ({ L0, es } = setup('infect')); const inf = rare => { Game.bullets = []; const e = es[0]; e.killAtt = { owner: null, inf: { tpl: shot({ rare, ln: { line: L0, k: 0 }, damage: 5, infect: 1 }), gen: 0 } }; Game.infectBurst(e); return Game.bullets.every(b => !!b.ln); };
      const infOk = inf(true) && !inf(false);
      // 佈雷：沒被觸發、時間到 → 自爆並往下傳
      ({ L0, es } = setup('stasis')); Game.enemies = []; Game.bullets = [];
      Game.lineFire({ owner: null, line: L0, k: 0, x: Game.player.x, y: Game.player.y, ang: 0, ignore: null });
      const mine = Game.bullets[0]; mine.mode = 'wait'; mine.waitT = 0; done = cnt(); mine.update(1 / 60); const mineN = done();
      // 追蹤彈：打中第一隻後彈去第二隻
      ({ L0, es } = setup('homing', 2)); es[1].x += 120; const hp = es.map(e => e.hp); Game.bullets = [];
      Game.lineFire({ owner: null, line: L0, k: 0, x: Game.player.x, y: Game.player.y, ang: 0, ignore: null }); W_.step(120);
      const hopOk = es.every((e, i) => e.hp < hp[i]);
      // 漩渦：吸到 5 隻以上 → 結束時傳 2 次
      ({ L0, es } = setup('vortex', 6)); Game.bullets = [];
      Game.lineFire({ owner: null, line: L0, k: 0, x: es[0].x, y: es[0].y, ang: 0, ignore: null }); done = cnt(); W_.step(100); const vorN = done();
      // 回響：從飛船打出去
      ({ L0, es } = setup('echo')); Game.bullets = []; const p = Game.player;
      Game.lineFire({ owner: null, line: L0, k: 0, x: p.x + 500, y: p.y + 500, ang: 0, ignore: null });
      const echoOk = Game.bullets.length > 0 && Game.bullets.every(b => Math.hypot(b.x - p.x, b.y - p.y) < 60);
      // 取得：保證稀有的三選一一定有一張
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null]);
      let gotRare = 0; for (let i = 0; i < 50; i++) if (Game.rewardOptions('combat', true).some(rareOf)) gotRare++;
      const ok = idOk && flyN === 0 && retN === 1 && shardN === 2 && infOk && mineN === 1 && hopOk && vorN === 2 && echoOk && gotRare === 50;
      return { ok, got: `id／合成${idOk ? '對' : '錯'}；迴旋 去程 ${flyN}、回程 ${retN}；碎片 6 片同一隻 ${shardN} 次；感染第二代${infOk ? '會傳' : '錯'}；佈雷消失自爆 ${mineN} 次；追蹤彈${hopOk ? '打到兩隻' : '沒彈過去'}；漩渦 6 隻 ${vorN} 次；回響${echoOk ? '從飛船' : '不是從飛船'}；保證稀有 ${gotRare}/50` };
    }],
    ['線', '元素傷害記在插件名下', '元素插件造成的燃燒、爆炸、電弧記在那個插件名下（編輯器插件下面的「每秒傷害」才有數字）；直擊照樣記在武器', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'blast', null]); Game.wSock = 1; Game.recalc();
      M.targets([[150, 0], [170, 20], [170, -20]], 'brute', true, 400); Game.runStats.chips = {};
      for (let f = 0; f < 120; f++) { Game.player.fire(); W_.step(1); }
      const C = Game.runStats.chips, ok = (C.blast || 0) > 0 && (C.weapon || 0) > 0;
      return { ok, got: `爆裂彈頭 ${Math.round(C.blast || 0)}、武器 ${Math.round(C.weapon || 0)}` };
    }],
    ['線', '屬性傷害', '元素的傷害只看疊了幾個同種元素：3 個電擊 = 電 3 隻、每道 ×(1 + 0.3 × 2)；不吃傷害插件和晶片等級（物理才吃）', M => {
      const fire = flat => { M.setup('sandbox', 'vanguard', 'laser', null, null, flat); const L0 = Game.stats.line;
        Game.lineFire({ owner: null, line: L0, k: 0, x: Game.player.x + 100, y: Game.player.y, ang: 0, ignore: null }); return Game.bullets.find(b => b.att.src === 'boomerang'); };
      const a = fire(['weapon', 'boomerang', 'shock']), b = fire(['weapon', 'shock', 'shock', 'shock', 'boomerang']), c = fire(['weapon', 'shock', 'shock', 'shock', 'boomerang', 'amp', 'amp']);
      const ref = lineRef(), one = ELEM.shock.k * ref, three = one * (1 + ELEM.shock.up * 2);
      return { ok: a.arcs.n === 1 && near1(a.arcs.dmg, one) && b.arcs.n === 3 && near1(b.arcs.dmg, three) && near1(c.arcs.dmg, three) && c.damage > b.damage * 2,
        got: `1 個電擊：${a.arcs.n} 道 ${a.arcs.dmg.toFixed(1)}；3 個：${b.arcs.n} 道 ${b.arcs.dmg.toFixed(1)}（要 ${three.toFixed(1)}）；再插 2 個傷害：電弧 ${c.arcs.dmg.toFixed(1)}（不變）、迴旋刃 ${b.damage.toFixed(1)} → ${c.damage.toFixed(1)}` };
    }],
    ['線', '稀有碎片打單隻', '只有一隻敵人時觸發碎片（觸發的就是牠）：一般碎片不打牠（0 次往下傳）；稀有碎片 6 片都打回牠，照常傳 1 次＋6 片同一隻多傳 1 次', M => {
      const run = rare => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', chipId('shard', 3, 1, rare), 'boomerang', null]);
        const L0 = Game.stats.line, e = M.targets([[200, 0]], 'brute', true, 400)[0];
        Game.bullets = []; Game.triggerQueue = [];
        let n = 0; const o = Game.lineQueue.bind(Game); Game.lineQueue = (...a) => { n++; return o(...a); };
        try {
          Game.lineFire({ owner: null, line: L0, k: 0, x: e.x, y: e.y, ang: 0, ignore: e.id });  // 跟真的命中一樣：觸發位置在牠身上、ignore = 牠
          for (let f = 0; f < 30; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); }
        } finally { Game.lineQueue = o; }
        return n;
      };
      const plain = run(false), rare = run(true);
      return { ok: plain === 0 && rare === 2, got: `一般碎片往下傳 ${plain} 次（要 0）；稀有碎片 ${rare} 次（要 2）` };
    }],
    ['線', '追蹤彈打單隻', '觸發追蹤彈的那隻附近（450 內）沒有別隻：追蹤彈打牠；有別隻：打別隻、不打牠', M => {
      const run = more => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'homing', null]);
        const es = M.targets(more ? [[200, 0], [380, 20]] : [[200, 0]], 'brute', true, 400), e = es[0], hp = es.map(x => x.hp);
        Game.bullets = []; Game.triggerQueue = [];
        Game.lineFire({ owner: null, line: Game.stats.line, k: 0, x: e.x, y: e.y, ang: 0, ignore: e.id });  // 跟真的命中一樣：觸發位置在牠身上、ignore = 牠
        for (let f = 0; f < 90; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); }
        return es.map((x, i) => Math.round(hp[i] - x.hp));
      };
      const one = run(false), two = run(true);
      return { ok: one[0] > 0 && two[0] === 0 && two[1] > 0, got: `只有一隻：打牠 ${one[0]}（要 > 0）；旁邊有別隻：打牠 ${two[0]}（要 0）、打別隻 ${two[1]}（要 > 0）` };
    }],
    ['線', '新晶片：碎片、追蹤彈、漩渦', '碎片往四周 6 片短程；追蹤彈轉向敵人打中；漩渦把附近敵人吸到中心、結束時往下傳一次', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'shard', 'homing', 'vortex', 'boomerang', null]);
      const L0 = Game.stats.line, p = Game.player, at = (k, x, y) => Game.lineFire({ owner: null, line: L0, k, x, y, ang: 0, ignore: null });
      at(0, p.x, p.y); const sh = Game.bullets.filter(b => b.att.src === 'shard'), far = Math.max(...sh.map(b => b.speed * b.life));
      const e = M.targets([[200, 120]])[0]; Game.bullets = []; at(1, p.x, p.y);
      let hit = false; for (let f = 0; f < 90 && !hit; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); hit = e.hp < e.maxHp; }
      const es = M.targets([[300, 80], [300, -80], [380, 0]], 'brute', false, 60); for (const q of es) { q.t = { ...q.t, speed: 0 }; q.frozen = false; }
      Game.bullets = []; Game.triggerQueue = []; at(2, p.x + 300, p.y);
      const d0 = es.map(q => Math.hypot(q.x - p.x - 300, q.y - p.y));
      let next = 0;
      for (let f = 0; f < 100; f++) { Game.time += 1 / 60; Game.updateBullets(1 / 60); for (const q of es) { q.x += q.vx / 60; q.y += q.vy / 60; } next = Math.max(next, Game.bullets.filter(b => b.att.src === 'boomerang').length); }
      const d1 = es.map(q => Math.hypot(q.x - p.x - 300, q.y - p.y)), pulled = d1.every((d, i) => d < d0[i] - 20);
      return { ok: sh.length === 6 && far < 120 && hit && pulled && next === 1,
        got: `碎片 ${sh.length} 片、射程 ${Math.round(far)}；追蹤彈${hit ? '打中了' : '沒打中（錯誤）'}；漩渦把敵人吸近 ${d0.map((d, i) => Math.round(d - d1[i])).join('／')}；結束時往下傳、放出迴旋刃 ${next}` };
    }],
    ['線', '產物預算', `每個人場上最多 ${CFG.PROD_CAP} 個產物：額度不夠時改成放比較少顆、每顆照比例變大變痛（總傷害不變）；隊友有自己的額度`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'shard', null]);
      const L0 = Game.stats.line, p = Game.player;
      Game.L.prodN = CFG.PROD_CAP - 2;
      Game.lineFire({ owner: null, line: L0, k: 0, x: p.x, y: p.y, ang: 0, ignore: null });
      const got = Game.bullets.filter(b => b.att.src === 'shard'), one = L0.cells[0] && CHIPS.shard.mul * lineRef();
      const total = got.reduce((a, b) => a + b.damage, 0);
      Game.updateBullets(0); const counted = Game.L.prodN === got.length;
      return { ok: got.length === 2 && near1(total, one * 6) && got[0].r > 4 && counted, got: `剩 2 個額度：放 ${got.length} 片、總傷害 ${total.toFixed(1)}（要 ${(one * 6).toFixed(1)}）、半徑 ${got[0] && got[0].r.toFixed(1)}；重新數產物 ${Game.L.prodN}` };
    }],
    ['線', '產物傷害', `產物傷害 = 晶片的倍率 × 參考傷害（武器每 ${REF_T} 秒的輸出）× 等級 × 傷害插件，每往下一層 ×${LINE_DECAY}；回響 = 武器傷害 × ${CHIPS.echo.mul}`, M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', 'boomerang', 'echo']);
      const L0 = Game.stats.line, ref = lineRef(), p = Game.player, at = k => Game.lineFire({ owner: null, line: L0, k, x: p.x + 100, y: p.y, ang: 0, ignore: null });
      at(0); const d0 = Game.bullets[Game.bullets.length - 1].damage;
      at(1); const d1 = Game.bullets[Game.bullets.length - 1].damage;
      at(2); const de = Game.bullets[Game.bullets.length - 1].damage;
      const w0 = CHIPS.boomerang.mul * ref, wE = WEAPONS.laser.base.damage * CHIPS.echo.mul * LINE_DECAY ** 2;
      return { ok: near1(d0, w0) && near1(d1, w0 * LINE_DECAY) && near1(de, wE),
        got: `參考傷害 ${ref.toFixed(1)}；第 1 格迴旋 ${d0.toFixed(2)}（要 ${w0.toFixed(2)}）、第 2 格 ${d1.toFixed(2)}（要 ${(w0 * LINE_DECAY).toFixed(2)}）、第 3 格回響 ${de.toFixed(2)}（要 ${wE.toFixed(2)}）` };
    }],
    ['線', '實戰：一整條線', '熱能光束 → 迴旋 → 佈雷打一群：每一格都真的有打出傷害（傷害統計記在各自的晶片上）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', 'stasis', null]);
      M.targets(Array.from({ length: 12 }, (_, i) => [180 + (i % 4) * 30, ((i / 4 | 0) - 1) * 35]), 'brute', true, 60);
      M.run(60 * 5);
      const C = Game.runStats.chips, r = k => Math.round(C[k] || 0);
      return { ok: r('weapon') > 0 && r('boomerang') > 0 && r('stasis') > 0, got: `5 秒：武器 ${r('weapon')}、迴旋 ${r('boomerang')}、佈雷 ${r('stasis')}` };
    }],
    ['線', '隊友的線', '隊友的武器命中觸發隊友自己的線：產物是隊友的（傷害記在隊友身上），累積記在隊友的配裝上', M => {
      const m = M.coop('laser', ['weapon', 'boomerang', null]), L = m.L.stats.line;
      const e = M.targets([[300, 300]])[0];
      for (let i = 0; i < 3; i++) Game.linePass({ ln: { line: L, k: -1 }, owner: m.L, angle: 0 }, 'hit', e);
      Game.updateBullets(1 / 60);
      const b = Game.bullets.find(q => q.att.src === 'boomerang');
      return { ok: !!b && b.owner === m.L && b.ownerP === m && m.L.lnAcc instanceof Map && !(Game.L.lnAcc && Game.L.lnAcc.size), got: b ? `迴旋刃的主人：${b.owner === m.L ? '隊友' : '不是隊友（錯誤）'}、飛回 ${b.ownerP === m ? '隊友' : '別人（錯誤）'}` : '沒有放出迴旋刃' };
    }],
    ['線', '電路格：空位', '只有一條線：空格集中在最後；插進來 = 接在線的最後、用掉一個空位；沒有空位放不進去', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, 'boomerang', null, 'stasis', null]);
      Game.packChain(); const packed = Game.chain.join() === ['weapon', fullChip('boomerang'), fullChip('stasis'), null, null, null].join();
      Game.insertChip(fullChip('echo')); Game.insertChip(fullChip('shard')); Game.recalc();
      const order = Game.stats.line.cells.map(c => c.key).join();
      const full = Game.insertChip(fullChip('homing')) && !Game.insertChip(fullChip('infect'));
      return { ok: packed && order === 'boomerang,stasis,echo,shard' && full,
        got: `整理後 ${packed ? '對' : Game.chain.join()}；線上 ${order}；沒有空位時${full ? '放不進去' : '還放得進去（錯誤）'}` };
    }],
    ['電路晶片', '插件插在武器上', '武器插傷害 = 每一下 +60%；插大小 = 子彈變大；元素 = 每一下帶元素（燃燒固定值，不吃傷害插件）', M => {
      const run = (w, flat) => { M.setup('sandbox', 'vanguard', w, null, null, flat); return Game.stats; };
      const b = WEAPONS.laser.base, d = run('laser', ['weapon', 'amp', null]);
      const r0 = run('blade', ['weapon', null]) && Game.wp.radius, r1 = run('blade', ['weapon', 'bigshot', null]) && Game.wp.radius;
      run('laser', ['weapon', 'ignite', null]); const e1 = weaponShots()[0].burnEl; run('laser', ['weapon', 'ignite', 'amp', null]); const e2 = weaponShots()[0].burnEl;
      return { ok: near1(d.dmg, b.damage * (1 + PLUG.dmg)) && near1(r1, r0 * (1 + PLUG.size)) && e1 > 0 && near1(e1, e2),
        got: `傷害 ${b.damage} → ${d.dmg.toFixed(1)}；刃半徑 ${r0} → ${r1.toFixed(1)}；燃燒每秒 ${e1 && e1.toFixed(2)}、加傷害插件後 ${e2 && e2.toFixed(2)}（要一樣）` };
    }],
    ['構築系統', '武器插座數', `遠征開局 ${CFG.START_WSOCK} 個，每打完一隻王 +1，最多 ${CFG.WEAPON_SOCKETS} 個`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const seq = [Game.wSock];
      for (let k = 0; k < 4; k++) {
        Game.node = { type: 'boss', L: 6, id: 'mc' + k }; Game.inArena = true; Game.state = 'play';
        Game.combatWon();
        seq.push(Game.wSock);
      }
      const want = [0, 1, 2, 3, 4].map(k => Math.min(CFG.WEAPON_SOCKETS, CFG.START_WSOCK + k)).join();
      return { ok: seq.join() === want, got: `打王前後：${seq.join(' → ')}` };
    }],
    ['構築系統', '三選一保底', '電路有空格時，零件只會出現在最後一格（滿了哪一格都可能）；上一次三選一沒有晶片，這一次一定有', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      const N = 400, part = id => String(id).startsWith('part:'), play = id => !part(id) && hasLv(id);
      let early = 0, last = 0, dry = 0;
      for (let i = 0; i < N; i++) { Game.playDry = false; const o = Game.rewardOptions(); if (part(o[0]) || part(o[1])) early++; if (part(o[2])) last++; }
      for (let i = 0; i < N; i++) { Game.playDry = true; if (!Game.rewardOptions().some(play)) dry++; }
      Game.chain = ['weapon', 'boomerang', 'stasis', 'echo'];
      let full = 0;
      for (let i = 0; i < N; i++) { const o = Game.rewardOptions(); if (part(o[0]) || part(o[1])) full++; }
      return { ok: early === 0 && last > 0 && dry === 0 && full > 0,
        got: `有空格：前兩格出現零件 ${early} 次、最後一格 ${last} 次；保底時沒有晶片 ${dry} 次；電路滿了前兩格出現零件 ${full} 次（各 ${N} 次）` };
    }],
    ['構築系統', '子彈上限防呆', '我方子彈超過 CFG.BULLET_CAP.mine、敵方超過 enemy：刪最舊的（陣列前面的，標成消失），留最新的；觸發記進遊玩紀錄（幾幀、刪幾顆、最多幾顆、在哪、第一次在哪、最多那次的子彈來源前 3 名和當時電路）', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'echo'], []);
      // 我方：每 3 顆有 2 顆是迴旋的回響子彈、1 顆是武器的；敵方都是盾衛反彈的
      const C = CFG.BULLET_CAP, mk = n => Array.from({ length: n }, (_, i) => ({ id: i, dead: false, att: { src: i % 3 ? 'boomerang' : 'weapon' }, depth: i % 3 ? 1 : 0, from: '盾衛' }));
      const B = mk(C.mine + 100), E = mk(C.enemy + 50), old = B[0];
      Game.bullets = B; Game.eBullets = E; Game.runStats.cap = { n: 0, cut: 0, max: 0, at: '', first: '', src: [], chain: [] };
      Game.capBullets();
      const R = Game.runStats.cap, okB = Game.bullets.length === C.mine && Game.bullets[0].id === 100 && old.dead, okE = Game.eBullets.length === C.enemy && Game.eBullets[0].id === 50;
      const n1 = R.n; Game.capBullets(); const still = n1 === 1 && R.n === 1;  // 同一幀兩邊都超過算 1 幀；沒超過就不再觸發
      Game.bullets = []; Game.eBullets = [];
      const src = R.src.map(([k, v]) => k + v).join(' '), wantSrc = `${CHIPS.boomerang.name}・回響${Math.floor((C.mine + 100) * 2 / 3)} ${CHIPS.weapon.name}${Math.ceil((C.mine + 100) / 3)}`;
      const okSrc = src === wantSrc && R.chain.join('｜') === `${CHIPS.weapon.name}｜${CHIPS.echo.name}` && !!R.first;
      return { ok: okB && okE && still && okSrc && R.cut === 150 && R.max === C.mine + 100,
        got: `我方 ${C.mine + 100} → ${okB ? C.mine + '（刪掉最舊的 100 顆）' : '不對（錯誤）'}；敵方 ${C.enemy + 50} → ${okE ? C.enemy : '不對（錯誤）'}；紀錄：觸發 ${R.n} 幀、刪 ${R.cut} 顆、最多 ${R.max} 顆（${R.at}）、第一次（${R.first}）${still ? '' : '（沒超過也記了，錯誤）'}；來源 ${src}${src === wantSrc ? '' : `（應為 ${wantSrc}，錯誤）`}；電路 ${R.chain.join('｜')}` };
    }],
    ['構築系統', '軍械台升級', '武器進入第一段、第二段', M => {
      M.setup('run', 'vanguard', 'plasma', null, null, ['weapon', null, null, null]);
      Game.upgradeWeapon('C', 'armory');
      const s1 = Game.wp.wellMax === WELL_UP.max;
      Game.upgradeWeapon('0', 'armory');
      return { ok: s1 && !!Game.wp.flyPull && Game.weapon.final === 0, got: weaponTitle(Game.weapon) };  // 重力井・布井・黑洞彈
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
      // 砲台還在時隊友換了電路（房主收到新電路，跟 net.js 一樣重算）：下一發照新的（武器插上傷害插件）
      const d0 = mb[0] && mb[0].damage, r = splitChain(['weapon', 'amp'].map(fullChip));
      m.L.wSock = CFG.WEAPON_SOCKETS; m.L.chain = r.chain; m.L.socks = r.socks; Game.withLoadout(m.L, () => { Game.stats = analyzeChain(Game.chain); });
      Game.bullets = []; Game.turrets[0].cd = 0; Game.updateTurrets(1 / 60);
      const tb = Game.bullets.find(b => b.turret), swapN = tb ? +(tb.damage / d0).toFixed(2) : 0, swapOk = near1(swapN, 1 + PLUG.dmg) && Game.turrets.length === 1;
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); M.targets([]);
      const q = Game.player; Game.turrets = []; q.dashSX = q.x; q.dashSY = q.y; q.onDash();
      const none = !Game.turrets.length;
      return { ok: one && shots >= 3 && half && aimed && rec > 0 && gone && mateOk && swapOk && none,
        got: `衝刺兩次：砲台 ${nT} 座${one ? '' : '（要 1 座）'}；1 秒開火 ${shots} 發、每發 ${dmg1 == null ? '—' : +dmg1.toFixed(2)}（雷射 ${WEAPONS.laser.base.damage} × ${CFG.TURRET.dmg}）、${aimed ? '朝著敵人' : '方向不對'}；傷害統計「砲台」${rec}；${CFG.TURRET.t} 秒後${gone ? '消失' : '還在（錯誤）'}；`
          + `隊友（散彈）的砲台一次 ${mb.length} 發${mateOk ? '、算隊友的' : '（錯誤）'}；砲台還在時插上傷害插件：傷害 ×${swapN}${swapOk ? '' : `（要 ×${1 + PLUG.dmg}）`}；先鋒號${none ? '沒有砲台' : '也有砲台（錯誤）'}` };
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
      let q = Game.player; const g = Arena.gates[0], side = () => (q.x - g.x) * g.nx + (q.y - g.y) * g.ny;
      const jump = (x, y, a, zone) => { q.x = x; q.y = y; q.zone = zone; q.dashA = a; Dash.phase(q, (x, y) => q.phaseFree(x, y)); q.dashT = 0; Arena.collide(q, q.r, Arena.shipPass(q)); Arena.updateZone(q); };
      const fwd = Math.atan2(g.ny, g.nx);
      g.open = false; jump(g.x - g.nx * 60, g.y - g.ny * 60, fwd, 0);
      const closed = q.zone === 0 && side() <= 0;
      g.open = true; jump(g.x - g.nx * 60, g.y - g.ny * 60, fwd, 0);
      const opened = q.zone === 1 && side() > 0;
      jump(g.x + g.nx * 40, g.y + g.ny * 40, fwd + Math.PI, 1);
      const noBack = q.zone === 1 && side() > 0;
      // 同一區的牆：找一個起點和方向，中間是牆、落點是同一區的空地；隨機地圖偶爾一張都沒有（release 10-24 碰到一次、mcloop 100 次 0 次）→ 換一張地圖再找，最多 10 張
      let wall = null;
      for (let m = 0; m < 10 && !wall; m++) {
      if (m) { Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 }); q = Game.player; }
      for (let y = 20; y < Arena.H && !wall; y += 20) for (let x = 20; x < Arena.W && !wall; x += 20) for (let k = 0; k < 16 && !wall; k++) {
        const a = k / 16 * TAU, c = Math.cos(a), s = Math.sin(a), ex = x + c * D, ey = y + s * D, z = Arena.zoneOf(x, y);
        if (Arena.zoneOf(ex, ey) !== z || !Objects.shipFree(q, x, y) || !Objects.shipFree(q, ex, ey) || Arena.f(ex, ey) < q.r + 6) continue;
        let solid = false; for (let d = 16; d < D - 16; d += 4) if (Arena.f(x + c * d, y + s * d) < 0) solid = true;
        if (solid) wall = [x, y, a, ex, ey, z];
      }
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
      return { ok: far.rep === 0 && near.rep === 0 && Object.keys(far.n).length === new Set(b.t.skills).size && far.n.fan > near.n.fan && near.n.spiral + near.n.ring > far.n.spiral + far.n.ring,
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
    ['敵人', '母巢', '每 4 秒生 2 隻蟲群，最多 8 隻；生出來的被晶片打死不算晶片的擊殺；不吃擊退（位置不變）', M => {
      M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, h = M.targets([[300, 0]], 'hive', true, 1)[0]; h.cd = 0.05;
      for (let f = 0; f < 60 * 30; f++) { Game.time += 1 / 60; h.update(1 / 60, p); }
      const kids = Game.enemies.filter(q => q.type === 'swarmer' && !q.dead), k = kids[0];
      const x0 = h.x, y0 = h.y;  // 重擊退的一下＋吸引那種直接加速度，之後走 30 幀
      h.hurt(1, 600, 300, 'direct', null, 3); h.vx += 500;
      for (let f = 0; f < 30; f++) h.update(1 / 60, p);
      const moved = Math.hypot(h.x - x0, h.y - y0);
      Game.playKills = {}; k.hurt(9999, 0, 0, 'direct', { src: 'boomerang', owner: null });
      return { ok: kids.length === 8 && !(Game.playKills.boomerang > 0) && moved < 0.01, got: '生了 ' + kids.length + ' 隻；迴旋打死一隻記 ' + (Game.playKills.boomerang || 0) + ' 次（要 0）；被擊退之後移動 ' + moved.toFixed(2) + '（要 0）' };
    }],
    ['敵人', '寶藏無人機：出現、逃跑、打掉多一次三選一', `只在指定的那一區出場；往離玩家的反方向逃；打掉：打贏後多一次三選一、不掉晶體`, M => {
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
      Game.inArena = true; Game.state = 'play'; Game.combatWon();
      const again = Game.state === 'reward' ? Game.reward.again : -1;
      return { ok: !w1 && w2 === 1 && d1 > d0 + 250 && got && drops === 0 && again === CFG.BONUS.treasure.again,
        got: `第 1 區${w1 ? '有（錯誤）' : '沒有'}、第 2 區 ${w2} 隻；2 秒內距離 ${Math.round(d0)} → ${Math.round(d1)}；打掉${got ? '' : '沒'}記下、掉晶體 ${drops}；三選一之後再選 ${again} 次（要 ${CFG.BONUS.treasure.again}）` };
    }],
    ['敵人', '寶藏無人機：逃走', `出場 ${CFG.TREASURE.life} 秒沒打掉就躍遷離開：不算擊殺、不掉晶體，三選一不會多一次`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', 'boomerang', null, null]);
      Game.node = { type: 'combat', L: 1, id: 'mc' }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0, treasure: 1 });
      const p = Game.player, e = M.targets([[200, 0]], 'treasure', false, 1)[0], k0 = Game.kills;
      let tGone = null;
      for (let f = 0; f < 60 * (CFG.TREASURE.life + 1) && tGone == null; f++) { Game.time += 1 / 60; e.update(1 / 60, p); if (e.dead) tGone = f / 60; }
      const alive = tGone == null ? '沒有離開' : `${tGone.toFixed(1)} 秒離開`;
      Game.inArena = true; Game.state = 'play'; Game.combatWon();
      const add = Game.reward.again || 0;
      return { ok: tGone != null && Math.abs(tGone - CFG.TREASURE.life) < 0.1 && Game.kills === k0 && Game.pickups.length === 0 && !(Game.combat.bonus || []).length && add === 0,
        got: `${alive}；擊殺 +${Game.kills - k0}、晶體 ${Game.pickups.length}；三選一多 ${add} 次` };
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
    ['敵人', '精英亂入', `3 區的一般戰鬥、第 2 區以後：這一區都出場、剩 ${CFG.INTRUDE.at * 100}% 以下時闖進一隻帶詞綴的精英（只闖一次）；分裂的兩隻都打掉：打贏後多一次三選一`, M => {
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
      const rare = Game.state === 'reward' && Game.reward.again === CFG.BONUS.intrude.again;
      return { ok: w1 === 0 && !inList && early === 0 && L.length === 1 && nAff === affixCount(Game.sector) && k.intruder === e.intruder && after1 === 0 && after2 === 'intrude' && rare,
        got: `第 1 區闖進 ${w1} 隻；第 2 區出場名單${inList ? '有精英（錯誤）' : '沒有精英'}、出場 ${spawned} 隻、還很多時 ${early} 隻、剩一半時 ${L.length} 隻（${nAff} 個詞綴）；分裂後打掉一隻${after1 ? '就給了（錯誤）' : '還沒給'}、兩隻都打掉：${after2 || '沒給'}；三選一${rare ? '多一次' : '沒有多一次（錯誤）'}` };
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
    ['敵人', '逃跑：大地圖不卡牆', '警報艇、寶藏無人機在大地圖被追著跑：沿著牆、往空的地方逃，不會頂著牆不動（場地大小照 Arena；以前照方形場地的大小，大部分方向被當成出界，直直往牆衝）', M => {
      // 量法同 tests/alarmstuck.js：玩家從 250 外一直追（距離 180 以外就靠近），每局 8 秒，數「幾乎不動（每秒 < 20）」的時間
      const dt = 1 / 60, out = [];
      let bad = 0;
      for (const type of ['alarm', 'treasure']) {
        let stuck = 0, total = 0;
        for (let r = 0; r < 6; r++) {
          M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
          Game.sector = 2; Game.node = { type: 'combat', L: 3, id: 'mc' + r }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
          Game.combat.pending = []; Game.enemies = [];
          const P = Game.player, k = r % Arena.areas.length, [ax, ay] = Arena.randomIn(k, 60);
          Game.spawnEnemy(type); const e = Game.enemies[Game.enemies.length - 1];
          e.spawnT = 0; e.x = ax; e.y = ay; e.home = [ax, ay]; e.zone = Arena.zoneOf(ax, ay); e.alert = true; e.hp = e.maxHp = 1e9; e.hurt(1, 0, 0, 'direct');
          let st = null;
          for (let i = 0; i < 32 && !st; i++) { const a = i / 32 * TAU, x = ax + Math.cos(a) * 250, y = ay + Math.sin(a) * 250; if (Arena.f(x, y) > 40 && Arena.zoneOf(x, y) === e.zone) st = [x, y]; }
          if (!st) continue;
          [P.x, P.y] = st; P.zone = e.zone; P.hp = P.maxHp = 1e9;
          for (let f = 0; f < 8 * 60 && !e.dead; f++) {
            Game.time += dt;
            const x0 = e.x, y0 = e.y, dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1;
            if (d > 180) { P.x += dx / d * 230 * dt; P.y += dy / d * 230 * dt; }
            Arena.collide(P, P.r, null);
            e.update(dt, P);
            if (Math.hypot(e.x - x0, e.y - y0) / dt < 20) stuck += dt;
            total += dt;
          }
        }
        const pct = total ? stuck / total * 100 : 100;
        if (pct > 2) bad++;
        out.push(`${ENEMY_TYPES[type].name} 幾乎不動 ${pct.toFixed(1)}%`);
      }
      return { ok: !bad, got: `${out.join('、')}（6 局 × 8 秒；要 ≤ 2%）` };
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
    ['事件', '漂流殘骸', `搜刮：HP −最大 HP 的 ${CFG.EVENT.wreck.hp * 100}%（最少留 1）、晶片三選一；拆反應爐 ${CFG.EVENT.wreck.core.chance * 100}%：先揭曉，再三選一 ${1 + CFG.EVENT.wreck.core.again} 次，失敗 HP −${CFG.EVENT.wreck.core.hp * 100}%；離開：什麼都不變`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, node = { id: 'mcev', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'wreck' };
      Game.openEvent(node); const st0 = Game.state, hp0 = p.hp;
      Game.evChoose(2); const leave = Game.state === 'map' && p.hp === hp0;
      Game.openEvent(node); Game.evChoose(0);
      const lost = hp0 - p.hp, rew = Game.state === 'reward' && Game.reward.kind === 'event';
      p.hp = 3; Game.openEvent(node); Game.evChoose(0); const low = p.hp;
      p.hp = p.maxHp; Game.openEvent(node); M.luck(0, () => Game.evChoose(1));
      const wait = Game.state === 'event' && !!Game.ev.res && p.hp === p.maxHp;
      Game.evNext(); const win = Game.state === 'reward' ? Game.reward.again : -1;
      Game.openEvent(node); M.luck(0.99, () => Game.evChoose(1)); const boom = p.maxHp - p.hp; Game.evNext(); const back = Game.state;
      return { ok: st0 === 'event' && leave && lost === Math.round(p.maxHp * CFG.EVENT.wreck.hp) && rew && low === 1 && wait && win === CFG.EVENT.wreck.core.again && boom === Math.round(p.maxHp * CFG.EVENT.wreck.core.hp) && back === 'map',
        got: `進去是${st0}；離開${leave ? '沒變' : '有變（錯誤）'}；搜刮扣 ${lost}（最大 HP ${p.maxHp}）、${rew ? '三選一' : '沒有三選一（錯誤）'}；HP 3 時搜刮剩 ${low}；拆反應爐成功：${wait ? '先揭曉' : '沒停在揭曉（錯誤）'}、之後再選 ${win} 次；失敗扣 ${boom}、之後回到 ${back}` };
    }],
    ['事件', '黑市商人', `改造晶片 ◆${CFG.EVENT.market.price}：三選一 ${1 + CFG.EVENT.market.again} 次、這一局最大 HP ×${1 - CFG.EVENT.market.hpCut}（可以疊）；走私零件 ◆${CFG.EVENT.market.part}：零件三選一；神祕包裹 ◆${CFG.EVENT.market.box.price}：晶片／空包（價格都隨星區上漲）；錢不夠不能選`, M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const p = Game.player, node = { id: 'mcev', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'market' }, hp0 = p.maxHp, K = CFG.EVENT.market, price = Game.shopPrice(K.price);
      Game.credits = price - 1; Game.openEvent(node); Game.evChoose(0); const poor = Game.state === 'event' && Game.boons.hp === 0;
      Game.credits = 1000; Game.evChoose(0);
      const paid = 1000 - Game.credits, hp1 = p.maxHp, nRare = Game.state === 'reward' ? Game.reward.again : -1;
      Game.reward.again = 0; Game.takeReward(null); Game.credits = 1000; Game.openEvent(node); Game.evChoose(0); const hp2 = p.maxHp; Game.reward.again = 0; Game.takeReward(null);
      const k = K.hpCut, want1 = Math.round(hp0 * (1 - k)), want2 = Math.round(hp0 * (1 - k) ** 2);
      Game.credits = 1000; Game.openEvent(node); Game.evChoose(1);
      const parts = Game.state === 'reward' && Game.reward.options.every(id => id.startsWith('part:')) && 1000 - Game.credits === Game.shopPrice(K.part);
      Game.rerollReward(); const parts2 = Game.reward.options.every(id => id.startsWith('part:')); Game.takeReward(null);
      const box = v => { Game.inventory = Game.inventory.map(() => null); Game.openEvent(node); M.luck(v, () => Game.evChoose(2)); const got = Game.inventory.filter(Boolean); Game.evNext(); return got; };
      const b1 = box(0), b3 = box(0.99);
      const boxOk = b1.length === 1 && b3.length === 0;
      return { ok: poor && paid === price && nRare === K.again && Math.abs(hp1 - want1) <= 1 && Math.abs(hp2 - want2) <= 1 && parts && parts2 && boxOk,
        got: `錢不夠${poor ? '不能交易' : '還是交易了（錯誤）'}；改造晶片付 ◆${paid}、之後再選 ${nRare} 次、最大 HP ${hp0} → ${hp1} → ${hp2}（應為 ${want1} → ${want2}）；走私零件${parts ? '' : '不對（錯誤）'}、刷新${parts2 ? '還是零件' : '變了（錯誤）'}；包裹：${[b1, b3].map(b => b.length ? '晶片' : '空').join('／')}` };
    }],
    ['事件', '求救訊號', `全力救援：下一場一般戰鬥或精英戰敵人 ×${CFG.EVENT.sos.full.mul}（照一波的預算）、打贏多 ${CFG.BONUS.sos.again} 次三選一；只護送：敵人 ×${CFG.EVENT.sos.escort.mul}、打贏多一次三選一；只算一場`, M => {
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
      const add = Game.state === 'reward' ? Game.reward.again || 0 : -1, rare = add === CFG.BONUS.sos.again;
      Game.reward.again = 0; Game.takeReward(null);
      ev(1); const esc = Game.takeSos(); const c2 = fight(esc);
      Game.inArena = true; Game.state = 'play'; Game.combatWon(); Game.takeReward(null);
      const again = Game.state === 'reward' && Game.reward.kind === 'combat'; Game.takeReward(null); const done = Game.state === 'map';
      // 隊友回應（fromNet）：倍數取大的；自己選了沒獎勵的（被發現）→ 照隊友的獎勵
      Game.sos = null; Game.addSos('escort'); Game.addSos('full', true); const team = Game.takeSos();
      Game.sos = null; Game.addSos('caught'); Game.addSos('escort', true); const team2 = Game.takeSos();
      const want = m => Math.ceil(base * m), sc = CFG.EVENT.sos;
      return { ok: flag && elite && c0 === Math.ceil(base) && c1 === want(sc.full.mul) && rare && c2 === want(sc.escort.mul) && again && done &&
          team.sos === sc.full.mul && team.sosKey === 'escort' && team2.sos === sc.caught.mul && team2.sosKey === 'escort',
        got: `全力救援${flag ? '記下' : '沒記下（錯誤）'}；下一場精英戰${elite ? '帶著、用掉了' : '沒帶到（錯誤）'}；一波的預算 ${c0} → ${c1}（應為 ${want(sc.full.mul)}）；打贏之後再選 ${add} 次${rare ? '' : '（錯誤）'}；` +
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
    ['事件', '星圖情報：寶藏星域', `解讀座標：標出產生航圖時決定的第 1 場；強行破解 ${CFG.EVENT.chart.chance * 100}%：標出 2 場，失敗：下一場敵人 ×${CFG.EVENT.sos.caught.mul}、什麼都沒標；寶藏星域每一區都有一架寶藏無人機，打掉幾架就多幾次三選一`, M => {
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
      const nRare = Game.state === 'reward' ? Game.reward.again : -1;
      return { ok: before === 0 && one && two && fail && per.join() === '1,1,1' && nRare === 3 * CFG.BONUS.treasure.again,
        got: `進來時標了 ${before} 格；解讀${one ? '標 1 格' : '不對（錯誤）'}；破解成功${two ? '標 2 格' : '不對（錯誤）'}；失敗${fail ? '沒標、下一場變難、沒有獎勵' : '不對（錯誤）'}；每一區寶藏無人機 ${per.join('／')}；打掉 3 架 → 之後再選 ${nRare} 次` };
    }],
    ['敵人', '主題小兵隨進度增加', '第 1 星區前半 0～1 種、第 3 星區 2～3 種；母巢第 3 星區才出現', M => {
      const avg = (s, late) => { let n = 0, hive = 0; for (let i = 0; i < 200; i++) { const T = Game.pickThemes(s, late); n += T.list.length; if (T.list.includes('hive')) hive++; } return [n / 200, hive]; };
      const [a1, h1] = avg(1, false), [a2] = avg(2, false), [a3, h3] = avg(3, false);
      return { ok: a1 <= 1 && a2 >= 1 && a3 >= 2 && h1 === 0 && h3 > 0, got: '平均幾種：星區 1 ' + a1.toFixed(1) + '、星區 2 ' + a2.toFixed(1) + '、星區 3 ' + a3.toFixed(1) + '；母巢出現：星區 1 ' + h1 + ' 次、星區 3 ' + h3 + ' 次' };
    }],
    ['敵人', '推王（抗擊退）', '擊退 4 的子彈推得動星噬母艦（抗 1.5），擊退 0.6（熱能光束）推不動', M => {
      const push = knock => {
        M.setup('sandbox', 'vanguard', 'laser', null, null, ['weapon', null, null, null]); Game.wp = { ...Game.wp, knock };
        const b = M.targets([[200, 0]], 'boss', true, 50)[0], x0 = b.x;
        b.update = function () { this.move(1 / 60); this.vx *= 0.95; this.vy *= 0.95; };  // 只看被推的位移，不讓王自己移動
        M.run(60);
        return b.x - x0;
      };
      const siege = push(4), laser = push(WEAPONS.laser.base.knock);
      return { ok: siege > 20 && Math.abs(laser) < 1, got: `擊退 4 推了 ${Math.round(siege)} px，擊退 ${WEAPONS.laser.base.knock} 推了 ${Math.round(laser)} px` };
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
      try { saved = localStorage.getItem(Save.KEYS.chapters); } catch (e) {}
      const put = v => { try { if (v == null) localStorage.removeItem(Save.KEYS.chapters); else localStorage.setItem(Save.KEYS.chapters, v); } catch (e) {} };
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
    ['精英', '精英池', 'CFG.ELITE_POOL：第 1 星區只出 from ≤ 1 的，第 2 星區起全部都出；章節的 eliteW 再乘（第二章三艦編隊 ×2）；編隊不會抽到分裂、召喚、閃現，砲艦不會抽到護盾、隱形', M => {
      M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
      const P = CFG.ELITE_POOL, cnt = (sector, ch) => { Game.chapterId = ch; const c = {}; for (let i = 0; i < 2000; i++) { const k = Game.pickElite(sector); c[k] = (c[k] || 0) + 1; } return c; };
      const s1 = cnt(1, 1), s2 = cnt(2, 1), c2 = cnt(3, 2);
      Game.chapterId = 1;
      const want1 = Object.keys(P).filter(k => P[k].from <= 1), only1 = Object.keys(s1).every(k => want1.includes(k)) && want1.every(k => s1[k] > 0);
      const all2 = Object.keys(P).every(k => s2[k] > 300), wing2 = c2.wing / 2000;  // 4 種、第二章編隊權重 2：2 / 5 = 40%
      let bad = 0; for (let i = 0; i < 300; i++) for (const ty of ['wing', 'artillery']) if (rollAffixes(3, ty).some(id => ENEMY_TYPES[ty].noAffix.includes(id))) bad++;  // 編隊不抽分裂、召喚、閃現；砲艦不抽護盾、隱形
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
    ['多人', '隊友用自己的武器', '房主拿熱能光束、隊友拿無人機蜂群：隊友的無人機由房主每幀更新、右鍵（altSeq）收攏只動隊友；武器狀態同步過去跟房主這邊一樣', M => {
      const m = M.coop('drone'), P = Game.player, dt = 1 / 60;
      for (let f = 0; f < 30; f++) { Game.time += dt; Net.hostUpdateMates(dt); }
      const nD = (m.drones || []).length;
      Net.applyInput({ ds: 0, as: 1, x: m.x, y: m.y }, { slot: m.slot }); Net.hostUpdateMates(dt);
      const guard = m.guardT > 0 && m.altCd > 0 && !(P.altCd > 0) && !P.drones;
      const c = {}; applyWeaponRow(c, weaponRow(m));
      return { ok: nD === DRONE.n && guard && c.drones.length === nD && c.guardN === m.guardN,
        got: `隊友無人機 ${nD} 架（要 ${DRONE.n}）；右鍵後隊友收攏 ${m.guardT > 0 ? '有' : '沒有'}、冷卻 ${m.altCd.toFixed(2)}，房主冷卻 ${P.altCd || 0}、房主無人機 ${P.drones ? P.drones.length : '無'}；同步後無人機 ${c.drones.length}、還能擋 ${c.guardN}` };
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
    ['多人', '擊殺效果給打最後一擊的人', '無傷連殺：記在打出最後一擊的那個人身上（隊友殺的給隊友、房主殺的給房主）', M => {
      const m = M.coop(), P = Game.player;
      const streakOn = mc => ({ ...mc, traits: { ...mc.traits, streak: true } });
      m.L.mech = streakOn(m.L.mech); Game.mech = streakOn(Game.mech);
      m.streak = 0; P.streak = 0;
      Game.onStreakKill({ killer: m.L });
      const a = m.streak === 1 && P.streak === 0;
      Game.onStreakKill({ killer: null });
      const b = P.streak === 1 && m.streak === 1;
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
      const keep = [Save.KEYS.unlocks, Save.KEYS.chapters, Save.KEYS.records].map(k => [k, localStorage.getItem(k)]), all = CFG.UNLOCK_ALL, sh = Screen.show;
      const html = fn => { let h = ''; Screen.show = x => { h = x; }; try { fn(); } finally { Screen.show = sh; } return h; };
      try {
        for (const [k] of keep) localStorage.removeItem(k);  // 玩家自己的紀錄也先拿開，不然會被拿去補解鎖
        const ids = L => L.map(u => u.id).sort().join(',');
        const a = unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 100, elites: 2, echoK: 5, play: { boomerang: 60 } });
        const b = unlockAddRun({ sector: 1, bossIds: [], weapon: 'scatter', kills: 50, play: { boomerang: 50 } });
        const P = unlockLoad(), sum = P.runs === 2 && P.kills === 150 && P.sector === 2 && P.play.boomerang === 110 && P.elites === 2;
        const firstOk = ids(a) === 'wraith',  // 原型：武器、晶片、觸發器先全部開放
        secondOk = ids(b) === '';
        // 精英被回響打死：這一局的精英、回響擊殺各 +1
        M.setup('run', 'vanguard', 'laser', null, null, ['weapon', null, null, null]);
        const e = M.targets([[100, 0]], 'elite', true, 1)[0]; e.hurt(e.hp + 1, 0, 0, 'echo', null);  // 打死時遊戲自己算擊殺（onEnemyKilled）
        const RS = Game.runStats, killOk = RS.elites === 1 && RS.echoK === 1;  // 進基地之後 runStats 就清掉了
        CFG.UNLOCK_ALL = true;
        const hs = Hub.shipId; Hub.enter(); Hub.setShip('vanguard');
        const allOpen = isUnlocked('ship', 'gate') && Hub.pick('gate');
        CFG.UNLOCK_ALL = false; Hub.setShip('vanguard');
        const lockOk = !isUnlocked('ship', 'gate') && isUnlocked('ship', 'wraith') && isUnlocked('ship', 'vanguard');  // 武器原型：武器先全部開放（不測武器的鎖）
        const gray = !Hub.pick('gate') && Hub.shipId === 'vanguard' && Hub.pick('wraith');
        Hub.setShip(hs);
        const hw = Hub.weaponId; Hub.weaponId = 'laser';
        const sb = Hub.equip('drone') && Hub.weaponId === 'drone' && Hub.equip('scatter');  // 武器原型：全部開放，每把都裝得上
        Hub.weaponId = hw;
        return { ok: sum && firstOk && secondOk && killOk && allOpen && lockOk && gray && sb,
          got: `第 1 局新達成 ${ids(a) || '無'}（要 wraith）、第 2 局 ${ids(b) || '無'}（要無）；累計 ${P.runs} 局、擊殺 ${P.kills}、迴旋 ${P.play.boomerang}${sum ? '' : '（錯誤）'}；`
            + `回響打死精英：精英 ${RS.elites}、回響擊殺 ${RS.echoK}；全開時${allOpen ? '都能選' : '有鎖（錯誤）'}；上鎖時${lockOk ? '照進度' : '不對'}、基地${gray ? '換不到星門號、換得到幻影號' : '星門號沒鎖（錯誤）'}、武器架${sb ? '每把都裝得上' : '有裝不上的（錯誤）'}` };
      } finally {
        CFG.UNLOCK_ALL = all;
        for (const [k, v] of keep) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
    }],
    ['局外成長', '基地', '開飛船的基地：停機坪換船（沒解鎖的換不過去）；靠近門按 E 打開那個面板；發射台用選的章出發（沒解鎖的章用第一章）；剛解鎖的東西在停機坪、門上有「新」，靠近停機坪、打開面板之後就沒了', M => {
      const keep = [Save.KEYS.unlocks, Save.KEYS.chapters, Save.KEYS.records, Save.KEYS.unlockSeen].map(k => [k, localStorage.getItem(k)]), all = CFG.UNLOCK_ALL, sh = Screen.show, hs = Hub.shipId, ch = Game.chapterId;
      const html = fn => { let h = ''; Screen.show = x => { h = x; }; try { fn(); } finally { Screen.show = sh; } return h; };
      const goTo = id => { const z = Hub.zone(id), s = Hub.ship; s.x = z.x; s.y = z.y; s.vx = s.vy = 0; Hub.update(0); return Hub.near && Hub.near.id; };
      try {
        for (const [k] of keep) localStorage.removeItem(k);
        CFG.UNLOCK_ALL = false;
        html(() => Screen.title()); Hub.setShip('vanguard');
        const nearPad = goTo('pad:gate'), lockSwap = Hub.interact() && Hub.shipId === 'vanguard';  // 鎖住：按 E 不會換
        const door = goTo('armory') === 'armory' && html(() => Hub.interact()).includes('⚔ 軍械庫');
        Game.chapterId = 2; const chLock = Hub.chapter() === 1;  // 第二章還沒解鎖：用第一章
        localStorage.setItem(Save.KEYS.chapters, JSON.stringify({ cleared: [1] })); Game.chapterId = 2;
        const launch = goTo('launch') === 'launch' && html(() => Hub.interact()).includes('data-act="depart"');
        const go = html(() => Screen.depart()), goOk = go.includes('起始晶片') && go.includes(`:${Hub.weaponId}:`) && Game.chapterId === 2;  // 出發 → 直接起始晶片（武器在基地裝好了）
        unlockAddRun({ sector: 2, bossIds: ['boss'], weapon: 'scatter', play: {} });  // 解鎖幻影號、軌道砲（第一章已通關 → 哨兵號也一起）
        const padZ = Hub.zone('pad:wraith'), doorZ = Hub.zone('armory');
        const newBefore = Screen.hubNew(padZ) === 1 && Screen.hubNew(doorZ) === 0;  // 武器原型：武器全部開放，軍械庫門上沒有「新」
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
    ['局外成長', '記住上次的飛船和武器', '換船、換武器就存進瀏覽器（Save 的 lastPick）；重新整理後（記憶體裡沒有選擇）進基地，拿回存的那組', M => {
      const keep = localStorage.getItem(Save.KEYS.lastPick), g0 = [Game.shipId, Game.weapon, Hub.shipId, Hub.weaponId];
      const S = Object.keys(SHIPS).filter(id => isUnlocked('ship', id)), W = Object.keys(WEAPONS).filter(id => isUnlocked('weapon', id));
      const s1 = S[S.length - 1], w1 = W[W.length - 1];
      try {
        localStorage.setItem(Save.KEYS.lastPick, JSON.stringify({ ship: s1, weapon: w1 }));
        Game.shipId = null; Game.weapon = { id: 'laser', path: null, final: null }; Hub.shipId = Hub.weaponId = null;  // 剛打開遊戲：基地沒有選擇，Game.weapon 是預設的雷射（不能蓋掉存的）
        Hub.enter();
        const back = Hub.shipId === s1 && Hub.weaponId === w1;
        Hub.pick(S[0]); Hub.equip(W[0]);
        const L = Hub.last(), saved = L.ship === S[0] && L.weapon === W[0];
        localStorage.setItem(Save.KEYS.lastPick, '{壞掉'); Hub.shipId = Hub.weaponId = null; Hub.enter();
        const broken = Hub.shipId === S[0] && Hub.weaponId === W[0];  // 存檔壞掉：當成沒有，用第一個解鎖的
        return { ok: S.length > 1 && W.length > 1 && back && saved && broken,
          got: `存 ${SHIPS[s1].name}＋${WEAPONS[w1].name} → 重新整理後${back ? '拿回來了' : `是 ${Hub.shipId}＋${Hub.weaponId}（錯誤）`}；換成 ${SHIPS[S[0]].name}＋${WEAPONS[W[0]].name} → 存的${saved ? '跟著變' : '沒變（錯誤）'}；存檔壞掉${broken ? '用第一個解鎖的' : '出錯（錯誤）'}` };
      } finally {
        if (keep == null) localStorage.removeItem(Save.KEYS.lastPick); else localStorage.setItem(Save.KEYS.lastPick, keep);
        [Game.shipId, Game.weapon, Hub.shipId, Hub.weaponId] = g0;
      }
    }],
    ['局外成長', '基地射擊', '基地跟戰鬥同一套（Player、Bullet）：每把武器對著標靶機按住左鍵 1 秒內都射得出來；貼著大廳上牆射，子彈撞牆就消失、不會跑進牆裡；放開就停', M => {
      const st = Game.state, down = Input.down, hw = Hub.weaponId, mm = Input.mouseMoved, keys = new Set(Input.keys);
      try {
        Game.state = 'title'; Hub.enter(); Input.mouseMoved = false; Input.keys.clear();  // 沒動滑鼠、沒按方向：船頭不轉
        const run = (n, fire) => { Input.down = fire; let most = 0; for (let i = 0; i < n; i++) { Hub.update(1 / 60); most = Math.max(most, Game.bullets.length); } return most; };
        const at = (x, y, a = -Math.PI / 2) => { const p = Hub.ship; p.x = x; p.y = y; p.vx = p.vy = 0; p.aim = a; };
        const T = HUB.targets[0], dry = Object.keys(WEAPONS).filter(id => { Hub.equip(id); at(T.x - 200, T.y, 0); return !run(60, true); });  // 站在標靶機旁邊（無人機要附近有敵人才出手）
        Hub.equip('laser'); at(HUB.rooms.hall.x + 100, HUB.rooms.hall.y + 80);  // 貼近上牆射（避開往觀景台的門）
        let out = 0, hit = 0;
        Input.down = true;
        for (let i = 0; i < 60; i++) { Hub.update(1 / 60); out += Game.bullets.filter(b => !b.dead && Arena.f(b.x, b.y) < -b.r - 8).length; hit = Math.max(hit, Game.bullets.length); }
        run(120, false); const gone = Game.bullets.length === 0, idle = run(60, false) === 0;
        return { ok: !dry.length && hit && !out && gone && idle,
          got: `${dry.length ? `射不出來：${dry.join('、')}（錯誤）` : '每把武器都射得出來'}；貼著上牆射 ${hit} 顆、跑進牆裡 ${out} 顆${out ? '（錯誤）' : ''}；放開 2 秒後子彈${gone ? '都消失' : '還在（錯誤）'}、${idle ? '不再射' : '還在射（錯誤）'}` };
      } finally {
        Input.down = down; Input.mouseMoved = mm; Input.keys.clear(); keys.forEach(k => Input.keys.add(k)); Game.state = st; Hub.equip(hw);
      }
    }],
    ['局外成長', '基地靶場', '軍械庫的標靶機 = 打不死的標靶：打中算傷害，頭上的每秒傷害 = 最近 3 秒的傷害 ÷ 從第一發到現在（最少 1 秒）；自己的血不變', M => {
      const st = Game.state, down = Input.down, hw = Hub.weaponId, mm = Input.mouseMoved, keys = new Set(Input.keys);
      try {
        Game.state = 'title'; Hub.enter(); Hub.equip('laser'); Input.mouseMoved = false; Input.keys.clear();
        const T = HUB.targets[0], p = Hub.ship; p.x = T.x - 160; p.y = T.y; p.aim = 0;  // 站在第一個靶左邊，朝右射
        const hp = p.hp; Input.down = true;
        for (let i = 0; i < 90; i++) Hub.update(1 / 60);
        Input.down = false;
        const e = Game.enemies[0], dps = Hub.dps(0), sum = e.hits.reduce((a, h) => a + h[1], 0), t0 = Math.min(...e.hits.map(h => h[0]));
        const want = Math.round(sum / clamp(Game.time - t0, 1, HUB.DPS_WIN));
        return { ok: e.hits.length > 0 && dps === want && !e.dead && e.hp > 0 && p.hp === hp,
          got: `打中 ${e.hits.length} 下、每秒 ${dps}（應為 ${want}）；標靶${e.dead ? '死了（錯誤）' : '還在'}；自己的血${p.hp === hp ? '不變' : '變了（錯誤）'}` };
      } finally {
        Input.down = down; Input.mouseMoved = mm; Input.keys.clear(); keys.forEach(k => Input.keys.add(k)); Game.state = st; Hub.equip(hw);
      }
    }],
    ['局外成長', '基地衝刺', '基地的飛船能力跟戰鬥同一套：先鋒號瞬移 CFG.PHASE.dist、幻影號留殘影、星門號衝完開一對門（走進去從另一個門出來）、哨兵號留砲台打標靶機；換船留在原地', M => {
      const st = Game.state, hs = Hub.shipId, ulk = CFG.UNLOCK_ALL, mm = Input.mouseMoved, keys = new Set(Input.keys);
      try {
        Game.state = 'title'; CFG.UNLOCK_ALL = true; Hub.enter(); Input.mouseMoved = false;
        const T = HUB.targets[0];
        const dash = (id, n = 20) => {  // 站在靶左邊 260 朝右衝，跑 n 幀
          Hub.setShip(id); const p = Hub.ship; p.x = T.x - 260; p.y = T.y; p.aim = 0; Input.keys.clear(); Input.dash = true;
          const x0 = p.x; for (let i = 0; i < n; i++) Hub.update(1 / 60);
          return { dx: Math.round(p.x - x0), decoy: Game.decoys.length, portal: Game.portals.length, turret: Game.turrets.length, hits: Game.enemies[0].hits.length };
        };
        const v = dash('vanguard', 1), w = dash('wraith'), g = dash('gate'), t = dash('sentry', 90), b = dash('bulwark');
        dash('gate'); const P = Game.portals[0], p = Hub.ship;  // 星門：從起點那個門走進去 → 從落點那個門出來
        let hopOk = false;
        if (P) { p.x = P.ax - 60; p.y = P.ay; p.vx = p.vy = 0; Input.keys.add('d'); for (let i = 0; i < 40 && !hopOk; i++) { Hub.update(1 / 60); hopOk = Math.hypot(p.x - P.bx, p.y - P.by) < 60; } }
        Input.keys.clear();
        Hub.setShip('vanguard'); const z = Hub.zone('pad:wraith'), q = Hub.ship; q.x = z.x + 20; q.y = z.y + 15;  // 換船：站在停機位旁邊換，位置不動
        const swapOk = Hub.pick('wraith') && Hub.ship.x === z.x + 20 && Hub.ship.y === z.y + 15;
        return { ok: v.dx === CFG.PHASE.dist && w.decoy && g.portal && t.turret && t.hits > 0 && !b.decoy && !b.portal && !b.turret && hopOk && swapOk,
          got: `先鋒號瞬移 ${v.dx}（應為 ${CFG.PHASE.dist}）；幻影號殘影 ${w.decoy}；星門號門 ${g.portal}、穿門${hopOk ? '成功' : '失敗（錯誤）'}；哨兵號砲台 ${t.turret}、打中標靶 ${t.hits} 下；堡壘號 ${b.decoy + b.portal + b.turret ? '有效果（錯誤）' : '沒有額外效果'}；換船${swapOk ? '留在原地' : '位置變了（錯誤）'}` };
      } finally {
        Game.state = st; CFG.UNLOCK_ALL = ulk; Input.dash = false; Input.mouseMoved = mm; Input.keys.clear(); keys.forEach(k => Input.keys.add(k)); Hub.setShip(hs);
      }
    }],
    ['局外成長', '房間裡的其他人', '多人房間：別人的飛船在自己這邊也跑一份（配裝照他的船、武器）——照同步來的按鍵開火（子彈是他的）、衝刺放出飛船能力（幻影號殘影）、換武器就換配裝', M => {
      const st = Game.state, rm = Net.roomMates;
      try {
        Game.state = 'pick'; Hub.enter();
        const T = HUB.targets[0], o = { x: T.x - 200, y: T.y, vx: 0, vy: 0, a: 0, s: 'wraith', w: 'laser', m: false, r: false, b: false, f: true, ds: 0, as: 0, dT: 0 };
        Net.roomMates = { 2: o };
        const run = n => { for (let i = 0; i < n; i++) { o.at = performance.now(); Hub.update(1 / 60); } };
        run(30);
        const m = Game.mates[0], shots = Game.bullets.filter(b => b.ownerP === m).length;
        o.ds = 1; o.f = false; run(5); const decoy = Game.decoys.length;
        o.w = 'scatter'; run(1); const swap = Game.mates[0] !== m && Game.mates[0].L.weapon.id === 'scatter';
        return { ok: !!m && m.L.weapon.id === 'laser' && shots > 0 && decoy > 0 && swap && Game.enemies[0].hits.length > 0,
          got: `其他人 ${Game.mates.length} 艘；他的子彈 ${shots} 顆、打中標靶 ${Game.enemies[0].hits.length} 下；衝刺後殘影 ${decoy}；換武器${swap ? '換了配裝' : '沒換（錯誤）'}` };
      } finally { Net.roomMates = rm; Game.state = st; Hub.enter(); }
    }],
    ['局外成長', '晶片池上鎖', '上鎖時三選一（含保底插件）、商店、開局晶片都不會出現沒解鎖的晶片；條件達成後就會出現；UNLOCK_ALL 時全部都會出現', M => {
      const keep = [Save.KEYS.unlocks, Save.KEYS.chapters, Save.KEYS.records].map(k => [k, localStorage.getItem(k)]), all = CFG.UNLOCK_ALL;
      const seen = () => {  // 抽很多次，看出現過哪些晶片
        const got = new Set(), add = id => { if (CHIPS[id]) got.add(baseOf(id)); };
        for (let i = 0; i < 300; i++) {
          Game.rewardOptions('combat').forEach(add);
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
        unlockAddRun({ sector: 1, bossIds: [], weapon: 'laser', elites: 10 });  // 打倒 10 隻精英 → 破甲
        const b = seen(), infect = b.has('shred') && !b.has('shock');
        CFG.UNLOCK_ALL = true;
        const c = seen(), allIn = NORMAL_IDS.every(id => c.has(id));
        return { ok: !leak.length && !openMiss.length && infect && allIn,
          got: `上鎖時出現沒解鎖的：${leak.join('、') || '無'}；解鎖的沒出現過：${openMiss.join('、') || '無'}；打倒 10 隻精英後${infect ? '出現破甲' : '破甲沒出現或電擊也出現（錯誤）'}；全開時${allIn ? '全部都出現' : '有沒出現的（錯誤）'}` };
      } finally {
        CFG.UNLOCK_ALL = all;
        for (const [k, v] of keep) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
      }
    }],
    ['局外成長', '存檔升級', '第一次讀進度時：2.20.0 以前的遊玩紀錄刪掉、章節進度只照 2.20.0 以後通關（或打到無盡）的紀錄重來（只做一次）；以後加的新成績用 2.20.0 以後的紀錄補一次，已經在記的不重複算', M => {
      const rec = (build, o) => ({ build, ship: '先鋒號', weapon: WEAPONS.laser.name + '・聚焦', chapter: 1, result: 'dead', endless: false, sector: 1, bosses: [], kills: 100, mech: { playKills: {} }, ...o });
      const recs = [rec('mp-2.21.0（2026-10-19 10:00）', { kills: 50, ulk: { sector: 2, bossIds: ['boss'], weapon: 'laser', kills: 50, elites: 3, echoK: 0, play: {} } }),
        rec('mp-2.20.0（2026-10-18 03:59）', { chapter: 2, result: 'cleared', sector: 3, bosses: [ENEMY_TYPES.boss2.name, ENEMY_TYPES.boss.name], kills: 900, mech: { playKills: { [CHIPS.boomerang.name]: 70 } } }),
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
      const r0 = recordRun(recs[1]), convOk = r0.bossIds.join() === 'boss2,boss' && r0.weapon === 'laser' && r0.play.boomerang === 70 && r0.kills === 900;
      return { ok: keepOk && onceOk && newOk && convOk,
        got: `留下 ${a.recs.length} 筆紀錄（要 2）、章節 ${a.ch.join(',') || '無'}（要 2）、成績 ${P.runs} 局擊殺 ${P.kills}（不變）${keepOk ? '' : '（錯誤）'}；第二次${onceOk ? '不再刪' : '又做了一次（錯誤）'}；${newGot}${newOk ? '' : '（錯誤）'}；`
          + `2.20.0 紀錄換回：王 ${r0.bossIds.join(',')}、武器 ${r0.weapon}、迴旋 ${r0.play.boomerang}${convOk ? '' : '（錯誤）'}` };
    }],
    ['介面', '設定', '設定頁的值存在瀏覽器、重新讀回來一樣；壞掉的存檔用預設值；主音量乘在音效上；關掉畫面震動就不會震', M => {
      const keep = localStorage.getItem(Save.KEYS.settings), old = { vol: Settings.vol, musicVol: Settings.musicVol, shake: Settings.shake, fps: Settings.fps, detail: Settings.detail, unlockAll: Settings.unlockAll }, ulk = CFG.UNLOCK_ALL;  // ulk：讀設定會改 CFG.UNLOCK_ALL（模擬預設全開），結束要還原
      try {
        Settings.set('vol', 0.5); Settings.set('shake', false); Settings.set('fps', false);
        Settings.vol = 1; Settings.shake = true; Settings.fps = true; Settings.load();  // 重新讀
        const saved = Settings.vol === 0.5 && !Settings.shake && !Settings.fps && Settings.musicVol === old.musicVol;
        const m = SFX.muted; SFX.muted = false; const gain = Math.abs(SFX.gainNow() - SFX.VOLUME * 0.5) < 1e-9; SFX.muted = m;
        FX.shake = 0; Events.emit('shake', 12); const noShake = FX.shake === 0;
        Settings.set('shake', true); Events.emit('shake', 12); const shakes = FX.shake === 12; FX.shake = 0;
        localStorage.setItem(Save.KEYS.settings, '{"vol":"大聲","shake":3,"musicVol":9}'); Settings.load();
        const bad = Settings.vol === 1 && Settings.shake === true && Settings.musicVol === 1;
        return { ok: saved && gain && noShake && shakes && bad,
          got: `存了再讀：${saved ? '主音量 0.5、震動關、FPS 關' : '不對（錯誤）'}；音效音量${gain ? '照主音量' : '沒乘（錯誤）'}；震動關掉${noShake ? '不震' : '還在震（錯誤）'}、打開${shakes ? '會震' : '不震（錯誤）'}；壞掉的存檔${bad ? '用預設值' : '沒處理（錯誤）'}` };
      } finally {
        if (keep == null) localStorage.removeItem(Save.KEYS.settings); else localStorage.setItem(Save.KEYS.settings, keep);
        Object.assign(Settings, old); CFG.UNLOCK_ALL = ulk;
      }
    }],
    ['介面', '測試：全部解鎖開關', '設定頁「全部解鎖」打開 = CFG.UNLOCK_ALL：沒解鎖的飛船、武器馬上能選；存在設定裡，重新讀回來還是開；關掉恢復上鎖', M => {
      const keep = [Save.KEYS.settings, Save.KEYS.unlocks].map(k => [k, localStorage.getItem(k)]), old = Settings.unlockAll, ulk = CFG.UNLOCK_ALL;
      try {
        localStorage.removeItem(Save.KEYS.unlocks);  // 沒有任何解鎖進度
        const locked = Object.keys(SHIPS).find(id => { CFG.UNLOCK_ALL = false; return !isUnlocked('ship', id); });
        Settings.set('unlockAll', true); const on = CFG.UNLOCK_ALL && isUnlocked('ship', locked);
        Settings.unlockAll = false; CFG.UNLOCK_ALL = false; Settings.load(); const kept = Settings.unlockAll && CFG.UNLOCK_ALL;
        Settings.set('unlockAll', false); const off = !CFG.UNLOCK_ALL && !isUnlocked('ship', locked);
        return { ok: !!locked && on && kept && off, got: `${locked ? `沒解鎖的飛船 ${SHIPS[locked].name}` : '找不到沒解鎖的飛船（錯）'}：打開${on ? '能選' : '還是鎖著（錯）'}；重新讀${kept ? '還是開' : '變關（錯）'}；關掉${off ? '恢復上鎖' : '還是能選（錯）'}` };
      } finally {
        for (const [k, v] of keep) if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v);
        Settings.unlockAll = old; CFG.UNLOCK_ALL = ulk;
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

