// 星環電路 雙人版 · entities.js：Player、Bullet、敵人種類 ENEMY_TYPES 與 Enemy（含旗艦技能）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// ENTITIES
// =====================================================================
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
    this.chargeC = 0; this.ohT = 0; this.ohLock = 0; this.blinkT = 0;
    this.wasDash = false; this.dashDir = 0; this.dashHit = new Set(); this.dx0 = this.x; this.dy0 = this.y;
  }
  // 開火（房主執行；隊友的飛船要在 withLoadout(隊友配裝) 裡呼叫）：超頻模組過熱、蓄力、一般連射
  tickFire(dt, want) {
    const S = Game.stats, held = want;
    this.fireCd -= dt;
    if (this.noFireT > 0) { this.noFireT -= dt; want = false; }  // 裂界推進器：衝刺後不能射擊
    if (S.heatLimit) {
      if (this.ohLock > 0) { this.ohLock -= dt; want = false; }
      else if (want) {
        this.ohT += dt;
        if (this.ohT >= S.heatLimit) { this.ohLock = 1.5; this.ohT = 0; burst(this.x, this.y, '#ff9f1c', 14, 160, 0.5, 3); SFX.play('hurt'); }
      } else this.ohT = Math.max(0, this.ohT - dt * 1.5);
    } else { this.ohT = 0; this.ohLock = 0; }
    // 停火蓄力：沒按射擊時累積，再按下的第一發依蓄力程度變強（之後照常連射）
    if (!S.charge) this.chargeC = 0;
    else if (!held) this.chargeC = Math.min(1, this.chargeC + dt / S.chargeTime);
    this.quenchT -= dt;
    if (want && this.fireCd <= 0) {
      const M = Game.mech, rate = M.rate * (M.traits.gale && this.moving ? 1.2 : 1) * (this.quenchT > 0 ? 1.3 : 1);  // 散熱片、疾風、急冷
      Game.chargeC = S.charge ? this.chargeC : null;
      try { this.fire(); } finally { Game.chargeC = null; }
      this.chargeC = 0; this.fireCd = S.interval / rate;
    }
  }
  // 衝刺相關的晶片（房主執行）：衝刺中的流星、衝刺結束時的衝刺射擊
  tickDash() {
    const dashing = this.dashT > 0, S = Game.stats;
    if (dashing && !this.wasDash) { this.dashHit.clear(); this.dx0 = this.x; this.dy0 = this.y; }
    if (dashing && Math.hypot(this.vx, this.vy) > 100) this.dashDir = Math.atan2(this.vy, this.vx);
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
      if (M.module === 'thruster') this.noFireT = 0.5;
      if (M.module === 'blink' && M.heavy) Game.explode(this.x, this.y, 110, 25, '#b388ff', null, { src: 'ship', cr: null, owner: Game.shooter || null });
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
      if (list.length) spawnShots(list, this.x + Math.cos(this.aim) * 4, this.y + Math.sin(this.aim) * 4, this.aim, 0, null);
    }
    this.wasDash = dashing;
  }
  onDash() {  // 衝刺開始（房主執行；隊友的衝刺由房主在隊友的配裝下執行）：排熱爆發
    if (Net.role === 'client') return;
    if (Game.mech.traits.vent) {  // 排熱爆發（散熱片 4 層）：朝四周放出 12 發
      const w = Game.wp, list = Array.from({ length: 12 }, (_, i) => shot({ angle: i / 12 * TAU, speed: Math.min(700, w.speed), damage: w.damage,
        radius: w.radius, life: 0.6, color: '#ffb38a', shape: w.shape === 'blade' ? 'dot' : w.shape, src: 'ship' }));
      spawnShots(list, this.x, this.y, 0, 0, null);
    }
  }
  get invuln() { return this.iframe > 0 || this.dashT > 0; }
  update(dt) {
    const K = Input.keys, P = Game.passives;
    let mx = 0, my = 0;
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
        target = nearestEnemy(this.x, this.y, a ? 900 : reach, null, true);
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

    this.dashCd -= dt;
    if (Input.dash || (Input.dashHeld && this.dashCd <= 0 && Game.state === 'play')) {  // 按住衝刺鍵：冷卻一好就再衝
      Input.dash = false;
      if (this.dashCd <= 0) {
        const M = Game.mech;
        this.dashT = CFG.DASH_TIME * M.dashDist;
        this.dashCd = this.ship.dashCd * (1 - P.dashCd) * M.dashCd;
        this.dashA = this.moving ? Math.atan2(my, mx) : this.aim;
        this.dashSX = this.x; this.dashSY = this.y;  // 衝刺起點（星門號的第一個門）：在瞬移之前記
        if (M.module === 'blink') {  // 相位跳躍：瞬移，留一小段「衝刺中」讓衝刺結束的效果照常觸發
          const x0 = this.x, y0 = this.y;
          if (Arena.rect) {
            this.x = clamp(this.x + Math.cos(this.dashA) * 150, this.r, CFG.WORLD_W - this.r);
            this.y = clamp(this.y + Math.sin(this.dashA) * 150, this.r, CFG.WORLD_H - this.r);
          } else {  // 大地圖：不能瞬移穿牆、穿閘門
            const d = Arena.rayFree(this.x, this.y, this.dashA, 150, this.r);
            this.x += Math.cos(this.dashA) * d; this.y += Math.sin(this.dashA) * d;
          }
          this.dashT = 0.05; this.blinkT = 0.05;
          burst(x0, y0, '#b388ff', 12, 160, 0.3, 2);
        }
        this.dashSeq = (this.dashSeq || 0) + 1;  // 連線時告訴房主「衝刺了一次」
        burst(this.x, this.y, this.ship.color, 10, 160, 0.3, 2);
        if (Game.runStats) Game.runStats.dashes++;
        SFX.play('dash');
        this.onDash();
      }
    }
    if (this.dashT > 0) {
      this.dashT -= dt;
      const sp = this.blinkT > 0 ? 0 : CFG.DASH_SPEED;
      this.blinkT -= dt;
      this.vx = Math.cos(this.dashA) * sp;
      this.vy = Math.sin(this.dashA) * sp;
      if (Game.particles.length < 1500)
        Game.particles.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: this.ship.color, size: 5 });
    } else {
      const l = Math.max(1, Math.hypot(mx, my)), spd = this.ship.speed * (1 + P.speed) * Game.mech.speed, k = Math.min(1, dt * 12);
      this.vx += (mx / l * spd - this.vx) * k;
      this.vy += (my / l * spd - this.vy) * k;
    }
    const x0 = this.x, y0 = this.y;
    if (Arena.rect) {
      this.x = clamp(this.x + this.vx * dt, this.r, CFG.WORLD_W - this.r);
      this.y = clamp(this.y + this.vy * dt, this.r, CFG.WORLD_H - this.r);
    } else {  // 大地圖：撞牆停住；打開的閘門可以往前穿過（穿過去就到下一區，不能回頭）
      this.x += this.vx * dt; this.y += this.vy * dt;
      Arena.collide(this, this.r, Arena.shipPass(this));
      Arena.updateZone(this);
    }
    this.moduleMove(dt);
    Objects.moveShip(this, dt);  // 地圖物件：黑洞拉扯、行星與小行星擋住
    Game.portalShip(this, x0, y0);   // 星門：走進門從另一個門出來

    this.iframe -= dt;
    this.overdrive -= dt;
    this.wantFire = Input.down;
    if (Net.role === 'client') return;  // 連線的隊友：開火交給房主（子彈、傷害都由房主計算）
    this.tickDash();
    this.tickFire(dt, Input.down);
  }
  // 背包模組對飛船移動的影響：目前沒有（重力井改成減速場，見 Game.tickModules）
  moduleMove(dt) {}

  fire() {
    const list = runOps(Game.stats.ops, 0);
    if (!list.length) return;
    if (list.every(s => s.orbit) && (this.orbV ? this.orbV.size : 0) >= orbCap(list[0].orbit)) return;  // 環繞存滿：按住也不再射
    const nx = this.x + Math.cos(this.aim) * 16, ny = this.y + Math.sin(this.aim) * 16;
    // 子彈從船身中心附近發出：怪物貼臉時也打得到（槍口火光仍在船頭）
    spawnShots(list, this.x + Math.cos(this.aim) * 4, this.y + Math.sin(this.aim) * 4, this.aim, 0, null);
    SFX.play('shoot', Game.weapon.id);
    burst(nx, ny, list[0].color, 3, 120, 0.15, 2);
  }
}

// 環繞：Lv1 最多存 10 發、3 秒轉到 2 倍；Lv2 起 20 發、2 秒轉到 3 倍。「一發」= 一次開火（散彈一次的 5 顆算同一發）
const orbCap = lv => lv >= 2 ? 20 : 10;
let volleySeq = 0, curVolley = 0;  // 每次 spawnShots 算一發（環繞用來數存了幾發）
// 速度倍率（加速、疾射）照「射程進度」算：p = 已飛距離 ÷ 射程（射程 = 出手速度 × 存活時間；加速 ×1.5），超過射程停在終點的值
//   加速 0.5 → 3（Lv2 4）、疾射 3（Lv2 4）→ 0.5，兩個都裝時加在同一個倍率上；環繞放出時加速不扣起步的 0.5
const SPD_CAP = 5;
const spdTop = lv => lv >= 2 ? 4 : 3;
const accelAdd = (lv, p, full) => !lv ? 0 : (full ? -0.5 : 0) + (spdTop(lv) - 0.5) * p;
const quickAdd = (lv, p) => !lv ? 0 : spdTop(lv) - 1 - (spdTop(lv) - 0.5) * p;
const orbSpinOf = (lv, held) => lv >= 2 ? 1 + 2 * Math.min(1, held / 2) : 1 + Math.min(1, held / 3);
const orbSpinMax = lv => lv >= 2 ? 3 : 2;

class Bullet {
  constructor(x, y, angle, s, depth, ignoreId) {
    this.x = x; this.y = y; this.px = x; this.py = y; this.angle = angle;
    this.sx = x; this.sy = y;  // 發射點：畫尾巴時不超過已飛行的距離（不然剛射出時尾巴會從船屁股露出來）
    this.speed = s.speed; this.damage = s.damage; this.r = s.radius;
    this.pierce = s.pierce; this.bounce = s.bounce; this.homing = s.homing;
    this.life = s.life; this.color = s.color; this.shape = s.shape;
    this.payload = s.payload; this.depth = depth;
    this.explode = s.explode; this.burn = s.burn; this.shards = s.shards; this.shard = s.shard; this.arcs = s.arcs || null;
    this.slow = s.slow; this.slowDur = s.slowDur || 0; this.burnR = s.burnR || 0; this.shred = s.shred || 0; this.knock = s.knock; this.lifesteal = s.lifesteal;
    this.att = { src: s.src || 'weapon', cr: s.cr, owner: Game.shooter || null };  // 傷害統計歸屬（owner：雙人時是誰打的）
    this.splits = s.splits || 0;  // 被分裂過幾次（畫面上顯示殘影用）
    this.hitSet = new Set();
    if (ignoreId != null) this.hitSet.add(ignoreId);
    this.owner = Game.shooter || null;  // 雙人：這顆子彈是誰的電路射出的（null = 房主自己）
    this.ownerP = Game.shooter ? Game.mate : Game.player;  // 環繞、迴旋要跟著／飛回的飛船
    this.dead = false;
    // V2 改玩法的晶片
    this.baseSpeed = this.speed0 = s.speed;  // speed0：武器原本的速度（佈雷衝出去會改 baseSpeed，迴旋回程用這個）
    this.boom = s.boom; this.orbit = s.orbit; this.stasis = s.stasis; this.accel = s.accel; this.quick = s.quick; this.intercept = s.intercept; this.parry = s.parry; this.prism = s.prism;
    this.rear = s.rear; this.full = s.full; this.endBoom = s.endBoom; this.sticky = s.sticky; this.pull = s.pull;
    this.dashShot = s.dashShot; this.infGen = s.infGen || 0;
    // 傷害加成：bonus = 武器層（倍增、蓄力、速度倍率…相加），hb = 宿主層（插在玩法晶片上的倍增…）；hm = 還沒出現的產物要套用的組件（見 hostFire）
    this.bonus = s.bonus || 0; this.wsb = s.wsb || 0; this.wsbOff = s.wsbOff || 0; this.hb = s.hb || 0; this.qhb = s.qhb || 0; this.hm = s.hm || null; this.pullMul = s.pullMul || 1;
    this.tAcc = 0; this.tN = 0;  // 定時觸發器：計時、已觸發次數
    this.mode = 'fly'; this.flyAge = 0; this.accelMul = 1; this.dashed = false;  // accelMul = 速度倍率（相對出手時；打中時加進傷害加成，最多 5）
    if (this.accel) this.life *= 1.5;  // 加速：射程 ×1.5
    // R：射程；dist：已飛距離（佈雷衝出去、迴旋回程都接著算，只有開火和環繞放出重新算）；mul0：起始倍率（環繞放出時是轉速倍率）
    this.R = this.speed0 * this.life; this.dist = 0; this.mul0 = 1; this.accFull = true;
    if (this.accel || this.quick) this.setMul();
    if (s.infect) this.att.inf = { tpl: s, lv: s.infect, gen: this.infGen };  // 感染：擊殺時照這個樣板爆出子彈
    if (this.orbit && depth > 0) this.orbit = 0;  // 觸發射出的子彈不進圈（不會瞬移回飛船）
    this.vid = curVolley;
    if (this.orbit) {  // 環繞：存在飛船旁邊（Lv1 10 發，Lv2 20 發；同一次開火的子彈算一發；存滿了多的丟掉）
      const o = this.ownerP, V = o && (o.orbV || (o.orbV = new Set()));
      if (o && (V.has(this.vid) || V.size < orbCap(this.orbit))) {
        V.add(this.vid);
        this.mode = 'orbit'; this.phase = angle; this.orbR = 0; this.R = 60;
        this.life0 = this.life; this.life = 99;
      } else this.dead = true;  // 存滿了：多的子彈不射出去
    }
  }
  // 速度倍率 = 起始倍率 ＋ 加速 ＋ 疾射（照射程進度），0.5～5
  setMul() {
    const p = Math.min(1, this.dist / this.R);
    this.accelMul = clamp(this.mul0 + accelAdd(this.accel, p, this.accFull) + quickAdd(this.quick, p), 0.5, SPD_CAP);
    this.speed = this.baseSpeed * this.accelMul;
    // 加速、疾射的產物：速度 1.5 倍以上（武器插座的傷害加成不算；疾射掉回 1.5 倍以下時加回來）
    if (this.accelMul >= CFG.HOST_SPEED) stripW(this); else if (this.wsbOff) restoreW(this);
    if (this.hm && this.hm.accel && this.accelMul >= CFG.HOST_SPEED) hostFire(this, 'accel');  // 加速的產物：速度到 1.5 倍
    if (this.qhb && this.accelMul < CFG.HOST_SPEED) {  // 疾射的產物只有高速段：掉到 1.5 倍以下，插在疾射上的傷害加成失效
      const nb = this.hb - this.qhb;
      this.damage = this.damage / Math.max(0.1, 1 + this.hb) * Math.max(0.1, 1 + nb);
      this.hb = nb; this.qhb = 0;
    }
  }
  // 消失觸發器：子彈消失時從這裡沿原本的方向射出回響
  endTrig() {
    const P = this.payload, Q = Game.triggerQueue;
    if (!P || P[0].trig !== 'end' || this.endDone || Q.length >= CFG.MAX_TRIGGERS_PER_FRAME) return;
    this.endDone = true;
    Q.push({ payload: P, x: this.x, y: this.y, angle: this.angle, depth: this.depth + 1, ignore: null, owner: this.owner, fi: this.fromIntercept });
  }
  // 定時觸發器：飛行中每 0.3 秒往左右兩側各射一次回響（每顆最多 5 次；停住的地雷不算）
  tickTimer(dt) {
    const P = this.payload;
    if (!P || P[0].trig !== 'time' || this.tN >= CFG.TIMER_MAX || this.mode === 'wait') return;
    if ((this.tAcc += dt) < CFG.TIMER_TRIG) return;
    this.tAcc -= CFG.TIMER_TRIG; this.tN++;
    const Q = Game.triggerQueue;
    for (const sd of [-1, 1]) if (Q.length < CFG.MAX_TRIGGERS_PER_FRAME)
      Q.push({ payload: P, x: this.x, y: this.y, angle: this.angle + sd * Math.PI / 2, depth: this.depth + 1, ignore: null, owner: this.owner, fi: this.fromIntercept });
  }
  // 複製一顆（稜鏡、迴旋風暴用），放進場上的子彈清單
  copy(dAngle) {
    const c = Object.assign(Object.create(Bullet.prototype), this, { hitSet: new Set(this.hitSet) });
    c.angle += dAngle;
    Game.bullets.push(c);
    return c;
  }
  // 迴旋：去程穿甲用完（先穿過去再折返，回程會再打牠一次）、撞到牆（或行星、小行星）、飛到盡頭都會折返，追著射出它的飛船飛回來
  startReturn() {
    const o = this.ownerP;
    this.mode = 'return'; this.life = 4; this.hitSet.clear(); this.flyAge = 0; this.speed = (this.dashed ? this.speed0 : this.baseSpeed) * this.accelMul; this.overT = 0;  // 回程一直追到飛船為止（最多 4 秒）；地雷衝出去的用武器原本的速度飛回
    if (o) this.angle = Math.atan2(o.y - this.y, o.x - this.x);
    // 折返的那一刻剛好重疊到的敵人不算（不然折返點剛好停在下一隻身上會多打一下）；剛剛穿過的那一隻回程照樣再打
    for (const e of Game.enemies) if (e.id !== this.overId && dist2(this.x, this.y, e.x, e.y) < (e.r + this.r) ** 2) this.hitSet.add(e.id);
    this.att = { ...this.att, src: 'boomerang' };  // 傷害統計：回程打中的基礎傷害算迴旋的
    if (this.boom >= 2) { this.damage *= 1.5; this.att = attCredit(this.att, 'boomerang', 1.5); }
    stripW(this);  // 產物：武器插座的傷害加成只算直擊
    const cs = this.boom >= 3 ? [-0.7, 0.7].map(off => this.copy(off)) : [];  // 迴旋風暴：折返時分裂成 3 發（打中、撞牆、飛到盡頭都一樣）
    for (const b of [this, ...cs]) hostFire(b, 'boomerang');  // 插在迴旋上的組件：折返之後的每一發（風暴＋分裂 = 9 發）
  }
  update(dt) {
    this.px = this.x; this.py = this.y;  // 記住這一幀的起點，碰撞用整段路徑判定
    this.tickTimer(dt);
    if (this.mode === 'orbit') {  // 環繞：按住射擊時繞著飛船轉，越轉越快；放開射擊時朝準星射出
      const o = this.ownerP;
      if (!o || o.dead) { this.dead = true; return; }
      const spin = orbSpinOf(this.orbit, o.orbHeld || 0);
      if (!o.wantFire || (o.autoMode && spin >= orbSpinMax(this.orbit))) {  // 放開射擊才放出（衝刺不會）；右邊晶片的效果（迴旋、加速……）從這裡開始
        const d = Math.max(120, o.aimD || 300), tx = o.x + Math.cos(o.aim) * d, ty = o.y + Math.sin(o.aim) * d;
        this.mode = 'fly'; this.angle = Math.atan2(ty - this.y, tx - this.x);  // 從所在位置朝滑鼠當下那一點射出
        // 速度倍率 = 傷害倍率：轉速 1～3 倍 → 放出時速度倍率 1～2（Lv1 最多 1.5）；有加速時從這裡繼續加上去（不相乘）
        // 射程也 × 轉速倍率（放出的子彈飛得比較快，存活時間不變）
        this.mul0 = 1 + 0.5 * (spin - 1); this.accFull = false; this.dist = 0; this.R = this.speed0 * this.life0 * this.mul0;
        this.orbShot = true;  // 放出後命中也算環繞成長
        this.life = this.life0; this.setMul(); this.flyAge = 0; this.hitSet.clear(); this.sx = this.x; this.sy = this.y;
        if (this.orbit >= 3) this.homing = Math.max(this.homing, 1.5);  // 星環：射出的子彈追蹤敵人
        this.orbit = 0;
        stripW(this);
        hostFire(this, 'orbit');  // 插在環繞上的組件：放出的那一波
        return;
      }
      (o.orbV || (o.orbV = new Set())).add(this.vid);
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
      for (const e of Game.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        const gap = Math.hypot(e.x - this.x, e.y - this.y) - e.r;
        if (gap < TR && gap < nb) { nb = gap; near = e; }
      }
      if (!near && this.waitT <= 0) { this.dead = true; this.endTrig(); burst(this.x, this.y, this.color, 4, 60, 0.2, 2); return; }  // 時間到沒被觸發：消失
      if (near) {
        this.angle = Math.atan2(near.y - this.y, near.x - this.x);
        this.damage *= 1.2; this.att = attCredit(this.att, 'stasis', 1.2);
        // 衝出去用武器原本的速度，跑剩下的射程（至少觸發範圍 + 30，射程很短的相刃才碰得到）；
        // 速度倍率接著停住前的射程進度繼續算（加速、疾射都不重新開始）
        this.mode = 'fly'; this.dashed = true; this.baseSpeed = this.speed0;
        this.life = Math.max(this.R - this.dist, TR + 30) / (this.speed0 * this.mul0);
        this.flyAge = 0; this.setMul();
        stripW(this);
        hostFire(this, 'stasis');  // 插在佈雷上的組件：衝出去的地雷
      }
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
      for (const e of Game.enemies) {
        if (e.dead || e.spawnT > 0 || this.hitSet.has(e.id) || e.cloak > 0.5) continue;  // 隱形的潛伏者不追
        const d2 = dist2(this.x, this.y, e.x, e.y);
        if (d2 >= bd || Math.abs(angleDiff(this.angle, Math.atan2(e.y - this.y, e.x - this.x))) > 1.22) continue;
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
    // 加速、疾射的子彈照飛行距離消耗存活時間：不管速度怎麼變，都剛好飛完射程（迴旋回程照秒數，追到飛船為止）
    this.life -= (this.accel || this.quick) && this.mode === 'fly' ? dt * this.accelMul / this.mul0 : dt;
    if (this.accel || this.quick) this.setMul();  // 速度倍率（= 傷害加成）照射程進度變化（移動完馬上更新，碰撞用的是這一幀到達位置的倍率）
    if (!Arena.rect) {  // 大地圖：碰到牆或閘門（環繞中、迴旋回程、停住的地雷不算）
      const hit = this.mode === 'orbit' || this.mode === 'return' || this.mode === 'wait' ? null : Arena.bulletWall(this.px, this.py, this.x, this.y, this.r);
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
          this.dead = true; return;
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
  // 牆反彈之後（方向已經改好）：成長標記、稜鏡分裂、插在牆反彈上的組件
  afterBounce() {
    this.hitSet.clear(); this.life = Math.max(this.life, 0.5);
    this.bounced = true;  // 成長：反彈過的子彈打中才貼標記
    stripW(this);
    const c = this.prism ? this.copy(0.4) : null;  // 稜鏡：反彈時分裂
    if (c) this.angle -= 0.2;
    for (const b of c ? [this, c] : [this]) hostFire(b, 'wallbounce');  // 插在牆反彈上的組件：第一次反彈之後（兩發都套用）
  }
  // 無限穿透：迴旋的回程、超音速（加速 Lv3 且 2 倍速以上）
  get infPierce() { return (!!this.boom && this.mode === 'return') || (this.accel >= 3 && this.accelMul >= 2); }
}

function spawnShots(list, x, y, baseAngle, depth, ignoreId) {
  const B = Game.bullets, M = Game.mech;  // 射出這些子彈的人的機體：感測器（子彈速度、鎖定、弱點標記）
  curVolley = ++volleySeq;
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
  for (const e of Game.enemies) {
    if (e.dead || (exclude && exclude.has(e.id)) || (visible && e.cloak > 0.5)) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

const ENEMY_TYPES = {
  swarmer: { name: '蟲群', hp: 18, speed: 150, radius: 10, dmg: 10, color: '#ff4d6d', credits: 1, shape: 3 },
  brute:   { name: '刺殼', hp: 130, speed: 65, radius: 22, dmg: 25, color: '#ff9f1c', credits: 4, shape: 6 },  // 靠近時縮成球滾過來（見 updateBrute）
  spitter: { name: '噴吐者', hp: 40, speed: 110, radius: 13, dmg: 10, color: '#f72585', credits: 2, shape: 4,
    ranged: { range: 380, cd: 1.8, speed: 260, dmg: 12 } },
  elite:   { name: '虛空獵手', hp: 800, speed: 95, radius: 26, dmg: 30, color: '#ffd400', credits: 12, shape: 5, elite: true },
  // 主題小兵（每場隨機抽幾種，越後面越多，見 Game.pickThemes）
  gunboat:  { name: '彈幕艇', hp: 60, speed: 70, radius: 16, dmg: 10, color: '#ff6b9d', credits: 3, shape: 7 },    // 停在 420～520 外，每 3 秒放一圈 10 發慢速彈（先閃 0.6 秒）
  worm:     { name: '列隊蟲', hp: 14, speed: 130, radius: 9, dmg: 8, color: '#c0ff4d', credits: 1, shape: 4 },    // 6 節排成一列蛇行，後面的跟著前一節；頭死了下一節變成頭
  shield:   { name: '盾衛', hp: 110, speed: 55, radius: 20, dmg: 20, color: '#5ec8ff', credits: 4, shape: 6 },    // 出生時隨機決定盾的方向（120°），之後不轉；打到盾的子彈反彈回去（傷害 ×0.5，最多 25）
  splitter: { name: '分裂體', hp: 70, speed: 80, radius: 18, dmg: 15, color: '#ffb347', credits: 3, shape: 5 },   // 死掉時分成 3 隻碎裂體
  splitling:{ name: '碎裂體', hp: 20, speed: 140, radius: 10, dmg: 8, color: '#ffb347', credits: 0, shape: 3 },  // 不掉晶體、不給成長（都算在分裂體身上）
  lurker:   { name: '潛伏者', hp: 40, speed: 120, radius: 12, dmg: 18, color: '#9d8cff', credits: 3, shape: 3 },   // 平常幾乎透明（有殘影），離 140 內現形 0.4 秒後撲過去
  hive:     { name: '母巢', hp: 300, speed: 0, radius: 30, dmg: 15, color: '#e05d2e', credits: 8, shape: 9 },      // 不會動，每 4 秒生 2 隻蟲群（最多 8 隻；不掉晶體、不給成長）
  // 靶場標靶：不會動、不攻擊、打不死（血量歸零就補滿），被擊退後會慢慢回到原位
  dummy:   { name: '標靶', hp: 5000, speed: 0, radius: 18, dmg: 0, color: '#9fb4ff', credits: 0, shape: 8, dummy: true },
  // 三隻旗艦：第 1～3 關依序出現，無盡模式隨機抽
  boss:    { name: '星噬母艦', hp: 2000, speed: 45, radius: 50, dmg: 35, color: '#ff4d6d', credits: 40, shape: 8, boss: true,
    knockResist: 1.5, rage: '母艦核心暴走', skills: ['spiral', 'fan', 'summon', 'ring'],
    desc: '螺旋彈幕、扇形齊射、召喚蟲群、環形彈。' },
  boss2:   { name: '裂界獵艦', hp: 2800, speed: 80, radius: 42, dmg: 35, color: '#b388ff', credits: 40, shape: 3, boss: true,
    knockResist: 2.5, rage: '獵艦推進器過載', skills: ['charge', 'cross', 'snipe', 'charge', 'deploy'],
    desc: '高速衝鋒（有預警線，衝鋒時往兩側灑彈）、旋轉十字彈流、三連狙擊、部署噴吐者。' },
  boss3:   { name: '終焉核心', hp: 3000, speed: 35, radius: 56, dmg: 40, color: '#2ee6a6', credits: 40, shape: 6, boss: true,
    knockResist: 3.5, rage: '核心臨界', skills: ['nova', 'twin', 'bomb', 'wall', 'guard'],
    desc: '連續缺口環形波、雙向螺旋、落點轟炸、慢速彈牆、召喚刺殼護衛。' },
};

// 無盡模式：每過一個星區，敵人攻擊頻率 ×1.1、移動速度 ×1.05（乘算；攻擊力另外在受傷時 ×1.25）
const endlessK = () => Game.mode === 'run' || Game.mode === 'coop' ? Math.max(0, Game.sector - CFG.CAMPAIGN_SECTORS) : 0;
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
    this.burnT = 0; this.burnDps = 0; this.burnAcc = 0; this.slowT = 0; this.slowAmt = 0; this.shredT = 0; this.shredAmt = 0;
    this.mode = type === 'lurker' ? 'stalk' : 'chase'; this.skillCd = 2.5; this.nextSkill = 'charge'; this.modeT = 0; this.chargeA = 0;
    this.dead = false;
  }
  move(dt) {
    if (Arena.rect) {
      this.x = clamp(this.x + this.vx * dt, this.r, CFG.WORLD_W - this.r);
      this.y = clamp(this.y + this.vy * dt, this.r, CFG.WORLD_H - this.r);
    } else { this.x += this.vx * dt; this.y += this.vy * dt; this.wallN = Arena.collide(this, this.r, null); }  // 大地圖：撞牆停住，閘門過不去
  }
  update(dt, p) {
    this.flash = Math.max(0, this.flash - dt);
    if (this.burnT > 0) {  // 燃燒：持續扣血
      this.burnT -= dt;
      this.burnAcc += this.burnDps * dt;
      if (this.burnAcc >= 1) {
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
    if (this.slowT > 0) this.slowT -= dt;
    if (this.markT > 0) this.markT -= dt;
    if (this.shredT > 0) this.shredT -= dt;
    this.spdMul = this.slowT > 0 ? 1 - this.slowAmt : 1;
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    const t = this.t;
    if (t.dummy || this.frozen) {  // 標靶（和靶場手動生的「不動」敵人）：被擊退後像彈簧一樣回到原位，不移動也不攻擊
      const k = Math.min(1, dt * 6);
      this.vx += ((this.hx - this.x) * 8 - this.vx) * k;
      this.vy += ((this.hy - this.y) * 8 - this.vy) * k;
      this.move(dt);
      return;
    }
    const dx = p.x - this.x, dy = p.y - this.y, d = Math.hypot(dx, dy) || 1;
    this.rot += dt * (this.type === 'brute' ? 0.8 : this.type === 'elite' ? 1.5 : this.type === 'boss' ? 0.4 : 0);
    if (t.boss) { this.updateBoss(dt, dx, dy, d); return; }
    if (this.type === 'brute' && this.updateBrute(dt, dx, dy, d)) return;
    if (THEME_AI[this.type] && THEME_AI[this.type].call(this, dt, p, dx, dy, d)) return;

    if (t.elite) {  // 精英：蓄力衝鋒 / 環形彈幕 交替
      if (this.mode === 'windup') {
        this.modeT -= dt; this.vx *= 0.85; this.vy *= 0.85; this.move(dt);
        if (this.modeT <= 0) {
          this.mode = 'charge'; this.modeT = 0.45;
          this.vx = Math.cos(this.chargeA) * 800; this.vy = Math.sin(this.chargeA) * 800;
        }
        return;
      }
      if (this.mode === 'charge') {
        this.modeT -= dt; this.move(dt);
        if (Game.particles.length < 1500)
          Game.particles.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.3, max: 0.3, color: t.color, size: 6 });
        if (this.modeT <= 0) this.mode = 'chase';
        return;
      }
      // 環形彈：20 發，0.35 秒後錯開半格再放一圈（兩圈之間有縫可以鑽）
      const eliteRing = off => { for (let i = 0; i < 20; i++) {
        const a = (i + off) / 20 * TAU + this.rot;
        Game.eBullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, r: 6, dmg: 14, life: 4, from: t.name });
      } };
      if (this.ring2T > 0 && (this.ring2T -= dt) <= 0) eliteRing(0.5);
      this.skillCd -= dt * endlessAtk();
      if (this.skillCd <= 0) {
        this.skillCd = 2.2;
        if (this.nextSkill === 'charge') {
          this.mode = 'windup'; this.modeT = 0.65; this.chargeA = Math.atan2(dy, dx); this.nextSkill = 'ring';
        } else {
          eliteRing(0); this.ring2T = 0.35;
          this.nextSkill = 'charge';
        }
      }
    }

    // 看不到玩家（中間有行星或小行星）：照尋路方向繞過去或鑽縫
    let bx = dx / d, by = dy / d;
    const blocked = Game.objs.length && Objects.losBlocked(this.x, this.y, p.x, p.y, this.r * 0.8);
    if (blocked) { const f = Objects.flowDir(this, p); if (f) [bx, by] = f; }
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
      if (this.cd <= 0 && d < R + 120) {
        this.cd = t.ranged.cd;
        const a = Math.atan2(dy, dx);
        Game.eBullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * t.ranged.speed, vy: Math.sin(a) * t.ranged.speed,
          r: 5, dmg: t.ranged.dmg, life: 3, from: t.name });
        SFX.play('eshot');
      }
    }
    if (Game.objs.length) [mx, my] = Objects.steer(this, mx, my);  // 繞開黑洞
    const ml = Math.hypot(mx, my) || 1;
    const k = Math.min(1, dt * 4);
    this.vx += (mx / ml * t.speed * this.spdMul * endlessSpd() - this.vx) * k;
    this.vy += (my / ml * t.speed * this.spdMul * endlessSpd() - this.vy) * k;
    this.move(dt);
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
      if (Game.particles.length < 1500 && Math.random() < 0.5)
        Game.particles.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: this.t.color, size: 5 });
      if (this.modeT <= 0) { this.mode = 'stun'; this.modeT = B.stunT; }
      return true;
    }
    if (this.mode === 'stun') {  // 暈眩：滑行停下，這段時間是反擊的機會
      this.modeT -= dt; this.vx *= 0.88; this.vy *= 0.88; this.move(dt);
      if (this.modeT <= 0) { this.mode = 'chase'; this.rollCd = B.cooldown; }
      return true;
    }
    this.rollCd -= dt * endlessAtk();
    if (this.rollCd <= 0 && d < B.range) { this.mode = 'windup'; this.modeT = B.windup; this.chargeA = Math.atan2(dy, dx); return true; }
    return false;
  }
  // ---------- 旗艦（三隻共用框架，技能清單寫在 ENEMY_TYPES.skills；半血後暴走） ----------
  //   星噬母艦：螺旋彈幕 / 扇形齊射 / 召喚蟲群 / 環形彈
  //   裂界獵艦：預警衝鋒（兩側灑彈）/ 旋轉十字彈流 / 三連狙擊 / 部署噴吐者
  //   終焉核心：缺口環形波 / 雙向螺旋 / 慢速彈牆 / 刺殼護衛
  shootAt(a, spd, r = 6, dmg = 14) {  // 旗艦子彈傷害（整局模擬調的）：前兩隻 ×0.85（第一星區旗艦原本是斷層）、終焉核心 ×1.15（第三星區原本太簡單）
    Game.eBullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, r, dmg: dmg * (this.type === 'boss3' ? 1.15 : this.t.boss ? 0.85 : 1), life: 10, from: this.t.name, boss: !!this.t.boss });  // 王的子彈存在 10 秒；boss：會削行星、打碎小行星
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
      e.summoned = true;  // 旗艦叫出來的小怪不掉晶體
      Game.enemies.push(e);
    }
    burst(this.x, this.y, this.t.color, 24, 200, 0.5, 2);
  }
  updateBoss(dt, dx, dy, d) {
    const t = this.t, rage = this.hp < this.maxHp * 0.5;
    this.blocked = (Game.objs.length ? Objects.losBlocked(this.x, this.y, this.x + dx, this.y + dy, 6) : null) || Arena.losPoint(this.x, this.y, this.x + dx, this.y + dy, 6);  // 大地圖：牆、柱子也算
    if (rage && !this.enraged) {
      this.enraged = true; this.skillCd = Math.min(this.skillCd, 1);
      Game.banner = { text: t.rage, sub: '攻擊頻率上升', t: 2 };
      Game.shake(14);
      burst(this.x, this.y, t.color, 60, 380, 0.8, 3);
    }
    if (this.mode === 'windup') {  // 裂界獵艦：蓄力（畫面上有預警線），期間慢慢停下
      this.modeT -= dt; this.vx *= 0.85; this.vy *= 0.85; this.move(dt);
      if (this.modeT <= 0) {
        this.mode = 'charge'; this.modeT = 0.6; this.fireAcc = 0;
        this.vx = Math.cos(this.chargeA) * 760; this.vy = Math.sin(this.chargeA) * 760;
        Game.shake(6);
      }
    } else if (this.mode === 'charge') {  // 衝鋒：往兩側灑出慢速彈，撞牆或時間到就停
      this.modeT -= dt; this.move(dt); this.fireAcc += dt;
      while (this.fireAcc >= 0.07) {
        this.fireAcc -= 0.07;
        this.shootAt(this.chargeA + Math.PI / 2, 110, 5, 12);
        this.shootAt(this.chargeA - Math.PI / 2, 110, 5, 12);
      }
      if (Game.particles.length < 1500)
        Game.particles.push({ x: this.x, y: this.y, vx: 0, vy: 0, life: 0.35, max: 0.35, color: t.color, size: 8 });
      const wall = Arena.rect ? this.x <= this.r + 1 || this.x >= CFG.WORLD_W - this.r - 1 || this.y <= this.r + 1 || this.y >= CFG.WORLD_H - this.r - 1 : !!this.wallN;  // 大地圖：撞牆（move 記下的 wallN）
      if (this.modeT <= 0 || wall) { this.mode = 'chase'; this.vx *= 0.3; this.vy *= 0.3; }
    } else {
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
    if (this.skillCd > 0 || this.mode !== 'chase') return;
    this.skill = t.skills[this.skillIdx++ % t.skills.length];
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
        SFX.play('boss');
        this.skillCd = rage ? 2.2 : 2.8; break;
      }
      case 'guard':
        this.summon('brute', rage ? 2 : 1, 110, 0.6);
        this.summon('swarmer', rage ? 6 : 4, 80, 0.8);
        this.skillCd = rage ? 3 : 3.6; break;
    }
  }
  // knock：子彈的擊退值（只有子彈命中會帶）。旗艦只有在擊退值超過自己的抗擊退時才會被推，力道只看超過的部分；
  // 爆炸、震波、電弧不會推王。衝鋒中的敵人不會被推
  hurt(dmg, kx, ky, source = 'direct', att = null, knock = null) {
    const vul = (this.markT > 0 ? 0.25 : 0) + (this.shredT > 0 ? this.shredAmt : 0);  // 弱點標記（感測器 4 層）＋破甲，相加最多 +50%
    if (vul > 0) dmg *= 1 + Math.min(0.5, vul);
    if (att) this.lastAtt = att;
    Game.recordDamage(source, this.t.dummy ? dmg : Math.min(dmg, Math.max(0, this.hp)), att);  // 只算實際扣掉的血（標靶算全額）
    if (Game.mode === 'range') Range.hit(dmg, source);  // 靶場（標靶或實戰）的傷害都算進數據
    this.hp -= dmg; this.flash = 0.08;
    if ((this.t.dummy || this.immortal) && this.hp <= 0) this.hp += this.maxHp * Math.ceil(-this.hp / this.maxHp + 0.001);  // 標靶（和靶場手動生的「打不死」）打不死
    if (this.t.boss) {
      const over = knock == null ? 0 : knock - this.t.knockResist, l = Math.hypot(kx, ky);
      if (over > 0 && l > 0 && this.mode !== 'charge') { this.vx += kx / l * over * CFG.BOSS_KNOCK; this.vy += ky / l * over * CFG.BOSS_KNOCK; }
    } else if (this.mode !== 'charge') { this.vx += kx; this.vy += ky; }
    if (this.hp <= 0 && !this.dead) { this.dead = true; this.killer = att ? att.owner : Game.shooter; this.killAtt = att; Game.onEnemyKilled(this); }
  }
}

// ---------- 主題小兵的行為（this = Enemy）；回傳 true 表示這一幀的移動已經處理完 ----------
const THEME_AI = {
  gunboat(dt, p, dx, dy, d) {  // 停在 420～520 外；每 3 秒閃 0.6 秒後放一圈 10 發慢速彈
    if (this.mode === 'windup') {
      this.modeT -= dt; this.vx *= 0.9; this.vy *= 0.9; this.move(dt);
      if (this.modeT <= 0) {
        this.mode = 'chase'; this.cd = 3;
        const off = rand(0, TAU);
        for (let i = 0; i < 10; i++) { const a = off + i / 10 * TAU; Game.eBullets.push({ x: this.x, y: this.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 6, dmg: 10, life: 5, from: this.t.name }); }
        SFX.play('eshot');
      }
      return true;
    }
    let [mx, my] = this.chaseDir(p, dx, dy, d);
    if (d < 420) { mx = -dx / d; my = -dy / d; }
    else if (d < 520) { const s = Math.sin(this.phase) > 0 ? 1 : -1; mx = -dy / d * s * 0.5; my = dx / d * s * 0.5; }
    this.cd -= dt * endlessAtk();
    if (this.cd <= 0 && d < 750) { this.mode = 'windup'; this.modeT = 0.6; }
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
    this.steerMove(dt, ax, ay, ad > 22 ? sp * Math.min(1.6, ad / 22) : sp * 0.3, 8);
    return true;
  },
  lurker(dt, p, dx, dy, d) {  // 隱形接近 → 離 140 內現形 0.4 秒（預警線）→ 撲過去 0.4 秒 → 現形 2 秒 → 再隱形
    this.cloak = this.mode === 'stalk' ? Math.min(1, this.cloak + dt * 2) : 0;
    if (this.mode === 'windup') {
      this.modeT -= dt; this.vx *= 0.8; this.vy *= 0.8; this.move(dt);
      if (this.modeT > 0.15) this.chargeA = Math.atan2(dy, dx);
      if (this.modeT <= 0) { this.mode = 'charge'; this.modeT = 0.4; this.vx = Math.cos(this.chargeA) * 520; this.vy = Math.sin(this.chargeA) * 520; }
      return true;
    }
    if (this.mode === 'charge') { this.modeT -= dt; this.move(dt); if (this.modeT <= 0) { this.mode = 'shown'; this.modeT = 2; } return true; }
    if (this.mode === 'shown' && (this.modeT -= dt) <= 0) this.mode = 'stalk';
    if (this.mode === 'stalk' && d < 140 && this.cloak >= 1) { this.mode = 'windup'; this.modeT = 0.4; this.chargeA = Math.atan2(dy, dx); return true; }
    const [mx, my] = this.chaseDir(p, dx, dy, d);
    this.steerMove(dt, mx, my, this.t.speed);
    return true;
  },
  hive(dt) {  // 不會動；每 4 秒生 2 隻蟲群（同時最多 8 隻）
    this.vx *= 0.9; this.vy *= 0.9; this.move(dt);
    this.cd -= dt * endlessAtk();
    if (this.cd > 0) return true;
    this.cd = 4;
    this.kids = (this.kids || []).filter(k => !k.dead);
    for (let i = 0; i < 2 && this.kids.length < 8; i++) {
      const a = rand(0, TAU), k = new Enemy('swarmer', ...Arena.clampIn(this.x + Math.cos(a) * 45, this.y + Math.sin(a) * 45, 40), this.hpScale);
      k.summoned = true; k.noGrow = true;  // 不掉晶體、不給晶片成長（不然可以一直刷）
      this.kids.push(k); Game.enemies.push(k);
    }
    burst(this.x, this.y, this.t.color, 10, 120, 0.4, 2);
    return true;
  },
};
