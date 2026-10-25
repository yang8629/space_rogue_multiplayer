// 星環電路 多人版 · game_combat.js：Game 的戰鬥：開戰、波次與敵人生成、區域
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   往 game.js 的 Game 加方法（外面照樣呼叫 Game.xxx）
'use strict';

Object.assign(Game, {
  // ---------- 戰鬥 ----------
  startCombat(cfg) {
    // 這一場的傷害統計起點（三選一上面顯示這場各晶片佔比、每秒傷害跟上一場比，見 Screen.fightSummary）
    if (this.runStats) {
      if (this.fightBase && this.fightBase.dps) this.prevFightDps = this.fightBase.dps;
      this.fightBase = { node: this.node && this.node.id, chips: { ...this.runStats.chips }, time: this.runStats.time };
    }
    this.combat = Object.assign({ wave: 0, waveTimer: 1.2, pending: [], spawnClock: 0, cleared: false, clearT: 0,
      wavesTotal: Infinity, elites: 0 }, cfg);
    this.bullets = []; this.slashQ = []; this.enemies = []; this.eBullets = []; Events.emit('fxClear');
    for (const q of this.players()) if (q) q.drRec = 0;  // 灰血（堡壘號）每場重算
    this.pickups = []; this.triggerQueue = []; this.portals = []; this.decoys = []; this.turrets = []; this.zones = [];
    this.kills = 0; this.nextId = 1; this.exit = null;
    // 大地圖：一般戰、精英戰分區；旗艦戰一區、形狀照王（雙人：隊友收到種子才產生，之前先用方形場地）
    if (this.isClient()) Arena.reset();
    else if (this.usesAreas()) Arena.gen(randInt(1, 2 ** 31 - 2), this.combat.wavesTotal, this.areaScale(this.combat.level));
    else if (this.combat.boss && !this.combat.sandbox) Arena.genBoss(randInt(1, 2 ** 31 - 2), this.bossId);
    else Arena.reset();
    if (Net.stats) Net.stats.lastRecv = 0;  // 同步間隔從這場戰鬥重新算（不把航圖、商店的時間算進去）
    this.player.resetPos();
    // 雙人：照號碼由左到右、以中間為準排開，每人隔 100（1P 在最左；隊友的位置由隊友自己的電腦決定）
    if (Net.role) this.player.x += this.slotX(Net.mySlot());
    for (const m of this.mates) { m.resetPos(); m.x += this.slotX(m.slot || 2); m.dead = false; }
    this.player.dead = false;
    for (const p of this.allShips()) this.resetMechCombat(p);
    this.objs = this.isClient() ? [] : Objects.gen(this.combat, this.node);
    if (!this.combat.boss && !this.combat.sandbox && !this.combat.range) this.combat.themes = this.pickThemes(this.sector, !!this.node && this.node.L >= 3);  // 地圖物件（雙人：房主產生，隨同步傳給隊友）
    this.cam.x = this.player.x - ZW / 2; this.cam.y = this.player.y - ZH / 2;
    Input.down = false; Input.dash = false; Input.joy = null; Input.aimStick = null;
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
    this.inArena = true; this.state = 'play';
    this.view();
  },
  // 區域大小照難度縮放：前面敵人少，地圖小一點（第 1 星區 0.72～0.84、第 2 星區 0.86～0.98、之後 1）
  areaScale(level) { return clamp(0.7 + 0.02 * (level || 0), 0.7, 1); },
  startWave(n) {
    const C = this.combat;
    C.wave = n;
    if (C.boss) {
      C.pending = [this.bossId];
      bannerFx(`♛ ${ENEMY_TYPES[this.bossId].name}`, '守關旗艦接近中', 2.5);
      Events.emit('bossArrive', this.bossId);
      return;
    }
    let budget = (5 + n * 3 + C.level * 3) * CFG.WAVE_MUL * (this.coopOn() ? coopCount(C.level, this.onlineN()) : 1);  // 多人：敵人數量 ×2 → ×2.5（隨難度），三、四人每多一人再 +0.6
    if (C.sos) budget *= C.sos;  // 求救訊號、星圖情報被發現：敵人變多（倍數）
    const eliteArea = !C.sandbox && C.elites > 0 && n === C.wavesTotal;  // 精英戰的最後一區是精英的場子：只帶少量護衛
    if (eliteArea) budget *= CFG.ELITE_ESCORT;
    const list = [], TH = C.sandbox ? this.pickThemes(1 + Math.floor(n / 5), n % 5 >= 3) : C.themes || { list: [], share: 0 };
    C.swarmArea = C.swarm === n && !eliteArea; C.clumpN = 0;  // 蟲潮：這一區全是蟲群（數量照預算 ×count，spawnEnemy 成群放、血量打折）
    if (C.swarmArea) { for (let i = Math.round(budget * CFG.SWARM.count); i > 0; i--) list.push('swarmer'); budget = 0; }
    while (budget > 0) {
      if (TH.list.length && Math.random() < TH.share) {  // 主題小兵
        const k = pick(TH.list), c = THEMES[k];
        if (budget >= c.cost && !(c.max && list.filter(x => x === k).length >= c.max)) { list.push(k); budget -= c.cost; continue; }
      }
      const r = Math.random(), lv = C.sandbox ? n : C.level + n;
      if (lv >= 3 && r < 0.18 && budget >= 6) { list.push('brute'); budget -= 6; }
      else if (lv >= 2 && r < 0.45 && budget >= 3) { list.push('spitter'); budget -= 3; }
      else { list.push('swarmer'); budget -= 1; }
    }
    // 警報艇（CFG.ALARM）：分區的戰鬥第 from 區以後，混在這一區的敵人裡（在精英放進來之前插：精英照舊最先出場）（蟲潮那一區不放：全是蟲群）
    if (this.usesAreas() && !C.swarmArea && n >= CFG.ALARM.from && Math.random() < CFG.ALARM.chance) list.splice(randInt(0, list.length), 0, 'alarm');
    if (eliteArea) for (let i = 0; i < C.elites; i++) list.unshift(this.pickElite(this.sector));  // 精英最先出場
    if (C.treasure === n || C.hoard) list.splice(Math.floor(list.length / 2), 0, 'treasure');  // 寶藏無人機：混在這一區的敵人中間出場
    // 沙盒：每 10 波輪流出現三隻旗艦
    const sbBoss = C.sandbox && n % 10 === 0 ? CFG.BOSS_ORDER[(n / 10 - 1) % CFG.BOSS_ORDER.length] : null;
    if (sbBoss) list.push(sbBoss);
    else if (C.sandbox && n % 5 === 0) list.unshift(this.pickElite(1 + Math.floor(n / 5)));
    C.pending = list;
    // 精英詞綴先抽好（出場橫幅要寫名字）：第 1 星區 1 個、第 2 星區 2 個、第 3 星區以後 3 個；沙盒照波次（第 5 波 1 個、第 15 波 3 個）
    const nAff = affixCount(C.sandbox ? Math.floor(n / 5) : this.sector), eliteTypes = list.filter(x => ENEMY_TYPES[x].elite);
    C.eliteRolls = eliteTypes.map(x => rollAffixes(nAff, x));
    C.waveN = 0;  // 這一區實際出場幾隻（spawnEnemy 加；列隊蟲一隻 6 節）：精英亂入照這個算「剩一半」
    if (C.intrude === n) { C.intrudeType = this.pickElite(this.sector); C.intrudeRoll = rollAffixes(nAff, C.intrudeType); }
    const bText = C.sandbox ? `WAVE ${n}` : this.usesAreas() ? `區域 ${n} / ${C.wavesTotal}` : `WAVE ${n} / ${C.wavesTotal}`;
    Events.emit('waveStart', { n, boss: !!sbBoss, swarm: C.swarmArea });
    if (C.eliteRolls.length && !sbBoss) {  // 精英出場：名字＋詞綴說明
      const R = C.eliteRolls[0];
      bannerFx(`⚠ ${eliteName({ affixes: R, t: ENEMY_TYPES[eliteTypes[0]] })}`, affixBrief(R), 3);
    } else if (C.swarmArea) bannerFx('⚠ 蟲潮', `${bText}：大群脆弱的蟲群湧過來`, 2.5);
    else bannerFx(bText, sbBoss ? `♛ ${ENEMY_TYPES[sbBoss].name}接近中` : n === 1 ? [C.sos && `⚠ 追兵：敵人 +${Math.round((C.sos - 1) * 100)}%`, C.hoard && '✦ 寶藏星域：每一區都有寶藏無人機'].filter(Boolean).join('　') : '', 2);
  },
  // 主題小兵：每場戰鬥抽幾種、佔一波多少比例，都隨進度增加（第 1 星區前半 0～1 種 20% → 第 3 星區 2～3 種 55% → 無盡 3 種以上 65%）
  pickThemes(sector, late) {
    const s = sector;
    const [n, share] = s >= 4 ? [Math.min(5, 3 + Math.floor((s - 4) / 2)), 0.65] : s === 3 ? [randInt(2, 3), 0.55]
      : s === 2 ? [randInt(1, 2), 0.4] : late ? [1, 0.3] : [randInt(0, 1), 0.2];
    const pool = Object.keys(THEMES).filter(k => THEMES[k].from <= Math.min(s, 3));
    return { list: pickN(pool, Math.min(n, pool.length)), share };
  },
  // 抽一種精英（CFG.ELITE_POOL：這個星區出得來的，照權重 × 章節的 eliteW）
  pickElite(sector) {
    const P = CFG.ELITE_POOL, W = (!this.freePlay() && this.chapter().eliteW) || {};
    const ids = Object.keys(P).filter(k => P[k].from <= sector), w = ids.map(k => P[k].w * (W[k] != null ? W[k] : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ids.length; i++) if ((r -= w[i]) < 0) return ids[i];
    return ids[ids.length - 1];
  },
  // 一次出好幾個的：編隊（t.fleet）、雙子獵艦（t.twin）、星環守門者的砲塔（t.turrets）；回傳整組（第一個是 e，其他的已經放進 enemies）
  spawnParts(e) {
    return e.t.fleet ? this.makeFleet(e) : e.t.twin ? this.makeTwin(e) : e.t.turrets ? this.makeTurrets(e) : [e];
  },
  // 雙子獵艦（CFG.TWIN）：e 是主艦（血量在它身上），另一艘 share = e；兩艘共用隊形 P（中心、轉角，BOSS_MOVE.boss4）
  makeTwin(e) {
    const C = CFG.TWIN, P = { x: e.x, y: e.y, ang: rand(0, TAU), dir: Math.random() < 0.5 ? 1 : -1, k: 0, members: [e], at: -1 };
    // 兩艘都要落在空地上：出生點靠近牆時，有些角度會把其中一艘放進牆裡很深（clampIn 推不出來：牆裡深處推的方向算不出來，一直往右推）
    //   窄的地方哪個角度都放不下兩艘：中心換到離牆至少轉圈半徑的地方（王關裡 40 局有 3～5 局，tests/twinwall.js）
    const open = a => [1, -1].every(s => Arena.f(P.x + s * Math.cos(a) * C.orbit, P.y + s * Math.sin(a) * C.orbit) >= e.r + 10);
    const fit = () => { for (let i = 0; i < 16 && !open(P.ang); i++) P.ang += TAU / 16; return open(P.ang); };
    if (!fit() && !Arena.rect) { [P.x, P.y] = Arena.randomIn(e.zone || 0, C.orbit + e.r + 10, this.players(), 500); fit(); }
    [e.x, e.y] = Arena.clampIn(P.x + Math.cos(P.ang) * C.orbit, P.y + Math.sin(P.ang) * C.orbit, e.r + 10);
    const k = new Enemy(e.type, ...Arena.clampIn(P.x - Math.cos(P.ang) * C.orbit, P.y - Math.sin(P.ang) * C.orbit, e.r + 10), e.hpScale);
    k.share = e; k.spawnT = e.spawnT; k.spawnMax = e.spawnMax; k.zone = e.zone; k.alert = e.alert;
    e.pair = k.pair = P; P.members.push(k); this.enemies.push(k);
    return P.members;
  },
  // 星環守門者的砲塔（t.turrets，CFG.WARDEN）：繞在核心旁邊、各管一招（wardenTurret）；第一次出招錯開
  makeTurrets(e) {
    const W = CFG.WARDEN, out = [e];
    e.cd = W.rest;  // 一開始光束先停 rest 秒（最後 warn 秒有預警線）
    e.t.turrets.forEach((type, i) => {
      const a = Math.PI / 4 + i * Math.PI / 2, R = e.r + W.turretR;
      const k = new Enemy(type, e.x + Math.cos(e.rot + a) * R, e.y + Math.sin(e.rot + a) * R, e.hpScale);
      k.core = e; k.slotA = a; k.spawnT = e.spawnT; k.spawnMax = e.spawnMax; k.zone = e.zone; k.cd = k.t.turret.cd * (0.6 + 0.4 * i / 3);
      out.push(k); this.enemies.push(k);
    });
    return out;
  },
  // 編隊（ENEMY_TYPES[type].fleet）：e 是第一艘，在旁邊補上其他艘，共用一個編隊 F（CFG.WING、ELITE_AI.wing）；詞綴、待機照 e
  //   kids = 同隊的其他艘：叫醒一艘整隊一起醒（wakeEnemy）
  makeFleet(e) {
    const W = CFG.WING, n = e.t.fleet;
    const F = { x: e.x, y: e.y, ang: rand(0, TAU), side: Math.random() < 0.5 ? 1 : -1, members: [e], fireT: W.fireCd, crossT: W.crossCd * 0.6, mode: 'form', modeT: 0, at: -1 };
    e.fleet = F;
    for (let i = 1; i < n; i++) {
      const a = F.ang + i / n * TAU, k = new Enemy(e.type, ...Arena.clampIn(e.x + Math.cos(a) * W.radius, e.y + Math.sin(a) * W.radius, 20), e.hpScale);
      k.zone = e.zone; k.alert = e.alert; k.home = e.home; k.spawnT = e.spawnT; k.fleet = F;
      if (e.affixes) k.setAffixes(e.affixes, this.player.x, this.player.y);
      F.members.push(k); this.enemies.push(k);
    }
    for (const m of F.members) { m.kids = F.members.filter(o => o !== m); m.grp = e.id; }  // 精英血條：整隊一條（一艘一段）
    return F.members;
  },
  // o.intruder：精英亂入（o.affixes = 先抽好的詞綴）
  spawnEnemy(type, o = {}) {
    const C = this.combat, p = this.player, zone = Math.max(0, C.wave - 1), S = CFG.SWARM, swarm = C.swarmArea && type === 'swarmer', n0 = this.enemies.length;
    let x, y;
    if (swarm && C.clumpN > 0) {  // 蟲潮：跟同一群的第一隻擠在一起（散開 jitter）；落在行星、小行星上就生在第一隻那裡
      C.clumpN--;
      [x, y] = Arena.clampIn(C.clumpAt[0] + rand(-S.jitter, S.jitter), C.clumpAt[1] + rand(-S.jitter, S.jitter), 20);
      if (Objects.inHole({ x, y, r: 10 }, OBJ.HOLE_NOESC) || Objects.onSolid({ x, y, r: 10 }, 40)) [x, y] = C.clumpAt;
    } else for (let t = 0; t < 30; t++) {
      const a = rand(0, TAU), d = rand(520, 780);
      x = clamp(p.x + Math.cos(a) * d, 40, CFG.WORLD_W - 40);
      y = clamp(p.y + Math.sin(a) * d, 40, CFG.WORLD_H - 40);
      if (!Arena.rect) [x, y] = Arena.spawnPoint(zone, this.players().filter(q => q.zone === zone), 500, 60);  // 大地圖：散在這一波的區域各處（離在這一區的玩家至少 500）
      // 不生在黑洞出不來的範圍：母巢不會動，整個引力範圍都不行；列隊蟲後面 5 節往外排到 110
      const R = type === 'hive' ? OBJ.HOLE_R : OBJ.HOLE_NOESC + (type === 'worm' ? 110 : 0);
      // 也不生在行星、小行星裡或貼著它們（離表面至少 40）：生在裡面會被推進物件中間的死角出不來
      if (!Objects.inHole({ x, y, r: ENEMY_TYPES[type].radius }, R) && !Objects.onSolid({ x, y, r: ENEMY_TYPES[type].radius }, 40)) break;
    }
    const scale = (C.sandbox ? 1 + (C.wave - 1) * 0.12 : enemyHpMul(C.level, C.wave)) *
      (this.coopOn() ? coopMul(CFG.COOP_HP, C.level) : 1) *  // 雙人：敵人血量 ×1 → ×1.3（隨難度）；隊友離線時恢復單人血量
      (this.isEndless() ? Math.pow(CFG.ENDLESS_HP, this.sector - this.lastSector()) : 1) *  // 無盡：每個星區血量再 ×1.2（乘算）
      (C.sandbox ? 1 : this.chapter().hp);  // 章節：敵人血量再 ×（第一章 1）
    if (swarm && !(C.clumpN > 0)) { C.clumpAt = [x, y]; C.clumpN = S.clump - 1; }  // 新的一群從這裡湧出
    const e = new Enemy(type, x, y, scale);
    if (!Arena.rect) e.zone = zone;
    // 警戒（CFG.ALERT）：分區的戰鬥出場先待機；表上 awake 的（寶藏無人機）、精英亂入照舊直接行動
    if (this.usesAreas() && !e.t.awake && !o.intruder) { e.alert = false; e.home = [x, y]; }
    if (swarm) e.hp = e.maxHp *= S.hp;
    if (e.t.elite) e.setAffixes(o.affixes || (C.eliteRolls && C.eliteRolls.shift()) || [], p.x, p.y);  // 精英詞綴（startWave 先抽好的）
    if (e.t.center && !Arena.rect) { e.x = Arena.center.x; e.y = Arena.center.y; }  // 星環守門者：場地正中間
    this.enemies.push(e);
    const group = this.spawnParts(e);  // 編隊、雙子獵艦、守門者的砲塔：一次出好幾個
    if (e.t.treasure) { bannerFx(`✦ ${e.t.name}`, `${CFG.TREASURE.life} 秒內打掉：這場的三選一保證稀有晶片`, 2.5); Events.emit('treasureArrive', e); }
    if (o.intruder) {
      const I = { left: group.length };  // 同一個亂入的共用（left = 還沒打掉幾隻；分裂詞綴分出來的那隻也加進來）
      for (const m of group) m.intruder = I;
      bannerFx(`⚠ 精英亂入：${eliteName(e)}`, `打掉：這場的三選一保證稀有晶片　${affixBrief(e.affixes || [])}`, 3);
      Events.emit('eliteIntrude', e);
    }
    burst(x, y, e.t.color, 10, 90, 0.5, 2);
    if (type === 'worm') {  // 列隊蟲：再往外排 5 節，每節跟著前一節
      const ux = (x - p.x) / (Math.hypot(x - p.x, y - p.y) || 1), uy = (y - p.y) / (Math.hypot(x - p.x, y - p.y) || 1);
      let prev = e;
      for (let i = 1; i < 6; i++) {
        const w = new Enemy('worm', ...Arena.clampIn(x + ux * 22 * i, y + uy * 22 * i, 20), scale);
        if (!Arena.rect) w.zone = zone;
        w.alert = e.alert;
        w.ahead = prev; prev = w; this.enemies.push(w);
      }
    }
    C.waveN = (C.waveN || 0) + this.enemies.length - n0;
  },
  updateWaves(dt) {
    const C = this.combat;
    if (!C || C.range || C.tutorial) return;  // 基地（沒有 combat）、靶場、新手引導：沒有波次，標靶由 Hub／Range／Tutorial 管理
    if (C.cleared) {
      for (const c of this.pickups) c.vacuum = true;
      C.clearT -= dt;
      if (C.clearT <= 0) this.combatWon();
      return;
    }
    // 精英亂入：這一區的敵人都出場了、剩不到一半時闖進來（先於「清完」判斷：同一幀清完也照樣闖進來）
    if (C.intrude === C.wave && !C.intruded && !C.pending.length && this.enemies.length <= C.waveN * CFG.INTRUDE.at) {
      C.intruded = true;
      this.spawnEnemy(C.intrudeType, { affixes: C.intrudeRoll, intruder: true });
    }
    if (C.pending.length) {
      C.spawnClock -= dt;
      if (C.spawnClock <= 0) { C.spawnClock = C.swarmArea ? CFG.SWARM.gap : 0.22; this.spawnEnemy(C.pending.shift()); }
    } else if (this.enemies.length === 0) {
      for (const c of this.pickups) c.vacuum = true;  // 每一波清完就把地上的晶體全部吸過來
      if (C.wave >= C.wavesTotal) {
        C.cleared = true; C.clearT = this.simFast ? 0 : 1.6;  // simFast：模擬（電腦不用看「區域肅清」）
        bannerFx('區域肅清', '', 1.6);
        Events.emit('areaClear', { last: true });
        return;
      }
      // 一場戰鬥分成幾個區域（一區一波）：清完打開閘門，有人穿過閘門就開始下一區（另一個人之後自己飛過去加入）
      if (C.wave >= 1 && this.usesAreas() && C.exitUsed !== C.wave) {
        if (!this.exit) this.openExit();
        else if (this.players().some(p => p.zone >= C.wave)) this.nextArea();
        return;
      }
      C.waveTimer -= dt;
      if (C.waveTimer <= 0) { C.waveTimer = 2.5; this.startWave(C.wave + 1); }
    }
  },
  // ---------- 區域：一般戰、精英戰分成 2～3 個區域（旗艦戰、沙盒、靶場照舊） ----------
  usesAreas() {
    const C = this.combat;
    return !!C && !C.sandbox && !C.range && !C.boss && isFinite(C.wavesTotal) && C.wavesTotal > 1;
  },
  // 打開這一區的閘門（exit = 閘門中央，畫箭頭、同步用）
  openExit() {
    const g = Arena.gates[this.combat.wave - 1];
    if (!g) { this.combat.exitUsed = this.combat.wave; return; }  // 不該發生（大地圖的閘門數 = 區域數 - 1）：直接開始下一波
    g.open = true;
    this.exit = { x: g.x, y: g.y, r: 40, gate: true };
    bannerFx('區域肅清', '閘門已開啟，穿過閘門前往下一區', 2);
    Events.emit('areaClear', { last: false });
  },
  // 換區：地上的晶體直接收下；倒下的人如果留在後面的區域，搬到新區域的入口（閘門不能回頭，不搬隊友救不到）；下一波照常倒數
  nextArea() {
    const C = this.combat, n = this.pickups.length;
    this.credits += n;
    if (this.mode === 'coop') Net.lootTotal += n;
    this.pickups = [];
    this.exit = null; C.exitUsed = C.wave; C.areaN = (C.areaN || 0) + 1; C.waveTimer = 1.2;
    for (const p of this.allShips()) if (p.dead && !p.gone) this.toEntry(p, C.wave);
  },
  toEntry(p, k) {
    if (Arena.rect || (p.zone || 0) >= k) return;
    const E = Arena.entryOf(k);
    p.x = E.x; p.y = E.y; p.vx = p.vy = 0; p.zone = k;
  },
  combatWon() {
    const client = this.isClient();  // 雙人的隊友：地上剩下的晶體由房主算好數量傳過來
    this.inArena = false;
    const left = client ? 0 : this.pickups.length;
    this.credits += left;  // 沒吸完的晶體直接入帳（雙人時兩人都拿）
    this.pickups = [];
    const p = this.player;
    if (!client) for (const q of this.players()) if (q && !q.dead && q.drRec > 0) { q.hp = Math.min(q.maxHp, q.hp + q.drRec); q.drRec = 0; }  // 灰血（堡壘號）：戰鬥結束時剩下的回滿回
    if (this.mode === 'coop') Net.afterCombat(left);  // 雙人：被擊墜的人在戰鬥結束後以 30% HP 歸隊，並同步血量
    this.logNodeEnd();  // 先記下戰鬥結果（先鋒號回血之前的 HP）
    Events.emit('combatWon', { boss: this.node.type === 'boss' });
    const type = this.node.type;
    if (type === 'boss') {  // 擊敗旗艦：電路插槽 +1／零件格 +1 二選一（勝利畫面上選）、晶體獎勵，可前往下一星區
      const slot = this.chain.length < CFG.MAX_SLOTS;
      this.credits += 50;  // 雙人：兩人各自拿
      if (!slot) this.partSlots++;  // 電路已滿：沒得選，直接給零件格
      const ws = (this.wSock || CFG.START_WSOCK) < CFG.WEAPON_SOCKETS;
      if (ws) this.wSock = (this.wSock || CFG.START_WSOCK) + 1;  // 武器插座 +1（最多 3）
      this.recalc();
      if (this.runStats) { this.runStats.bosses.push(ENEMY_TYPES[this.bossId].name); this.runStats.bossIds.push(this.bossId); }
      if (this.sector === this.lastSector() && !MechCheck.running) markChapterCleared(this.chapterId);  // 打完這章最後一隻王：記下通關、開下一章（雙人兩邊各自記）
      this.victory = { slot, ws, boss: this.bossId, pick: slot ? null : 'part' };  // pick：二選一選了哪個（'chain' 電路插槽／'part' 零件格）
      this.victory.rew = false;  // 旗艦的三選一還沒選（選完才回到勝利畫面，見 afterReward）
      if (this.mode === 'coop' && Net.role === 'host') Net.waitMods(this.coopOn());  // 雙人：等隊友選好二選一才能前往
      this.openReward('boss');
      this.view();
      return;
    }
    // 額外獎勵：戰鬥中打到的（寶藏無人機、精英亂入，房主告訴大家）＋自己回應求救訊號的獎勵（每個人照自己選的，見 addSos）：多幾次三選一
    const S = CFG.EVENT.sos[this.combat.sosKey] || {}, B = [...(this.combat.bonus || []), ...(S.bonus ? [S.bonus] : [])], add = B.reduce((n, k) => n + CFG.BONUS[k].again, 0);
    const rare = (type === 'elite' ? 1 : 0) + B.filter(k => k === 'treasure').length;  // 精英戰、寶藏：保證一張稀有晶片（一次三選一一張）
    this.openReward(type === 'elite' ? 'elite' : 'combat', { again: (S.again || 0) + add, rare, ...(add ? { note: `✦ ${B.map(k => CFG.BONUS[k].note).join('、')}：多 ${add} 次三選一` } : {}) });
    this.view();
  },
  // 一般戰鬥獎勵三選一：每一格 30% 是零件（"part:armor"），其他是晶片；不重複；晶片照 CFG.RARE.chance 變成稀有版
  // 保底：電路有空格時，零件只會出現在最後一格；上一次三選一沒有晶片（有等級的），這一次一定有（刷新也算一次）；rare：這次一定有一張稀有
  rewardOptions(kind = 'combat', rare = false) {
    if (CFG.REWARDS[kind].parts) return pickN(PART_IDS, 3).map(k => 'part:' + k);  // 黑市的走私零件
    const offers = this.chipOffers(), chips = pickN(offers, 3), parts = pickN(PART_IDS, 3), empty = this.chain.includes(null);
    const out = this.withComp([0, 1, 2].map(i => (!empty || i === 2) && Math.random() < 0.3 ? 'part:' + parts[i] : newChip(chips[i], undefined, rollRare(chips[i]))));  // 晶片的插座數、稀有在這裡決定
    const isPlay = id => !String(id).startsWith('part:') && hasLv(id);
    if (this.playDry && !out.some(isPlay)) {
      const pool = offers.filter(id => hasLv(id) && !out.some(o => CHIPS[o] && baseOf(o) === id));
      const nComp = out.filter(isComp).length, k = out.findIndex(id => !isComp(id) || nComp > 1);  // 換掉零件、觸發器（或多出來的插件）；保底的那個插件留著
      if (pool.length && k >= 0) out[k] = newChip(pick(pool));
    }
    this.playDry = !out.some(isPlay);
    if (rare && !out.some(rareOf)) {  // 保證稀有：有晶片就把第一張晶片換成稀有版，沒有就換掉第一格
      const k = Math.max(0, out.findIndex(id => CHIPS[id] && RARE_INFO[baseOf(id)]));
      const pool = offers.filter(id => RARE_INFO[id]), base = CHIPS[out[k]] && RARE_INFO[baseOf(out[k])] ? baseOf(out[k]) : pool.length && pick(pool);
      if (base) out[k] = newChip(base, undefined, true);
    }
    return out;
  },
  // 至少一格是插件（插件才填得滿插座）：沒抽到就隨機把一格換成插件
  withComp(ids) {
    if (ids.some(id => isComp(id))) return ids;
    const pool = openChips(NORMAL_IDS).filter(id => isComp(id) && !ids.includes(id));
    if (pool.length) ids[Math.floor(Math.random() * ids.length)] = pick(pool);
    return ids;
  },
  // 打開三選一：每種三選一（出發前、戰鬥、精英）的差別都在 CFG.REWARDS（刷新價格、有沒有電路擴充卡）
  openReward(kind, extra = {}) {
    const K = CFG.REWARDS[kind];
    this.reward = { kind, options: this.rewardOptions(kind, extra.rare > 0), reroll: this.shopPrice(K.reroll), slot: K.slotCard && this.chain.length < CFG.MAX_SLOTS, after: K.after || null, ...extra };
    this.state = 'reward';
  },
  // 花晶體刷新三選一（價格見 CFG.REWARDS：每刷一次就更貴）
  rerollReward() {
    const R = this.reward;
    if (!R || this.credits < R.reroll) return;
    this.pay(R.reroll, () => { R.reroll += this.shopPrice(CFG.REWARDS[R.kind].rerollUp); R.options = this.rewardOptions(R.kind, R.rare > 0); R.revealed = false; this.view(); });
  },
  // 獎勵、商店、事件可以出現的晶片：解鎖了的（局外成長）；已經有的也會出現（同種晶片合成升級）
  chipOffers() { return openChips(NORMAL_IDS); },
});
