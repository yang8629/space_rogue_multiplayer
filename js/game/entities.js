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
    this.x = CFG.WORLD_W / 2; this.y = CFG.WORLD_H / 2; this.vx = 0; this.vy = 0;
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
        target = nearestEnemy(this.x, this.y, a ? 900 : reach, null);
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
    if (Input.dash) {
      Input.dash = false;
      if (this.dashCd <= 0) {
        const M = Game.mech;
        this.dashT = CFG.DASH_TIME * M.dashDist;
        this.dashCd = this.ship.dashCd * (1 - P.dashCd) * M.dashCd;
        this.dashA = this.moving ? Math.atan2(my, mx) : this.aim;
        this.dashSX = this.x; this.dashSY = this.y;  // 衝刺起點（星門號的第一個門）：在瞬移之前記
        if (M.module === 'blink') {  // 相位跳躍：瞬移，留一小段「衝刺中」讓衝刺結束的效果照常觸發
          const x0 = this.x, y0 = this.y;
          this.x = clamp(this.x + Math.cos(this.dashA) * 150, this.r, CFG.WORLD_W - this.r);
          this.y = clamp(this.y + Math.sin(this.dashA) * 150, this.r, CFG.WORLD_H - this.r);
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
    this.x = clamp(this.x + this.vx * dt, this.r, CFG.WORLD_W - this.r);
    this.y = clamp(this.y + this.vy * dt, this.r, CFG.WORLD_H - this.r);
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
const quickBonus = lv => !lv ? 0 : lv >= 2 ? 1.25 : 1;  // 疾射：出手時速度倍率 +1（Lv2 +1.25）
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
    this.slow = s.slow; this.knock = s.knock; this.lifesteal = s.lifesteal;
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
    this.mode = 'fly'; this.flyAge = 0; this.accelMul = 1; this.dashed = false;  // accelMul = 速度倍率（相對出手時；打中時傷害 × 這個倍率，最多 4）
    if (this.accel || this.quick) {  // 速度倍率的起點：加速從 0.5 倍開始；疾射 +1（Lv2 +1.5）
      this.accel0 = this.accelMul = (this.accel ? 0.5 : 1) + quickBonus(this.quick); this.flyDist = 0;
      this.speed = this.baseSpeed * this.accelMul;
    }
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
  // 複製一顆（稜鏡、迴旋風暴用），放進場上的子彈清單
  copy(dAngle) {
    if (Game.bullets.length >= CFG.MAX_LIVE_BULLETS) return null;
    const c = Object.assign(Object.create(Bullet.prototype), this, { hitSet: new Set(this.hitSet) });
    c.angle += dAngle;
    Game.bullets.push(c);
    return c;
  }
  // 迴旋：打中敵人才折返（穿甲用完，先穿過去再折返，回程會再打牠一次），追著射出它的飛船飛回來；沒打中就飛到盡頭消失
  startReturn() {
    const o = this.ownerP;
    this.mode = 'return'; this.life = 4; this.hitSet.clear(); this.flyAge = 0; this.speed = (this.dashed ? this.speed0 : this.baseSpeed) * this.accelMul; this.overT = 0;  // 回程一直追到飛船為止（最多 4 秒）；地雷衝出去的用武器原本的速度飛回
    if (o) this.angle = Math.atan2(o.y - this.y, o.x - this.x);
    // 折返的那一刻剛好重疊到的敵人不算（不然折返點剛好停在下一隻身上會多打一下）；剛剛穿過的那一隻回程照樣再打
    for (const e of Game.enemies) if (e.id !== this.overId && dist2(this.x, this.y, e.x, e.y) < (e.r + this.r) ** 2) this.hitSet.add(e.id);
    if (this.boom >= 2) { this.damage *= 1.5; this.att = attCredit(this.att, 'boomerang', 1.5); }
    if (this.boom >= 3) for (const off of [-0.7, 0.7]) this.copy(off);  // 迴旋風暴：折返時分裂成 3 發
  }
  update(dt) {
    this.px = this.x; this.py = this.y;  // 記住這一幀的起點，碰撞用整段路徑判定
    if (this.mode === 'orbit') {  // 環繞：按住射擊時繞著飛船轉，越轉越快；放開射擊時朝準星射出
      const o = this.ownerP;
      if (!o || o.dead) { this.dead = true; return; }
      const spin = orbSpinOf(this.orbit, o.orbHeld || 0);
      if (!o.wantFire || (o.autoMode && spin >= orbSpinMax(this.orbit))) {  // 放開射擊才放出（衝刺不會）；右邊晶片的效果（迴旋、加速……）從這裡開始
        const d = Math.max(120, o.aimD || 300), tx = o.x + Math.cos(o.aim) * d, ty = o.y + Math.sin(o.aim) * d;
        this.mode = 'fly'; this.angle = Math.atan2(ty - this.y, tx - this.x);  // 從所在位置朝滑鼠當下那一點射出
        // 速度倍率 = 傷害倍率：轉速 1～3 倍 → 放出時速度倍率 1～2（Lv1 最多 1.5）；有加速時從這裡繼續加上去（不相乘）
        this.accel0 = this.accelMul = 1 + 0.5 * (spin - 1) + quickBonus(this.quick); this.orbShot = true; this.flyDist = 0;  // 放出後命中也算環繞成長
        this.speed = this.baseSpeed * this.accelMul;
        this.life = this.life0; this.flyAge = 0; this.hitSet.clear(); this.sx = this.x; this.sy = this.y;
        if (this.orbit >= 3) this.homing = Math.max(this.homing, 1.5);  // 星環：射出的子彈追蹤敵人
        this.orbit = 0;
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
      const near = nearestEnemy(this.x, this.y, this.stasis >= 2 ? 70 : 50, null);
      if (!near && this.waitT <= 0) { this.dead = true; burst(this.x, this.y, this.color, 4, 60, 0.2, 2); return; }  // 時間到沒被觸發：消失
      if (near) {
        this.angle = Math.atan2(near.y - this.y, near.x - this.x);
        this.damage *= 1.2; this.att = attCredit(this.att, 'stasis', 1.2);
        this.mode = 'fly'; this.dashed = true; this.speed = this.baseSpeed = 1100; this.life = 0.6; this.flyAge = 0; this.accelMul = 1; this.accel0 = 1; this.flyDist = 0;
      }
      return;
    }
    if (this.stasis && !this.dashed && this.mode === 'fly' && this.flyAge >= 0.22 && !(this.overT > 0)) {  // 迴旋已經打中、準備折返的不變地雷
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
        if (e.dead || e.spawnT > 0 || this.hitSet.has(e.id)) continue;
        const d2 = dist2(this.x, this.y, e.x, e.y);
        if (d2 >= bd || Math.abs(angleDiff(this.angle, Math.atan2(e.y - this.y, e.x - this.x))) > 1.22) continue;
        bd = d2; t = e;
      }
      if (t) {
        const turn = this.homing * dt * Math.max(1, this.speed / 600);  // 快的子彈轉得跟著快：轉彎半徑跟 600 速度時一樣，不會繞圈追不到
        this.angle += clamp(angleDiff(this.angle, Math.atan2(t.y - this.y, t.x - this.x)), -turn, turn);
      }
    }
    if (this.accel || this.quick) {  // 速度倍率（= 傷害倍率）：加速每秒往上加、疾射照飛行距離往下減，全部加在同一個倍率上；0.5～4
      const up = this.accel ? (this.accel >= 2 ? 4.5 : 3) * this.flyAge : 0;
      const down = this.quick ? (this.flyDist || 0) / (this.quick >= 2 ? 250 : 200) : 0;
      this.accelMul = clamp((this.accel0 || 1) + up - down, 0.5, 4); this.speed = this.baseSpeed * this.accelMul;
    }
    if (this.mode === 'return') {
      const o = this.ownerP;
      if (!o || o.dead) { this.dead = true; return; }
      this.angle += clamp(angleDiff(this.angle, Math.atan2(o.y - this.y, o.x - this.x)), -9 * dt, 9 * dt);
      if (dist2(this.x, this.y, o.x, o.y) < 20 * 20) { this.dead = true; return; }
    }
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    if (this.quick) this.flyDist = (this.flyDist || 0) + this.speed * dt;  // 疾射：照飛行距離減速
    this.life -= dt;
    const W = CFG.WORLD_W, H = CFG.WORLD_H, outX = this.x < 0 || this.x > W, outY = this.y < 0 || this.y > H;
    if (outX || outY) {
      if (this.bounce > 0) {  // 牆反彈
        this.bounce--;
        if (outX) { this.angle = Math.PI - this.angle; this.x = clamp(this.x, 0, W); }
        if (outY) { this.angle = -this.angle; this.y = clamp(this.y, 0, H); }
        this.hitSet.clear(); this.life = Math.max(this.life, 0.5);
        this.bounced = true;  // 成長：反彈過的子彈打中才貼標記
        if (this.prism) { this.copy(0.4); this.angle -= 0.2; }  // 稜鏡：反彈時分裂
      } else if (this.mode === 'return') { this.x = clamp(this.x, 0, W); this.y = clamp(this.y, 0, H); }
      else {
        if (this.endBoom) Game.explode(clamp(this.x, 0, W), clamp(this.y, 0, H), 90, this.damage, this.color, null, this.att);
        this.dead = true; return;
      }
    }
    if (this.life <= 0) {
      if (this.boom && this.mode === 'fly' && this.shape === 'blade' && this.hitAny) { this.startReturn(); return; }  // 相刃＋迴旋：刃片揮到盡頭時，有砍到敵人就飛回來（相刃無限穿透，穿甲永遠用不完）
      {
        if (this.endBoom) Game.explode(this.x, this.y, 90, this.damage, this.color, null, this.att);  // 過載砲：飛到盡頭爆炸
        this.dead = true;
      }
    }
  }
  // 無限穿透：迴旋的回程、超音速（加速 Lv3 且 2 倍速以上）
  get infPierce() { return (!!this.boom && this.mode === 'return') || (this.accel >= 3 && this.accelMul >= 2); }
}

function spawnShots(list, x, y, baseAngle, depth, ignoreId) {
  const B = Game.bullets, M = Game.mech;  // 射出這些子彈的人的機體：感測器（子彈速度、鎖定、弱點標記）
  curVolley = ++volleySeq;
  for (const s0 of list) {
    if (B.length >= CFG.MAX_LIVE_BULLETS) break;
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

function nearestEnemy(x, y, range, exclude) {
  let best = null, bd = range * range;
  for (const e of Game.enemies) {
    if (e.dead || (exclude && exclude.has(e.id))) continue;
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
    knockResist: 3.5, rage: '核心臨界', skills: ['nova', 'twin', 'wall', 'guard'],
    desc: '連續缺口環形波、雙向螺旋、慢速彈牆、召喚刺殼護衛。' },
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
    this.cd = t.ranged ? rand(0.8, t.ranged.cd) : 0;
    this.burnT = 0; this.burnDps = 0; this.burnAcc = 0; this.slowT = 0; this.slowAmt = 0;
    this.mode = 'chase'; this.skillCd = 2.5; this.nextSkill = 'charge'; this.modeT = 0; this.chargeA = 0;
    this.dead = false;
  }
  move(dt) {
    this.x = clamp(this.x + this.vx * dt, this.r, CFG.WORLD_W - this.r);
    this.y = clamp(this.y + this.vy * dt, this.r, CFG.WORLD_H - this.r);
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
    this.spdMul = this.slowT > 0 ? 1 - this.slowAmt : 1;
    if (this.spawnT > 0) { this.spawnT -= dt; return; }
    const t = this.t;
    if (t.dummy) {  // 標靶：被擊退後像彈簧一樣回到原位
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
      const hitX = (this.x <= this.r + 0.5 && this.vx < 0) || (this.x >= W - this.r - 0.5 && this.vx > 0);
      const hitY = (this.y <= this.r + 0.5 && this.vy < 0) || (this.y >= H - this.r - 0.5 && this.vy > 0);
      if (hitX || hitY) {
        if (this.bounced) this.modeT = 0;
        else { this.bounced = true; if (hitX) this.vx = -this.vx; if (hitY) this.vy = -this.vy; this.chargeA = Math.atan2(this.vy, this.vx); Game.shake(3); }
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
      const e = new Enemy(type, clamp(this.x + Math.cos(a) * dist, 40, CFG.WORLD_W - 40),
        clamp(this.y + Math.sin(a) * dist, 40, CFG.WORLD_H - 40), this.hpScale * scale);
      e.summoned = true;  // 旗艦叫出來的小怪不掉晶體
      Game.enemies.push(e);
    }
    burst(this.x, this.y, this.t.color, 24, 200, 0.5, 2);
  }
  updateBoss(dt, dx, dy, d) {
    const t = this.t, rage = this.hp < this.maxHp * 0.5;
    this.blocked = Game.objs.length ? Objects.losBlocked(this.x, this.y, this.x + dx, this.y + dy, 6) : null;
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
      const wall = this.x <= this.r + 1 || this.x >= CFG.WORLD_W - this.r - 1 || this.y <= this.r + 1 || this.y >= CFG.WORLD_H - this.r - 1;
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
      case 'guard':
        this.summon('brute', rage ? 2 : 1, 110, 0.6);
        this.summon('swarmer', rage ? 6 : 4, 80, 0.8);
        this.skillCd = rage ? 3 : 3.6; break;
    }
  }
  // knock：子彈的擊退值（只有子彈命中會帶）。旗艦只有在擊退值超過自己的抗擊退時才會被推，力道只看超過的部分；
  // 爆炸、震波、電弧不會推王。衝鋒中的敵人不會被推
  hurt(dmg, kx, ky, source = 'direct', att = null, knock = null) {
    if (this.markT > 0) dmg *= 1.25;  // 弱點標記
    if (att) this.lastAtt = att;
    Game.recordDamage(source, this.t.dummy ? dmg : Math.min(dmg, Math.max(0, this.hp)), att);  // 只算實際扣掉的血（標靶算全額）
    if (Game.mode === 'range') Range.hit(dmg, source);  // 靶場（標靶或實戰）的傷害都算進數據
    this.hp -= dmg; this.flash = 0.08;
    if (this.t.dummy && this.hp <= 0) this.hp += this.maxHp * Math.ceil(-this.hp / this.maxHp + 0.001);  // 標靶打不死
    if (this.t.boss) {
      const over = knock == null ? 0 : knock - this.t.knockResist, l = Math.hypot(kx, ky);
      if (over > 0 && l > 0 && this.mode !== 'charge') { this.vx += kx / l * over * CFG.BOSS_KNOCK; this.vy += ky / l * over * CFG.BOSS_KNOCK; }
    } else if (this.mode !== 'charge') { this.vx += kx; this.vy += ky; }
    if (this.hp <= 0 && !this.dead) { this.dead = true; this.killer = att ? att.owner : Game.shooter; this.killAtt = att; Game.onEnemyKilled(this); }
  }
}
