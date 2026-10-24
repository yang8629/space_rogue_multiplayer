// 星環電路 多人版 · enemy_ai.js：各種敵人的行為表：主題小兵（THEME_AI）、精英（ELITE_AI）、旗艦平常的移動（BOSS_MOVE）、守門者砲塔的招式（TURRET_FIRE）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   表裡的函式 this = 那隻敵人（Enemy）；共通的移動、受傷、旗艦的招式框架在 game/entities.js
'use strict';

// 星環守門者的砲塔各管一招（this = 砲塔，q = 最近的玩家）；出招間隔在 ENEMY_TYPES[種類].turret.cd
const TURRET_FIRE = {
  wt_aim(q) { const a = Math.atan2(q.y - this.y, q.x - this.x); for (const o of [-0.08, 0, 0.08]) this.shootAt(a + o, 340, 5, 14); },
  wt_ring() { this.ring(16, 160, rand(0, TAU)); },
  wt_bomb(q) { for (let i = 0; i < 2; i++) { const a = rand(0, TAU), r = i ? rand(80, 180) : 0, [x, y] = Arena.clampIn(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r, 20); Game.zones.push({ x, y, r: 90, t: 1.3, max: 1.3, dmg: 22, from: `${this.t.name}（轟炸）` }); } },
  wt_call() { if (Game.enemies.filter(e => e.summoned && !e.dead).length < 8) this.summon('swarmer', 3, 60, 0.8); },
};

// ---------- 主題小兵的行為（this = Enemy）；回傳 true 表示這一幀的移動已經處理完 ----------
const THEME_AI = {
  egg(dt) {  // 孵化囊（星噬母艦的招式）：不動，modeT 秒後孵出蟲群（不掉晶體）、自己消失（不算擊殺）
    this.vx = this.vy = 0;
    if ((this.modeT -= dt) > 0) return true;
    const C = CFG.BOSS_SKILL.egg;
    for (let i = 0; i < C.swarm; i++) { const a = i / C.swarm * TAU, s = new Enemy('swarmer', this.x + Math.cos(a) * 14, this.y + Math.sin(a) * 14, this.hpScale / C.hp); s.summoned = true; s.noPlay = true; s.alert = true; Game.enemies.push(s); }
    burst(this.x, this.y, this.t.color, 24, 220, 0.4, 2); this.dead = true;
    return true;
  },
  core_shard(dt, p) {  // 核心碎片（終焉核心的招式）：繞著核心轉、每 cd 秒朝目標射一發；時間到或核心沒了就碎掉（不算擊殺）
    const C = CFG.BOSS_SKILL.shard, o = this.owner;
    if (!o || o.dead || (this.modeT -= dt) <= 0) { burst(this.x, this.y, this.t.color, 10, 160, 0.3, 2); this.dead = true; return true; }
    this.orbA += dt * C.spin; this.x = o.x + Math.cos(this.orbA) * C.orbit; this.y = o.y + Math.sin(this.orbA) * C.orbit; this.vx = this.vy = 0; this.rot = this.orbA;
    if ((this.cd -= dt) <= 0) { this.cd = C.cd; this.shootAt(Math.atan2(p.y - this.y, p.x - this.x), 260, 5, 10); }
    return true;
  },
  gunboat(dt, p, dx, dy, d) {  // 停在 420～520 外；每 3 秒閃 0.6 秒後從 8 根砲管各射一發慢速彈（砲塔 rot 慢慢轉）
    if (this.mode === 'windup') {
      this.modeT -= dt; this.brake(dt); this.move(dt);
      if (this.modeT <= 0) {
        this.mode = 'chase'; this.cd = 3;
        for (let i = 0; i < 8; i++) { const a = this.rot + i / 8 * TAU; Game.eBullets.push({ x: this.x + Math.cos(a) * this.r * 1.3, y: this.y + Math.sin(a) * this.r * 1.3, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 6, dmg: 10, life: 5, from: this.t.name }); }
        Events.emit('enemyShot', this);
      }
      return true;
    }
    let [mx, my] = this.chaseDir(p, dx, dy, d);
    if (d < 420) { mx = -dx / d; my = -dy / d; }
    else if (d < 520) { const s = Math.sin(this.phase) > 0 ? 1 : -1; mx = -dy / d * s * 0.5; my = dx / d * s * 0.5; }
    this.cd -= dt * endlessAtk();
    if (this.cd <= 0 && d < 750 && !Objects.inHole(this)) { this.mode = 'windup'; this.modeT = 0.6; }
    this.steerMove(dt, mx, my, this.t.speed);
    return true;
  },
  worm(dt, p, dx, dy, d) {  // 頭：蛇行追過來；身體：跟著前一節（間距 22）
    while (this.ahead && this.ahead.dead) this.ahead = this.ahead.ahead;
    const A = this.ahead;
    if (!A) {
      // 越短越快：整條 6 節是原本速度，每少一節 +16%，只剩頭 ×1.8（身體照頭的倍率跟上）
      const headOf = o => { let h = o; for (let q = o.ahead; q; q = q.ahead) if (!q.dead) h = q; return h; };  // 往前找最前面還活著的那節（跳過中間死掉的）
      const len = Game.enemies.reduce((n, o) => n + (o.type === 'worm' && !o.dead && headOf(o) === this ? 1 : 0), 0);
      this.wormMul = 1 + CFG.WORM_FAST * Math.max(0, 6 - len) / 5;
      const [bx, by] = this.chaseDir(p, dx, dy, d), w = Math.sin(Game.time * 4 + this.phase) * 0.8;
      this.steerMove(dt, bx - by * w, by + bx * w, this.t.speed * this.wormMul);
      return true;
    }
    let H = A; for (let q = A.ahead; q; q = q.ahead) if (!q.dead) H = q;
    const sp = this.t.speed * (H.wormMul || 1), ax = A.x - this.x, ay = A.y - this.y, ad = Math.hypot(ax, ay) || 1;
    // 被擋住跟不上（CFG.WORM_CUT）：斷開自己當頭，照頭的走法尋路、脫困（後面的節跟著牠）
    //   （2026-10-18 整局模擬：身體直線跟前一節，被兩顆小行星擋在凹洞裡，前面的節走遠了也一直卡著）
    const C = CFG.WORM_CUT;
    if (ad > C.gap && ((Game.objs.length && Objects.losBlocked(this.x, this.y, A.x, A.y, this.r * 0.8)) || Arena.losBlocked(this.x, this.y, A.x, A.y, this.r * 0.8))) {
      if ((this.cutT = (this.cutT || 0) + dt) > C.t) { this.ahead = null; this.cutT = 0; return THEME_AI.worm.call(this, dt, p, dx, dy, d); }
    } else this.cutT = 0;
    this.steerMove(dt, ax, ay, ad > 22 ? sp * Math.min(1.6, ad / 22) : sp * 0.3, 8);
    return true;
  },
  lurker(dt, p, dx, dy, d) {  // 隱形接近 → 離 140 內現形 0.4 秒（預警線）→ 撲過去 0.4 秒 → 現形 2 秒 → 再隱形
    this.cloak = this.mode === 'stalk' ? Math.min(1, this.cloak + dt * 2) : 0;
    if (this.mode === 'windup') {
      this.modeT -= dt; this.brake(dt); this.move(dt);
      if (this.modeT > 0.15) this.chargeA = Math.atan2(dy, dx);
      if (this.modeT <= 0) { const C = CFG.CHARGE.lurker; this.mode = 'charge'; this.modeT = C.t; this.vx = Math.cos(this.chargeA) * C.speed; this.vy = Math.sin(this.chargeA) * C.speed; }
      return true;
    }
    if (this.mode === 'charge') { this.modeT -= dt; this.move(dt); if (this.modeT <= 0) { this.mode = 'shown'; this.modeT = 2; this.vx = this.vy = 0; } return true; }  // 撲完停住（不滑出預警線）
    if (this.mode === 'shown' && (this.modeT -= dt) <= 0) this.mode = 'stalk';
    if (this.mode === 'stalk' && d < 140 && this.cloak >= 1 && !Objects.inHole(this)) { this.mode = 'windup'; this.modeT = 0.4; this.chargeA = Math.atan2(dy, dx); return true; }
    const [mx, my] = this.chaseDir(p, dx, dy, d);
    this.steerMove(dt, mx, my, this.t.speed);
    return true;
  },
  treasure(dt, p, dx, dy, d) {  // 寶藏無人機：往離最近玩家的反方向逃、左右閃；出場 CFG.TREASURE.life 秒沒打掉就躍遷離開
    const T = CFG.TREASURE;
    if (!this.age) bannerFx('寶藏無人機出現', `${T.life} 秒內打掉有額外獎勵（金色箭頭指著它）`, 1.6);
    if ((this.age = (this.age || 0) + dt) >= T.life) { Game.treasureEscape(this); return true; }
    this.modeT = T.life - this.age;  // 還剩幾秒（同步給隊友：畫面最後幾秒閃）
    this.flee(dt, dx, dy, d, this.t.speed * (d < T.near ? 1 : T.farMul), 0.5);
    return true;
  },
  alarm(dt, p, dx, dy, d) {  // 警報艇：沒被打到時在出生點附近晃（不追、不攻擊）；被打到（hurt 設 ringT）開始響、往遠離玩家的方向逃，
    //   倒數 CFG.ALARM.delay 秒後每 every 秒叫醒身邊 r 以內待機的敵人（Game.alarmPulse），一直響到被打掉
    const A = CFG.ALARM;
    if (this.ringT == null) { this.modeT = 0; this.wander(dt); return true; }
    if ((this.ringT -= dt) <= 0) { this.ringT += A.every; Game.alarmPulse(this); }
    this.modeT = this.rang ? 0.01 : Math.max(0.01, this.ringT);  // 響著（同步給隊友：畫面閃紅）；還沒叫過人 = 倒數剩幾秒
    this.flee(dt, dx, dy, d, A.flee, 0.3);
    return true;
  },
  hive(dt) {  // 不會動（擊退、吸引都推不動）；每 4 秒生 2 隻蟲群（同時最多 8 隻）
    this.vx = 0; this.vy = 0;
    this.cd -= dt * endlessAtk();
    if (this.cd > 0) return true;
    this.cd = 4;
    this.kids = (this.kids || []).filter(k => !k.dead);
    for (let i = 0; i < 2 && this.kids.length < 8; i++) {
      const a = rand(0, TAU), k = new Enemy('swarmer', ...Arena.clampIn(this.x + Math.cos(a) * 45, this.y + Math.sin(a) * 45, 40), this.hpScale);
      k.summoned = true; k.noPlay = true;  // 不掉晶體、不算玩法擊殺（不然可以一直刷）
      k.zone = this.zone; k.alert = this.alert; if (!k.alert) k.home = [this.x, this.y];  // 母巢待機：生出來的在母巢旁邊晃，母巢醒了一起醒（Game.wakeEnemy）
      this.kids.push(k); Game.enemies.push(k);
    }
    burst(this.x, this.y, this.t.color, 10, 120, 0.4, 2);
    return true;
  },
};

// 星環守門者的砲塔：釘在核心旁邊、跟著核心轉（slotA = 在核心的哪個角度）；照 t.turret 出招，核心暴走時出招間隔 × rageCd
function wardenTurret(dt) {
  const c = this.core, W = CFG.WARDEN, T = this.t.turret;
  this.vx = this.vy = 0;
  if (c && !c.dead) { const a = c.rot + this.slotA, R = c.r + W.turretR; this.x = c.x + Math.cos(a) * R; this.y = c.y + Math.sin(a) * R; this.rot = a; }
  this.cd -= dt * endlessAtk() / (c && c.enraged ? W.rageCd : 1);
  if (this.cd <= 0) { this.cd = T.cd; TURRET_FIRE[this.type].call(this, Game.nearestPlayer(this.x, this.y) || Game.player); Events.emit('enemyShot', this); }
  return true;
}
for (const k of Object.keys(ENEMY_TYPES)) if (ENEMY_TYPES[k].turret) THEME_AI[k] = wardenTurret;

// 旗艦平常的移動（沒在蓄力、衝鋒時）：有寫的照這裡，沒寫的照 updateBoss 原本的（跟玩家保持距離、慢慢繞）。this = 旗艦
const BOSS_MOVE = {
  // 雙子獵艦：兩艘回到隊形上自己的位置（中心 pair.x/y 的兩端）；中心、轉角由主艦每幀算一次
  boss4(dt, rage) {
    const C = CFG.TWIN, P = this.pair;
    if (!P) { this.vx = this.vy = 0; return; }  // 沒有隊形（靶場手動生的）：不動
    if (!this.share && P.at !== Game.time) {
      P.at = Game.time;
      const q = Game.nearestPlayer(P.x, P.y) || Game.player, vx = q.x - P.x, vy = q.y - P.y, l = Math.hypot(vx, vy) || 1, s = Math.min(l, C.drift * endlessSpd() * dt);
      [P.x, P.y] = Arena.clampIn(P.x + vx / l * s, P.y + vy / l * s, C.orbit + 40);  // 中心離牆至少轉圈半徑：兩艘都在空地上（不然一艘卡在牆裡）
      const S = CFG.BOSS_SKILL.sweep, sw = P.sweepT > 0 ? ((P.sweepT -= dt) > S.t ? 0.3 : S.mul) : 1;  // 光束橫掃：先慢下來 warn 秒，再快轉
      P.ang += dt * (rage ? C.spinRage : C.spin) * endlessAtk() * P.dir * sw;
    }
    const a = P.ang + (this.share ? Math.PI : 0), ax = P.x + Math.cos(a) * C.orbit - this.x, ay = P.y + Math.sin(a) * C.orbit - this.y;
    const l = Math.hypot(ax, ay) || 1, sp = Math.min(380, l * 5) * this.spdMul, k = Math.min(1, dt * 6);
    this.vx += (ax / l * sp - this.vx) * k; this.vy += (ay / l * sp - this.vy) * k;
    this.move(dt);
  },
  // 星環守門者：不動；核心跟著光束轉（rot），光束的開／停照 cd 倒數（syncCd：同步給隊友畫）
  boss5(dt, rage) {
    const W = CFG.WARDEN;
    this.vx = this.vy = 0;
    this.rot += dt * (rage ? W.spinRage : W.spin) * endlessAtk() * (this.spinDir || 1);  // spinDir：光束反轉（BOSS_SKILL.reverse）
    if ((this.cd -= dt) <= 0) this.cd += W.beam + W.rest;  // cd > rest：光束開著；cd < warn：快開了（預警線）
  },
};

// 王的專屬新招（使用者 10-24，數值 CFG.BOSS_SKILL）：cast = 出招那一下（this = 王；雙子獵艦是主艦，兩艘一起處理）
//   mode = 出招後的狀態（this.mode 跟招式同名），每幀在 updateBoss 跑，取代平常的移動；結束時改回 'chase'
const bossFoe = e => Game.lockFoe(e);  // 招式的目標：多人時鎖定的人，不然最近的玩家
const BOSS_SKILL = {
  devour: {  // 星噬母艦・吞噬：停下來把附近的玩家往自己吸（被吸的船在自己的電腦上拉：Game.beamPull），同時放螺旋彈
    cast(rage) {
      const C = CFG.BOSS_SKILL.devour;
      this.mode = 'devour'; this.modeT = C.t; this.fireAcc = 0;
      this.stream = { t: C.t, every: rage ? 0.06 : 0.09, arms: 2, turn: 0.3, spd: 170, r: 5, dmg: 12 };
      this.skillCd = C.t + (rage ? 1 : 1.6);
    },
    mode(dt) { this.brake(dt); this.move(dt); if ((this.modeT -= dt) <= 0) this.mode = 'chase'; },
  },
  egg: {  // 星噬母艦・孵化囊：丟卵到四周（孵化在 THEME_AI.egg）
    cast(rage) {
      const C = CFG.BOSS_SKILL.egg, n = C.n + (rage ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + rand(0, 1), [x, y] = Arena.clampIn(this.x + Math.cos(a) * C.dist, this.y + Math.sin(a) * C.dist, 40);
        const e = new Enemy('egg', x, y, this.hpScale * C.hp); e.summoned = true; e.noPlay = true; e.alert = true; e.modeT = C.hatch; e.spawnT = e.spawnMax = 0.3; Game.enemies.push(e);  // 出場動畫短一點（動畫中不倒數）
      }
      burst(this.x, this.y, this.t.color, 24, 200, 0.5, 2);
      this.skillCd = rage ? 2.6 : 3.2;
    },
  },
  rift: {  // 裂界獵艦・裂隙突襲：隱形，落點（rx, ry：目標背後，跟著目標更新）畫裂縫；時間到從那裡冒出來，短蓄力後衝鋒
    cast(rage) { this.mode = 'rift'; this.modeT = CFG.BOSS_SKILL.rift.t; this.skillCd = rage ? 2.6 : 3.2; },
    mode(dt) {
      const C = CFG.BOSS_SKILL.rift, q = bossFoe(this), a = q.aim || 0;
      [this.rx, this.ry] = Arena.clampIn(q.x - Math.cos(a) * C.back, q.y - Math.sin(a) * C.back, this.r + 10);
      this.vx = this.vy = 0; this.cloak = 1;
      if ((this.modeT -= dt) > 0) return;
      burst(this.x, this.y, this.t.color, 20, 220, 0.4, 2);
      this.x = this.rx; this.y = this.ry; this.cloak = 0;
      this.mode = 'windup'; this.modeT = C.windup; this.chargeA = Math.atan2(q.y - this.y, q.x - this.x);
      burst(this.x, this.y, this.t.color, 30, 260, 0.5, 3); Game.shake(5);
    },
  },
  scar: {  // 裂界獵艦・空間裂痕：一般的衝鋒，衝的時候沿路留下不會動的敵彈（updateBoss 的衝鋒看 scarOn）
    cast(rage) { const q = bossFoe(this); this.mode = 'windup'; this.modeT = rage ? 0.55 : 0.8; this.chargeA = Math.atan2(q.y - this.y, q.x - this.x); this.scarOn = true; this.skillCd = rage ? 2.4 : 3; },
  },
  overload: {  // 終焉核心・過載脈衝：停下來蓄力，時間到 r 內看得到核心的人受傷（牆、柱子、行星、小行星擋得住）
    cast(rage) { const C = CFG.BOSS_SKILL.overload; this.mode = 'overload'; this.modeT = C.t; this.skillCd = C.t + (rage ? 1 : 1.6); },
    mode(dt) {
      this.brake(dt); this.move(dt);
      if ((this.modeT -= dt) > 0) return;
      const C = CFG.BOSS_SKILL.overload; this.mode = 'chase';
      for (const p of Game.players()) {
        if (dist2(p.x, p.y, this.x, this.y) > (C.r + p.r) ** 2) continue;
        if (Arena.losPoint(this.x, this.y, p.x, p.y, 4) || (Game.objs.length && Objects.losBlocked(this.x, this.y, p.x, p.y, 4))) continue;
        Game.hurtPlayer(C.dmg, this.t.name + '（過載脈衝）', p, this.x, this.y);
      }
      ringFx(this.x, this.y, C.r, this.t.color); burst(this.x, this.y, this.t.color, 60, 420, 0.6, 3); Game.shake(10); Events.emit('explode', this);
    },
  },
  shard: {  // 終焉核心・核心碎片：碎片繞著核心轉、朝玩家射（THEME_AI.core_shard）
    cast(rage) {
      const C = CFG.BOSS_SKILL.shard;
      for (let i = 0; i < C.n; i++) {
        const e = new Enemy('core_shard', this.x, this.y, this.hpScale * C.hp);
        e.summoned = true; e.noPlay = true; e.alert = true; e.spawnT = e.spawnMax = 0.3; e.owner = this; e.orbA = i / C.n * TAU; e.modeT = C.t; e.cd = C.cd * (0.5 + i / C.n);
        Game.enemies.push(e);
      }
      burst(this.x, this.y, this.t.color, 30, 260, 0.5, 2);
      this.skillCd = rage ? 2.8 : 3.4;
    },
  },
  xcharge: {  // 雙子獵艦・交叉衝鋒：兩艘同時蓄力、各自朝目標衝（從兩側交叉成 X）
    cast(rage) {
      for (const s of this.pair ? this.pair.members.filter(o => !o.dead) : [this]) { const q = bossFoe(s); s.mode = 'windup'; s.modeT = rage ? 0.6 : 0.85; s.chargeA = Math.atan2(q.y - s.y, q.x - s.x); }
      this.skillCd = rage ? 2.4 : 3;
    },
  },
  sweep: {  // 雙子獵艦・光束橫掃：隊形先慢下來（warn），再轉得很快（BOSS_MOVE.boss4 看 pair.sweepT），中間的光束掃過去
    cast(rage) { const C = CFG.BOSS_SKILL.sweep; if (this.pair) this.pair.sweepT = C.warn + C.t; this.skillCd = C.warn + C.t + (rage ? 0.6 : 1); },
  },
  cage: {  // 星環守門者・封鎖環：能量牆從外圈往內收（半徑照 modeT 算，隊友那邊照同步的 modeT 畫），牆外的人每 every 秒受傷
    cast(rage) { const C = CFG.BOSS_SKILL.cage; this.mode = 'cage'; this.modeT = C.t; this.cageTick = C.every; this.skillCd = C.t + (rage ? 0.8 : 1.4); },
    mode(dt, rage) {
      BOSS_MOVE.boss5.call(this, dt, rage);
      const C = CFG.BOSS_SKILL.cage, R = cageR(this);
      if ((this.cageTick -= dt) <= 0) { this.cageTick += C.every; for (const p of Game.players()) if (dist2(p.x, p.y, this.x, this.y) > R * R) Game.hurtPlayer(C.dmg, this.t.name + '（封鎖環）', p, p.x, p.y); }
      if ((this.modeT -= dt) <= 0) this.mode = 'chase';
    },
  },
  reverse: {  // 星環守門者・光束反轉：光束閃警告（Game.bossBeams 的 rev），時間到反方向轉（spinDir）
    cast(rage) { this.mode = 'reverse'; this.modeT = CFG.BOSS_SKILL.reverse.warn; this.skillCd = rage ? 2.4 : 3; },
    mode(dt, rage) { BOSS_MOVE.boss5.call(this, dt, rage); if ((this.modeT -= dt) <= 0) { this.spinDir = -(this.spinDir || 1); this.mode = 'chase'; Game.shake(4); } },
  },
};
// 封鎖環現在的半徑（畫面也用）：modeT 從 t 倒數到 0，半徑從 r0 收到 r1
const cageR = e => { const C = CFG.BOSS_SKILL.cage; return C.r1 + (C.r0 - C.r1) * clamp(e.modeT / C.t, 0, 1); };

// 每秒轉幾弧度（e.rot：虛空獵手環形彈的起始角、彈幕艇的砲塔；畫面也用）
const ENEMY_SPIN = { brute: 0.8, elite: 1.5, boss: 0.4, gunboat: 0.5 };

// 精英的行為（詞綴在 affixTick 先跑過）：this = 敵人；p = 目標（最近的玩家或殘影）；dx, dy, d = 往目標的向量和距離
//   回傳 true = 這一幀的移動處理完了；false = 照 Enemy.update 下面的一般追擊
const ELITE_AI = {
  elite(dt, p, dx, dy, d) {  // 虛空獵手：蓄力衝鋒／兩圈環形彈輪流
    if (this.mode === 'windup') {
      this.modeT -= dt; this.brake(dt); this.move(dt);
      if (this.modeT <= 0) {
        const C = CFG.CHARGE.elite;
        this.mode = 'charge'; this.modeT = C.t;
        this.vx = Math.cos(this.chargeA) * C.speed; this.vy = Math.sin(this.chargeA) * C.speed;
      }
      return true;
    }
    if (this.mode === 'charge') {
      this.modeT -= dt; this.move(dt);
      trail(this.x, this.y, this.t.color, 0.3, 6);
      if (this.modeT <= 0) { this.mode = 'chase'; this.vx = this.vy = 0; }  // 衝完停住（不滑出預警線）
      return true;
    }
    // 環形彈：20 發，0.35 秒後錯開半格再放一圈（兩圈之間有縫可以鑽）
    const ring = off => { for (let i = 0; i < 20; i++) this.eShot(this.x, this.y, (i + off) / 20 * TAU + this.rot, 200, 14); };
    if (this.ring2T > 0 && (this.ring2T -= dt) <= 0) ring(0.5);
    this.skillCd -= dt * this.atkRate();
    if (this.skillCd <= 0 && !Objects.inHole(this)) {
      this.skillCd = 2.2;
      if (this.nextSkill === 'charge') { this.mode = 'windup'; this.modeT = 0.65; this.chargeA = Math.atan2(dy, dx); this.nextSkill = 'ring'; }
      else { ring(0); this.ring2T = 0.35; this.nextSkill = 'charge'; }
    }
    return false;
  },
  // 砲艦：保持距離（太近就逃，被逼到牆角最好打）；蓄力後砲擊幾個落點（紅圈，Game.zones）；被追到身邊會近身散射
  artillery(dt, p, dx, dy, d) {
    const A = CFG.ARTILLERY, rate = this.atkRate();
    if (this.mode === 'windup') {
      this.modeT -= dt; this.brake(dt); this.move(dt);
      this.chargeA = Math.atan2(dy, dx);
      if (this.modeT <= 0) { this.mode = 'chase'; Game.artilleryVolley(this, p); }
      return true;
    }
    this.shotCd = (this.shotCd || 0) - dt * rate;
    if (d < A.near && this.shotCd <= 0) { this.shotCd = A.shotCd; this.fan(Math.atan2(dy, dx), A.shot, A.arc, A.speed, A.sdmg); }
    this.skillCd -= dt * rate;
    if (this.skillCd <= 0 && d < A.keep[1] + 250 && !Objects.inHole(this)) {
      this.skillCd = A.cd; this.mode = 'windup'; this.modeT = A.windup; this.chargeA = Math.atan2(dy, dx);
      return true;
    }
    if (d < A.flee) { this.flee(dt, dx, dy, d, this.t.speed * 1.15, 0.3); return true; }
    let [mx, my] = this.chaseDir(p, dx, dy, d);
    if (d < A.keep[1]) {  // 在射程裡：橫著繞；比 keep[0] 近就邊繞邊退
      const s = Math.sin(this.phase) > 0 ? 1 : -1;
      mx = -dy / d * s - (d < A.keep[0] ? dx / d * 0.6 : 0); my = dx / d * s - (d < A.keep[0] ? dy / d * 0.6 : 0);
    }
    this.steerMove(dt, mx, my, this.t.speed);
    return true;
  },
  // 拖曳艦：鎖定（aim，預警線）→ 牽引（pull：被拉的那艘船在自己的電腦上被拉，見 Game.beamPull）→ 拉完立刻近身散射
  //   目標衝刺、被擋住、跑太遠就斷掉（stun）。tgt = 目標的號碼（同步給隊友）、tgtP = 目標的飛船（房主這邊）
  tractor(dt, p, dx, dy, d) {
    const T = CFG.TRACTOR, rate = this.atkRate();
    if (this.mode === 'stun') {
      this.modeT -= dt; this.brake(dt, CFG.TRACTOR.stunBrake); this.move(dt);
      if (this.modeT <= 0) this.mode = 'chase';
      return true;
    }
    if (this.mode === 'aim' || this.mode === 'pull') {
      const q = this.tgtP, alive = q && !q.dead && !q.gone, qd = alive ? Math.hypot(q.x - this.x, q.y - this.y) : Infinity;
      if (!alive || qd > T.lose || this.losTo(q) || (this.mode === 'pull' && q.dashT > 0)) { this.breakBeam(alive && this.mode === 'pull' && q.dashT > 0); return true; }
      this.chargeA = Math.atan2(q.y - this.y, q.x - this.x);
      this.brake(dt); this.move(dt);
      if ((this.modeT -= dt) <= 0) {
        if (this.mode === 'aim') { this.mode = 'pull'; this.modeT = T.pull; Events.emit('tractorPull', this); }
        else { this.mode = 'chase'; this.tgt = 0; this.tgtP = null; this.shotCd = 0; }  // 拉完：沒掙脫就馬上吃近身散射
      }
      return true;
    }
    this.shotCd = (this.shotCd || 0) - dt * rate;
    if (d < T.near && this.shotCd <= 0) { this.shotCd = T.shotCd; this.fan(Math.atan2(dy, dx), T.shot, T.arc, T.bspeed, T.bdmg); }
    this.skillCd -= dt * rate;
    if (this.skillCd <= 0 && !p.decoy && d > T.range[0] && d < T.range[1] && !Objects.inHole(this)) {
      if (this.losTo(p)) this.skillCd = 0.3;  // 看不到：等一下再試
      else { this.skillCd = T.cd; this.mode = 'aim'; this.modeT = T.aim; this.tgtP = p; this.tgt = Game.slotOf(p); this.chargeA = Math.atan2(dy, dx); return true; }
    }
    let [mx, my] = this.chaseDir(p, dx, dy, d);
    if (d < 260) { const s = Math.sin(this.phase) > 0 ? 1 : -1; mx = -dy / d * s; my = dx / d * s; }
    this.steerMove(dt, mx, my, this.t.speed);
    return true;
  },
  // 編隊艦：同一隊（fleet）的幾艘繞著共同的中心轉；中心、開火由每幀第一艘更新的算一次（F.at）
  //   F.mode 'windup' = 交叉齊射蓄力中（每艘的 mode、chargeA 照這個設，畫面畫預警線）
  wing(dt, p, dx, dy, d) {
    const W = CFG.WING, F = this.fleet;
    if (!F) return false;  // 沒有編隊（靶場不動的）：照一般追擊（速度 0）
    if (F.at !== Game.time) {
      F.at = Game.time;
      F.members = F.members.filter(m => !m.dead);
      const n = F.members.length, lost = this.t.fleet - n, rate = this.atkRate();
      F.ang += dt * W.spin * (1 + W.lost * lost) * (this.alert ? 1 : 0.4);
      if (this.alert) {
        const cx = p.x - F.x, cy = p.y - F.y, cd = Math.hypot(cx, cy) || 1;
        let mx = cx / cd, my = cy / cd;
        if (cd < W.keep[0]) { mx = -mx; my = -my; }
        else if (cd < W.keep[1]) { mx = -cy / cd * F.side * 0.6; my = cx / cd * F.side * 0.6; }
        const sp = W.speed * endlessSpd();
        [F.x, F.y] = Arena.clampIn(F.x + mx * sp * dt, F.y + my * sp * dt, W.radius + 20);
        if ((F.fireT -= dt * rate) <= 0) {
          F.fireT = W.fireCd * (1 - W.fireLost * lost);
          for (const m of F.members) if (!(m.spawnT > 0)) m.eShot(m.x, m.y, Math.atan2(p.y - m.y, p.x - m.x), W.bspeed, W.bdmg, 5);
          Events.emit('enemyShot', this);
        }
        if (F.mode === 'windup') {
          if ((F.modeT -= dt) <= 0) {
            F.mode = 'form';
            for (const m of F.members) for (let i = 0; i < W.line; i++) m.eShot(m.x, m.y, m.chargeA, W.lineSpd[0] + (W.lineSpd[1] - W.lineSpd[0]) * i / Math.max(1, W.line - 1), W.bdmg, 6);
            Events.emit('enemyShot', this);
          }
        } else if ((F.crossT -= dt * rate) <= 0 && !Objects.inHole(this)) { F.crossT = W.crossCd; F.mode = 'windup'; F.modeT = W.windup; F.aim = [p.x, p.y]; }
      }
      F.members.forEach((m, i) => {
        m.slotA = F.ang + i / n * TAU;
        if (F.mode === 'windup') { m.mode = 'windup'; m.modeT = F.modeT; m.chargeA = Math.atan2(F.aim[1] - m.y, F.aim[0] - m.x); } else m.mode = 'chase';
      });
    }
    const ax = F.x + Math.cos(this.slotA) * W.radius - this.x, ay = F.y + Math.sin(this.slotA) * W.radius - this.y;
    this.steerMove(dt, ax, ay, Math.min(320, Math.hypot(ax, ay) * 6), 8);  // 回到自己在隊形裡的位置（被擊退也會歸隊）
    return true;
  },
};
