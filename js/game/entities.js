// 星環電路 多人版 · entities.js：Player、Bullet、敵人種類 ENEMY_TYPES 與 Enemy（含旗艦技能）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// ENTITIES
// =====================================================================
// 衝刺：戰鬥、基地的飛船（Player）都用這一套——按鍵、冷卻、速度、時間、先鋒號的瞬移都在這裡
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
    // 衝刺狀態（突擊、急冷、星門用）
    this.wasDash = false; this.dashDir = 0; this.dashHit = new Set(); this.dx0 = this.x; this.dy0 = this.y;
  }
  // 開火（房主執行；隊友的飛船要在 withLoadout(隊友配裝) 裡呼叫）
  tickFire(dt, want) {
    this.fireCd -= dt;
    this.quenchT -= dt;
    if (want && this.fireCd <= 0 && weaponPlay().canFire(this)) {  // 過熱、飛輪全在場上時不能開火
      const M = Game.mech, rate = (M.rate + (M.traits.gale && this.moving ? 0.2 : 0) + (this.quenchT > 0 ? 0.3 : 0)) * M.rateMul;  // 射速增加相加（散熱片、疾風、急冷），減少相乘
      this.fire();
      // 這一幀多過的時間留到下一發（不然射速會照幀率變慢）；停火一陣子再按不會累積成連發（最多帶一幀）
      this.fireCd = Math.max(this.fireCd, -dt) + Game.stats.interval / rate;
    }
  }

  // 衝刺相關（房主執行）：突擊（加速器 4 層）、衝刺結束的急冷、星門
  tickDash() {
    const dashing = this.dashT > 0;
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
        Game.hitFx(e, wFx(dmg), dmg, e.x, e.y);  // 飛船晶片的元素插件（傷害插件已經在 Game.wp.damage 裡）
        floatText(e.x, e.y - e.r, Math.round(dmg), '#9dff6b', true);
      }
    }
    this.dx0 = this.x; this.dy0 = this.y;
    if (!dashing && this.wasDash) {  // 衝刺結束
      const M = Game.mech;
      if (M.traits.quench) this.quenchT = 2;
      if (this.ship.ability === 'portal') Game.openPortal(this, this.dashSX, this.dashSY, this.x, this.y);
    }
    this.wasDash = dashing;
  }
  onDash() {  // 衝刺開始（房主執行；隊友的衝刺由房主在隊友的配裝下執行）：殘影、砲台；被隊友勾住 = 掙脫
    if (this.grabBy) { const s = Game.allShips().find(q => q.hookShip === this); if (s) s.hookShip = null; this.grabBy = 0; this.grabFreeT = Game.time + 0.5; }  // grabFreeT：隊友那邊，房主的快照還沒更新前不再被拉回去
    if (Game.isClient()) return;
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
      const [wx, wy] = Game.toWorld(Input.mx, Input.my);
      if (Game.inArena || Input.mouseMoved) {
        this.aim = Math.atan2(wy - this.y, wx - this.x);
        this.aimD = Math.hypot(wx - this.x, wy - this.y);  // 準星距離：環繞放出時朝滑鼠那一點集中
      } else if (this.moving) this.aim = Math.atan2(my, mx);  // 基地：還沒動過滑鼠就朝移動方向
      this.autoMode = false;
    }

    if (Dash.input(this, dt, this.moving ? Math.atan2(my, mx) : this.aim, this.ship.dashCd * (1 - P.dashCd) * Game.mech.dashCd, Game.state === 'play' || !Game.inArena, (x, y) => this.phaseFree(x, y))) {  // 衝刺：Dash（跟基地同一套）
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
    Game.shipPull(this, dt);  // 被隊友的鉤爪勾住：拉到他前方（蓋掉自己的操控）
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
    if (Input.alt) { Input.alt = false; this.altQ = true; this.altSeq = (this.altSeq || 0) + 1; }  // 右鍵：altSeq 告訴房主「按了一次」（隊友的右鍵由房主執行）
    if (Game.isClient()) return;  // 連線的隊友（戰鬥中）：開火交給房主（子彈、傷害都由房主計算）；基地裡各自算
    this.tickDash();
    this.tickAlt(dt);
    this.tickFire(dt, Input.down);
  }
  // 武器右鍵（WEAPONS[id].alt 寫名稱、冷卻；行為在 weaponPlay().alt）：altQ = 按了還沒處理（自己的在 update，隊友的在 Net.applyInput）；冷卻好了才能用；parryWinT = 彈反的格擋時間、edgeT = 下一刀強化的剩餘時間（見 Game.parryReflect）
  tickAlt(dt) {
    weaponPlay().tick(this, dt);  // 武器每幀的事：熱度、鉤住的敵人、無人機
    this.comboT = (this.comboT || 0) - dt;
    this.altCd = Math.max(0, (this.altCd || 0) - dt);
    const win0 = this.parryWinT || 0;
    this.parryWinT = Math.max(0, win0 - dt);
    if (win0 > 0 && !this.parryWinT && !this.parryN) ringFx(this.x, this.y, PARRY.r, '#8a8fa8', true);  // 彈反落空：灰色光圈往內收
    this.edgeT = Math.max(0, (this.edgeT || 0) - dt);
    if (!this.altQ) return;
    this.altQ = false;
    const A = WEAPONS[Game.weapon.id].alt;
    if (!A || this.altCd > 0) return;
    this.altCd = A.cd;
    weaponPlay().alt(this);
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
    let list = weaponShots();
    if (!list.length) return;
    list = weaponPlay().onFire(this, list);  // 武器自己的出手方式（能量刃：連段；無人機：從無人機射出）
    if (!list.length) return;
    const nx = this.x + Math.cos(this.aim) * 16, ny = this.y + Math.sin(this.aim) * 16;
    // 子彈從船身中心附近發出：怪物貼臉時也打得到（槍口火光仍在船頭）
    spawnShots(list, this.x + Math.cos(this.aim) * 4, this.y + Math.sin(this.aim) * 4, this.aim, 0, null);
    Events.emit('shoot', { p: this, weapon: Game.weapon.id });
    burst(nx, ny, list[0].color, 3, 120, 0.15, 2);
  }
}

let bulletN = 0;  // 子彈編號（多人：隊友那邊用編號對上同一顆，見 Net.bulletRows）
class Bullet {
  constructor(x, y, angle, s, depth, ignoreId) {
    this.nid = ++bulletN;
    this.x = x; this.y = y; this.px = x; this.py = y; this.angle = angle;
    this.sx = x; this.sy = y;  // 發射點：畫尾巴時不超過已飛行的距離（不然剛射出時尾巴會從船屁股露出來）
    this.speed = this.speed0 = s.speed; this.damage = s.damage; this.r = s.radius;  // speed0：原本的速度（地雷衝出去、迴旋回程用）
    this.pierce = s.pierce; this.bounce = s.bounce; this.homing = s.homing;
    this.life = s.life; this.color = s.color; this.shape = s.shape; this.depth = depth;
    this.explode = s.explode; this.burn = s.burn; this.arcs = s.arcs || null;
    this.slow = s.slow; this.slowDur = s.slowDur || 0; this.burnR = s.burnR || 0; this.burnEl = s.burnEl || 0; this.shred = s.shred || 0; this.knock = s.knock; this.lifesteal = s.lifesteal;
    this.sig = s.sig || null;
    this.rare = !!s.rare; this.grp = s.grp || null;  // 稀有晶片的產物（行為見 RARE_INFO）；碎片的 6 片共用 grp  // 能量刃重斬：同一刀的刃片共用一個 { done }，第一下命中觸發武器線（見 Game.lineSig）
    this.park = s.park ? PARKS[s.park] : null; this.hook = !!s.hook;  // 飛到盡頭停在場上（飛輪、重力井，見 toPark、PARKS）、鉤爪（打中會勾住）
    this.boom = s.boom; this.stasis = s.stasis; this.infGen = s.infGen || 0; this.vortex = s.vortex || 0;  // 晶片產物：迴旋刃、地雷、孢子、漩渦（吸引半徑；見 LINE_FX）
    this.prod = !!s.prod;  // 晶片的產物（算進每人的產物預算 CFG.PROD_CAP，見 lineSpawn）
    this.ln = s.ln || null;  // 哪條線第幾格的產物（命中、擊殺時往下傳，見 Game.linePass）
    this.att = { src: s.src || 'weapon', cr: s.cr, owner: Game.shooter || null };  // 傷害統計歸屬（owner：雙人時是誰打的）
    if (s.infect) this.att.inf = { tpl: s, lv: s.infect, gen: this.infGen };  // 孢子：擊殺時照這個樣板爆出孢子（Game.infectBurst）
    this.hitSet = new Set();
    if (ignoreId != null) this.hitSet.add(ignoreId);
    this.owner = Game.shooter || null;  // 雙人：這顆子彈是誰的（null = 房主自己）
    this.ownerP = Game.shipOf(Game.shooter);  // 迴旋、飛輪要飛回的飛船
    this.dead = false;
    this.mode = 'fly'; this.flyAge = 0; this.R = this.speed0 * this.life; this.dist = 0;  // R：射程；dist：已飛距離
  }
  // 地雷朝敵人 e 衝出去（×1.2）：跑剩下的射程，至少比觸發範圍 TR 遠 30
  mineGo(e, TR) {
    this.angle = Math.atan2(e.y - this.y, e.x - this.x);
    this.damage *= 1.2;
    this.mode = 'fly'; this.dashed = true; this.speed = Math.max(this.speed0, 420);
    this.life = Math.max(this.R - this.dist, TR + 30) / this.speed;
    this.flyAge = 0;
  }
  // 迴旋：打中（穿甲用完先穿過去）、撞牆、飛到盡頭都會折返，追著飛船飛回來；回程無限穿透
  startReturn() {
    const o = this.ownerP;
    this.mode = 'return'; this.life = 4; this.hitSet.clear(); this.flyAge = 0; this.speed = this.speed0; this.overT = 0;  // 回程一直追到飛船為止（最多 4 秒）
    if (o) this.angle = Math.atan2(o.y - this.y, o.x - this.x);
    // 折返的那一刻剛好重疊到的敵人不算（不然折返點剛好停在下一隻身上會多打一下）；剛剛穿過的那一隻回程照樣再打
    for (const e of enemiesNear(this.x, this.y, this.r)) if (e.id !== this.overId && dist2(this.x, this.y, e.x, e.y) < (e.r + this.r) ** 2) this.hitSet.add(e.id);
  }
  update(dt) {
    this.px = this.x; this.py = this.y;  // 記住這一幀的起點，碰撞用整段路徑判定
    if (this.vortex) {  // 漩渦：停在原地把敵人吸到中心；時間到消失，在中心往下傳（pass 'end'）
      pullEnemies(this.x, this.y, this.vortex, dt);
      if ((this.life -= dt) <= 0) {
        this.dead = true;
        if (!this.ln) return;
        const c = { x: this.x, y: this.y, id: -1 }, n = this.rare ? Game.enemies.filter(e => !e.dead && dist2(e.x, e.y, this.x, this.y) < this.vortex ** 2).length : 0;
        for (let k = n >= 5 ? 2 : 1; k > 0; k--) Game.linePass(this, 'end', c);  // 稀有漩渦：吸到 5 隻以上傳 2 次
      }
      return;
    }
    if (this.mode === 'park') {  // 停在場上（飛輪、重力井）：每 rehit 秒能再打同一隻；時間到照停住設定的 onExpire（飛輪飛回手上），沒有就消失
      this.parkT -= dt; this.speed = 0;
      if ((this.reHitT -= dt) <= 0) { this.reHitT = this.park.rehit; this.hitSet.clear(); }
      if (this.park.tick) this.park.tick(this, dt);
      if (this.parkT <= 0) { if (this.park.onExpire) this.park.onExpire(this); else this.dead = true; }
      return;
    }
    if (this.mode === 'wait') {  // 地雷：停住，敵人靠近就朝牠衝出去；時間到還沒被觸發就消失
      this.waitT -= dt; this.speed = 0;
      // 觸發範圍算到敵人的邊緣（大隻的在旁邊也會觸發）
      const TR = 50;
      let near = null, nb = Infinity;
      for (const e of enemiesNear(this.x, this.y, TR)) {
        if (e.dead || e.spawnT > 0) continue;
        const gap = Math.hypot(e.x - this.x, e.y - this.y) - e.r;
        if (gap < TR && gap < nb) { nb = gap; near = e; }
      }
      if (!near && this.waitT <= 0) {
        this.dead = true; burst(this.x, this.y, this.color, 4, 60, 0.2, 2);
        if (this.rare && this.ln) { Game.explode(this.x, this.y, 60, this.damage, this.color, null, this.att); Game.linePass(this, 'hit', { x: this.x, y: this.y, id: -1 }); }  // 稀有佈雷：沒被觸發也自爆、往下傳
        return;
      }
      if (near) this.mineGo(near, TR);
      return;
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
        if (d2 >= bd || (Math.abs(angleDiff(this.angle, Math.atan2(e.y - this.y, e.x - this.x))) > 1.22)) continue;
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
      const tg = this.detour && !this.detour.dead ? this.detour : o;  // 飛輪的回程追蹤：先繞去那隻，碰到再飛回飛船
      if (tg !== o && dist2(this.x, this.y, tg.x, tg.y) < (tg.r + this.r) ** 2) this.detour = null;
      this.angle += clamp(angleDiff(this.angle, Math.atan2(tg.y - this.y, tg.x - this.x)), -9 * dt, 9 * dt);
      if (tg === o && dist2(this.x, this.y, o.x, o.y) < 20 * 20) { this.dead = true; if (this.park && this.park.onCatch) this.park.onCatch(this); return; }  // 飛回飛船（飛輪：接住）
    }
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;
    this.dist += this.speed * dt;
    this.life -= dt;
    if (!Arena.rect) {  // 大地圖：碰到牆或閘門（迴旋回程不算）
      const hit = this.mode === 'return' ? null : Arena.bulletWall(this.px, this.py, this.x, this.y, this.r);
      if (hit) {
        if (this.bounce > 0) {  // 反彈：照牆面的法線
          this.bounce--;
          const vx = Math.cos(this.angle), vy = Math.sin(this.angle), dot = vx * hit.nx + vy * hit.ny;
          if (dot < 0) this.angle = Math.atan2(vy - 2 * dot * hit.ny, vx - 2 * dot * hit.nx);
          this.x = hit.x; this.y = hit.y; this.hitSet.clear(); this.bounced = true;
        } else if (this.boom && this.mode === 'fly') { this.x = hit.x; this.y = hit.y; this.startReturn(); }  // 迴旋：撞牆折返
        else if (this.toPark(hit.x - Math.cos(this.angle) * this.r, hit.y - Math.sin(this.angle) * this.r)) return;  // 飛輪、重力井：停在牆前
        else {
          if (this.hook && this.ownerP) weaponPlay(this.ownerP).onWall(this.ownerP, hit.x, hit.y);  // 鉤爪打到牆（鉤索）
          this.dead = true; this.x = hit.x; this.y = hit.y;  // 停在牆面
          return;
        }
      }
    } else {
      const W = CFG.WORLD_W, H = CFG.WORLD_H, outX = this.x < 0 || this.x > W, outY = this.y < 0 || this.y > H;
      if (outX || outY) {
        if (this.bounce > 0) {
          this.bounce--;
          if (outX) { this.angle = Math.PI - this.angle; this.x = clamp(this.x, 0, W); }
          if (outY) { this.angle = -this.angle; this.y = clamp(this.y, 0, H); }
          this.hitSet.clear(); this.bounced = true;
        } else if (this.boom && this.mode === 'fly') { this.x = clamp(this.x, 0, W); this.y = clamp(this.y, 0, H); this.startReturn(); }  // 迴旋：撞到場地邊緣折返
        else if (this.mode === 'return') { this.x = clamp(this.x, 0, W); this.y = clamp(this.y, 0, H); }
        else if (this.toPark(clamp(this.x, 0, W), clamp(this.y, 0, H))) return;
        else { this.dead = true; return; }
      }
    }
    if (this.stasis && !this.dashed && this.mode === 'fly' && this.life <= 0) {  // 地雷：滑到盡頭停住（4 秒）
      this.mode = 'wait'; this.waitT = 4; this.speed = 0; this.life = 1; return;
    }
    if (this.life <= 0) {
      if (this.toPark()) return;  // 飛輪、重力井：飛到盡頭停住
      if (this.boom && this.mode === 'fly') { this.startReturn(); return; }  // 迴旋：飛到盡頭折返
      this.dead = true;
    }
  }
  // 飛到盡頭（或撞牆）停在場上；不是會停的子彈回傳 false
  toPark(x = this.x, y = this.y) {
    if (!this.park || this.mode !== 'fly') return false;
    this.mode = 'park'; this.x = x; this.y = y; this.px = x; this.py = y;
    this.parkT = this.park.t * (this.park.mul ? this.park.mul() : 1); this.reHitT = this.park.rehit; this.life = 1; this.hitSet.clear();
    if (this.park.onPark) this.park.onPark(this);  // 剛停住（疊輪）
    return true;
  }
  // 無限穿透：迴旋的回程
  get infPierce() { return !!this.boom && this.mode === 'return'; }
}

function spawnShots(list, x, y, baseAngle, depth, ignoreId) {
  const B = Game.bullets, M = Game.mech;  // 射出這些子彈的人的機體：感測器（子彈速度、鎖定、弱點標記）
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
  const k = decay(CFG.PICKUP_DRAG, dt); c.vx *= k; c.vy *= k;
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

// 衝鋒預警線的長度：衝鋒距離＋身體半徑（刺殼再加上暈眩滑行的距離）；畫面兩種繪圖都用這個
const BRUTE_SKID = 0.88;  // 刺殼暈眩時每 1/60 秒速度剩幾成
function telegraphLen(e) {
  if (e.type === 'brute') { const B = CFG.BRUTE, s = B.rollSpeed * (e.spdMul || 1); return s * (B.rollT + 1 / 60) + s / 60 * BRUTE_SKID / (1 - BRUTE_SKID) + e.r; }
  const C = CFG.CHARGE[e.type];
  return C ? C.speed * (C.t + 1 / 60) + e.r : 0;  // 多算一幀：計時器的最後一幀
}


// 無盡模式：每過一個星區，敵人攻擊頻率 ×1.1、移動速度 ×1.05（乘算；攻擊力另外在受傷時 ×1.25）
const endlessK = () => Game.mode === 'run' || Game.mode === 'coop' ? Math.max(0, Game.sector - Game.lastSector()) : 0;
const endlessAtk = () => Math.pow(CFG.ENDLESS_ATK, endlessK());
const endlessSpd = () => Math.pow(CFG.ENDLESS_SPD, endlessK());

// 旗艦命中點：分佈在王身上的幾個點（世界座標，跟著 rot 轉）；不是旗艦回傳 null。只讀欄位：隊友那邊同步來的敵人也能用（除錯畫面）
function hitPts(e) {
  const T = ENEMY_TYPES[e.type] || e.t;
  if (!T || !T.boss) return null;
  const n = Math.max(1, Math.round(e.r / CFG.HIT_PT.per)), ring = n % 2 ? n - 1 : n, R = e.r * CFG.HIT_PT.ring, a0 = e.rot || 0;
  const pts = Array.from({ length: ring }, (_, i) => ({ x: e.x + Math.cos(a0 + i / ring * TAU) * R, y: e.y + Math.sin(a0 + i / ring * TAU) * R }));
  if (n % 2) pts.push({ x: e.x, y: e.y });
  return pts;
}
class Enemy {
  // 控制抗性（CFG.CC）：照等級查這種控制的規則；ccDur = 這次能控制多久、ccImmune = 現在不能被控制、ccEnd = 控制結束（有規則就開始免疫，回傳 true）
  ccRule(kind) { const R = CFG.CC[this.t.boss ? 'boss' : this.t.elite ? 'elite' : 'normal']; return (R && R[kind]) || null; }
  ccDur(kind, base) { const r = this.ccRule(kind); return r && r.t != null ? r.t : base; }
  ccImmune(kind) { return !!(this.ccFree && this.ccFree[kind] > Game.time); }
  ccEnd(kind) { const r = this.ccRule(kind); if (!r || !r.immune) return false; (this.ccFree || (this.ccFree = {}))[kind] = Game.time + r.immune; return true; }
  brake(dt, f = this.t.brake || CFG.BRAKE) { const k = decay(f, dt); this.vx *= k; this.vy *= k; }  // 起手、蓄力時慢慢停下（f 見 CFG.BRAKE）
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
    } else {
      this.x += this.vx * dt; this.y += this.vy * dt; this.wallN = Arena.collide(this, this.r, null);  // 大地圖：撞牆停住，閘門過不去
    }
  }
  // 減速（2026-10-10 改相乘）：每個來源（shot 子彈、comet 彗星的冰）各自計時；同一來源再打中取大的、刷新時間；
  //   剩下的速度相乘（兩個 40% = 64%），沒有上限。slowAmt／slowT = 合起來的減速和最久的剩餘時間（畫面、連線用）
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
    if (this.burnT > 0) {  // 燃燒：持續扣血（只留最強的一個）
      this.burnT -= dt; const dps = this.burnDps;
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
    if (this.stunT > 0) {  // 暈眩（牽引鉤拉在身前、甩出去飛行中）：不動、不攻擊，被甩開的速度慢慢減
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
      this.modeT -= dt; this.brake(dt); this.move(dt);
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
      this.modeT -= dt; this.brake(dt); this.move(dt);
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
    if (this.hits) this.hits.push([Game.time, dmg]);  // 基地的標靶機：每一下（每秒傷害，見 Hub.dps）
    if ((this.t.dummy || this.immortal) && this.hp <= 0) this.hp += this.maxHp * Math.ceil(-this.hp / this.maxHp + 0.001);  // 標靶（和靶場手動生的「打不死」）打不死
    if (this.t.boss) {
      const over = knock == null ? 0 : knock - this.t.knockResist, l = Math.hypot(kx, ky);
      if (over > 0 && l > 0 && this.mode !== 'charge') this.push(kx / l * over * CFG.BOSS_KNOCK, ky / l * over * CFG.BOSS_KNOCK);
    } else if (this.mode !== 'charge' && !this.t.anchored) this.push(kx, ky);  // 母巢（anchored）不吃擊退
    if (this.has('split') && !this.splitDone && this.hp > 0 && this.hp <= this.maxHp * AFFIX.split.at) this.splitNow = true;  // 精英「分裂」：下一幀分成兩隻
    if (this.hp <= 0 && !this.dead) { this.dead = true; this.killer = att ? att.owner : Game.shooter; this.killAtt = att; Game.onEnemyKilled(this); }
  }
}
