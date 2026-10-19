// 星環電路 雙人版 · entities.js：Player、Bullet、敵人種類 ENEMY_TYPES 與 Enemy（含旗艦技能）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// ENTITIES
// =====================================================================
// 衝刺：戰鬥的飛船（Player）和基地的飛船（Hub.ship）共用同一套——按鍵、冷卻、速度、時間、先鋒號的瞬移都在這裡
//   o 要有 x, y, aim, ship（SHIPS 的那艘）、dashT, dashCd, dashA；衝刺的起點記在 dashSX, dashSY（星門號開門、殘影、砲台用）
//   各自的效果（粒子、殘影、砲台、星門、傷害）由呼叫的人在 input 回傳 true 時做
const Dash = {
  // 每幀：冷卻倒數；按了衝刺鍵（或按住、冷卻一好）就開始衝 → 回傳 true。dir = 衝的方向；cd = 這次的冷卻；hold = 按住可以連衝
  //   free(x, y)：先鋒號瞬移的落點能不能放（戰鬥：場地、區域、障礙物；基地：房間和開口裡）
  input(o, dt, dir, cd, hold, free) {
    o.dashCd -= dt;
    if (!(Input.dash || (hold && Input.dashHeld && o.dashCd <= 0))) return false;  // 按住衝刺鍵：冷卻一好就再衝（不靠系統的按鍵重複，按別的鍵也不會斷）
    Input.dash = false;
    if (o.dashCd > 0) return false;
    o.dashT = CFG.DASH_TIME; o.dashCd = cd; o.dashA = dir;
    o.dashSX = o.x; o.dashSY = o.y;  // 衝刺起點：在瞬移之前記
    if (o.ship.ability === 'phase') this.phase(o, free);
    return true;
  },
  // 先鋒號・相位跳躍：朝 dashA 瞬移 CFG.PHASE.dist（落點不能放就往回找最遠的），之後停 CFG.PHASE.t（算衝刺中）
  phase(o, free) {
    const c = Math.cos(o.dashA), s = Math.sin(o.dashA);
    for (let d = CFG.PHASE.dist; d > 0; d -= 4) if (free(o.x + c * d, o.y + s * d)) { o.x += c * d; o.y += s * d; break; }
    o.dashT = CFG.PHASE.t;
  },
  // 衝刺中：照 dashA 衝（先鋒號已經瞬移過去，剩下的時間停在落點）；回傳這一幀是不是在衝
  move(o, dt) {
    if (!(o.dashT > 0)) return false;
    o.dashT -= dt;
    const sp = o.ship.ability === 'phase' ? 0 : CFG.DASH_SPEED;
    o.vx = Math.cos(o.dashA) * sp; o.vy = Math.sin(o.dashA) * sp;
    return true;
  },
};

class Player {
  constructor(ship) {
    this.ship = ship;
    this.r = ship.radius; this.hp = this.maxHp = ship.hp;
    this.resetPos();
  }
  resetPos() {
    this.x = Arena.start.x; this.y = Arena.start.y; this.vx = 0; this.vy = 0; this.zone = 0;  // zone：大地圖上在第幾區（閘門用）
    this.iframe = 0; this.fireCd = 0; this.aim = 0; this.moving = false;
    this.dashT = 0; this.dashCd = 0; this.dashA = 0; this.overdrive = 0; this.target = null;
    this.reviveT = 0;  // 雙人：倒下後隊友救援的進度（秒）
    // V2 晶片：蓄力進度（0～1）、超頻模組的連續射擊秒數與過熱停火秒數、衝刺狀態（衝刺射擊／流星用）
    this.chargeC = 0; this.ohT = 0; this.ohLock = 0;
    this.wasDash = false; this.dashDir = 0; this.dashHit = new Set(); this.dx0 = this.x; this.dy0 = this.y;
  }
  // 開火（房主執行；隊友的飛船要在 withLoadout(隊友配裝) 裡呼叫）：超頻模組過熱、蓄力、一般連射
  tickFire(dt, want) {
    const S = Game.stats, held = want;
    this.fireCd -= dt;
    if (S.heatLimit) {
      if (this.ohLock > 0) { this.ohLock -= dt; want = false; }
      else if (want) {
        this.ohT += dt;
        if (this.ohT >= S.heatLimit) { this.ohLock = 1.5; this.ohT = 0; burst(this.x, this.y, '#ff9f1c', 14, 160, 0.5, 3); Events.emit('overheat', this); }
      } else this.ohT = Math.max(0, this.ohT - dt * 1.5);
    } else { this.ohT = 0; this.ohLock = 0; }
    // 停火蓄力：沒按射擊時累積，再按下的第一發依蓄力程度變強（之後照常連射）
    if (!S.charge) this.chargeC = 0;
    else if (!held) this.chargeC = Math.min(1, this.chargeC + dt / S.chargeTime);
    this.quenchT -= dt;
    // 架設：站著不動 2 秒疊滿，每層射速 +10%（Lv1 最多 6 層、Lv2 起 8 層），移動或衝刺超過 0.15 秒就歸零
    if (!S.stand) { this.standT = 0; this.standMv = 0; }
    else if (this.moving || this.dashT > 0) { this.standMv = (this.standMv || 0) + dt; if (this.standMv > 0.15) this.standT = 0; }
    else { this.standMv = 0; this.standT = (this.standT || 0) + dt; }
    if (want && this.fireCd <= 0) {
      const M = Game.mech, sk = standStacks(this, S.stand), rate = (M.rate + (M.traits.gale && this.moving ? 0.2 : 0) + (this.quenchT > 0 ? 0.3 : 0) + hpRateAdd(this) + 0.1 * sk + weaponRateAdd(this) + rareRateAdd(this)) * M.rateMul;  // 射速增加相加（散熱片、疾風、急冷、裝甲供能、架設、武器升級的群戰／分散／擦彈／狂怒、稀有詞條的狂熱），減少相乘
      Game.standFull = !!S.stand && sk >= standMax(S.stand);
      if (Game.standFull && !this.standWas) Game.rareAct('stand', this.x, this.y, Game.shooter || null);  // 稀有晶片：架設發動（疊滿後的第一發）
      this.standWas = Game.standFull;
      Game.chargeC = S.charge ? this.chargeC : null; Game.heatC = S.heatLimit ? this.ohT / S.heatLimit : null;  // 超頻：熱度越高越痛
      try { this.fire(); } finally { Game.chargeC = null; Game.heatC = null; Game.standFull = false; }
      if (Game.wp.static) this.staticK = 0;  // 靜電（軌道升級）：充的電射出去就用掉
      // 這一幀多過的時間留到下一發（以前直接設成間隔，多過的被丟掉：射速會照幀率變慢，60Hz 和 144Hz 不一樣）；
      //   停火一陣子再按不會累積成連發（最多帶一幀）
      this.chargeC = 0; this.fireCd = Math.max(this.fireCd, -dt) + S.interval / rate;
    }
  }
  // 衝刺相關的晶片（房主執行）：衝刺中的流星、衝刺結束時的衝刺射擊
  tickDash() {
    const dashing = this.dashT > 0, S = Game.stats;
    const phase = this.ship.ability === 'phase';  // 相位跳躍：開始衝刺時已經瞬移完，穿過的線段從衝刺起點算
    if (dashing && !this.wasDash) { this.dashHit.clear(); this.dx0 = phase ? this.dashSX : this.x; this.dy0 = phase ? this.dashSY : this.y; }
    if (dashing && !this.wasDash && phase) this.dashDir = Math.atan2(this.y - this.dashSY, this.x - this.dashSX);
    else if (dashing && Math.hypot(this.vx, this.vy) > 100) this.dashDir = Math.atan2(this.vy, this.vx);
    const mul = Game.mech.traits.assault ? 4 : 0;  // 突擊（加速器 4 層）：衝刺穿過的敵人受重擊
    if (dashing && mul) {  // 衝刺穿過的敵人受到重擊
      for (const e of Game.enemies) {
        if (e.dead || e.spawnT > 0 || this.dashHit.has(e.id)) continue;
        const rr = e.r + this.r + 4;
        if (segDist2(this.dx0, this.dy0, this.x, this.y, e.x, e.y) >= rr * rr) continue;
        this.dashHit.add(e.id);
        const dmg = Game.wp.damage * mul;
        e.hurt(dmg, Math.cos(this.dashDir) * 300, Math.sin(this.dashDir) * 300, 'shock', { src: 'ship', cr: null, owner: Game.shooter || null });
        floatText(e.x, e.y - e.r, Math.round(dmg), '#9dff6b', true);
      }
    }
    this.dx0 = this.x; this.dy0 = this.y;
    if (!dashing && this.wasDash) {  // 衝刺結束
      const M = Game.mech;
      if (M.traits.quench) this.quenchT = 2;
      if (this.ship.ability === 'portal') Game.openPortal(this, this.dashSX, this.dashSY, this.x, this.y);
    }
    if (!dashing && this.wasDash && S.dashfire) { this.dfN = S.dashfire >= 2 ? 2 : 1; this.dfAt = Game.time; }  // 衝刺射擊：衝刺結束時開槍（Lv2 連開 2 槍）
    if (this.dfN > 0 && S.dashfire && Game.time >= this.dfAt) {  // 用整條電路朝準星開一槍（不佔射擊冷卻，傷害 +50%，流星 +100% 且無限穿透；會用掉停火蓄力）
      this.dfN--; this.dfAt = Game.time + 0.12;
      Game.fireMode = 'dashfire'; Game.chargeC = S.charge ? this.chargeC : null;
      let list;
      try { list = runOps(S.ops, 0); } finally { Game.fireMode = null; Game.chargeC = null; }
      for (const s of list) s.src = 'dashfire';  // 傷害統計：衝刺結束這一槍算衝刺射擊的
      this.chargeC = 0;
      if (list.length) { spawnShots(list, this.x + Math.cos(this.aim) * 4, this.y + Math.sin(this.aim) * 4, this.aim, 0, null); Game.rareAct('dashfire', this.x, this.y, Game.shooter || null); }  // 稀有晶片：衝刺射擊發動
    }
    this.wasDash = dashing;
  }
  onDash() {  // 衝刺開始（房主執行；隊友的衝刺由房主在隊友的配裝下執行）：排熱爆發、幻影號的殘影
    if (Net.role === 'client') return;
    if (this.ship.ability === 'decoy') Game.addDecoy(this, this.dashSX != null ? this.dashSX : this.x, this.dashSY != null ? this.dashSY : this.y);
    if (this.ship.ability === 'turret') Game.addTurret(this, this.dashSX != null ? this.dashSX : this.x, this.dashSY != null ? this.dashSY : this.y);
    if (this.ship.ability === 'phase' && this !== Game.player) this.phaseFx();  // 隊友的瞬移在隊友那邊算：房主畫出來並轉給其他人（自己的在 update 畫）
    if (Game.mech.traits.vent) {  // 排熱爆發（散熱片 4 層）：朝四周放出 12 發
      const w = Game.wp, list = Array.from({ length: 12 }, (_, i) => shot({ angle: i / 12 * TAU, speed: Math.min(700, w.speed), damage: w.damage,
        radius: w.radius, life: 0.6, color: '#ffb38a', shape: w.shape === 'blade' ? 'dot' : w.shape, src: 'ship' }));
      spawnShots(list, this.x, this.y, 0, 0, null);
    }
  }
  // 相位跳躍（先鋒號，Dash.phase）的落點能不能放：可以穿過牆、行星、小行星，但落點不能在裡面；
  //   不能落到別區：只能留在這一區，或穿過這一區打開的閘門到下一區（關著的閘門、走過的區域都跳不過去）
  phaseFree(x, y) {
    const r = this.r, z = Arena.rect ? 0 : this.zone != null ? this.zone : Arena.zoneOf(this.x, this.y), g = !Arena.rect && Arena.gates[z];
    const zoneOk = () => { const k = Arena.zoneOf(x, y); return k === z || (g && g.open && k === z + 1); };
    if (Arena.rect ? x < r || y < r || x > CFG.WORLD_W - r || y > CFG.WORLD_H - r : x < r || y < r || x > Arena.W - r || y > Arena.H - r || !zoneOk()) return false;
    return Objects.shipFree(this, x, y);
  }
  phaseFx() {  // 瞬移：起點收縮的圈、落點擴散的圈、中間一道電光
    const c = this.ship.color, sx = this.dashSX, sy = this.dashSY;
    ringFx(sx, sy, 28, c, true); ringFx(this.x, this.y, 34, c);
    zapFx(sx, sy, this.x, this.y, { c, life: 0.25 });
    burst(sx, sy, c, 12, 120, 0.35, 2); burst(this.x, this.y, c, 14, 200, 0.35, 2);
  }
  get invuln() { return this.iframe > 0 || this.dashT > 0; }
  update(dt) {
    const K = Input.keys, P = Game.passives;
    let mx = 0, my = 0;
    if (this.frostT > 0) this.frostT -= dt;  // 被彗星凍到：移動變慢（見 Objects.cometFrost）
    if (K.has('w') || K.has('arrowup')) my -= 1;
    if (K.has('s') || K.has('arrowdown')) my += 1;
    if (K.has('a') || K.has('arrowleft')) mx -= 1;
    if (K.has('d') || K.has('arrowright')) mx += 1;
    if (Input.joy) { const v = stickVec(Input.joy); mx = v.x; my = v.y; }
    this.moving = Math.hypot(mx, my) > 0.1;
    if (Input.touch) {
      // 右搖桿拖曳 = 手動瞄準；否則鎖定最近敵人（自動攻擊開啟時不用按也會射）
      const a = Input.aimStick, v = a && stickVec(a);
      let target = null;
      if (v && v.len > 14) this.aim = Math.atan2(v.y, v.x);
      else {
        // 自動攻擊的索敵距離依武器射程調整（近戰武器只在敵人靠近時攻擊）
        const wp = Game.wp, reach = clamp(wp.speed * wp.life + 40, 140, CFG.AUTO_RANGE);
        target = this.autoTarget(a ? 900 : reach, dt);
        if (target) this.aim = Math.atan2(target.y - this.y, target.x - this.x);
      }
      Input.down = !!a || (Input.autoFire && !!target);
      this.target = Input.down ? target : null;
      this.autoMode = !a && Input.autoFire;  // 自動攻擊：沒有「放開」，環繞轉滿就放
      this.aimD = target ? Math.hypot(target.x - this.x, target.y - this.y) : 300;
    } else {
      const wx = Input.mx / ZOOM + Game.cam.x, wy = Input.my / ZOOM + Game.cam.y;
      this.aim = Math.atan2(wy - this.y, wx - this.x);
      this.aimD = Math.hypot(wx - this.x, wy - this.y);  // 準星距離：環繞放出時朝滑鼠那一點集中
      this.autoMode = false;
    }

    if (Dash.input(this, dt, this.moving ? Math.atan2(my, mx) : this.aim, this.ship.dashCd * (1 - P.dashCd) * Game.mech.dashCd, Game.state === 'play', (x, y) => this.phaseFree(x, y))) {  // 衝刺：Dash（跟基地同一套）
      if (this.ship.ability === 'phase') { this.iframe = Math.max(this.iframe, CFG.DASH_TIME); this.phaseFx(); }  // 無敵時間跟一般衝刺一樣（停在落點的時間比較短，用 iframe 補足）
      this.dashSeq = (this.dashSeq || 0) + 1;  // 連線時告訴房主「衝刺了一次」
      burst(this.x, this.y, this.ship.color, 10, 160, 0.3, 2);
      if (Game.runStats) Game.runStats.dashes++;
      Events.emit('dash', this);
      this.onDash();
    }
    if (Dash.move(this, dt)) trail(this.x, this.y, this.ship.color, 0.25, 5);
    else if (this.kbT > 0) {  // 被彈開（盾衛的盾）：這段時間不吃操控，速度慢慢減
      this.kbT -= dt; const f = Math.max(0, 1 - dt * 4); this.vx *= f; this.vy *= f;
    } else {
      const l = Math.max(1, Math.hypot(mx, my)), spd = this.ship.speed * (1 + P.speed) * Game.mech.speed * (this.frostT > 0 ? 1 - OBJ.COMET_FROST.slow : 1), k = Math.min(1, dt * 12);
      this.vx += (mx / l * spd - this.vx) * k;
      this.vy += (my / l * spd - this.vy) * k;
    }
    Game.beamPull(this, dt);  // 拖曳艦的牽引（之後照常撞牆）
    const x0 = this.x, y0 = this.y, free0 = Objects.shipFree(this, x0, y0);
    if (Arena.rect) {
      this.x = clamp(this.x + this.vx * dt, this.r, CFG.WORLD_W - this.r);
      this.y = clamp(this.y + this.vy * dt, this.r, CFG.WORLD_H - this.r);
    } else {  // 大地圖：撞牆停住；打開的閘門可以往前穿過（穿過去就到下一區，不能回頭）
      this.x += this.vx * dt; this.y += this.vy * dt;
      Arena.collide(this, this.r, Arena.shipPass(this));
      Arena.updateZone(this);
    }
    Objects.moveShip(this, dt);  // 地圖物件：黑洞拉扯、行星與小行星擋住
    // 被兩顆小行星（或小行星和牆）輪流推、還卡在裡面 = 想擠過比飛船窄的縫 → 退回這一幀開頭（以前衝刺會擠過去、卡進凹洞出不來）
    if (free0 && !Objects.shipFree(this, this.x, this.y)) { this.x = x0; this.y = y0; }
    Game.portalShip(this, x0, y0);   // 星門：走進門從另一個門出來

    this.iframe -= dt;
    this.overdrive -= dt;
    this.wantFire = Input.down;
    if (Net.role === 'client') return;  // 連線的隊友：開火交給房主（子彈、傷害都由房主計算）
    this.tickDash();
    this.tickFire(dt, Input.down);
  }
  // 自動瞄準：最近的敵人；被牆、行星擋住打不到時，改打最近的打得到的那隻（都打不到就照樣打最近的）
  //   每 0.1 秒重選一次（沿線檢查視線，每幀算太貴），中間照原本的目標瞄
  autoTarget(range, dt) {
    const T = this.autoT;
    if ((this.autoCd = (this.autoCd || 0) - dt) > 0 && T && !T.dead && dist2(this.x, this.y, T.x, T.y) < range * range) return T;
    this.autoCd = 0.1;
    const near = nearestEnemy(this.x, this.y, range, null, true);
    let pickE = near;
    if (near && !Arena.clearLine(this.x, this.y, near.x, near.y, 4)) {
      let bd = Infinity;
      for (const e of range <= 600 ? enemiesNear(this.x, this.y, range) : Game.enemies) {
        if (e.dead || e.cloak > 0.5) continue;
        const d = dist2(this.x, this.y, e.x, e.y);
        if (d < bd && d < range * range && Arena.clearLine(this.x, this.y, e.x, e.y, 4)) { bd = d; pickE = e; }
      }
    }
    return (this.autoT = pickE);
  }

  fire() {
    const list = runOps(Game.stats.ops, 0);
    if (!list.length) return;
    const per = list.filter(s => s.orbit).length;  // 環繞：一次開火幾顆進圈 → 最多存幾顆
    if (per) this.orbMax = orbCap(list.find(s => s.orbit).orbit) * per;
    if (per === list.length && (this.orbN || 0) >= this.orbMax) return;  // 環繞存滿：按住也不再射（少了幾顆才再射，多的在 Bullet 裡丟掉）
    const nx = this.x + Math.cos(this.aim) * 16, ny = this.y + Math.sin(this.aim) * 16;
    // 子彈從船身中心附近發出：怪物貼臉時也打得到（槍口火光仍在船頭）
    spawnShots(list, this.x + Math.cos(this.aim) * 4, this.y + Math.sin(this.aim) * 4, this.aim, 0, null);
    Events.emit('shoot', { p: this, weapon: Game.weapon.id });
    burst(nx, ny, list[0].color, 3, 120, 0.15, 2);
  }
}

// 環繞：Lv1 最多存 10 發、3 秒轉到 2 倍；Lv2 起 20 發、2 秒轉到 3 倍。「一發」= 一次開火（散彈一次的全部彈丸；實際照顆數存：發數 × 一次幾顆）
const orbCap = lv => lv >= 2 ? 20 : 10;
// 速度倍率（加速）照「射程進度」算：p = 已飛距離 ÷ 射程（射程 = 出手速度 × 存活時間；加速 ×1.5），超過射程停在終點的值
//   加速 0.5 → 3（Lv2 4）；環繞放出時加速不扣起步的 0.5（疾射 2026-10-10 拿掉）
const SPD_CAP = 5;
const spdTop = lv => lv >= 2 ? 4 : 3;
const accelAdd = (lv, p, full) => !lv ? 0 : (full ? -0.5 : 0) + (spdTop(lv) - 0.5) * p;
const orbSpinOf = (lv, held) => lv >= 2 ? 1 + 2 * Math.min(1, held / 2) : 1 + Math.min(1, held / 3);
const orbSpinMax = lv => lv >= 2 ? 3 : 2;

class Bullet {
  constructor(x, y, angle, s, depth, ignoreId) {
    this.x = x; this.y = y; this.px = x; this.py = y; this.angle = angle;
    this.sx = x; this.sy = y;  // 發射點：畫尾巴時不超過已飛行的距離（不然剛射出時尾巴會從船屁股露出來）
    this.speed = s.speed; this.damage = s.damage; this.r = s.radius;
    this.pierce = s.pierce; this.bounce = s.bounce; this.homing = s.homing; this.seekAll = !!s.seekAll;  // seekAll：追蹤不限前方（分裂電漿的小電漿）
    this.life = s.life; this.color = s.color; this.shape = s.shape;
    this.payload = s.payload; this.depth = depth;
    this.explode = s.explode; this.burn = s.burn; this.shards = s.shards; this.shard = s.shard; this.arcs = s.arcs || null;
    this.slow = s.slow; this.slowDur = s.slowDur || 0; this.burnR = s.burnR || 0; this.shred = s.shred || 0; this.knock = s.knock; this.lifesteal = s.lifesteal; this.kin = s.kin || null;  // kin：動能彈頭（命中時照速度加傷害）
    this.wild = s.wild || null;  // 野火（散彈升級）：點燃的火會傳染
    this.wallhit = s.wallhit || null;  // 撞牆（散彈升級）：打飛的敵人撞到東西會受傷
    this.carpet = s.carpet || null;    // 火毯（散彈升級）：消失的地方留火
    this.focus = s.focus || null; this.skewer = s.skewer || null; this.skN = 0; this.spreadSh = s.spreadSh || false;  // 雷射升級：專注、串燒（穿過幾隻）、分散的碎光
    this.frostbite = s.frostbite || null; this.aftershock = s.aftershock || null; this.res = s.res || null;  // 電漿升級：冰封、餘震、共鳴（小電漿帶著連結）
    this.trail = s.trail || null; this.crack = s.crack || null;  // 軌道升級：殘留彈道、碎甲
    this.inferno = s.inferno || null;  // 相位刃升級：業火（燃燒疊加、疊滿爆燃）
    this.att = { src: s.src || 'weapon', cr: s.cr, owner: Game.shooter || null };  // 傷害統計歸屬（owner：雙人時是誰打的）
    this.splits = s.splits || 0;  // 被分裂過幾次（畫面上顯示殘影用）
    this.hitSet = new Set();
    if (ignoreId != null) this.hitSet.add(ignoreId);
    this.owner = Game.shooter || null;  // 雙人：這顆子彈是誰的電路射出的（null = 房主自己）
    this.ownerP = Game.shipOf(Game.shooter);  // 環繞、迴旋要跟著／飛回的飛船
    this.dead = false;
    // V2 改玩法的晶片
    this.baseSpeed = this.speed0 = s.speed;  // speed0：武器原本的速度（佈雷衝出去會改 baseSpeed，迴旋回程用這個）
    this.boom = s.boom; this.orbit = s.orbit; this.stasis = s.stasis; this.accel = s.accel; this.intercept = s.intercept; this.parry = s.parry; this.prism = s.prism;
    this.rear = s.rear; this.full = s.full; this.endBoom = s.endBoom; this.sticky = s.sticky; this.pull = s.pull;
    this.dashShot = s.dashShot; this.infGen = s.infGen || 0;
    // 傷害加成：bonus = 武器層（倍增、蓄力、速度倍率…相加），hb = 宿主層（插在玩法晶片上的倍增…）；hm = 還沒出現的產物要套用的組件（見 hostFire）
    this.bonus = s.bonus || 0; this.wsb = s.wsb || 0; this.wsbOff = s.wsbOff || 0; this.hb = s.hb || 0; this.hm = s.hm || null; this.pullMul = s.pullMul || 1;
    this.tAcc = 0; this.tN = 0;  // 定時觸發器：計時、已觸發次數
    this.mode = 'fly'; this.flyAge = 0; this.accelMul = 1; this.dashed = false;  // accelMul = 速度倍率（相對出手時；打中時加進傷害加成，最多 5）
    if (this.accel) this.life *= 1.5;  // 加速：射程 ×1.5
    // R：射程；dist：已飛距離（佈雷衝出去、迴旋回程都接著算，只有開火和環繞放出重新算）；mul0：起始倍率（環繞放出時是轉速倍率）
    this.R = this.speed0 * this.life; this.dist = 0; this.mul0 = 1; this.accFull = true;
    if (this.accel) this.setMul();
    if (s.infect) this.att.inf = { tpl: s, lv: s.infect, gen: this.infGen };  // 感染：擊殺時照這個樣板爆出子彈
    if (this.orbit && depth > 0) this.orbit = 0;  // 觸發射出的子彈不進圈（不會瞬移回飛船）
    if (this.orbit) {  // 環繞：存在飛船旁邊（上限 orbMax = Lv1 10 發、Lv2 20 發 × 一次開火幾顆；照顆數算：被敵人撞掉幾顆就補幾顆；存滿了多的丟掉）
      const o = this.ownerP;
      if (o && (o.orbN || 0) < (o.orbMax || orbCap(this.orbit))) {
        o.orbN = (o.orbN || 0) + 1;
        this.mode = 'orbit'; this.phase = angle; this.orbR = 0; this.R = 60;
        this.life0 = this.life; this.life = 99;
      } else this.dead = true;  // 存滿了：多的子彈不射出去
    }
  }
  // 速度倍率 = 起始倍率 ＋ 加速（照射程進度），0.5～5
  setMul() {
    const p = Math.min(1, this.dist / this.R), was = this.accelMul;
    this.accelMul = clamp(this.mul0 + accelAdd(this.accel, p, this.accFull), 0.5, SPD_CAP);
    if (this.accel && was < 2 && this.accelMul >= 2) Game.rareAct('accel', this.x, this.y, this.owner, this);  // 稀有晶片：加速發動（越過 2 倍速，跟玩法擊殺的條件一樣）
    this.speed = this.baseSpeed * this.accelMul;
    // 加速的產物：速度 1.5 倍以上（武器插座的傷害加成不算；掉回 1.5 倍以下時加回來）
    if (this.accelMul >= CFG.HOST_SPEED) stripW(this); else if (this.wsbOff) restoreW(this);
    if (this.hm && this.hm.accel && this.accelMul >= CFG.HOST_SPEED) hostFire(this, 'accel');  // 加速的產物：速度到 1.5 倍
  }
  // 消失觸發器：子彈消失時從這裡沿原本的方向射出回響
  endTrig(x = this.x, y = this.y, angle = this.angle) {  // 撞牆：從牆面射、方向是反彈後的方向
    const P = this.payload, Q = Game.triggerQueue;
    if (!P || P[0].trig !== 'end' || this.endDone || Q.length >= CFG.MAX_TRIGGERS_PER_FRAME) return;
    this.endDone = true;
    Q.push({ payload: P, x, y, angle, depth: this.depth + 1, ignore: null, owner: this.owner, fi: this.fromIntercept, rf: this.rareFx });
  }
  // 定時觸發器：飛行中每 0.3 秒往左右兩側各射一次回響（每顆最多 5 次；停住的地雷不算）
  tickTimer(dt) {
    const P = this.payload;
    if (!P || P[0].trig !== 'time' || this.tN >= CFG.TIMER_MAX || this.mode === 'wait') return;
    if ((this.tAcc += dt) < CFG.TIMER_TRIG) return;
    this.tAcc -= CFG.TIMER_TRIG; this.tN++;
    const Q = Game.triggerQueue;
    for (const sd of [-1, 1]) if (Q.length < CFG.MAX_TRIGGERS_PER_FRAME)
      Q.push({ payload: P, x: this.x, y: this.y, angle: this.angle + sd * Math.PI / 2, depth: this.depth + 1, ignore: null, owner: this.owner, fi: this.fromIntercept, rf: this.rareFx });
  }
  // 複製一顆（稜鏡、迴旋風暴用），放進場上的子彈清單
  copy(dAngle) {
    const c = Object.assign(Object.create(Bullet.prototype), this, { hitSet: new Set(this.hitSet) });
    c.angle += dAngle;
    Game.bullets.push(c);
    return c;
  }
  // 佈雷：地雷朝敵人 e 衝出去（×1.2）。TR = 觸發範圍
  mineGo(e, TR) {
    this.angle = Math.atan2(e.y - this.y, e.x - this.x);
    this.damage *= 1.2; this.att = attCredit(this.att, 'stasis', 1.2);
    // 衝出去用武器原本的速度，跑剩下的射程（至少觸發範圍 + 30，射程很短的相刃才碰得到）；
    // 速度倍率接著停住前的射程進度繼續算（加速不重新開始）
    this.mode = 'fly'; this.dashed = true; this.baseSpeed = this.speed0;
    this.life = Math.max(this.R - this.dist, TR + 30) / (this.speed0 * this.mul0);
    this.flyAge = 0; this.setMul();
    stripW(this);
    hostFire(this, 'stasis');  // 插在佈雷上的組件：衝出去的地雷
    Game.rareAct('stasis', this.x, this.y, this.owner, this);  // 稀有晶片：佈雷發動（衝出去）
  }
  // 迴旋：去程穿甲用完（先穿過去再折返，回程會再打牠一次）、撞到牆（或行星、小行星）、飛到盡頭都會折返，追著射出它的飛船飛回來
  startReturn() {
    const o = this.ownerP;
    this.mode = 'return'; this.life = 4; this.hitSet.clear(); this.flyAge = 0; this.speed = (this.dashed ? this.speed0 : this.baseSpeed) * this.accelMul; this.overT = 0;  // 回程一直追到飛船為止（最多 4 秒）；地雷衝出去的用武器原本的速度飛回
    if (o) this.angle = Math.atan2(o.y - this.y, o.x - this.x);
    // 折返的那一刻剛好重疊到的敵人不算（不然折返點剛好停在下一隻身上會多打一下）；剛剛穿過的那一隻回程照樣再打
    for (const e of enemiesNear(this.x, this.y, this.r)) if (e.id !== this.overId && dist2(this.x, this.y, e.x, e.y) < (e.r + this.r) ** 2) this.hitSet.add(e.id);
    this.att = { ...this.att, src: 'boomerang' };  // 傷害統計：回程打中的基礎傷害算迴旋的
    if (this.boom >= 2) { this.damage *= 1.5; this.att = attCredit(this.att, 'boomerang', 1.5); }
    stripW(this);  // 產物：武器插座的傷害加成只算直擊
    const cs = this.boom >= 3 ? [-0.7, 0.7].map(off => this.copy(off)) : [];  // 迴旋風暴：折返時分裂成 3 發（打中、撞牆、飛到盡頭都一樣）
    for (const b of [this, ...cs]) hostFire(b, 'boomerang');  // 插在迴旋上的組件：折返之後的每一發（風暴＋分裂 = 9 發）
    Game.rareAct('boomerang', this.x, this.y, this.owner, this);  // 稀有晶片：迴旋發動（折返）
  }
  update(dt) {
    this.px = this.x; this.py = this.y;  // 記住這一幀的起點，碰撞用整段路徑判定
    this.tickTimer(dt);
    if (this.mode === 'orbit') {  // 環繞：按住射擊時繞著飛船轉，越轉越快；放開射擊時朝準星射出
      const o = this.ownerP;
      if (!o || o.dead) { this.dead = true; return; }
      const spin = orbSpinOf(this.orbit, o.orbHeld || 0);
      if (!o.wantFire || this.forceOut || (o.autoMode && spin >= orbSpinMax(this.orbit))) {  // 放開射擊才放出（衝刺不會；forceOut = 稀有詞條「反擊」強制放出）；右邊晶片的效果（迴旋、加速……）從這裡開始
        const d = Math.max(120, o.aimD || 300), tx = o.x + Math.cos(o.aim) * d, ty = o.y + Math.sin(o.aim) * d;
        this.mode = 'fly'; this.angle = Math.atan2(ty - this.y, tx - this.x);  // 從所在位置朝滑鼠當下那一點射出
        // 速度倍率 = 傷害倍率：轉速 1～3 倍 → 放出時速度倍率 1～2（Lv1 最多 1.5）；有加速時從這裡繼續加上去（不相乘）
        // 射程也 × 轉速倍率（放出的子彈飛得比較快，存活時間不變）
        this.mul0 = 1 + 0.5 * (spin - 1); this.accFull = false; this.dist = 0; this.R = this.speed0 * this.life0 * this.mul0;
        this.orbShot = true;  // 放出後命中也算環繞的玩法擊殺
        this.life = this.life0; this.setMul(); this.flyAge = 0; this.hitSet.clear(); this.sx = this.x; this.sy = this.y;
        if (this.orbit >= 3) this.homing = Math.max(this.homing, 1.5);  // 星環：射出的子彈追蹤敵人
        this.orbit = 0;
        stripW(this);
        hostFire(this, 'orbit');  // 插在環繞上的組件：放出的那一波
        Game.rareAct('orbit', this.x, this.y, this.owner, this);  // 稀有晶片：環繞發動（放出）
        return;
      }
      o.orbN = (o.orbN || 0) + 1;
      this.orbR = Math.min(this.R, this.orbR + dt * 260); this.phase += dt * 5 * spin;
      this.x = o.x + Math.cos(this.phase) * this.orbR; this.y = o.y + Math.sin(this.phase) * this.orbR;
      this.angle = this.phase + Math.PI / 2; this.speed = this.orbR * 5 * spin;  // 沿著圓周的方向（隊友那邊畫面推算用）
      return;
    }
    if (this.mode === 'wait') {  // 佈雷：停住當地雷，敵人靠近就朝牠衝出去（×1.2）；時間到還沒被觸發就消失
      this.waitT -= dt; this.speed = 0;
      // 觸發範圍算到敵人的邊緣（大隻的刺殼、精英、旗艦在旁邊也會觸發；以前算到中心，貼著大隻的邊也不動，時間到就消失）
      const TR = this.stasis >= 2 ? 70 : 50;
      let near = null, nb = Infinity;
      for (const e of enemiesNear(this.x, this.y, TR)) {
        if (e.dead || e.spawnT > 0) continue;
        const gap = Math.hypot(e.x - this.x, e.y - this.y) - e.r;
        if (gap < TR && gap < nb) { nb = gap; near = e; }
      }
      if (!near && this.waitT <= 0) { this.dead = true; this.endTrig(); burst(this.x, this.y, this.color, 4, 60, 0.2, 2); return; }  // 時間到沒被觸發：消失
      if (near) this.mineGo(near, TR);
      return;
    }
    if (this.stasis && !this.dashed && this.mode === 'fly' && this.dist >= 0.5 * this.R && !(this.overT > 0)) {  // 飛到射程一半停住；迴旋已經打中、準備折返的不變地雷
      this.mode = 'wait'; this.waitT = this.stasis >= 2 ? 6 : 4; this.speed = 0; return;
    }
    this.flyAge += dt;
    if (this.overT > 0 && (this.overT -= dt) <= 0) this.startReturn();  // 迴旋：穿過打中的敵人後折返
    const o = this.ownerP, L = this.lock && o && o.lockT > Game.time && o.lockE && !o.lockE.dead ? o.lockE : null;
    if (L && this.mode === 'fly') {  // 鎖定（感測器 2 層）：轉向剛剛打中的那一隻
      const turn = 2 * dt * Math.max(1, this.speed / 600);
      this.angle += clamp(angleDiff(this.angle, Math.atan2(L.y - this.y, L.x - this.x)), -turn, turn);
    } else if (this.homing > 0 && this.mode !== 'return') {
      // 追蹤：只找前方 ±70° 內、450 以內最近的敵人（身後的不追，往反方向射不會整個轉回去）
      let t = null, bd = 450 * 450;
      for (const e of enemiesNear(this.x, this.y, 450)) {
        if (e.dead || e.spawnT > 0 || this.hitSet.has(e.id) || e.cloak > 0.5) continue;  // 隱形的潛伏者不追
        const d2 = dist2(this.x, this.y, e.x, e.y);
        if (d2 >= bd || (!this.seekAll && Math.abs(angleDiff(this.angle, Math.atan2(e.y - this.y, e.x - this.x))) > 1.22)) continue;
        bd = d2; t = e;
      }
      if (t) {
        const turn = this.homing * dt * Math.max(1, this.speed / 600);  // 快的子彈轉得跟著快：轉彎半徑跟 600 速度時一樣，不會繞圈追不到
        this.angle += clamp(angleDiff(this.angle, Math.atan2(t.y - this.y, t.x - this.x)), -turn, turn);
      }
    }
    if (this.mode === 'return') {
      const o = this.ownerP;
      if (!o || o.dead) { this.dead = true; return; }
      this.angle += clamp(angleDiff(this.angle, Math.atan2(o.y - this.y, o.x - this.x)), -9 * dt, 9 * dt);
      if (dist2(this.x, this.y, o.x, o.y) < 20 * 20) { this.dead = true; this.endTrig(); return; }  // 飛回飛船：算消失
    }
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.dist += this.speed * dt;
    // 加速的子彈照飛行距離消耗存活時間：不管速度怎麼變，都剛好飛完射程（迴旋回程照秒數，追到飛船為止）
    this.life -= this.accel && this.mode === 'fly' ? dt * this.accelMul / this.mul0 : dt;
    if (this.accel) this.setMul();  // 速度倍率（= 傷害加成）照射程進度變化（移動完馬上更新，碰撞用的是這一幀到達位置的倍率）
    if (!Arena.rect) {  // 大地圖：碰到牆或閘門（環繞中、迴旋回程、停住的地雷不算）
      const hit = this.mode === 'orbit' || this.mode === 'return' || this.mode === 'wait' ? null
        : Arena.bulletWall(this.px, this.py, this.x, this.y, this.r);
      if (hit) {
        if (this.bounce > 0) {  // 牆反彈：照牆面的法線反彈
          this.bounce--;
          const vx = Math.cos(this.angle), vy = Math.sin(this.angle), dot = vx * hit.nx + vy * hit.ny;
          if (dot < 0) this.angle = Math.atan2(vy - 2 * dot * hit.ny, vx - 2 * dot * hit.nx);
          this.x = hit.x; this.y = hit.y;
          this.afterBounce();
        } else if (this.boom && this.mode === 'fly') { this.x = hit.x; this.y = hit.y; this.startReturn(); }  // 迴旋：撞牆折返
        else {
          if (this.endBoom) Game.explode(hit.x, hit.y, 90, this.damage, this.color, null, this.att);
          this.dead = true; this.x = hit.x; this.y = hit.y;  // 停在牆面（不然停在這一幀的終點，薄牆會在牆後：火毯的火留到牆另一邊）
          // 撞牆算消失：回響從牆面反彈的方向射出（照原方向會馬上又撞牆）
          const vx = Math.cos(this.angle), vy = Math.sin(this.angle), dot = vx * hit.nx + vy * hit.ny;
          this.endTrig(hit.x + hit.nx * 2, hit.y + hit.ny * 2, dot < 0 ? Math.atan2(vy - 2 * dot * hit.ny, vx - 2 * dot * hit.nx) : this.angle);
          return;
        }
      }
    } else {
      const W = CFG.WORLD_W, H = CFG.WORLD_H, outX = this.x < 0 || this.x > W, outY = this.y < 0 || this.y > H;
      if (outX || outY) {
        if (this.bounce > 0) {  // 牆反彈
          this.bounce--;
          if (outX) { this.angle = Math.PI - this.angle; this.x = clamp(this.x, 0, W); }
          if (outY) { this.angle = -this.angle; this.y = clamp(this.y, 0, H); }
          this.afterBounce();
        } else if (this.boom && this.mode === 'fly') { this.x = clamp(this.x, 0, W); this.y = clamp(this.y, 0, H); this.startReturn(); }  // 迴旋：撞到場地邊緣折返
        else if (this.mode === 'return') { this.x = clamp(this.x, 0, W); this.y = clamp(this.y, 0, H); }
        else {
          if (this.endBoom) Game.explode(clamp(this.x, 0, W), clamp(this.y, 0, H), 90, this.damage, this.color, null, this.att);
          this.dead = true; return;
        }
      }
    }
    if (this.life <= 0) {
      // 佈雷：到盡頭前還沒停住的（例如迴旋準備折返時錯過了射程一半），在消失前的最後一刻停住變地雷
      if (this.stasis && !this.dashed && this.mode === 'fly' && !(this.overT > 0)) { this.mode = 'wait'; this.waitT = this.stasis >= 2 ? 6 : 4; this.speed = 0; this.life = 1; return; }
      if (this.boom && this.mode === 'fly') { this.startReturn(); return; }  // 迴旋：飛到盡頭折返（相刃的刃片揮到盡頭也一樣）
      {
        if (this.endBoom) Game.explode(this.x, this.y, 90, this.damage, this.color, null, this.att);  // 過載砲：飛到盡頭爆炸
        this.dead = true;
        this.endTrig();  // 飛完射程：算消失
      }
    }
  }
  // 牆反彈之後（方向已經改好）：玩法擊殺標記、稜鏡分裂、插在牆反彈上的組件
  afterBounce() {
    this.hitSet.clear(); this.life = Math.max(this.life, 0.5);
    this.bounced = true;  // 玩法擊殺：反彈過的子彈打中才貼標記
    stripW(this);
    const c = this.prism ? this.copy(0.4) : null;  // 稜鏡：反彈時分裂
    if (c) this.angle -= 0.2;
    for (const b of c ? [this, c] : [this]) hostFire(b, 'wallbounce');  // 插在牆反彈上的組件：第一次反彈之後（兩發都套用）
    Game.rareAct('wallbounce', this.x, this.y, this.owner, this);  // 稀有晶片：牆反彈發動（反彈）
  }
  // 無限穿透：迴旋的回程、超音速（加速 Lv3 且 2 倍速以上）
  get infPierce() { return (!!this.boom && this.mode === 'return') || (this.accel >= 3 && this.accelMul >= 2); }
}

function spawnShots(list, x, y, baseAngle, depth, ignoreId) {
  const B = Game.bullets, M = Game.mech;  // 射出這些子彈的人的機體：感測器（子彈速度、鎖定、弱點標記）
  // 稀有晶片：反向發動（射出往後的子彈）、蓄力發動（射出蓄滿的那一發）
  if (list.some(s => s.rear)) Game.rareAct('rear', x, y, Game.shooter || null);
  if (list.some(s => s.full)) Game.rareAct('charge', x, y, Game.shooter || null);
  for (const s0 of list) {
    const s = M.bspeed !== 1 ? { ...s0, speed: s0.speed * M.bspeed } : s0;
    const b = new Bullet(x, y, baseAngle + s.angle, s, depth, ignoreId);
    if (M.traits.mark) b.mark = true;
    if (M.traits.lock) b.lock = true;  // 鎖定：打中後 1 秒內追蹤那一隻（見 Bullet.update）
    B.push(b);
  }
}

// 晶體飛行：進入拾取範圍（或波次清空後全場吸取）就被拉向玩家。房主與隊友用同一套算法，隊友畫面才會順
function stepPickup(c, p, range, d2, dt) {
  if (c.vacuum || d2 < range * range) {
    const d = Math.sqrt(d2) || 1, f = c.vacuum ? 3000 : 1400;
    c.vx += (p.x - c.x) / d * f * dt; c.vy += (p.y - c.y) / d * f * dt;
  }
  c.vx *= 0.92; c.vy *= 0.92;
  c.x += c.vx * dt; c.y += c.vy * dt;
}

function nearestEnemy(x, y, range, exclude, visible = false) {  // visible：略過隱形中的潛伏者（自動瞄準用）
  let best = null, bd = range * range;
  for (const e of range <= 600 ? enemiesNear(x, y, range) : Game.enemies) {
    if (e.dead || (exclude && exclude.has(e.id)) || (visible && e.cloak > 0.5)) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// 架設：目前幾層（站 STAND_FULL 秒疊滿，射速 +10%／層）
const STAND_FULL = 2;
const standMax = lv => lv >= 2 ? 8 : 6;
const standStacks = (p, lv) => lv ? Math.min(standMax(lv), Math.floor((p.standT || 0) / STAND_FULL * standMax(lv) + 1e-9)) : 0;

// 武器升級的射速：群戰（身邊的敵人數，Game.tickWeaponFx 每幀數好）、分散、擦彈（疊的層數）、狂怒（缺的 HP）
function weaponRateAdd(p) {
  const W = Game.wp; if (!W) return 0;
  let k = 0;
  if (W.crowd) k += Math.min(W.crowd.max, p.crowdK || 0) * W.crowd.per;
  if (W.spreadUp) k += (p.spreadK || 0) * W.spreadUp.per;
  if (W.graze) k += (p.grazeK || 0) * W.graze.per;
  if (W.rage) k += rageAdd(p, W.rage);
  return k;
}
const rageAdd = (p, R) => Math.max(0, 1 - Math.max(0, p.hp) / p.maxHp) * R.per;
// 裝甲供能（軌道砲・攻城砲的升級）：最大 HP 超過 100 的部分換成射速
function hpRateAdd(p) {
  const H = Game.wp && Game.wp.hpRate;
  return H ? Math.min(H.max, Math.max(0, p.maxHp - 100) * H.per) : 0;
}

// 衝鋒預警線的長度：衝鋒距離＋身體半徑（刺殼再加上暈眩滑行的距離）；畫面兩種繪圖都用這個
const BRUTE_SKID = 0.88;  // 刺殼暈眩時每 1/60 秒速度剩幾成
function telegraphLen(e) {
  if (e.type === 'brute') { const B = CFG.BRUTE, s = B.rollSpeed * (e.spdMul || 1); return s * (B.rollT + 1 / 60) + s / 60 * BRUTE_SKID / (1 - BRUTE_SKID) + e.r; }
  const C = CFG.CHARGE[e.type];
  return C ? C.speed * (C.t + 1 / 60) + e.r : 0;  // 多算一幀：計時器的最後一幀
}

const ENEMY_TYPES = {
  swarmer: { name: '蟲群', hp: 18, speed: 150, radius: 10, dmg: 10, color: '#ff4d6d', credits: 1, shape: 3 },
  brute:   { name: '刺殼', hp: 130, speed: 65, radius: 22, dmg: 25, color: '#ff9f1c', credits: 4, shape: 6 },  // 靠近時縮成球滾過來（見 updateBrute）
  spitter: { name: '噴吐者', hp: 40, speed: 110, radius: 13, dmg: 10, color: '#f72585', credits: 2, shape: 4, syncCd: true,
    ranged: { range: 380, cd: 1.8, speed: 260, dmg: 12 } },
  // 精英（elite: true，行為在 ELITE_AI；出現機率 CFG.ELITE_POOL）：face = 畫面上船頭朝目標；noAffix = 不會抽到的詞綴
  elite:   { name: '虛空獵手', hp: 800, speed: 95, radius: 26, dmg: 30, color: '#ffd400', credits: 12, shape: 5, elite: true, face: true,
    desc: '蓄力衝鋒（有預警線）和兩圈錯開的環形彈輪流放。' },
  // 砲艦不抽護盾：牠會逃、被逼到牆邊就背貼牆，盾一直對著你又繞不到背後，只能慢慢磨（2026-10-19 使用者實玩）
  // 也不抽隱形：牠一直保持 420 以上的距離，隱形要靠近 200 內才現形 → 幾乎整場看不見、自動瞄準鎖不到
  artillery: { name: '砲艦', hp: 700, speed: 90, radius: 24, dmg: 25, color: '#ff8c42', credits: 12, shape: 6, elite: true, face: true, noAffix: ['shield', 'cloak'],   // 保持距離砲擊（CFG.ARTILLERY）
    desc: `跟你保持 ${CFG.ARTILLERY.keep[0]}～${CFG.ARTILLERY.keep[1]} 的距離，靠近就逃；每 ${CFG.ARTILLERY.cd} 秒砲擊 ${CFG.ARTILLERY.n} 個落點（紅圈 ${CFG.ARTILLERY.delay} 秒後爆炸，第一個瞄準你前進的方向）；被追到身邊會近身散射。不會抽到護盾、隱形詞綴。` },
  tractor: { name: '拖曳艦', hp: 850, speed: 85, radius: 25, dmg: 30, color: '#3fe0c5', credits: 12, shape: 4, elite: true, face: true,   // 牽引光束把你拉過去（CFG.TRACTOR）
    desc: `鎖定你 ${CFG.TRACTOR.aim} 秒（紅色預警線）後用牽引光束把你往牠拉 ${CFG.TRACTOR.pull} 秒；拉的時候衝刺就能掙脫（牠會暈 ${CFG.TRACTOR.stun} 秒），沒掙脫被拉到身邊就吃近身散射。` },
  // 三艦編隊：一次出 fleet 艘、共用一個編隊（CFG.WING）；晶體、亂入獎勵照艘數分；分裂（變 6 艘）、召喚（×3）、閃現（離隊）不抽
  wing:    { name: '編隊艦', group: '三艦編隊', hp: 300, speed: 0, radius: 15, dmg: 20, color: '#ff5ec4', credits: 4, shape: 3, elite: true, face: true, fleet: 3, idleAct: true,
    noAffix: ['split', 'summon', 'blink'],
    desc: `3 艘小艦繞著同一個中心轉、輪流朝你開火，每 ${CFG.WING.crossCd} 秒交叉齊射（預警線）；打掉一艘，剩下的重新排隊形、轉得更快、開火更密。詞綴三艘都有（不會抽到分裂、召喚、閃現）。` },
  // 主題小兵（每場隨機抽幾種，越後面越多，見 Game.pickThemes）
  gunboat:  { name: '彈幕艇', hp: 60, speed: 70, radius: 16, dmg: 10, color: '#ff6b9d', credits: 3, shape: 8 },    // 停在 420～520 外，每 3 秒放一圈 8 發慢速彈（先閃 0.6 秒；從 8 根砲管射出，砲塔慢慢轉）
  worm:     { name: '列隊蟲', hp: 35, speed: 130, radius: 9, dmg: 8, color: '#c0ff4d', credits: 1, shape: 4 },    // 6 節排成一列蛇行，後面的跟著前一節；頭死了下一節變成頭
  shield:   { name: '盾衛', hp: 110, speed: 55, radius: 20, dmg: 20, color: '#5ec8ff', credits: 4, shape: 6 },    // 出生時隨機決定盾的方向（120°），之後不轉；打到盾的子彈反彈回去（傷害 ×0.5，最多 25）
  splitter: { name: '分裂體', hp: 70, speed: 80, radius: 18, dmg: 15, color: '#ffb347', credits: 0, shape: 5 },   // 死掉時分成 3 隻碎裂體（本體不掉晶體，晶體都在碎裂體身上）
  splitling:{ name: '碎裂體', hp: 30, speed: 140, radius: 10, dmg: 8, color: '#ffb347', credits: 1, shape: 3 },  // 每隻掉 1 顆（一隻分裂體總共 3 顆，跟以前一樣）
  lurker:   { name: '潛伏者', hp: 40, speed: 120, radius: 12, dmg: 18, color: '#9d8cff', credits: 3, shape: 3 },   // 平常幾乎透明（有殘影），離 140 內現形 0.4 秒後撲過去
  hive:     { name: '母巢', hp: 300, speed: 0, radius: 30, dmg: 15, color: '#e05d2e', credits: 8, shape: 9, anchored: true, idleAct: true, syncCd: true },  // 不會動（anchored：不吃擊退、吸引拉不動，2026-10-10），每 4 秒生 2 隻蟲群（最多 8 隻；不掉晶體、不算玩法擊殺）；待機時也照生（生出來的在旁邊晃，idleAct）
  // 寶藏無人機（CFG.TREASURE）：不攻擊、沒有撞擊傷害、不掉晶體，往離玩家的反方向逃；打掉這場的三選一保證稀有晶片
  //   awake：沒有待機（出場就逃，見 CFG.ALERT）
  treasure:{ name: '寶藏無人機', hp: 156, speed: 230, radius: 18, dmg: 0, color: '#ffd166', credits: 0, shape: 4, treasure: true, awake: true },
  // 警報艇（CFG.ALARM）：不攻擊、沒有撞擊傷害，平常在出生點附近晃；被打到開始響、往遠離玩家的方向逃，邊逃邊叫醒身邊待機的敵人
  //   idleAct：待機時也照自己的行為（THEME_AI）動
  alarm:   { name: '警報艇', hp: 54, speed: 60, radius: 15, dmg: 0, color: '#ff3b3b', credits: 3, shape: 4, alarm: true, idleAct: true },
  // 靶場標靶：不會動、不攻擊、打不死（血量歸零就補滿），被擊退後會慢慢回到原位
  dummy:   { name: '標靶', hp: 5000, speed: 0, radius: 18, dmg: 0, color: '#9fb4ff', credits: 0, shape: 8, dummy: true },
  // 三隻旗艦：第 1～3 關依序出現，無盡模式隨機抽
  boss:    { name: '星噬母艦', hp: 2000, speed: 45, radius: 50, dmg: 35, color: '#ff4d6d', credits: 40, shape: 8, boss: true,
    knockResist: 1.5, shotMul: 0.85, rage: '母艦核心暴走', skills: ['spiral', 'fan', 'summon', 'ring'],
    desc: '螺旋彈幕、扇形齊射、召喚蟲群、環形彈。' },
  boss2:   { name: '裂界獵艦', hp: 2800, speed: 80, radius: 42, dmg: 35, color: '#b388ff', credits: 40, shape: 3, boss: true, face: true,
    knockResist: 2.5, rage: '獵艦推進器過載', skills: ['charge', 'cross', 'snipe', 'charge', 'deploy'], shotMul: 0.85,
    desc: '高速衝鋒（有預警線，衝鋒時往兩側灑彈）、旋轉十字彈流、三連狙擊、部署噴吐者。' },
  boss3:   { name: '終焉核心', hp: 3000, speed: 35, radius: 56, dmg: 40, color: '#2ee6a6', credits: 40, shape: 6, boss: true,
    knockResist: 3.5, rage: '核心臨界', skills: ['nova', 'twin', 'bomb', 'wall', 'guard'], shotMul: 1.15,
    desc: '連續缺口環形波、雙向螺旋、落點轟炸、慢速彈牆、召喚刺殼護衛。' },
  // 章節專屬的王：twin = 一次出兩艘、共用一條血（CFG.TWIN）；beams = 旋轉光束、turrets = 身邊的砲塔（CFG.WARDEN）；center = 出現在場地正中間
  boss4:   { name: '雙子獵艦', hp: 3000, speed: 80, radius: 34, dmg: 30, color: '#7c9cff', credits: 40, shape: 3, boss: true, face: true, twin: true,
    knockResist: 2.5, rage: '雙子同步過載', skills: ['charge', 'fan', 'snipe', 'deploy'], shotMul: 1.6,  // 子彈 ×1.6：10-20 整局模擬（第二章 3-7，66 場）加強光束、出招後陣亡 14%（終焉核心 26%），扣血主要來自子彈；×1.2 → 17%、×1.6 → 21%
    desc: `兩艘共用一條血，繞著同一個中心轉，中間連著光束（碰到受傷；一艘衝鋒時光束斷掉）；輪流衝鋒、兩艘一起扇形齊射、狙擊、部署噴吐者。` },
  boss5:   { name: '星環守門者', hp: 3200, speed: 0, radius: 54, dmg: 40, color: '#ffb86b', credits: 40, shape: 8, boss: true, anchored: true, center: true, beams: true,
    syncCd: true, knockResist: 99, rage: '守門者全開', skills: ['pulse'], shotMul: 1, turrets: ['wt_aim', 'wt_ring', 'wt_bomb', 'wt_call'],
    desc: `待在場地正中間不動：旋轉光束掃過全場（開之前有細的預警線；暴走後 3 條），核心定時放環形彈；身邊 4 座砲塔各管一招（瞄準射擊、環形彈、轟炸、召喚蟲群），打掉一座那招就沒了。` },
  // 星環守門者的砲塔：跟著核心轉（anchored，不吃擊退）；turret = 出招間隔 cd 秒、出什麼招（fire，this = 砲塔，q = 最近的玩家）
  wt_aim:  { name: '瞄準砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#ff8a5c', credits: 0, shape: 6, anchored: true,
    turret: { cd: 1.8, fire(q) { const a = Math.atan2(q.y - this.y, q.x - this.x); for (const o of [-0.08, 0, 0.08]) this.shootAt(a + o, 340, 5, 14); } } },
  wt_ring: { name: '環形砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#ffd166', credits: 0, shape: 6, anchored: true,
    turret: { cd: 3, fire() { this.ring(16, 160, rand(0, TAU)); } } },
  wt_bomb: { name: '轟炸砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#ff5a5a', credits: 0, shape: 6, anchored: true,
    turret: { cd: 3.4, fire(q) {
      for (let i = 0; i < 2; i++) { const a = rand(0, TAU), r = i ? rand(80, 180) : 0, [x, y] = Arena.clampIn(q.x + Math.cos(a) * r, q.y + Math.sin(a) * r, 20); Game.zones.push({ x, y, r: 90, t: 1.3, max: 1.3, dmg: 22, from: `${this.t.name}（轟炸）` }); }
    } } },
  wt_call: { name: '召喚砲塔', hp: 450, speed: 0, radius: 20, dmg: 20, color: '#c77dff', credits: 0, shape: 6, anchored: true,
    turret: { cd: 6, fire() { if (Game.enemies.filter(e => e.summoned && !e.dead).length < 8) this.summon('swarmer', 3, 60, 0.8); } } },
};

// 無盡模式：每過一個星區，敵人攻擊頻率 ×1.1、移動速度 ×1.05（乘算；攻擊力另外在受傷時 ×1.25）
const endlessK = () => Game.mode === 'run' || Game.mode === 'coop' ? Math.max(0, Game.sector - Game.lastSector()) : 0;
const endlessAtk = () => Math.pow(CFG.ENDLESS_ATK, endlessK());
const endlessSpd = () => Math.pow(CFG.ENDLESS_SPD, endlessK());

class Enemy {
  constructor(type, x, y, hpScale) {
    const t = ENEMY_TYPES[type];
    this.id = Game.nextId++; this.type = type; this.t = t;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.hp = this.maxHp = t.hp * hpScale; this.r = t.radius;
    this.flash = 0; this.spawnT = t.boss ? 1.6 : t.elite ? 1.2 : 0.6; this.spawnMax = this.spawnT;
    this.hpScale = hpScale;
    // Boss 狀態
    this.skill = null; this.skillT = 0; this.skillIdx = 0; this.spin = 0; this.fireAcc = 0;
    this.stream = null; this.volley = null; this.ringQ = []; this.enraged = false;
    this.rollCd = rand(0.5, 1.5); this.bounced = false;  // 刺殼滾球用
    this.phase = rand(0, TAU); this.rot = rand(0, TAU);
    this.cd = t.ranged ? rand(0.8, t.ranged.cd) : type === 'gunboat' ? rand(1.5, 3) : type === 'hive' ? 2 : 0;
    if (type === 'shield') this.shieldA = rand(0, TAU);  // 盾的方向（世界座標，不會轉）
    this.cloak = type === 'lurker' ? 1 : 0;              // 潛伏者：1 = 隱形
    this.burnT = 0; this.burnDps = 0; this.burnAcc = 0; this.slowT = 0; this.slowAmt = 0; this.slows = null; this.burnL = null; this.shredT = 0; this.shredAmt = 0;
    this.mode = type === 'lurker' ? 'stalk' : 'chase'; this.skillCd = 2.5; this.nextSkill = 'charge'; this.modeT = 0; this.chargeA = 0;
    this.affixes = null;  // 精英詞綴（affixes.js）：出生時由 setAffixes 設定
    this.alert = true; this.home = null; this.alertT = 0;  // 警戒（CFG.ALERT）：分區的戰鬥由 spawnEnemy 改成待機（alert = false、home = 出生點）；alertT = 頭上「!」還顯示幾秒
    this.dead = false;
  }
  has(id) { return !!this.affixes && this.affixes.includes(id); }
  // 出招速度倍率：無盡模式、精英「狂暴」（出招間隔 ×0.6）
  atkRate() { return endlessAtk() / (this.enraged && this.has('rage') ? AFFIX.rage.cd : 1); }
  // 精英射一發敵彈（往 a 方向、速度 sp）；精英「追蹤彈」：射出後 1.5 秒內轉向最近的玩家
  eShot(x, y, a, sp, dmg, r = 6, life = 4) {
    Game.eBullets.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r, dmg, life, from: this.t.group || this.t.name, home: this.has('homing') ? AFFIX.homing.t : 0 });
  }
  // 近身散射：以 a 為中心、扇形 arc 弧度內平均射 n 發（從船身邊緣射出）
  fan(a, n, arc, sp, dmg) {
    for (let i = 0; i < n; i++) { const b = a + (n > 1 ? (i / (n - 1) - 0.5) * arc : 0); this.eShot(this.x + Math.cos(b) * this.r, this.y + Math.sin(b) * this.r, b, sp, dmg); }
    Events.emit('enemyShot', this);
  }
  // 到 q 的視線被擋住（行星、小行星、大地圖的牆）
  losTo(q) { return !!((Game.objs.length && Objects.losBlocked(this.x, this.y, q.x, q.y, 6)) || Arena.losBlocked(this.x, this.y, q.x, q.y, 6)); }
  // 拖曳艦的光束斷掉：自己暈 CFG.TRACTOR.stun 秒；escaped = 被目標衝刺掙脫（目標頭上跳「掙脫！」）
  breakBeam(escaped) {
    const q = this.tgtP;
    if (escaped && q) floatText(q.x, q.y - 30, '掙脫！', this.t.color, true);
    burst(this.x, this.y, this.t.color, 14, 180, 0.4, 2);
    this.mode = 'stun'; this.modeT = CFG.TRACTOR.stun; this.tgt = 0; this.tgtP = null;
  }
  // 精英詞綴：設定詞綴和各自的初始狀態（盾先朝向 (fx, fy)：通常是玩家）
  setAffixes(list, fx = this.x + 1, fy = this.y) {
    this.affixes = list.length ? [...list] : null;
    if (this.has('shield')) this.shieldA = Math.atan2(fy - this.y, fx - this.x);
    if (this.has('cloak')) this.cloak = 1;
    this.blinkAt = 1 - AFFIX.blink.step;  // 閃現：血量比例掉到這裡就瞬移（每次再往下 20%）
    this.sumCd = AFFIX.summon.cd; this.mineCd = AFFIX.mine.every; this.cmdT = 0;
  }
  // 精英詞綴每一幀（精英的行為一開始呼叫；p = 最近的玩家）
  affixTick(dt, p, d) {
    const A = AFFIX;
    if (this.has('shield')) {  // 盾慢慢轉向玩家（每秒最多 60°）：繞得夠快就能打到背後
      const want = Math.atan2(p.y - this.y, p.x - this.x), diff = angleDiff(this.shieldA, want), step = A.shield.turn * dt;
      this.shieldA += clamp(diff, -step, step);
    }
    if (this.has('rage') && !this.enraged && this.hp <= this.maxHp * A.rage.at) {
      this.enraged = true; ringFx(this.x, this.y, this.r * 2.5, '#ff4d6d'); floatText(this.x, this.y - this.r - 16, '狂暴！', '#ff4d6d', true);
    }
    if (this.has('cloak'))  // 隱形：靠近 200 內、蓄力或衝鋒時現形
      this.cloak = d < A.cloak.near || this.mode === 'windup' || this.mode === 'charge' ? 0 : Math.min(1, this.cloak + dt * 2);
    if (this.splitNow) { this.splitNow = false; this.doSplit(); }
    if (this.has('blink')) {
      if (this.blinkT > 0) { if ((this.blinkT -= dt) <= 0) this.doBlink(); }
      else if (this.hp <= this.maxHp * this.blinkAt) this.startBlink();
    }
    if (this.has('summon') && (this.sumCd -= dt * endlessAtk()) <= 0) {  // 召喚：跟母巢一樣，叫出來的不掉晶體、不算玩法擊殺
      this.sumCd = A.summon.cd;
      this.kids = (this.kids || []).filter(k => !k.dead);
      for (let i = 0; i < A.summon.n && this.kids.length < A.summon.max; i++) {
        const a = rand(0, TAU), k = new Enemy('swarmer', ...Arena.clampIn(this.x + Math.cos(a) * (this.r + 25), this.y + Math.sin(a) * (this.r + 25), 20), this.hpScale);
        k.summoned = true; k.noPlay = true; k.zone = this.zone; k.spawnT = 0.3; k.vx = Math.cos(a) * 160; k.vy = Math.sin(a) * 160;
        this.kids.push(k); Game.enemies.push(k);
      }
      burst(this.x, this.y, this.t.color, 14, 160, 0.4, 2);
    }
    if (this.has('command') && (this.cmdT -= dt) <= 0) {  // 統帥：身邊的小兵（不含精英、旗艦）加速、減傷
      this.cmdT = 0.2;
      const R2 = A.command.r ** 2;
      for (const o of Game.enemies) if (o !== this && !o.dead && !o.t.elite && !o.t.boss && dist2(o.x, o.y, this.x, this.y) < R2) o.ledT = 0.3;
    }
    if (this.has('mine') && Math.hypot(this.vx, this.vy) > 30 && (this.mineCd -= dt) <= 0) {  // 佈雷：移動中才放
      this.mineCd = A.mine.every;
      Game.eBullets.push({ x: this.x, y: this.y, vx: 0, vy: 0, r: A.mine.size, dmg: A.mine.dmg, life: A.mine.life, max: A.mine.life, mine: true, from: `${this.t.name}（地雷）` });
    }
  }
  // 分裂：自己變成 35% 血、小一號，旁邊再生一隻一樣的（詞綴照抄，分裂除外）；晶體兩隻平分
  doSplit() {
    const A = AFFIX.split, mx = this.maxHp * A.hp, keep = this.affixes.filter(id => id !== 'split');
    const a = rand(0, TAU), ux = Math.cos(a), uy = Math.sin(a);
    this.grp = this.grp || this.id;  // 精英血條：兩隻還是同一隻精英（同一條、兩段）
    this.maxHp = this.hp = mx; this.r *= A.size; this.credits = Math.ceil(this.t.credits / 2);
    const [x, y] = Arena.clampIn(this.x - ux * this.r * 2, this.y - uy * this.r * 2, this.r);
    const k = new Enemy(this.type, x, y, this.hpScale);
    k.t = this.t; k.maxHp = k.hp = mx; k.r = this.r; k.credits = Math.floor(this.t.credits / 2); k.zone = this.zone; k.spawnT = 0;
    k.setAffixes(keep, this.x, this.y); k.grp = this.grp;
    if (this.shieldA != null && k.shieldA != null) k.shieldA = this.shieldA;
    if (this.enraged) k.enraged = true;
    if (this.intruder) { k.intruder = this.intruder; this.intruder.left++; }  // 精英亂入：兩隻都打掉才算（Game.onEnemyKilled）
    this.affixes = keep.length ? keep : null; this.splitDone = true;
    this.push(ux * 260, uy * 260); k.push(-ux * 260, -uy * 260);
    Game.enemies.push(k);
    burst(this.x, this.y, this.t.color, 30, 260, 0.5, 2.5); ringFx(this.x, this.y, this.r * 3, this.t.color);
    floatText(this.x, this.y - this.r - 16, '分裂！', this.t.color, true);
  }
  // 閃現：先在落點閃紅圈（0.4 秒），時間到才瞬移；落點離現在 300～400、在同一區、不在牆裡和黑洞、行星旁邊
  startBlink() {
    const A = AFFIX.blink;
    this.blinkAt -= A.step;
    for (let i = 0; i < 24; i++) {
      const a = rand(0, TAU), dd = rand(A.dist[0], A.dist[1]);
      const x = clamp(this.x + Math.cos(a) * dd, this.r + 20, Arena.W - this.r - 20), y = clamp(this.y + Math.sin(a) * dd, this.r + 20, Arena.H - this.r - 20);  // 場地大小照 Arena（大地圖比 CFG.WORLD_W 大）
      if (!Arena.rect && (Arena.f(x, y) < this.r + 20 || (this.zone != null && Arena.zoneOf(x, y) !== this.zone))) continue;
      if (Objects.inHole({ x, y, r: this.r }, OBJ.HOLE_NOESC) || Objects.onSolid({ x, y, r: this.r }, 20)) continue;
      this.blinkTo = [x, y]; this.blinkT = A.warn;
      ringFx(x, y, this.r * 1.6, '#ff2a2a', true);
      return;
    }
  }
  doBlink() {
    const [x, y] = this.blinkTo;
    burst(this.x, this.y, this.t.color, 20, 220, 0.4, 2);
    this.x = x; this.y = y; this.vx = this.vy = 0; this.blinkTo = null;
    if (this.mode !== 'chase') this.mode = 'chase';  // 瞬移打斷招式（衝鋒、砲擊蓄力、牽引）：不然從新位置照舊方向衝
    burst(x, y, this.t.color, 20, 220, 0.4, 2);
  }
  move(dt) {
    if (Arena.rect) {
      const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
      this.x = clamp(nx, this.r, CFG.WORLD_W - this.r);
      this.y = clamp(ny, this.r, CFG.WORLD_H - this.r);
      if (this.whT > 0 && (this.x !== nx || this.y !== ny)) Game.wallSlam(this);  // 撞牆（散彈升級）：撞到場地邊緣
    } else {
      this.x += this.vx * dt; this.y += this.vy * dt; this.wallN = Arena.collide(this, this.r, null);  // 大地圖：撞牆停住，閘門過不去
      if (this.whT > 0 && this.wallN) Game.wallSlam(this);
    }
  }
  // 減速（2026-10-10 改相乘）：每個來源（shot 子彈、comet 彗星的冰）各自計時；同一來源再打中取大的、刷新時間；
  //   剩下的速度相乘（兩個 40% = 64%），沒有上限。slowAmt／slowT = 合起來的減速和最久的剩餘時間（冰封、畫面、連線用）
  slowBy(src, amt, t) {
    const S = this.slows || (this.slows = {}), o = S[src];
    if (o && o.t > 0) { o.amt = Math.max(o.amt, amt); o.t = Math.max(o.t, t); } else S[src] = { amt, t };
    this.slowTick(0);
  }
  slowTick(dt) {
    let keep = 1, T = 0, any = false;
    for (const k in this.slows) {
      const o = this.slows[k]; o.t -= dt;
      if (o.t > 0) { keep *= 1 - o.amt; T = Math.max(T, o.t); any = true; }
    }
    if (!any) this.slows = null;
    this.slowAmt = 1 - keep; this.slowT = T;
  }
  update(dt, p) {
    this.flash = Math.max(0, this.flash - dt);
    if (this.burnT > 0 || this.burnL) {  // 燃燒：持續扣血（一般燃燒只留最強的一個；業火的燃燒層各自計時、相加）
      let dps = 0;
      if (this.burnT > 0) { this.burnT -= dt; dps += this.burnDps; }
      if (this.burnL) {
        let w = 0;
        for (const L of this.burnL) { L.t -= dt; if (L.t > 0) { dps += L.dps; this.burnL[w++] = L; } }
        this.burnL.length = w; if (!w) this.burnL = null;
      }
      this.burnAcc += dps * dt;
      if (this.burnAcc >= 1 && this.share && !this.share.dead) {  // 雙子獵艦的另一艘：燒的傷害也算在共用的那條血上
        const d = Math.floor(this.burnAcc);
        this.burnAcc -= d; this.share.hurt(d, 0, 0, 'burn', this.burnAtt, null, true); this.hp = this.share.hp;
      } else if (this.burnAcc >= 1) {
        const d = Math.floor(this.burnAcc);
        this.burnAcc -= d;
        Game.recordDamage('burn', Math.min(d, Math.max(0, this.hp)), this.burnAtt);
        this.hp -= d;
        if (Game.mode === 'range') Range.hit(d, 'burn');
        if (this.t.dummy) { if (this.hp <= 0) this.hp += this.maxHp; }  // 標靶打不死
        if (Math.random() < 0.4) burst(this.x, this.y, '#ff9f1c', 2, 60, 0.3, 2);
        if (this.hp <= 0 && !this.dead) { this.dead = true; this.killer = this.burnAtt && this.burnAtt.owner; this.killAtt = this.burnAtt; Game.onEnemyKilled(this); return; }
      }
    }
    if (this.slows) this.slowTick(dt);
    if (this.markT > 0) this.markT -= dt;
    if (this.alertT > 0) this.alertT -= dt;
    if (this.shredT > 0) this.shredT -= dt;
    this.spdMul = this.slowT > 0 ? 1 - this.slowAmt : 1;
    if (this.ledT > 0) { this.ledT -= dt; this.spdMul *= AFFIX.command.speed; }  // 精英「統帥」身邊的小兵
    if (this.enraged && this.has('rage')) this.spdMul *= AFFIX.rage.speed;       // 精英「狂暴」
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    if (this.whT > 0) this.whT -= dt;
    if (this.stunT > 0) {  // 撞牆暈眩（散彈升級）：不動、不攻擊，被撞開的速度慢慢減
      this.stunT -= dt; const f = Math.max(0, 1 - dt * 6); this.vx *= f; this.vy *= f; this.move(dt);
      return;
    }
    const t = this.t;
    if (t.dummy || this.frozen) {  // 標靶（和靶場手動生的「不動」敵人）：被擊退後像彈簧一樣回到原位，不移動也不攻擊
      const k = Math.min(1, dt * 6);
      this.vx += ((this.hx - this.x) * 8 - this.vx) * k;
      this.vy += ((this.hy - this.y) * 8 - this.vy) * k;
      this.move(dt);
      return;
    }
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
    this.rot += dt * (ENEMY_SPIN[this.type] || 0);
    if (!this.alert && this.idle(dt, d)) return;
    if (t.boss) { this.updateBoss(dt, dx, dy, d); return; }
    if (this.type === 'brute' && this.updateBrute(dt, dx, dy, d)) return;
    if (THEME_AI[this.type] && THEME_AI[this.type].call(this, dt, p, dx, dy, d)) return;

    if (t.elite) {  // 精英：先跑詞綴，再照種類（ELITE_AI；回傳 true = 這一幀的移動處理完了，false = 照下面一般追擊）
      if (this.affixes) { this.affixTick(dt, p, d); if (this.dead) return; }
      if (ELITE_AI[this.type].call(this, dt, p, dx, dy, d)) return;
    }

    // 看不到玩家（中間有行星、小行星，或大地圖的牆）：照尋路方向繞過去或鑽縫
    let bx = dx / d, by = dy / d;
    if (!((this.losT -= dt) > 0)) {  // 視線每 0.15 秒重算一次（沿線取樣，每幀算太貴）
      this.losT = 0.15;
      this.losBlk = !!((Game.objs.length && Objects.losBlocked(this.x, this.y, p.x, p.y, this.r * 0.8)) || Arena.losBlocked(this.x, this.y, p.x, p.y, this.r * 0.8));
    }
    const blocked = this.losBlk;
    if (blocked) { const f = Objects.flowDir(this, p); if (f) [bx, by] = f; } else this.flowEsc = false;
    let mx = bx, my = by;
    if (this.type === 'swarmer') {
      const w = Math.sin(Game.time * 6 + this.phase) * (blocked ? 0.25 : 0.6);
      mx += -by * w; my += bx * w;
    }
    if (t.ranged) {
      const R = t.ranged.range;
      if (blocked) { /* 繞路中：不後退、不橫移 */ }
      else if (d < R * 0.55) { mx = -mx; my = -my; }
      else if (d < R * 0.9) { const s = Math.sin(this.phase) > 0 ? 1 : -1; mx = -dy / d * s; my = dx / d * s; }
      this.cd -= dt * endlessAtk();
      if (this.cd <= 0 && d < R + 120 && !blocked) {  // 看不到玩家（被牆、行星擋住）就不開火，先繞過去
        this.cd = t.ranged.cd;
        const a = Math.atan2(dy, dx);
        const mz = this.type === 'spitter' ? this.r * 1.55 : 0;  // 噴吐者：從噴管口射出
        Game.eBullets.push({ x: this.x + Math.cos(a) * mz, y: this.y + Math.sin(a) * mz, vx: Math.cos(a) * t.ranged.speed, vy: Math.sin(a) * t.ranged.speed,
          r: 5, dmg: t.ranged.dmg, life: 3, from: t.name });
        Events.emit('enemyShot', this);
      }
    }
    if (Game.objs.length) [mx, my] = Objects.steer(this, mx, my);  // 繞開黑洞
    const ml = Math.hypot(mx, my) || 1;
    const k = Math.min(1, dt * 4);
    this.vx += (mx / ml * t.speed * this.spdMul * endlessSpd() - this.vx) * k;
    this.vy += (my / ml * t.speed * this.spdMul * endlessSpd() - this.vy) * k;
    this.move(dt);
  }
  // 待機（CFG.ALERT）：d = 離目標（最近的玩家或殘影）多遠。看到了就醒、回傳 false（這一幀照常行動）
  //   列隊蟲的身體照舊跟著前一節走（頭待機就一起晃）；idleAct 的（母巢、警報艇）照自己的行為；其他在出生點附近晃
  idle(dt, d) {
    if (d < CFG.ALERT.see) { Game.wakeEnemy(this); return false; }
    if (this.ahead || this.t.idleAct) return false;
    this.wander(dt);
    return true;
  }
  // 在 home 附近 CFG.ALERT.wander 內慢慢晃：到了（或 1.5～3 秒）換下一個點
  wander(dt) {
    const A = CFG.ALERT, h = this.home || (this.home = [this.x, this.y]);
    if (!this.wanderTo || (this.wanderT -= dt) <= 0 || dist2(this.x, this.y, this.wanderTo[0], this.wanderTo[1]) < 100) {
      const a = rand(0, TAU), r = rand(0, A.wander);
      this.wanderTo = [h[0] + Math.cos(a) * r, h[1] + Math.sin(a) * r]; this.wanderT = rand(1.5, 3);
    }
    if (this.t.speed > 0) this.steerMove(dt, this.wanderTo[0] - this.x, this.wanderTo[1] - this.y, this.t.speed * A.slow);
    else this.vx = this.vy = 0;
  }
  // 逃離玩家（寶藏無人機、響著的警報艇）：(dx, dy, d) = 往玩家的向量和距離；sp = 速度；wob = 左右閃的幅度
  //   每 0.25 秒重選方向：8 個方向裡最背向玩家、前面 90 沒被牆和物件擋住的（被逼到牆角就跑不掉，這時最好打）
  flee(dt, dx, dy, d, sp, wob) {
    if (!((this.fleeT -= dt) > 0)) {
      this.fleeT = 0.25;
      const ux = -dx / d, uy = -dy / d, [ox, oy] = this.fleeDir || [ux, uy];
      let best = -Infinity;
      for (let i = 0; i < 8; i++) {
        const cx = Math.cos(i / 8 * TAU), cy = Math.sin(i / 8 * TAU), tx = this.x + cx * 90, ty = this.y + cy * 90;
        if (tx < this.r || ty < this.r || tx > Arena.W - this.r || ty > Arena.H - this.r) continue;  // 場地大小照 Arena（大地圖比 CFG.WORLD_W 大：以前大部分方向都被當成出界，一個都沒選到就直直往牆衝）
        if (Arena.losBlocked(this.x, this.y, tx, ty, this.r) || (Game.objs.length && Objects.losBlocked(this.x, this.y, tx, ty, this.r))) continue;
        const s = cx * ux + cy * uy + 0.3 * (cx * ox + cy * oy);  // 偏好原本的方向，不會每次重選就左右抖
        if (s > best) { best = s; this.fleeDir = [cx, cy]; }
      }
    }
    const [fx, fy] = this.fleeDir || [-dx / d, -dy / d], w = Math.sin(Game.time * 3 + this.phase) * wob;
    this.steerMove(dt, fx - fy * w, fy + fx * w, sp);
  }
  // 往 (mx, my) 方向走（繞開黑洞），速度 sp；主題小兵共用
  steerMove(dt, mx, my, sp, k = 4) {
    if (Game.objs.length) [mx, my] = Objects.steer(this, mx, my);
    const l = Math.hypot(mx, my) || 1, s = sp * this.spdMul * endlessSpd(), q = Math.min(1, dt * k);
    this.vx += (mx / l * s - this.vx) * q; this.vy += (my / l * s - this.vy) * q;
    this.move(dt);
  }
  // 追向 p 的方向：看不到（中間有行星、小行星）時照尋路方向
  chaseDir(p, dx, dy, d) {
    if ((Game.objs.length && Objects.losBlocked(this.x, this.y, p.x, p.y, this.r * 0.8)) || Arena.losBlocked(this.x, this.y, p.x, p.y, this.r * 0.8)) { const f = Objects.flowDir(this, p); if (f) return f; }
    this.flowEsc = false;
    return [dx / d, dy / d];
  }
  // ---------- 刺殼：平常慢慢走；靠近時縮成球（有預警線）→ 高速滾向玩家（撞牆反彈一次）→ 暈眩 ----------
  //   回傳 true 表示這一幀的移動已經處理完（縮球、滾動、暈眩中）；false 則照一般追擊
  updateBrute(dt, dx, dy, d) {
    const B = CFG.BRUTE, W = CFG.WORLD_W, H = CFG.WORLD_H;
    if (this.mode === 'windup') {  // 縮成球：前半段還會跟著玩家轉向，後半段鎖定方向
      this.modeT -= dt; this.vx *= 0.8; this.vy *= 0.8; this.move(dt);
      if (this.modeT > B.lock) this.chargeA = Math.atan2(dy, dx);
      if (this.modeT <= 0) {
        this.mode = 'charge'; this.modeT = B.rollT; this.bounced = false;
        const s = B.rollSpeed * this.spdMul;
        this.vx = Math.cos(this.chargeA) * s; this.vy = Math.sin(this.chargeA) * s;
      }
      return true;
    }
    if (this.mode === 'charge') {  // 滾動：不吃擊退（hurt 裡處理），撞牆反彈一次，第二次撞牆就停
      this.modeT -= dt; this.move(dt); this.rot += dt * 14;
      if (!Arena.rect) {  // 大地圖：照牆面法線反彈（move 撞到牆時記下 wallN，速度已經被削掉往牆裡的分量，用滾動方向算）
        if (this.wallN) {
          if (this.bounced) this.modeT = 0;
          else {
            const s = B.rollSpeed * this.spdMul, vx = Math.cos(this.chargeA), vy = Math.sin(this.chargeA), [nx, ny] = this.wallN, dot = vx * nx + vy * ny;
            this.chargeA = Math.atan2(vy - 2 * Math.min(0, dot) * ny, vx - 2 * Math.min(0, dot) * nx);
            this.vx = Math.cos(this.chargeA) * s; this.vy = Math.sin(this.chargeA) * s;
            this.bounced = true; Game.shake(3);
          }
        }
      } else {
      const hitX = (this.x <= this.r + 0.5 && this.vx < 0) || (this.x >= W - this.r - 0.5 && this.vx > 0);
      const hitY = (this.y <= this.r + 0.5 && this.vy < 0) || (this.y >= H - this.r - 0.5 && this.vy > 0);
      if (hitX || hitY) {
        if (this.bounced) this.modeT = 0;
        else { this.bounced = true; if (hitX) this.vx = -this.vx; if (hitY) this.vy = -this.vy; this.chargeA = Math.atan2(this.vy, this.vx); Game.shake(3); }
      }
      }
      trail(this.x, this.y, this.t.color, 0.25, 5, 0.5);
      if (this.modeT <= 0) { this.mode = 'stun'; this.modeT = B.stunT; }
      return true;
    }
    if (this.mode === 'stun') {  // 暈眩：滑行停下，這段時間是反擊的機會
      const k = Math.pow(BRUTE_SKID, dt * 60); this.modeT -= dt; this.vx *= k; this.vy *= k; this.move(dt);
      if (this.modeT <= 0) { this.mode = 'chase'; this.rollCd = B.cooldown; }
      return true;
    }
    this.rollCd -= dt * endlessAtk();
    if (this.rollCd <= 0 && d < B.range && !Objects.inHole(this)) { this.mode = 'windup'; this.modeT = B.windup; this.chargeA = Math.atan2(dy, dx); return true; }
    return false;
  }
  // ---------- 旗艦（三隻共用框架，技能清單寫在 ENEMY_TYPES.skills；半血後暴走） ----------
  //   星噬母艦：螺旋彈幕 / 扇形齊射 / 召喚蟲群 / 環形彈
  //   裂界獵艦：預警衝鋒（兩側灑彈）/ 旋轉十字彈流 / 三連狙擊 / 部署噴吐者
  //   終焉核心：缺口環形波 / 雙向螺旋 / 慢速彈牆 / 刺殼護衛
  shootAt(a, spd, r = 6, dmg = 14) {  // 子彈傷害 × t.shotMul（整局模擬調的）：前兩隻王 ×0.85（第一星區旗艦原本是斷層）、終焉核心 ×1.15（第三星區原本太簡單）、雙子獵艦 ×1.6
    Game.eBullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r, dmg: dmg * (this.t.shotMul || 1), life: 10, from: this.t.name, boss: !!this.t.boss });  // 王的子彈存在 10 秒；boss：會削行星、打碎小行星
  }
  ring(n, spd, offset, gap = 0) {  // gap：連續空出幾發，讓玩家有縫可鑽
    const g0 = gap ? randInt(0, n - 1) : -1;
    for (let i = 0; i < n; i++) if (!gap || mod(i - g0, n) >= gap) this.shootAt(offset + i / n * TAU, spd);
  }
  summon(type, n, dist, scale) {
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + this.rot;
      const [ex, ey] = Arena.clampIn(this.x + Math.cos(a) * dist, this.y + Math.sin(a) * dist, 40);
      const e = new Enemy(type, ex, ey, this.hpScale * scale);
      e.summoned = true; e.noPlay = true;  // 旗艦叫出來的小怪不掉晶體、不算玩法擊殺（跟母巢生的蟲群一樣）
      Game.enemies.push(e);
    }
    burst(this.x, this.y, this.t.color, 24, 200, 0.5, 2);
  }
  // 出招（以前固定順序輪流，背得起來）：加權隨機、不連續用同一招，再看情況調整
  //   玩家離得遠（450 外）：瞄準型（扇形、狙擊、彈牆、衝鋒）多一點；玩家貼近（350 內）：範圍型（螺旋、環形、新星、十字、雙螺旋）多一點
  //   叫出來的小怪還有 6 隻以上：少召喚；技能清單裡寫兩次的招式（獵艦的衝鋒）機率加倍；forceSkill：指定下一招（機制檢查用）
  pickSkill(d) {
    if (this.forceSkill) { const s = this.forceSkill; this.forceSkill = null; return s; }
    const AIM = ['fan', 'snipe', 'wall', 'charge'], AREA = ['spiral', 'ring', 'nova', 'cross', 'twin'], CALL = ['summon', 'deploy', 'guard'];
    const minions = Game.enemies.filter(e => e.summoned && !e.dead).length, cnt = {};
    for (const k of this.t.skills) cnt[k] = (cnt[k] || 0) + 1;
    const opts = Object.keys(cnt), w = opts.map(k => k === this.skill ? 0
      : cnt[k] * (AIM.includes(k) ? (d > 450 ? 1.6 : 0.8) : AREA.includes(k) ? (d < 350 ? 1.6 : 1) : CALL.includes(k) && minions >= 6 ? 0.2 : 1));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) if ((r -= w[i]) < 0) return opts[i];
    return opts[opts.length - 1];
  }
  updateBoss(dt, dx, dy, d) {
    if (this.share) { this.hp = this.share.hp; this.maxHp = this.share.maxHp; this.enraged = this.share.enraged; }  // 雙子獵艦的另一艘：血量、暴走跟主艦同一份
    const t = this.t, rage = this.hp < this.maxHp * 0.5;
    this.blocked = (Game.objs.length ? Objects.losBlocked(this.x, this.y, this.x + dx, this.y + dy, 6) : null) || Arena.losPoint(this.x, this.y, this.x + dx, this.y + dy, 6);  // 大地圖：牆、柱子也算
    if (rage && !this.enraged) {
      this.enraged = true; this.skillCd = Math.min(this.skillCd, 1);
      bannerFx(t.rage, '攻擊頻率上升', 2);
      Game.shake(14);
      burst(this.x, this.y, t.color, 60, 380, 0.8, 3);
    }
    if (this.mode === 'windup') {  // 裂界獵艦、雙子獵艦：蓄力（畫面上有預警線），期間慢慢停下
      this.modeT -= dt; this.vx *= 0.85; this.vy *= 0.85; this.move(dt);
      if (this.modeT <= 0) {
        const C = CFG.CHARGE[this.type];
        this.mode = 'charge'; this.modeT = C.t; this.fireAcc = 0;
        this.vx = Math.cos(this.chargeA) * C.speed; this.vy = Math.sin(this.chargeA) * C.speed;
        Game.shake(6);
      }
    } else if (this.mode === 'charge') {  // 衝鋒：往兩側灑出慢速彈，撞牆或時間到就停
      this.modeT -= dt; this.move(dt); this.fireAcc += dt;
      while (this.fireAcc >= 0.07) {
        this.fireAcc -= 0.07;
        this.shootAt(this.chargeA + Math.PI / 2, 110, 5, 12);
        this.shootAt(this.chargeA - Math.PI / 2, 110, 5, 12);
      }
      trail(this.x, this.y, t.color, 0.35, 8);
      const wall = Arena.rect ? this.x <= this.r + 1 || this.x >= CFG.WORLD_W - this.r - 1 || this.y <= this.r + 1 || this.y >= CFG.WORLD_H - this.r - 1 : !!this.wallN;  // 大地圖：撞牆（move 記下的 wallN）
      if (this.modeT <= 0 || wall) { this.mode = 'chase'; this.vx = this.vy = 0; }  // 衝完停住（不滑出預警線）
    } else if (BOSS_MOVE[this.type]) BOSS_MOVE[this.type].call(this, dt, rage);
    else {
      // 與玩家保持距離並緩慢繞行（獵艦貼得比較近，核心幾乎不動）
      const [far, near, orbit] = this.type === 'boss2' ? [300, 180, 60] : this.type === 'boss3' ? [460, 260, 18] : [340, 220, 35];
      const want = d > far ? 1 : d < near ? -1 : 0;
      const sp = t.speed * this.spdMul * endlessSpd();
      let tvx = dx / d * sp * want - dy / d * orbit, tvy = dy / d * sp * want + dx / d * orbit;
      if (this.blocked) {  // 射線被行星或小行星擋住：往離擋路物件遠的那一側橫移，找得到玩家的角度
        const B = this.blocked, px = -dy / d, py = dx / d, side = (B.x - this.x) * px + (B.y - this.y) * py > 0 ? -1 : 1, v = Math.max(90, sp * 1.8);
        tvx += px * side * v; tvy += py * side * v;
      }
      const k = Math.min(1, dt * 2);
      this.vx += (tvx - this.vx) * k; this.vy += (tvy - this.vy) * k;
      this.move(dt);
    }

    const S = this.stream;  // 持續彈流（螺旋 / 十字 / 雙向螺旋）
    if (S && S.t > 0) {
      S.t -= dt; this.fireAcc += dt;
      while (this.fireAcc >= S.every) {
        this.fireAcc -= S.every; this.spin += S.turn;
        for (let i = 0; i < S.arms; i++) {
          this.shootAt(this.spin + i * TAU / S.arms, S.spd, S.r, S.dmg);
          if (S.twin) this.shootAt(-this.spin + i * TAU / S.arms, S.spd, S.r, S.dmg);
        }
      }
    }
    const V = this.volley;  // 瞄準玩家的連續齊射
    if (V && V.n > 0 && this.blocked && (V.wait || 0) < 1.5) V.wait = (V.wait || 0) + dt;  // 瞄準型攻擊：被擋住時最多等 1.5 秒再打
    else if (V && V.n > 0) {
      V.T -= dt;
      if (V.T <= 0) {
        V.T = V.every; V.n--;
        const a0 = Math.atan2(dy, dx);
        if (V.kind === 'fan') { const w = rage ? 3 : 2; for (let i = -w; i <= w; i++) this.shootAt(a0 + i * 0.14, 300); }
        if (V.kind === 'snipe') for (const o of [-0.07, 0, 0.07]) this.shootAt(a0 + o, 440, 5, 16);
        if (V.kind === 'wall') {  // 15 發慢速彈排成一道牆，每一波錯開半格
          const shift = (V.n % 2) * 0.5;
          for (let i = 0; i < 15; i++) this.shootAt(a0 + (i + shift - 7) * 0.1, 140, 7, 15);
        }
      }
    }
    for (const q of this.ringQ) {  // 延遲發射的環形彈
      q.t -= dt;
      if (q.t <= 0) this.ring(q.n, q.spd, q.off, q.gap);
    }
    this.ringQ = this.ringQ.filter(q => q.t > 0);

    this.skillCd -= dt * endlessAtk();
    if (this.share || this.skillCd > 0 || this.mode !== 'chase') return;  // 雙子獵艦：出招由主艦決定（twinSkill 分給兩艘）
    this.skill = this.pickSkill(d);
    if (this.pair) { this.twinSkill(this.skill, rage); return; }
    switch (this.skill) {
      // 星噬母艦
      case 'spiral':
        this.stream = { t: 3, every: rage ? 0.05 : 0.08, arms: rage ? 3 : 2, turn: 0.33, spd: 190, r: 5, dmg: 12 };
        this.fireAcc = 0; this.skillCd = rage ? 3.6 : 4.4; break;
      case 'fan': this.volley = { kind: 'fan', n: rage ? 4 : 3, T: 0, every: 0.35 }; this.skillCd = rage ? 2.4 : 3; break;
      case 'summon': this.summon('swarmer', rage ? 8 : 5, 80, 0.8); this.skillCd = rage ? 2.6 : 3.2; break;
      case 'ring':
        this.ring(24, 170, this.rot);
        if (rage) this.ringQ.push({ t: 0.45, n: 24, spd: 170, off: this.rot + TAU / 48, gap: 0 });
        this.skillCd = rage ? 2.2 : 2.8; break;
      // 裂界獵艦
      case 'charge':
        this.mode = 'windup'; this.modeT = rage ? 0.55 : 0.8; this.chargeA = Math.atan2(dy, dx);
        this.skillCd = rage ? 2.2 : 2.8; break;
      case 'cross':
        this.stream = { t: 3, every: rage ? 0.08 : 0.11, arms: rage ? 6 : 4, turn: 0.07, spd: 230, r: 5, dmg: 13 };
        this.fireAcc = 0; this.skillCd = rage ? 3.4 : 4; break;
      case 'snipe': this.volley = { kind: 'snipe', n: rage ? 4 : 3, T: 0, every: 0.28 }; this.skillCd = rage ? 2 : 2.6; break;
      case 'deploy': this.summon('spitter', rage ? 3 : 2, 90, 0.7); this.skillCd = rage ? 2.4 : 3; break;
      // 終焉核心
      case 'nova': {
        const n = rage ? 4 : 3;
        for (let i = 0; i < n; i++) this.ringQ.push({ t: i * 0.55, n: 32, spd: rage ? 170 : 150, off: rand(0, TAU), gap: 5 });
        this.skillCd = rage ? 3 : 3.6; break;
      }
      case 'twin':
        this.stream = { t: 3.2, every: rage ? 0.07 : 0.1, arms: 2, turn: 0.22, spd: 170, r: 6, dmg: 13, twin: true };
        this.fireAcc = 0; this.skillCd = rage ? 3.8 : 4.4; break;
      case 'wall': this.volley = { kind: 'wall', n: rage ? 3 : 2, T: 0, every: 0.6 }; this.skillCd = rage ? 2.6 : 3.2; break;
      case 'bomb': {  // 落點轟炸：在最近的玩家身邊標幾個紅圈，一段時間後爆炸（牆、柱子擋不住）
        const B = CFG.BOSS_BOMB, q = Game.nearestPlayer(this.x, this.y) || Game.player;
        for (let i = 0, n = rage ? B.nRage : B.n; i < n; i++) {
          const a = rand(0, TAU), d = i === 0 ? rand(0, 40) : rand(90, 260);
          const [x, y] = Arena.clampIn(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, 20);
          Game.zones.push({ x, y, r: B.r, t: B.delay, max: B.delay, dmg: B.dmg, from: t.name + '（轟炸）' });
        }
        Events.emit('bossSkill', this);
        this.skillCd = rage ? 2.2 : 2.8; break;
      }
      case 'guard':
        this.summon('brute', rage ? 2 : 1, 110, 0.6);
        this.summon('swarmer', rage ? 6 : 4, 80, 0.8);
        this.skillCd = rage ? 3 : 3.6; break;
      // 星環守門者（光束、砲塔另外跑：BOSS_MOVE.boss5、THEME_AI 的砲塔）
      case 'pulse': {
        const W = CFG.WARDEN;
        this.ring(W.ring, 150, this.rot, 2);
        this.skillCd = rage ? W.ringCdRage : W.ringCd; break;
      }
    }
  }
  // 雙子獵艦的出招（主艦選招，分給兩艘）：衝鋒輪流一艘、扇形和狙擊兩艘一起、部署兩艘各叫
  twinSkill(skill, rage) {
    const P = this.pair, ships = P.members.filter(s => !s.dead);
    switch (skill) {
      case 'charge': {
        const s = ships[P.k++ % ships.length], q = Game.nearestPlayer(s.x, s.y) || Game.player;
        s.mode = 'windup'; s.modeT = rage ? 0.55 : 0.8; s.chargeA = Math.atan2(q.y - s.y, q.x - s.x);
        this.skillCd = rage ? 2.1 : 2.6; break;
      }
      case 'fan': for (const s of ships) s.volley = { kind: 'fan', n: rage ? 4 : 3, T: 0, every: 0.4 }; this.skillCd = rage ? 2.2 : 2.8; break;
      case 'snipe': for (const s of ships) s.volley = { kind: 'snipe', n: rage ? 4 : 3, T: 0, every: 0.3 }; this.skillCd = rage ? 1.9 : 2.4; break;
      case 'deploy': for (const s of ships) s.summon('spitter', rage ? 2 : 1, 90, 0.7); this.skillCd = rage ? 2.6 : 3.2; break;
    }
  }
  // knock：子彈的擊退值（只有子彈命中會帶）。旗艦只有在擊退值超過自己的抗擊退時才會被推，力道只看超過的部分；
  // 爆炸、震波、電弧不會推王。衝鋒中的敵人不會被推
  // 擊退不疊加：推完的速度最多是「原本的速度」和「這一發的擊退」比較大的那個（單發效果不變）。
  //   以前每發都加上去，散彈＋鏡像＋分裂＋穿甲一幀打中很多發，敵人被推到每秒幾千、飛進牆裡卡住（2026-10-09 整局模擬）
  push(kx, ky) {
    const v0 = Math.hypot(this.vx, this.vy), lim = Math.max(v0, Math.hypot(kx, ky));
    this.vx += kx; this.vy += ky;
    const v1 = Math.hypot(this.vx, this.vy);
    if (v1 > lim) { this.vx *= lim / v1; this.vy *= lim / v1; }
  }
  // raw：傷害已經算過弱點、破甲（雙子獵艦的另一艘轉過來的），不再乘一次
  hurt(dmg, kx, ky, source = 'direct', att = null, knock = null, raw = false) {
    const vul = raw ? 0 : (this.markT > 0 ? 0.25 : 0) + (this.shredT > 0 ? this.shredAmt : 0);  // 弱點標記（感測器 4 層）＋破甲，各自算、相加，沒有上限
    if (vul > 0) dmg *= 1 + vul;
    if (this.share && !this.share.dead) {  // 雙子獵艦的另一艘：傷害算在共用的那條血（主艦）上，擊退照自己
      this.flash = 0.08;
      const over = knock == null ? 0 : knock - this.t.knockResist, l = Math.hypot(kx, ky);
      if (over > 0 && l > 0 && this.mode !== 'charge') this.push(kx / l * over * CFG.BOSS_KNOCK, ky / l * over * CFG.BOSS_KNOCK);
      this.share.hurt(dmg, 0, 0, source, att, null, true);
      this.hp = this.share.hp;
      return;
    }
    if (this.ledT > 0) dmg *= AFFIX.command.taken;  // 精英「統帥」身邊的小兵：受到的傷害 −20%
    if (att) this.lastAtt = att;
    this.lastSrc = source;  // 最後一下的傷害方式（回響 echo 擊殺算進解鎖進度）
    if (!this.alert) Game.wakeEnemy(this);  // 待機中被打到：醒來，叫醒身邊的同伴
    if (this.t.alarm && this.ringT == null) this.ringT = CFG.ALARM.delay;  // 警報艇：開始響（倒數完開始叫人，見 THEME_AI.alarm）
    Game.recordDamage(source, this.t.dummy ? dmg : Math.min(dmg, Math.max(0, this.hp)), att);  // 只算實際扣掉的血（標靶算全額）
    if (Game.mode === 'range') Range.hit(dmg, source);  // 靶場（標靶或實戰）的傷害都算進數據
    this.hp -= dmg; this.flash = 0.08;
    if (this.link && source !== 'link') Game.shareLink(this, dmg, att);  // 共鳴（電漿升級）：分 60% 給其他連結的
    if ((this.t.dummy || this.immortal) && this.hp <= 0) this.hp += this.maxHp * Math.ceil(-this.hp / this.maxHp + 0.001);  // 標靶（和靶場手動生的「打不死」）打不死
    if (this.t.boss) {
      const over = knock == null ? 0 : knock - this.t.knockResist, l = Math.hypot(kx, ky);
      if (over > 0 && l > 0 && this.mode !== 'charge') this.push(kx / l * over * CFG.BOSS_KNOCK, ky / l * over * CFG.BOSS_KNOCK);
    } else if (this.mode !== 'charge' && !this.t.anchored) this.push(kx, ky);  // 母巢（anchored）不吃擊退
    if (this.has('split') && !this.splitDone && this.hp > 0 && this.hp <= this.maxHp * AFFIX.split.at) this.splitNow = true;  // 精英「分裂」：下一幀分成兩隻
    if (this.hp <= 0 && !this.dead) { this.dead = true; this.killer = att ? att.owner : Game.shooter; this.killAtt = att; Game.onEnemyKilled(this); }
  }
}

// ---------- 主題小兵的行為（this = Enemy）；回傳 true 表示這一幀的移動已經處理完 ----------
const THEME_AI = {
  gunboat(dt, p, dx, dy, d) {  // 停在 420～520 外；每 3 秒閃 0.6 秒後從 8 根砲管各射一發慢速彈（砲塔 rot 慢慢轉）
    if (this.mode === 'windup') {
      this.modeT -= dt; this.vx *= 0.9; this.vy *= 0.9; this.move(dt);
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
      this.modeT -= dt; this.vx *= 0.8; this.vy *= 0.8; this.move(dt);
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
  if (this.cd <= 0) { this.cd = T.cd; T.fire.call(this, Game.nearestPlayer(this.x, this.y) || Game.player); Events.emit('enemyShot', this); }
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
      P.ang += dt * (rage ? C.spinRage : C.spin) * endlessAtk() * P.dir;
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
    this.rot += dt * (rage ? W.spinRage : W.spin) * endlessAtk();
    if ((this.cd -= dt) <= 0) this.cd += W.beam + W.rest;  // cd > rest：光束開著；cd < warn：快開了（預警線）
  },
};

// 每秒轉幾弧度（e.rot：虛空獵手環形彈的起始角、彈幕艇的砲塔；畫面也用）
const ENEMY_SPIN = { brute: 0.8, elite: 1.5, boss: 0.4, gunboat: 0.5 };

// 精英的行為（詞綴在 affixTick 先跑過）：this = 敵人；p = 目標（最近的玩家或殘影）；dx, dy, d = 往目標的向量和距離
//   回傳 true = 這一幀的移動處理完了；false = 照 Enemy.update 下面的一般追擊
const ELITE_AI = {
  elite(dt, p, dx, dy, d) {  // 虛空獵手：蓄力衝鋒／兩圈環形彈輪流
    if (this.mode === 'windup') {
      this.modeT -= dt; this.vx *= 0.85; this.vy *= 0.85; this.move(dt);
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
      this.modeT -= dt; this.vx *= 0.85; this.vy *= 0.85; this.move(dt);
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
      this.modeT -= dt; this.vx *= 0.9; this.vy *= 0.9; this.move(dt);
      if (this.modeT <= 0) this.mode = 'chase';
      return true;
    }
    if (this.mode === 'aim' || this.mode === 'pull') {
      const q = this.tgtP, alive = q && !q.dead && !q.gone, qd = alive ? Math.hypot(q.x - this.x, q.y - this.y) : Infinity;
      if (!alive || qd > T.lose || this.losTo(q) || (this.mode === 'pull' && q.dashT > 0)) { this.breakBeam(alive && this.mode === 'pull' && q.dashT > 0); return true; }
      this.chargeA = Math.atan2(q.y - this.y, q.x - this.x);
      this.vx *= 0.85; this.vy *= 0.85; this.move(dt);
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
