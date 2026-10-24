// 星環電路 多人版 · weapon_play.js：每把武器「怎麼玩」（左鍵出手、右鍵、每幀、命中／擊殺／受傷時）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   數值、說明、升級樹在 data/weapons.js 的 WEAPONS；這裡只寫行為。每把武器一個類別，繼承 WeaponPlay，只覆寫跟一般射擊不一樣的地方。
//   玩法讀 Game.wp（升級改過的武器參數）；表現用 effects.js 的 burst／ringFx／floatText（都是發事件）
'use strict';

// 武器玩法的基底：每個方法的預設 = 一般射擊（什麼都不多做）
class WeaponPlay {
  constructor(id) { this.id = id; }
  canFire(p) { return true; }        // 能不能開火（過熱、飛輪全在場上時不能）
  onFire(p, list) { return list; }   // 左鍵出手：回傳這一幀要從飛船射出的子彈（其餘自己排隊或從別處射）
  tick(p, dt) {}                     // 每幀（Player.tickAlt）
  alt(p) {}                          // 右鍵（WEAPONS[id].alt 有寫才會呼叫，冷卻由 Player.tickAlt 管）
  onHit(p, b, e) {}                  // 這艘船的子彈打中敵人
  onKill(p, e) {}                    // 擊殺
  onHurt(p) {}                       // 被打中
  onWall(p, x, y) {}                 // 鉤爪這類子彈打到牆
}
// 子彈會停在場上的武器（飛輪、重力井）：kind 對應 PARKS
class ParkWeapon extends WeaponPlay {
  constructor(id, kind) { super(id); this.kind = kind; }
  shots(p) { return ownShots(p, this.kind); }  // 這艘船停著／飛著的（飛回來途中的不算）
  count(p) { return this.shots(p).length; }    // 佔掉幾個（HUD）
  max() { return Infinity; }                     // 場上最多幾個
}

// 停在場上的子彈（Bullet 的 park 模式）：kind 分辨是誰的、t 停多久（mul：升級的倍率）、rehit 隔多久能再打同一隻、
//   tick 每幀做的事、onPark 剛停住、onCatch 飛回飛船時
const DISC_PARK = { kind: 'disc', t: DISC.park, rehit: DISC.rehit, dmg: DISC.parkMul, mul: () => Game.wp.parkMul || 1,  // dmg：停住時的傷害倍率（hitDamage）
  onPark(b) {  // 疊輪：停在另一個停住的飛輪旁邊就疊上去
    if (!Game.wp.discStack) return;
    const o = ownShots(b.ownerP, 'disc').find(o => o !== b && o.mode === 'park' && (o.lvl || 1) < DISC_UP.stackMax && dist2(o.x, o.y, b.x, b.y) < DISC_UP.stackR ** 2);
    if (!o) return;
    o.lvl = (o.lvl || 1) + 1; o.r *= DISC_UP.stackGrow; if (o.r0) o.r0 *= DISC_UP.stackGrow; o.damage *= DISC_UP.stackDmg; o.parkT = Math.max(o.parkT, b.parkT);
    b.dead = true; ringFx(o.x, o.y, o.r + 10, '#ffb347');
  },
  tick(b, dt) {  // 磨盤：停越久越大
    if (!Game.wp.grind) return;
    b.r0 = b.r0 || b.r; b.age = (b.age || 0) + dt;
    b.r = b.r0 * Math.min(DISC_UP.grind.max, 1 + DISC_UP.grind.grow * b.age);
  },
  onExpire(b) { discReturn(b, 1); },  // 停住時間到：自己飛回手上（回程照樣打人；不吃召回的回程倍率，以前直接消失，10-23）
  onCatch(b) {  // 飛輪飛回手上：全接快擲、爆輪、自動再擲
    const p = b.ownerP, w = Game.wp;
    if (b.recall && p.recallN && ++p.caught >= p.recallN) { p.fastN = p.recallN; p.recallN = 0; floatText(p.x, p.y - 26, '全接！', '#ffb347'); }  // fastN：手上還有幾個強化的（排在前面）
    if (w.discBoom) { wBoom(p.x, p.y, DISC_UP.boom.r, DISC_UP.boom.dmg, '#ffb347', b.att); Game.shake(3); }
    if (w.rethrow) p.rethrowN = (p.rethrowN || 0) + 1;
  } };
// 飛輪飛回手上（右鍵召回、停住時間到共用）：無限穿透、回程速度，傷害 ×mul
function discReturn(b, mul) {
  const p = b.ownerP;
  b.mode = 'return'; b.life = 4; b.hitSet.clear(); b.pierce = 99; b.speed = DISC.backSpeed; b.damage *= mul; b.angle = Math.atan2(p.y - b.y, p.x - b.x);
}
// 把 R 內的敵人往 (x, y) 拉（旗艦不拉）；重力井停住時、黑洞彈飛行中共用
function pullEnemies(x, y, R, dt) {
  for (const e of Game.enemies) {
    if (e.dead || e.t.boss) continue;
    const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy);
    if (d > R || d < 8) continue;
    const m = Math.min(d - 6, WELL.pull * dt); e.x += dx / d * m; e.y += dy / d * m;
  }
}
const wellR = b => WELL.r * (Game.wp.wellR || 1) * (b.small ? WELL_UP.residue.r : 1) * WELL_STACK.r ** (b.stack || 0);  // 重力井的吸引範圍（升級、殘留小井、疊井）
const WELL_PARK = { kind: 'well', t: WELL.park, rehit: WELL.rehit,
  onPark(b) {  // 停住多了一個井：超過上限就擠掉最舊的（只算停住的；以前開火時連飛行中的也算，連射時疊好的井一停住新的就被擠掉，10-23）
    if (b.small) return;
    const W = ownShots(b.ownerP, 'well').filter(w => w.mode === 'park'), over = W.length - WEAPON_PLAY.plasma.max();
    for (const w of W.filter(w => w !== b).slice(0, Math.max(0, over))) { w.dead = true; burst(w.x, w.y, '#c77dff', 6, 80, 0.3, 2); }
  },
  tick(b, dt) {
  const w = Game.wp, R = wellR(b);
  pullEnemies(b.x, b.y, R, dt);
  if (w.horizon) for (const e of Game.enemies) if (!e.dead && !e.t.boss && dist2(e.x, e.y, b.x, b.y) < R * R) e.slowBy('shot', WELL_UP.slow, 0.3);  // 事件視界：吸住的減速
  if (w.eat) for (const eb of Game.eBullets) {  // 吸彈：井吸收敵彈，塌縮時加傷
    if ((b.eaten || 0) >= WELL_UP.eat.max) break;
    if (eb.life > 0 && dist2(eb.x, eb.y, b.x, b.y) < WELL_UP.eat.r ** 2) { eb.life = 0; b.eaten = (b.eaten || 0) + 1; burst(eb.x, eb.y, '#c77dff', 4, 80, 0.2, 2); }
  }
  if (w.drift) {  // 漂移井：慢慢飄向準星
    const p = b.ownerP, [tx, ty] = aimAt(p), l = Math.hypot(tx - b.x, ty - b.y);
    if (l > 4) { const m = Math.min(l, WELL_UP.drift * dt); b.x += (tx - b.x) / l * m; b.y += (ty - b.y) / l * m; b.px = b.x; b.py = b.y; }
  }
} };
// 準星指向的點：飛船＋瞄準方向 × 準星距離（限制在 min～max）。沒有準星距離（電腦、舊存檔）用 250
//   用 ?? 不用 ||：游標放在飛船上時距離是 0，以前被當成沒有、變成 250，無人機飛到前面亂跳（10-23）
function aimAt(p, min = 0, max = Infinity) { const d = clamp(p.aimD ?? 250, min, max); return [p.x + Math.cos(p.aim) * d, p.y + Math.sin(p.aim) * d]; }
// p 的飛輪／重力井（飛回來途中的不算）
const ownShots = (p, kind) => Game.bullets.filter(b => !b.dead && b.ownerP === p && b.park && b.park.kind === kind && b.mode !== 'return');
// 右鍵沒東西可用：灰色光圈往內收，冷卻只扣一點
const altMiss = p => { ringFx(p.x, p.y, 30, '#8a8fa8', true); p.altCd = 0.2; };
// 武器原型直接造成的傷害（不是子彈打的：撕扯、撞擊、電弧）算在武器上
const WATT = () => ({ src: 'weapon', cr: null, owner: Game.shooter });  // owner：算在誰身上（隊友的配裝在 withLoadout 裡 = 他；以前寫死 null，隊友的撕扯、甩擊、扯都記到房主，2026-10-22 smoke.js 抓到）
// 武器自己造成的傷害（右鍵、升級的撞擊、電弧、爆炸）也吃插在武器上的插件：傷害、大小照乘，元素照命中套（見 weaponWithPlugs、Game.hitFx）
const wDmg = d => d * (Game.wp.plugDmg || 1);
const wSize = r => r * (Game.wp.plugSize || 1);
const wFx = d => elemize([{ damage: d, att: WATT(), color: WEAPONS[Game.weapon.id].color }], Game.wp.el)[0];
function wHit(e, dmg, vx = 0, vy = 0, stun) {  // 一下的傷害（持續傷害只用 wDmg：每幀套元素會一直電）
  const d = wDmg(dmg);
  e.hurt(d, vx, vy, 'direct', WATT(), stun);
  floatText(e.x, e.y - e.r, Math.round(d), ...dmgTextStyle(d, WEAPONS[Game.weapon.id].base.damage));  // 跟子彈命中一樣跳數字（以前沒有：甩擊撞到、扯、電擊鉤看起來像沒受傷，10-23）
  Game.hitFx(e, wFx(d), d, e.x, e.y);
}
const wBoom = (x, y, r, dmg, color, att = WATT()) => { const d = wDmg(dmg); Game.explode(x, y, wSize(r), d, color, null, att, wFx(d)); };
// 把一顆敵彈反射去打最近的敵人（不打 skip 裡的編號）；能量刃彈反、牽引鉤反射盾共用
function reflectShot(eb, mul, color, homing = 0, skip = null) {
  const t = nearestEnemy(eb.x, eb.y, 900, skip), a = t ? Math.atan2(t.y - eb.y, t.x - eb.x) : Math.atan2(-eb.vy, -eb.vx);
  eb.life = 0;
  spawnShots([shot({ angle: 0, speed: 750, damage: Math.max(eb.dmg, 10) * mul, radius: Math.max(5, eb.r), life: 1.5, color, shape: 'reflect', homing })], eb.x, eb.y, a, 1, null);
}
// 能量刃：彈反、完美彈反
const parryShoot = (p, eb) => reflectShot(eb, PARRY.reflect, '#ff8fd8', Game.wp.reflectHome ? 4 : 0);  // 反射彈追蹤（升級）
// 子彈的 park 欄位（武器資料寫 'disc'／'well'）→ 停在場上的設定
const PARKS = { disc: DISC_PARK, well: WELL_PARK };

// 熱能光束：熱度、過熱、排熱
class HeatBeam extends WeaponPlay {
  constructor() { super('laser'); }
  canFire(p) { return !(p.hLock > 0); }
  onFire(p, list) {
    const w = Game.wp, h = p.hHeat || 0;
    let mul = 1;
    if (!(p.beatT > 0)) p.beatI = 0;  // 四快一慢：停火 BEAT.reset 秒從頭算
    const i = p.beatI || 0, heavy = i === BEAT.n - 1;
    p.beatI = (i + 1) % BEAT.n; p.beatT = BEAT.reset + Game.stats.interval * BEAT.slow;
    if (i >= BEAT.n - 2) p.fireCd = Math.max(p.fireCd, 0) + Game.stats.interval * (BEAT.slow - 1);  // 重的那發前後都慢一拍（第 n−1 發之後、第 n 發之後；tickFire 之後再加正常間隔）
    if (heavy) { mul *= BEAT.dmg; for (const s of list) { s.radius *= BEAT.grow; s.color = '#ffffff'; } Game.shake(2); }  // 白色：收尾都用白色（能量刃強化刀、飛輪快擲）
    if (w.hot) mul *= 1 + HOT.mul * h;                    // 高溫
    if (w.zero && h < COOL.zero) mul *= COOL.zeroMul;     // 零度
    for (const s of list) { s.damage *= mul; if (w.crit && h >= CRIT.at) s.pierce += CRIT.pierce; }  // 臨界
    if (!(w.streak && p.streakT > 0)) p.hHeat = h + HEAT.per;  // 連殺不停火：擊殺後一段時間不加熱
    p.hWait = HEAT.wait;  // 最後一發之後 HEAT.wait 秒才開始降溫（見 tick）
    if (p.hHeat >= 1) {
      p.hHeat = 1;
      if (w.melt) p.hp = Math.max(1, p.hp - MELT.hp / Game.stats.rps);  // 熔芯：不停火，改扣血（每秒 MELT.hp，照每秒發數分到每一發）
      else { p.hLock = HEAT.lock; burst(p.x, p.y, '#ff4d6d', 14, 160, 0.4, 3); floatText(p.x, p.y - 30, '過熱！', '#ff4d6d', true); }
    }
    return list;
  }
  tick(p, dt) {
    p.streakT = (p.streakT || 0) - dt; p.beatT = (p.beatT || 0) - dt; p.hWait = (p.hWait || 0) - dt;
    if (p.hLock > 0) { p.hLock -= dt; p.hHeat = Math.max(0, p.hHeat - dt / HEAT.lock); }
    else if (!p.wantFire && p.hWait <= 0) p.hHeat = Math.max(0, (p.hHeat || 0) - HEAT.cool * dt);
  }
  onKill(p) {  // 低溫：擊殺降溫；連殺不停火
    const w = Game.wp;
    if (w.killCool) p.hHeat = Math.max(0, (p.hHeat || 0) - w.killCool);
    if (w.streak) p.streakT = COOL.streak;
  }
  alt(p) {
    const w = Game.wp, h = p.hHeat || 0;
    if (h < (w.ventMin || HEAT.min)) return altMiss(p);
    const k = w.ventSplit ? h / 2 : h, R = wSize(HEAT.r * (w.ventRange || 1)), list = [];  // 分段排熱：一次只排一半
    for (let i = 0; i < HEAT.n; i++) list.push(shot({ angle: i / HEAT.n * TAU, speed: 1000, damage: wDmg(HEAT.dmg * k), radius: 6, pierce: 99, life: R / 1000, color: w.ventSlow ? '#9fe8ff' : '#ff9f1c', shape: 'line', knock: 2,
      slow: w.ventSlow ? VENT2.slow : 0, slowDur: w.ventSlow ? VENT2.slowT : 0 }));  // 冷凍衝擊
    spawnShots(elemize(list, w.el), p.x, p.y, 0, 0, null);
    Game.lineSig(p, p.x, p.y, p.aim, null);  // 招牌動作：武器線觸發一次
    for (const b of Game.eBullets) if (dist2(b.x, b.y, p.x, p.y) < R * R) b.life = 0;
    ringFx(p.x, p.y, R, w.ventSlow ? '#9fe8ff' : '#ff9f1c'); Game.shake(3 + 4 * k);
    p.hHeat = h - k; p.hLock = 0;
    if (w.ventSplit && (p.ventHalf = !p.ventHalf)) p.altCd = VENT2.cd;  // 分段排熱：第一下之後只等 VENT2.cd（可以馬上排第二下），第二下之後照正常冷卻（以前每下都 0.25，等於沒有冷卻）
  }
}
// 迴旋飛輪：停在場上、召回
class Flywheel extends ParkWeapon {
  constructor() { super('scatter', 'disc'); }
  max() { return DISC.max + (Game.wp.discMax || 0); }  // 場上最多幾個
  canFire(p) { return this.shots(p).length < this.max(); }
  onFire(p, list) {  // 全接快擲：手上強化的飛輪先擲出去（飛得快、比較痛，停的距離不變），一個用掉一次
    if (!(p.fastN > 0)) return list;
    for (const s of list) { if (!(p.fastN > 0)) break; p.fastN--; s.speed *= DISC_FAST.speed; s.life /= DISC_FAST.speed; s.damage *= DISC_FAST.dmg; s.color = '#ffffff'; }
    Game.shake(2);
    return list;
  }
  tick(p, dt) {
    const w = Game.wp;
    for (const b of this.shots(p)) if (b.mode === 'park' && dist2(b.x, b.y, p.x, p.y) < (p.r + b.r) ** 2) { b.dead = true; DISC_PARK.onCatch(b); }  // 走過去撿起來：跟接住一樣（爆輪、自動再擲；不算全接）（使用者 10-23）
    if (p.rethrowN > 0 && this.canFire(p)) { p.rethrowN--; p.fire(); }  // 自動再擲
    if (w.discArc && (p.arcT = (p.arcT || 0) - dt) <= 0) {  // 連鎖：停住的飛輪之間放電弧
      p.arcT = DISC_UP.arc.every;
      const D = this.shots(p).filter(b => b.mode === 'park');
      for (let i = 0; i + 1 < D.length; i++) {
        const a = D[i], b = D[i + 1];
        if (dist2(a.x, a.y, b.x, b.y) > DISC_UP.arc.len ** 2) continue;
        zapFx(a.x, a.y, b.x, b.y, { c: '#ffd166', life: 0.15 });
        for (const e of Game.enemies) if (!e.dead && segDist2(a.x, a.y, b.x, b.y, e.x, e.y) < (DISC_UP.arc.w + e.r) ** 2) wHit(e, DISC_UP.arc.dmg);
      }
    }
  }
  onHit(p, b, e) {  // 召回：每個飛輪回程第一次打到敵人，觸發武器線（招牌動作；時間到自己飛回的不算）
    if (b.mode === 'return' && b.recall && !b.sigDone) { b.sigDone = true; Game.lineSig(p, e.x, e.y, b.angle, e.id); }
  }
  alt(p) {
    const D = this.shots(p), w = Game.wp;
    if (!D.length) return altMiss(p);
    p.recallN = D.length >= this.max() ? D.length : 0; p.caught = 0;  // 全接快擲：丟滿才算，這一批全部接回手上
    for (const b of D) {
      b.recall = true; discReturn(b, w.discBack || DISC.back);
      if (w.discDetour) b.detour = nearestEnemy(b.x, b.y, DISC_UP.detourR, null);  // 回程追蹤：先繞去最近的敵人（見 Bullet 的 return）
    }
  }
}
// 重力井：吸怪、塌縮
class GravityWell extends ParkWeapon {
  constructor() { super('plasma', 'well'); }
  max() { return WELL.max + (Game.wp.wellMax || 0); }  // 場上最多幾個
  count(p) { return this.shots(p).filter(b => b.mode === 'park').length; }  // 停住的才算（飛行中的還沒變成井）
  tick(p, dt) {
    const S = this.shots(p);
    for (const b of S) {  // 疊井：飛行中的重力彈碰到停著的井（井本體，不是吸引範圍；看這一幀飛過的線段）就併進去（以前看停下的位置在不在吸引範圍裡：沒碰到會合、穿過去的不合，10-23）
      if (b.mode !== 'fly' || b.dead) continue;
      const o = S.find(o => o.mode === 'park' && !o.small && !o.dead && (o.stack || 0) < WELL_STACK.max && segDist2(b.px, b.py, b.x, b.y, o.x, o.y) < (o.r + b.r) ** 2);
      if (!o) continue;
      o.stack = (o.stack || 0) + 1; o.r *= WELL_STACK.r; o.parkT = Math.max(o.parkT, WELL.park);  // 併進去：停留時間重新算滿 o.eaten = (o.eaten || 0) + (b.eaten || 0);
      b.dead = true; ringFx(o.x, o.y, wellR(o), '#c77dff'); floatText(o.x, o.y - 24, `疊井 ×${o.stack + 1}`, '#e0b3ff');
    }
    if (!Game.wp.flyPull) return;  // 黑洞彈：飛行中就吸路徑旁的敵人
    for (const b of S) if (b.mode === 'fly' && !b.dead) pullEnemies(b.x, b.y, wellR(b) * WELL_UP.flyR, dt);
  }
  boomN(b) {  // 塌縮算幾隻：碰到爆炸的敵人算 1 隻；旗艦算罩到幾個命中點（至少 1）。電腦挑時機也用這個
    const R = wSize(WELL.boom);
    return Game.enemies.reduce((s, e) => {
      if (e.dead || dist2(e.x, e.y, b.x, b.y) >= (R + e.r) ** 2) return s;
      const pts = hitPts(e);
      return s + (pts ? Math.max(1, pts.filter(q => dist2(q.x, q.y, b.x, b.y) < R * R).length) : 1);
    }, 0);
  }
  alt(p) {
    const w = Game.wp;
    let W = this.shots(p).filter(b => b.mode === 'park');
    if (!W.length) return altMiss(p);
    if (w.single) {  // 單點引爆：只炸離準星最近的那個
      const [tx, ty] = aimAt(p);
      W = [W.reduce((a, b) => dist2(a.x, a.y, tx, ty) <= dist2(b.x, b.y, tx, ty) ? a : b)];
      p.altCd = WELL_UP.singleCd;
    }
    for (const b of W) {
      const n = this.boomN(b);
      const dmg = WELL.dmg * (1 + (w.wellPer || WELL.per) * clamp(n - 1, 0, WELL.capN)) * (1 + WELL_UP.eat.per * (b.eaten || 0)) * WELL_STACK.dmg ** (b.stack || 0);  // 吸彈：吸過的敵彈加傷；疊井
      wBoom(b.x, b.y, WELL.boom, dmg, '#c77dff', b.att);
      Game.lineSig(p, b.x, b.y, p.aim, null);  // 招牌動作：每個井觸發一次武器線
      if (n > 1) floatText(b.x, b.y - 20, `×${n}`, '#e0b3ff', n >= 4);
      b.dead = true;
      if (w.residue && !b.small) {  // 殘留：原地留一個小井
        spawnShots([shot({ speed: 0, damage: 3, radius: 7, pierce: 99, life: 0.01, color: '#c77dff', shape: 'orb', park: 'well' })], b.x, b.y, 0, 0, null);
        const s = Game.bullets[Game.bullets.length - 1];
        s.small = true; s.toPark(); s.parkT = WELL_UP.residue.t;
      }
    }
    Game.shake(5);
  }
}
// 牽引鉤：勾住、甩擊、釘住旗艦
class GrappleHook extends WeaponPlay {
  constructor() { super('railgun'); }
  holdT(e) { return (e && e.ccDur ? e.ccDur('hook', HOOK.t) : HOOK.t) + (Game.wp.hookT || 0); }  // 隊友那邊的敵人是同步來的資料（沒有方法）：左上角的鉤爪狀態照基本時間算（以前直接呼叫，隊友勾住敵人時畫面當掉，smoke.js 偶發）  // 勾住（釘住）e 最多幾秒：照控制抗性（CFG.CC，精英比較短），升級的勾住時間另外加
  shield(list) {  // 這些敵人（勾住的、甩出去還在飛的）擋下碰到的敵彈、照子彈傷害扣血（算在射鉤爪的人身上）；反射盾：擋下的彈回去打最近的敵人（不打 list 裡的）
    const skip = Game.wp.hookReflect ? new Set(list.map(o => o.id)) : null;
    for (const o of list) for (const b of Game.eBullets) {
      if (o.dead || !(b.life > 0) || b.mine || dist2(b.x, b.y, o.x, o.y) >= (o.r + b.r) ** 2) continue;
      o.hurt(b.dmg, 0, 0, 'direct', WATT()); floatText(o.x, o.y - o.r, Math.round(b.dmg), '#ffffff');
      if (skip) reflectShot(b, HOOK_UP.reflect, '#ffd166', 0, skip); else b.life = 0;
      burst(b.x, b.y, '#ffd166', 4, 100, 0.2, 2);
    }
  }
  canFire(p) { return !p.hookShip; }  // 勾著隊友時不射新的鉤爪（右鍵把他甩出去）
  // ---- 勾隊友（多人戰鬥）：p.hookShip = 勾住的船、那艘船的 grabBy = p 的號碼；被勾的船自己拉自己（Game.shipPull）----
  //   不會繞圈：被勾住的人不能勾隊友（還能勾敵人）、已經被勾住的船別人勾不到（使用者 10-23：四個人互勾不能無限循環）
  hookShips(p) {
    if (!(Game.mode === 'coop' && Game.inArena) && !Hub.coop()) return;  // 多人戰鬥、多人房間（房間裡每台電腦各自判定：別人的鉤爪打中自己 → 自己被拉）
    if (p.hookE || p.hookShip || p.grabBy) return;
    const me = Game.slotOf(p);
    for (const b of Game.bullets) {
      if (b.dead || !b.hook || b.ownerP !== p || b.mode !== 'fly') continue;
      const q = Game.allShips().find(s => s !== p && !s.gone && !s.grabBy && segDist2(b.px, b.py, b.x, b.y, s.x, s.y) < (s.r + b.r) ** 2);  // 看這一幀飛過的線段（一幀 21 > 飛船＋鉤爪的半徑，只看點會跳過去）
      if (!q) continue;
      b.dead = true; p.hookShip = q; q.grabBy = me; p.hookT = this.holdT();
      floatText(q.x, q.y - 20, '勾住隊友！', '#ffd166');
      return;
    }
  }
  freeShip(p) { if (p.hookShip) p.hookShip.grabBy = 0; p.hookShip = null; }  // 放開勾住的隊友
  flingShip(p) {  // 右鍵：把勾住的隊友朝準星甩出去（飛行中無敵、撞到的敵人受甩擊傷害；倒下的只放開）
    const q = p.hookShip; this.freeShip(p);
    if (q.dead) return;
    q.flingSeq = (q.flingSeq || 0) + 1; q.flingV = [Math.cos(p.aim) * HOOK.fling, Math.sin(p.aim) * HOOK.fling];  // 隊友的船在他自己電腦上飛（快照 me）
    if (q === Game.player) { q.vx = q.flingV[0]; q.vy = q.flingV[1]; q.kbT = HOOK.flyT; }  // 房主自己的船：直接飛（kbT：不吃操控）
    q.iframe = Math.max(q.iframe || 0, HOOK.flyT);
    (p.flungShips = p.flungShips || []).push({ q, t: HOOK.flyT, hit: new Set() });
    burst(q.x, q.y, '#ffd166', 8, 180, 0.25, 2);
  }
  free(p, broke) {  // 放開勾住的：有抗性的開始免疫（CFG.CC）；broke = 時間到自己掙脫
    for (const o of [p.hookE, ...(p.hookX || [])]) if (o && o.ccEnd('hook') && broke && !o.dead) floatText(o.x, o.y - 24, '掙脫！', '#ff8f8f', true);
    p.hookE = null; p.hookX = [];
  }
  onFire(p, list) {  // 勾住時左鍵改成「扯」：扯、扯、重摔（YANK），不射新的鉤爪
    const e = p.hookE;
    if (!e || e.dead) return list;
    const i = p.yankI || 0, d = Game.wp.damage / (Game.wp.plugDmg || 1);  // 武器傷害（插件在 wHit／wBoom 裡乘）
    p.yankI = (i + 1) % YANK.n;
    p.yankCd = YANK.every;  // 扯不照射速：tick 把開火冷卻壓到這個（tickFire 的冷卻最多只帶一幀，不能在這裡扣）
    Events.emit('hit', { e, dmg: d });  // 扯不射子彈（Player.fire 拿到空清單就不發 shoot）：自己發打中的音效
    if (i === YANK.n - 1) { wBoom(e.x, e.y, YANK.r, d * YANK.slam, '#ffd166'); p.slammed = true; Game.shake(4); floatText(e.x, e.y - 24, '重摔！', '#ffd166', true); }
    else for (const o of [e, ...(p.hookX || [])]) { wHit(o, d); burst(o.x, o.y, '#ffd166', 4, 120, 0.2, 2); }
    Game.lineTouch(p, e, YANK.trig);  // 扯也算武器打中：照 YANK.trig 累積觸發電路（10-25 使用者：扯要能觸發晶片）
    return [];
  }
  tick(p, dt) {
    const w = Game.wp, e = p.hookE;
    p.yankCd = (p.yankCd || 0) - dt;
    if (e && !e.dead) p.fireCd = Math.min(p.fireCd, Math.max(0, p.yankCd));  // 勾住時照 YANK.every 扯
    this.hookShips(p);
    const q = p.hookShip;
    if (q && (q.gone || q.dashT > 0 || p.dead || (p.hookT -= dt) <= 0)) this.freeShip(p);  // 隊友衝刺 = 掙脫
    if (p.flungShips) p.flungShips = p.flungShips.filter(f => {  // 甩出去的隊友：飛行中撞到的敵人受甩擊傷害（每隻一次）
      if ((f.t -= dt) <= 0 || f.q.dead || f.q.gone) return false;
      for (const o of Game.enemies) if (!o.dead && !f.hit.has(o.id) && dist2(o.x, o.y, f.q.x, f.q.y) < (o.r + f.q.r) ** 2) {
        f.hit.add(o.id); wHit(o, HOOK.dmg * (Game.wp.flingMul || 1), 0, 0, 2); Game.shake(3);
        if (!f.sig) { f.sig = true; Game.lineSig(p, o.x, o.y, p.aim, o.id); }  // 招牌動作：第一次撞到觸發武器線
      }
      return true;
    });
    if (e && (e.dead || (p.hookT -= dt) <= 0)) this.free(p, !e.dead);
    else if (e) {
      p.hookX = (p.hookX || []).filter(o => !o.dead);
      if (!e.t.boss) [e, ...p.hookX].forEach((o, i) => {  // 拉到飛船前方（群鉤的排在兩側）、暈住（stunT：不動、不攻擊）；走 move 才會被牆擋住（以前直接改位置，會被拉穿牆，10-22）
        const hold = Math.max(HOOK.hold, p.r + o.r + (o.shieldA != null ? SHIELD_OUT : 0) + 12);  // 大隻的、帶盾的拉在遠一點（不貼在船上）
        const side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 32, tx = p.x + Math.cos(p.aim) * hold - Math.sin(p.aim) * side, ty = p.y + Math.sin(p.aim) * hold + Math.cos(p.aim) * side, k = Math.min(1, dt * 12);
        const n = Math.max(1, Math.ceil(Math.hypot(tx - o.x, ty - o.y) * k / (o.r * 0.5)));  // 分小步走：一步超過牆厚會穿過去（碰撞是移動後才檢查）
        o.vx = (tx - o.x) * k / dt; o.vy = (ty - o.y) * k / dt;
        for (let s = 0; s < n; s++) o.move(dt / n);
        o.vx = o.vy = 0; o.stunT = Math.max(o.stunT || 0, 0.1);
      });
      if ((p.hookTick = (p.hookTick || 0) + dt) >= HOOK.tick) {  // 持續傷害：每 tick 秒結算一次
        const k = p.hookTick; p.hookTick = 0;
        if (e.t.boss) e.hurt(wDmg(HOOK.tear * k), 0, 0, 'direct', WATT());  // 旗艦：釘住撕扯
        else if (w.hookDps) for (const o of [e, ...p.hookX]) o.hurt(wDmg(HOOK_UP.dps * k), 0, 0, 'direct', WATT());  // 拉：勾住的持續受傷
      }
      if (w.shockHook && (p.shockT = (p.shockT || 0) - dt) <= 0) {  // 電擊鉤：電流傳到附近的敵人
        p.shockT = HOOK_UP.shock.every;
        const S = HOOK_UP.shock, near = Game.enemies.filter(o => !o.dead && o !== e && !p.hookX.includes(o) && dist2(o.x, o.y, e.x, e.y) < S.r * S.r).slice(0, S.n);
        for (const o of near) { zapFx(e.x, e.y, o.x, o.y, { c: '#ffd166' }); wHit(o, S.dmg); }
      }
      if (!e.t.boss) this.shield([e, ...p.hookX]);  // 勾住的敵人擋子彈（拉在身前當盾牌）
    }
    if (p.grap) {  // 鉤索：拉向鉤到的點，路上撞到的敵人受傷
      const G = p.grap, l = Math.hypot(G.x - p.x, G.y - p.y);
      G.t = (G.t || 0) + dt;
      // 到了、被擋住拉不過去（這一幀沒更靠近）、拉太久：放開。以前只看「到了」：鉤到牆角，牆擋著永遠差一點到不了，飛船整場被定住（整局模擬軌道第 7 局卡住，10-23）
      if (l <= HOOK_UP.grapple.stop || (G.last != null && l > G.last - 0.5) || G.t > HOOK_UP.grapple.maxT) p.grap = null;
      else {
        G.last = l;
        const m = Math.min(l - HOOK_UP.grapple.stop, HOOK_UP.grapple.speed * dt);
        p.x += (G.x - p.x) / l * m; p.y += (G.y - p.y) / l * m; p.vx = p.vy = 0;
        for (const o of Game.enemies) if (!o.dead && !G.hit.has(o.id) && dist2(o.x, o.y, p.x, p.y) < (o.r + p.r) ** 2) { G.hit.add(o.id); wHit(o, HOOK_UP.grapple.dmg, 0, 0, 2); burst(o.x, o.y, '#ffd166', 8, 180, 0.25, 2); }
      }
    }
    // 被甩出去的敵人：飛行中撞到別隻 → 兩隻都受傷（每隻只撞一次）；撞到牆 → 受傷、停在牆邊（爆裂甩照樣炸）；彈跳甩撞到後轉向下一隻；爆裂甩飛完爆炸
    const dmg = HOOK.dmg * (w.flingMul || 1), keep = [];
    for (const f of p.flung || []) {
      if (f.e.dead) continue;
      if (f.t < HOOK.flyT - 0.03 && f.e.atWall()) {  // 撞牆（剛甩出去那一下不算：被勾在牆邊往外甩時還貼著牆）
        wHit(f.e, dmg * HOOK.wall); f.e.vx = f.e.vy = 0; f.t = 0;
        burst(f.e.x, f.e.y, '#ffd166', 14, 240, 0.35, 3); Game.shake(4); floatText(f.e.x, f.e.y - 24, '撞牆！', '#ffd166', true);
        if (!f.sig) { f.sig = true; Game.lineSig(p, f.e.x, f.e.y, 0, null); }  // 招牌動作：沒撞到別隻、先撞牆也觸發武器線
      }
      if ((f.t -= dt) <= 0) { if (w.flingBoom) { wBoom(f.e.x, f.e.y, HOOK_UP.boom.r, HOOK_UP.boom.dmg, '#ffd166'); Game.shake(3); } continue; }
      keep.push(f);
      for (const o of Game.enemies) {
        if (o === f.e || o.dead || f.hit.has(o.id) || dist2(o.x, o.y, f.e.x, f.e.y) > (o.r + f.e.r) ** 2) continue;
        f.hit.add(o.id);
        wHit(o, dmg, f.e.vx * 0.2, f.e.vy * 0.2, 2);
        wHit(f.e, dmg * HOOK.self);  // 被甩的那隻也受傷
        if (!f.sig) { f.sig = true; Game.lineSig(p, o.x, o.y, Math.atan2(f.e.vy, f.e.vx), o.id); }  // 招牌動作：第一次撞到觸發武器線
        burst(o.x, o.y, '#ffd166', 10, 220, 0.3, 3); Game.shake(3);
        if (f.bounce > 0) {  // 彈跳甩：轉向下一隻
          f.bounce--;
          const n = Game.enemies.filter(q => !q.dead && q !== f.e && !f.hit.has(q.id) && dist2(q.x, q.y, f.e.x, f.e.y) < HOOK_UP.bounceR ** 2)
            .sort((a, b) => dist2(a.x, a.y, f.e.x, f.e.y) - dist2(b.x, b.y, f.e.x, f.e.y))[0];
          if (n) { const a = Math.atan2(n.y - f.e.y, n.x - f.e.x); f.e.vx = Math.cos(a) * HOOK.fling; f.e.vy = Math.sin(a) * HOOK.fling; f.t = HOOK.flyT; f.e.stunT = HOOK.flyT; }
        }
        break;
      }
    }
    p.flung = keep;
    if (keep.length) this.shield(keep.map(f => f.e));  // 甩出去還在飛的也擋子彈
  }
  onHit(p, b, e) {
    if (!b.hook || e.dead || e.ccImmune('hook')) return;  // 剛掙脫的（控制抗性）：只吃傷害、勾不住
    const w = Game.wp;
    if (!p.hookE) { p.hookE = e; p.hookX = []; p.hookT = this.holdT(e); p.yankI = 0; p.slammed = false; floatText(e.x, e.y - 20, e.t.boss ? '釘住！' : '勾住！', '#ffd166'); return; }
    // 群鉤：同一發穿過去再勾住別隻（旗艦不算）
    if (w.multi && !e.t.boss && !p.hookE.t.boss && e !== p.hookE && !p.hookX.includes(e) && p.hookX.length < (w.hookMax || HOOK_UP.multi) - 1) p.hookX.push(e);  // hookMax：數量插件
  }
  onWall(p, x, y) {  // 鉤索：鉤爪打到牆就把自己拉過去
    if (!Game.wp.grapple || p.hookE) return;
    p.grap = { x, y, hit: new Set() }; ringFx(x, y, 16, '#ffd166');
  }
  alt(p) {
    if (p.hookShip) return this.flingShip(p);
    const e = p.hookE;
    if (!e) return altMiss(p);
    const X = p.hookX || [];
    this.free(p, false);
    if (e.t.boss) {  // 旗艦：用力一扯
      wHit(e, HOOK.rip);
      burst(e.x, e.y, '#ffd166', 16, 260, 0.4, 3); floatText(e.x, e.y - 30, '撕裂！', '#ffd166', true); Game.shake(5);
      return;
    }
    p.flung = p.flung || [];
    [e, ...X].forEach((o, i) => {  // 群鉤：整串一起甩（稍微散開）
      const a = p.aim + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.12;
      o.vx = Math.cos(a) * HOOK.fling; o.vy = Math.sin(a) * HOOK.fling; o.stunT = HOOK.flyT;
      p.flung.push({ e: o, t: HOOK.flyT, hit: new Set(), bounce: Game.wp.flingBounce ? 1 : 0 });
      burst(o.x, o.y, '#ffd166', 8, 180, 0.25, 2);
    });
  }
}
// 能量刃：連段、彈反
class EnergyBlade extends WeaponPlay {
  constructor() { super('blade'); }
  onFire(p, list) {
    const w = Game.wp, steps = w.combo4 ? COMBO4 : COMBO.steps, last = steps[steps.length - 1];
    if (!(p.comboT > 0) || p.comboI == null) { p.comboI = 0; p.endN = 0; }
    if (p.comboI >= steps.length) p.comboI = 0;
    const full = w.endless && (p.endN || 0) >= ENDLESS.max;  // 無盡連段：疊滿後每刀都是重斬
    const st = full ? last : steps[p.comboI], heavy = st === last, up = p.edgeT > 0;
    p.comboI = (p.comboI + 1) % steps.length; p.comboT = COMBO.reset + Game.stats.interval * st.cd;  // 收刀的時間不算在 reset 裡（不然重斬之後無盡連段一定歸零）
    p.comboName = st.name;
    if (w.endless) p.endN = Math.min(ENDLESS.max, (p.endN || 0) + 1);
    if (up) p.edgeT = 0;
    let mul = st.dmg * (up ? PARRY.boost : 1);
    if (w.endless) mul *= 1 + ENDLESS.per * p.endN;
    if (w.fury) mul *= 1 + FURY.per * Math.max(0, 1 - p.hp / p.maxHp);  // 狂戰：血越少越痛
    if (heavy && w.blood) {  // 血祭重斬：扣血（不低於 floor）換傷害
      const fl = p.maxHp * BLOOD.floor;
      if (p.hp > fl) p.hp = Math.max(fl, p.hp - p.maxHp * BLOOD.cost);
      mul *= BLOOD.mul;
    }
    const sig = heavy ? { done: false } : null;  // 招牌動作：這一刀第一下命中觸發武器線（onHit）
    for (const s of list) {
      s.sig = sig;
      s.angle *= st.wide; s.damage *= mul; s.radius *= st.grow * (up ? PARRY.grow : 1);
      if (up) s.color = '#ffffff';
    }
    if (heavy && w.whirl) { const n = list.length * 2; list = Array.from({ length: n }, (_, i) => ({ ...list[i % list.length], angle: i / n * TAU })); }  // 旋風重斬：360°
    if (st.lunge) { p.vx += Math.cos(p.aim) * st.lunge; p.vy += Math.sin(p.aim) * st.lunge; }
    p.fireCd = Math.max(p.fireCd, 0) + Game.stats.interval * (st.cd - 1);  // 收刀：多等的時間（tickFire 之後再加正常間隔）
    if (!st.sweep || list.length < 2) return list;
    const order = list.slice().sort((a, b) => (a.angle - b.angle) * st.sweep);  // 照揮的方向排：先出的在前
    order.slice(1).forEach((s, i) => Game.slashQ.push({ s, p, a: p.aim, t: COMBO.sweepT * (i + 1) / (order.length - 1) }));
    return [order[0]];
  }
  onHit(p, b, e) {  // 重斬第一下命中：招牌動作，觸發武器線；吸能刃：命中回血，最多回到上限
    if (b && b.sig && !b.sig.done) { b.sig.done = true; Game.lineSig(p, e.x, e.y, b.angle, e.id); }
    if (e && Game.wp.blood) p.bloodE = b && b.sig ? e : p.bloodE === e ? null : p.bloodE;  // 血祭重斬：記住最後被重斬打到的那隻（命中在扣血之前，打死時 onKill 看）
    const L = Game.wp.leech && LEECH;
    if (L && p.hp < p.maxHp * L.cap) p.hp = Math.min(p.maxHp * L.cap, p.hp + L.heal);
  }
  onKill(p, e) { if (Game.wp.blood && p.bloodE === e) { p.hp = Math.min(p.maxHp, p.hp + p.maxHp * BLOOD.kill); p.bloodE = null; } }  // 血祭重斬：重斬打死的回血
  onHurt(p) { p.endN = 0; }
  alt(p) { p.parryWin0 = p.parryWinT = PARRY.win + (Game.wp.parryWin || 0); p.parryN = 0; ringFx(p.x, p.y, PARRY.r, '#ff8fd8'); }
}
// 無人機蜂群：出擊、收攏、牽繩、耐久
class DroneSwarm extends WeaponPlay {
  constructor() { super('drone'); }
  blockMax() { return DRONE.blockN + (Game.wp.blockN || 0); }  // 收攏一次最多擋幾顆
  // 這架無人機要打哪隻（開火、平常機頭朝向共用）：集火 = T（離準星最近的那隻，射程 1.5 倍內）；沒集火 = 自己射程內最近的
  //   不優先打王：要打王，玩家自己把無人機擺到王旁邊（使用者 10-23 定，這是蜂群的玩法）
  target(d, T) { return T && !T.dead && dist2(T.x, T.y, d.x, d.y) < (DRONE.range * 1.5) ** 2 ? T : !Game.wp.focusD ? nearestEnemy(d.x, d.y, DRONE.range, null) : null; }
  onFire(p, list) {  // 電路的子彈改從每架無人機射出；收攏中不攻擊
    const w = Game.wp;
    if (p.guardT > 0 || !p.drones) return [];
    let T = null;
    if (w.focusD) {  // 集火：全部打離準星最近的那隻，連續打同一隻越打越痛
      const [ax, ay] = aimAt(p, 0, DRONE.leash);
      T = nearestEnemy(ax, ay, DRONE.range + DRONE.leash, null);
      p.focN = T && T === p.focE ? Math.min(DRONE_UP.focus.max, (p.focN || 0) + 1) : 0; p.focE = T;
    }
    const M = DRONE_UP.missile, mul = 1 + (w.focusD ? DRONE_UP.focus.per * p.focN : 0);
    let shot0 = false;
    for (const d of p.drones) {
      if (d.down > 0 || d.kami) continue;
      const t = this.target(d, T);
      if (!t) continue;
      spawnShots(list.map(s => ({ ...s, damage: s.damage * mul, ...(w.missile ? { homing: M.homing, explode: { r: M.r, ratio: M.ratio }, speed: s.speed * M.speed, shape: 'dart' } : {}) })),
        d.x, d.y, Math.atan2(t.y - d.y, t.x - d.x), 0, null);  // 飛彈無人機：追蹤＋小爆炸
      shot0 = true;
    }
    if (shot0) Events.emit('shoot', { p, weapon: 'drone' });
    return [];
  }
  tick(p, dt) {
    const w = Game.wp, n = w.drones || DRONE.n, D = p.drones || (p.drones = []);
    while (D.length < n) D.push({ x: p.x, y: p.y, hp: DRONE.hp });
    D.length = n;
    const g0 = p.guardT > 0;
    p.guardT = Math.max(0, (p.guardT || 0) - dt);
    const guard = p.guardT > 0;
    if (guard && w.repair) p.hp = Math.min(p.maxHp, p.hp + DRONE_UP.repair * dt);  // 修復：收攏中回血
    if (g0 && !guard && p.blocked > 0) Game.lineSig(p, p.x, p.y, p.aim, null);  // 招牌動作：收攏有擋到東西，結束時觸發武器線
    if (g0 && !guard && w.counter && p.blocked > 0) {  // 反擊：收攏結束，每架衝向敵人，擋得越多越痛
      for (const d of D) {
        if (d.down > 0) continue;
        const t = nearestEnemy(d.x, d.y, DRONE_UP.counter.r, null);
        if (t) { zapFx(d.x, d.y, t.x, t.y, { c: '#7cf5c8' }); wHit(t, DRONE_UP.counter.per * p.blocked); }
      }
      p.blocked = 0;
    }
    const [cx, cy] = aimAt(p, 0, DRONE.leash), ph = Game.time * (guard ? 6 : 2);
    D.forEach((d, i) => {
      if (d.down > 0) { if ((d.down -= dt) <= 0) { d.x = p.x; d.y = p.y; d.hp = DRONE.hp; ringFx(p.x, p.y, 14, '#7cf5c8'); } return; }  // 壞掉的：時間到在飛船旁重生
      if (d.kami) {  // 自爆：衝向目標，碰到就炸，之後等重生
        const t = d.kami;
        if (t.dead) { d.kami = null; return; }
        const l = Math.hypot(t.x - d.x, t.y - d.y), m = Math.min(l, DRONE_UP.kami.speed * dt);
        if (l > 0) { d.x += (t.x - d.x) / l * m; d.y += (t.y - d.y) / l * m; d.a = Math.atan2(t.y - d.y, t.x - d.x); }
        if (l <= t.r + 8) { wBoom(d.x, d.y, DRONE_UP.kami.r, DRONE_UP.kami.dmg, '#7cf5c8'); d.kami = null; d.down = DRONE.respawn; }
        return;
      }
      const away = p.wantFire && !guard && !(w.split && i % 2);  // 分工：單數的留在身邊
      const ox = away ? cx : p.x, oy = away ? cy : p.y;
      const a = ph + i / n * TAU, r = guard ? DRONE.guard : away ? DRONE.spread : DRONE.orbit;
      const dx = ox + Math.cos(a) * r - d.x, dy = oy + Math.sin(a) * r - d.y, l = Math.hypot(dx, dy), m = Math.min(l, DRONE.speed * (guard ? 3 : 1) * dt);
      if (l > 0) { d.x += dx / l * m; d.y += dy / l * m; }
      const t = guard ? null : this.target(d, w.focusD ? p.focE : null);  // 機頭一直瞄著要打的那隻（沒開火也是），沒有目標就朝移動方向；照 DRONE.turn 慢慢轉
      const want = t ? Math.atan2(t.y - d.y, t.x - d.x) : l > 2 ? Math.atan2(dy, dx) : null;
      if (want != null) d.a = d.a == null ? want : d.a + clamp(angleDiff(d.a, want), -DRONE.turn * dt, DRONE.turn * dt);
      if (!guard) for (const b of Game.eBullets) {  // 飛出去時會被敵彈打（收攏時由下面的護盾擋）
        if (b.life <= 0 || dist2(b.x, b.y, d.x, d.y) > (DRONE.hitR + b.r) ** 2) continue;
        b.life = 0; burst(d.x, d.y, '#7cf5c8', 4, 100, 0.2, 2);
        if (--d.hp <= 0) { d.down = DRONE.respawn; burst(d.x, d.y, '#ff9f1c', 12, 180, 0.4, 3); break; }
      }
    });
    // 收攏：無人機轉成一圈護盾，碰到這圈的敵彈擋掉（最多 guardN 顆，擋完護盾就散）
    if (guard) for (const b of Game.eBullets) {
      if (b.life <= 0 || dist2(b.x, b.y, p.x, p.y) > (DRONE.guard + DRONE.block + b.r) ** 2) continue;
      b.life = 0; p.blocked = (p.blocked || 0) + 1; burst(b.x, b.y, '#7cf5c8', 5, 120, 0.2, 2);
      if (--p.guardN <= 0) { p.guardT = 0.0001; ringFx(p.x, p.y, DRONE.guard, '#8a8fa8', true); break; }  // 留一點點時間：下一幀照「收攏結束」處理（反擊）
    }
  }
  alt(p) {
    if (Game.wp.kami) {  // 自爆：右鍵改成每架衝向最近的敵人
      let any = false;
      for (const d of p.drones || []) { if (d.down > 0) continue; d.kami = nearestEnemy(d.x, d.y, DRONE_UP.kami.seek, null); any = any || !!d.kami; }
      if (!any) altMiss(p);
      return;
    }
    p.guardT = DRONE.shield; p.guardN = this.blockMax(); p.blocked = 0; ringFx(p.x, p.y, DRONE.guard + 12, '#7cf5c8');
  }
}

// 每把武器的玩法（id → 類別的實例）；某艘船裝的那把用 weaponPlay(p)
const WEAPON_PLAY = Object.fromEntries([new HeatBeam(), new Flywheel(), new GravityWell(), new GrappleHook(), new EnergyBlade(), new DroneSwarm()].map(w => [w.id, w]));
const weaponPlay = p => WEAPON_PLAY[(p ? loadoutOf(p) : Game.cur).weapon.id];  // 不給 p = 目前在算的那個人（withLoadout）
