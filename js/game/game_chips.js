// 星環電路 多人版 · game_chips.js：Game 的晶片效果：線的觸發與往下傳、孢子、彈反、爆炸、敵彈、光束
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   往 game.js 的 Game 加方法（外面照樣呼叫 Game.xxx）
'use strict';

// 紅圈爆炸時誰受傷：回傳 [[飛船, 傷害]]（P = 活著的玩家、inside = 在圈裡）
const ZONE_HIT = {
  bomb: (z, P, inside) => P.filter(inside).map(p => [p, z.dmg]),                 // 落點轟炸、砲擊：圈裡的
  gather: (z, P, inside) => P.filter(p => !inside(p)).map(p => [p, z.dmg]),     // 集合圈：圈外的
  track: (z, P, inside) => P.filter(inside).map(p => [p, z.dmg]),                // 追蹤紅圈：圈裡的（跟落點轟炸一樣，只是先跟著人跑）
};
const ZONE_KINDS = Object.keys(ZONE_HIT);  // 同步用的種類號碼
Object.assign(Game, {
  // ---------- 線（見 chips.js 開頭、pipeline.js）：房主執行 ----------
  // 觸發一格：先排進 triggerQueue（updateBullets 跑完才放產物：不在子彈迴圈裡加子彈），一幀最多 MAX_TRIGGERS_PER_FRAME 個
  //   owner = 那個人的配裝（房主自己 null）；line、k = 那條線的第幾個晶片；(x, y) 位置、ang 方向；ignore = 不要馬上又打到的敵人
  lineQueue(owner, line, k, x, y, ang, ignore) {
    const Q = this.triggerQueue;
    if (Q.length < CFG.MAX_TRIGGERS_PER_FRAME && line.cells[k]) Q.push({ owner, line, k, x, y, ang, ignore });
  },
  // 子彈 b（武器的、或晶片的產物）命中／擊殺了 e、或產物結束了（kind 'hit'／'kill'／'end'；漩渦結束時 e 是中心點）：照產生它的那一格的條件和係數累積，滿 1 觸發下一格
  //   武器、回響照武器的觸發係數（WEAPONS[id].trig）；晶片照 CHIPS[晶片].coef
  //   累積記在那個人的配裝上（lnAcc：下一格 → 累積），一次最多觸發 1 次（多的留著）
  linePass(b, kind, e) {
    const { line, k } = b.ln, next = line.cells[k + 1];
    if (!next) return;
    const src = k < 0 ? null : line.cells[k], echo = !src || src.key === 'echo';
    if ((echo ? 'hit' : CHIPS[src.key].pass) !== kind) return;
    if (b.grp && e.id >= 0) {  // 稀有碎片：6 片都打中同一隻 → 額外傳 1 次
      const n = (b.grp.get(e.id) || 0) + 1;
      b.grp.set(e.id, n);
      if (n === 6) this.lineQueue(b.owner, line, k + 1, e.x, e.y, b.angle, e.id);
    }
    const rareBoom = src && src.rare && src.key === 'boomerang';  // 稀有迴旋：只有回程打中才傳，每次 1
    if (rareBoom && b.mode !== 'return') return;
    const L = b.owner || this.L, A = L.lnAcc || (L.lnAcc = new Map());
    const v = (A.get(next) || 0) + (echo ? WEAPONS[L.weapon.id].trig : rareBoom ? 1 : CHIPS[src.key].coef);
    if (v < 1) { A.set(next, v); return; }
    A.set(next, v - 1);
    this.lineQueue(b.owner, line, k + 1, e.x, e.y, b.angle, e.id);
  },
  // 武器的招牌動作（排熱、召回、塌縮、甩擊、重斬、收攏）：武器線直接觸發第 1 格一次（不用累積），位置在 (x, y)
  lineSig(p, x, y, ang, ignore) {
    const L = loadoutOf(p), line = L.stats && L.stats.line;
    if (line && line.cells.length) this.lineQueue(L === this.L ? null : L, line, 0, x, y, ang, ignore);
  },
  // 放出一格的產物（用那個人的武器與電路）
  lineFire(t) {
    this.withLoadout(t.owner, () => LINE_FX[t.line.cells[t.k].key](t.line.cells[t.k], t));
  },
  // 孢子（感染）：被孢子打死的敵人爆出孢子（照打死牠的那顆的樣板，傷害 ×1.5；只傳一代：爆出來的不再帶感染）
  infectBurst(e) {
    const A = e.killAtt, inf = A && A.inf;
    if (!inf || inf.gen > 0) return;
    const n = 3, a0 = rand(0, TAU), tpl = { ...inf.tpl, damage: inf.tpl.damage * 1.5, infect: 0, infGen: 1, ln: inf.tpl.rare ? inf.tpl.ln : null };  // 第二代打死的不往下傳（稀有：也傳）
    const list = Array.from({ length: n }, (_, k) => ({ ...tpl, angle: a0 + k / n * TAU }));
    this.withLoadout(A.owner, () => spawnShots(list, e.x, e.y, 0, 0, e.id));
  },
  // 能量刃的彈反（右鍵，PARRY）：格擋時間內碰到身邊的敵彈 → 反射去打最近的敵人；成功就冷卻轉好、下一刀強化
  parryReflect(eb, ps) {
    for (const p of ps) {
      if (!(p.parryWinT > 0) || p.dead) continue;
      const rr = PARRY.r + eb.r;
      if (dist2(eb.x, eb.y, p.x, p.y) >= rr * rr) continue;
      const L = loadoutOf(p), perfect = L.wp.perfect && p.parryWin0 - p.parryWinT <= PERFECT.early;  // 完美彈反（升級）：剛按下就擋到
      this.withLoadout(L, () => {
        parryShoot(p, eb);
        if (perfect) for (const o of this.eBullets) if (o.life > 0 && dist2(o.x, o.y, p.x, p.y) < PERFECT.r * PERFECT.r) parryShoot(p, o);
      });
      if (perfect) { ringFx(p.x, p.y, PERFECT.r, '#ffffff'); floatText(p.x, p.y - 48, '完美！', '#ffffff', true); }
      p.edgeT = PARRY.keep; p.altCd = Math.min(p.altCd, PARRY.hitCd); p.parryN = (p.parryN || 0) + 1; p.comboI = (L.wp.combo4 ? COMBO4 : COMBO.steps).length - 1; p.comboT = PARRY.keep;  // 彈反成功：下一刀直接是重斬（四段連段時是第 4 段）
      if (this.mode !== 'coop') this.hitstopT = PARRY.stop;  // 頓幀（雙人不頓：兩台的時間要一致）
      burst(eb.x, eb.y, '#ff8fd8', 10, 200, 0.3, 3);
      ringFx(p.x, p.y, PARRY.r * 1.8, '#ffffff');
      flashFx(p.x, p.y, PARRY.r * 1.4);
      floatText(p.x, p.y - 30, '彈反！', '#ff8fd8', true);
      this.shake(PARRY.shake);
      return true;
    }
    return false;
  },
  // 盾衛反彈：子彈照盾面的法線反彈，變成敵人的子彈（傷害 ×0.5，最多 25），我方子彈消失
  reflectShot(e, b, ca) {
    const nx = Math.cos(ca), ny = Math.sin(ca), vx = Math.cos(b.angle), vy = Math.sin(b.angle), dot = vx * nx + vy * ny;
    let rx = vx - 2 * dot * nx, ry = vy - 2 * dot * ny;
    if (rx * nx + ry * ny < 0.3) { rx = nx; ry = ny; }  // 擦邊的也往外彈
    const l = Math.hypot(rx, ry) || 1, spd = clamp(b.speed * 0.6, 200, 450), dmg = Math.min(25, hitDamage(b) * 0.5);
    this.eBullets.push({ x: e.x + nx * (e.r + SHIELD_OUT + 6), y: e.y + ny * (e.r + SHIELD_OUT + 6), vx: rx / l * spd, vy: ry / l * spd, r: 5, dmg, life: 2.5, from: e.t.name, col: b.color });  // col：原本子彈的顏色（畫成紅框＋原本顏色的芯）
    b.dead = true;
    burst(e.x + nx * (e.r + SHIELD_OUT), e.y + ny * (e.r + SHIELD_OUT), '#bfefff', 6, 160, 0.25, 2);
  },
  // 爆炸：半徑 r 內的敵人（被直擊的 skipId 那隻不再吃爆炸傷害）
  explode(x, y, r, dmg, color, skipId, att = null, fx = null) {  // fx：被炸到的再套這顆的命中效果（武器插件的元素，見 wHit）
    for (const e of this.enemies) {
      if (e.dead || e.id === skipId) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > r + e.r) continue;
      const k = 120 * (14 / e.r) / (d || 1);
      e.hurt(dmg, (e.x - x) * k, (e.y - y) * k, 'explode', att);
      if (fx) this.hitFx(e, fx, dmg, e.x, e.y);
      floatText(e.x, e.y - e.r, Math.round(dmg), '#ffd166');
    }
    Objects.explodeRocks(x, y, r, dmg, att);
    ringFx(x, y, r, color);
    Events.emit('explode', { x, y });
  },
  healPlayer(v, p = this.player) {  // 吸血：每秒最多回復 4 HP（每位玩家各自計算）
    if (!p || p.dead) return;
    if (this.time - (p.healWin || 0) > 1) { p.healWin = this.time; p.healed = 0; }
    const add = Math.min(v, 4 - p.healed);
    if (add <= 0) return;
    p.healed += add;
    p.hp = Math.min(p.maxHp, p.hp + add);
  },
  // 彗星打爆後的碎片打到飛船：每片 10，碎片消失
  cometShardHit(b) {
    for (const p of this.players()) {
      if (p.invuln || dist2(b.x, b.y, p.x, p.y) >= (b.r + p.r) ** 2) continue;
      Objects.cometFrost(p);  // 先凍再扣血（扣血後的無敵時間會擋掉冰凍）
      this.hurtPlayer(CFG.COMET_SHARD_DMG, '彗星（碎片）', p, b.px, b.py);
      b.dead = true; return true;
    }
    return false;
  },
  // 精英「佈雷」的地雷爆炸：半徑 60 內的玩家受傷
  mineBlast(b) {
    const R = AFFIX.mine.r;
    for (const p of this.players()) if (!p.dead && dist2(b.x, b.y, p.x, p.y) < (R + p.r) ** 2) this.hurtPlayer(b.dmg, b.from || '地雷', p, b.x, b.y);
    burst(b.x, b.y, '#ffd400', 24, 260, 0.45, 2.5); ringFx(b.x, b.y, R, '#ffd400');
    Events.emit('mineBlast', b);
  },
  updateEnemyBullets(dt) {
    const ps = this.players();
    Objects.buildGrid();  // 地圖物件格子（敵彈打行星、小行星）
    for (const b of this.eBullets) {
      if (b.home > 0) {  // 精英「追蹤彈」：射出後一段時間內轉向最近的玩家（每秒最多 40°）
        b.home -= dt;
        const q = this.nearestPlayer(b.x, b.y);
        if (q) {
          const a = Math.atan2(b.vy, b.vx), s = Math.hypot(b.vx, b.vy), st = AFFIX.homing.turn * dt;
          const na = a + clamp(angleDiff(a, Math.atan2(q.y - b.y, q.x - b.x)), -st, st);
          b.vx = Math.cos(na) * s; b.vy = Math.sin(na) * s;
        }
      }
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      this.portalHop(b, b.r, 'portalT', 0.3, null, b.x - b.vx * dt, b.y - b.vy * dt);  // 敵彈也會穿門
      if (!Arena.rect && (Arena.f(b.x, b.y) < 0 || Arena.gateCross(b.x - b.vx * dt, b.y - b.vy * dt, b.x, b.y))) { b.life = 0; continue; }  // 大地圖：敵彈打到牆、閘門就消失
      if (Objects.eBulletHit(b)) continue;
      if (this.parryReflect(b, ps)) continue;
      for (const p of ps) {
        const rr = b.r + p.r, d2 = dist2(b.x, b.y, p.x, p.y);
        if (d2 < rr * rr && !p.invuln && !p.dead) {
          b.life = 0;
          if (b.mine) { this.mineBlast(b); break; }  // 精英「佈雷」：碰到就爆炸（範圍內的玩家都受傷）
          if (b.dmg > 0) this.hurtPlayer(b.dmg, (b.from || '敵人') + '（子彈）', p, b.x - b.vx, b.y - b.vy);
          break;
        }
      }
    }
    this.eBullets = this.eBullets.filter(b => b.life > 0);
  },
  // 砲艦的砲擊（CFG.ARTILLERY）：在目標 p 附近放 n 個落點紅圈（第一個在 p 前進方向 lead 秒後的位置），跟王的落點轟炸一樣時間到才爆炸
  artilleryVolley(e, p) {
    const A = CFG.ARTILLERY;
    for (let i = 0; i < A.n; i++) {
      const a = rand(0, TAU), r = i ? rand(60, A.spread) : 0;
      const [x, y] = Arena.clampIn(p.x + (p.vx || 0) * A.lead + Math.cos(a) * r, p.y + (p.vy || 0) * A.lead + Math.sin(a) * r, 20);
      this.zones.push({ x, y, r: A.r, t: A.delay, max: A.delay, dmg: A.dmg, from: `${e.t.name}（砲擊）` });
    }
    burst(e.x + Math.cos(e.chargeA) * e.r, e.y + Math.sin(e.chargeA) * e.r, e.t.color, 12, 200, 0.3, 2);
    Events.emit('enemyShot', e);
  },
  // 拖曳艦的牽引（CFG.TRACTOR）：被拉的船在自己的電腦上拉（房主拉自己、隊友拉自己；e.tgt = 被拉的號碼），拉到離牠 stop 為止；
  //   衝刺中不拉（衝刺 = 掙脫，光束由房主那邊斷掉）。在飛船移動、撞牆之前呼叫（Player.update）
  beamPull(P, dt) {
    if (P.dashT > 0 || !this.enemies.length) return;
    const me = this.slotOf(P), T = CFG.TRACTOR;
    const D = CFG.BOSS_SKILL.devour;
    for (const e of this.enemies) {
      if (e.mode === 'devour' && !e.dead) {  // 星噬母艦・吞噬：範圍內的人都被吸（比飛船慢，頂得住）
        const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1, k = Math.min(D.speed * dt, d - (e.r + P.r + D.stop));
        if (d < D.r && k > 0) { P.x += dx / d * k; P.y += dy / d * k; }
        continue;
      }
      if (e.mode !== 'pull' || e.tgt !== me || e.dead) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy) || 1, k = Math.min(T.speed * dt, d - (e.r + P.r + T.stop));
      if (k > 0) { P.x += dx / d * k; P.y += dy / d * k; }
    }
  },
  // 被隊友的鉤爪勾住（牽引鉤）：P.grabBy = 勾住它的人的號碼（房主設，快照 me 送給隊友）。被勾的船在自己的電腦上被拉到那艘船前方 HOOK.hold、不能自己移動；
  //   衝刺中不拉（衝刺 = 掙脫，見 Player.onDash／GrappleHook.tick）。用速度拉（後面照常撞牆）；回傳有沒有在拉
  shipPull(P, dt) {
    if (!P.grabBy || P.dashT > 0) return false;
    const s = this.allShips().find(q => q !== P && !q.gone && this.slotOf(q) === P.grabBy);
    if (!s) return false;
    const k = Math.min(1, dt * 12), tx = s.x + Math.cos(s.aim) * HOOK.hold, ty = s.y + Math.sin(s.aim) * HOOK.hold;
    P.vx = (tx - P.x) * k / dt; P.vy = (ty - P.y) * k / dt;
    return true;
  },
  // 倒下的船被勾住：自己不會更新（Player.update 不跑），由算它的那台電腦直接搬（房主搬隊友、把位置放進快照 me）
  dragDowned(P, dt) {
    if (!this.shipPull(P, dt)) return;
    P.x += P.vx * dt; P.y += P.vy * dt; P.vx = P.vy = 0;
    if (Arena.rect) { P.x = clamp(P.x, P.r, CFG.WORLD_W - P.r); P.y = clamp(P.y, P.r, CFG.WORLD_H - P.r); } else Arena.collide(P, P.r, null);
  },
  // 旗艦的光束：雙子獵艦兩艘中間的（兩艘都在隊形上才連著）、星環守門者的旋轉光束（cd 倒數：> rest 開著、< warn 預警）
  //   回傳 [{ x1, y1, x2, y2, w, dmg, from, warn }]；房主算傷害、畫面、模擬電腦都用這個，只讀欄位（隊友那邊的敵人是同步來的資料）；同一幀只算一次
  bossBeams() {
    if (this.beamMemo && this.beamMemo.t === this.time && this.beamMemo.n === this.enemies) return this.beamMemo.list;
    const list = [], up = e => !e.dead && !(e.spawnT > 0), C = CFG.TWIN, W = CFG.WARDEN;
    const tw = this.enemies.filter(e => e.t.twin && up(e));
    if (tw.length === 2 && tw.every(e => e.mode === 'chase')) list.push({ x1: tw[0].x, y1: tw[0].y, x2: tw[1].x, y2: tw[1].y, w: C.beamW, dmg: C.beamDmg, from: `${tw[0].t.name}（光束）`, warn: false });
    for (const e of this.enemies) if (e.t.beams && up(e)) {
      const on = e.cd > W.rest, warn = !on && e.cd < W.warn;
      if (!on && !warn) continue;
      const n = e.enraged ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const a = e.rot + k * TAU / n, c = Math.cos(a), s = Math.sin(a), L = Arena.rayLen(e.x, e.y, a, 1500);
        list.push({ x1: e.x + c * e.r, y1: e.y + s * e.r, x2: e.x + c * L, y2: e.y + s * L, w: warn ? 3 : W.beamW, dmg: warn ? 0 : W.beamDmg, from: `${e.t.name}（光束）`, warn, rev: e.mode === 'reverse' });  // rev：快反轉了（畫面閃黃）
      }
    }
    this.beamMemo = { t: this.time, n: this.enemies, list };
    return list;
  },
  // 光束打到飛船（房主算，隊友的也是）：碰到就受傷，之後的無敵時間內不會再扣
  beamHits() {
    for (const B of this.bossBeams()) {
      if (B.warn) continue;
      for (const p of this.players()) if (segDist2(B.x1, B.y1, B.x2, B.y2, p.x, p.y) < (p.r + B.w / 2) ** 2) this.hurtPlayer(B.dmg, B.from, p, p.x, p.y);
    }
  },
  // 紅圈（王的落點轟炸、標記圈）：標記圈先跟著被標的人跑、剩 hold 秒時定住；時間到就爆炸，照種類（ZONE_HIT）決定誰受傷、受多少
  updateZones(dt) {
    for (const z of this.zones) {
      if (z.tgt && z.t > z.hold && !z.tgt.dead) { z.x = z.tgt.x; z.y = z.tgt.y; }
      if ((z.t -= dt) > 0) continue;
      const P = this.players(), inside = p => dist2(p.x, p.y, z.x, z.y) < (z.r + p.r * 0.5) ** 2;
      for (const [p, dmg] of ZONE_HIT[z.kind || 'bomb'](z, P, inside)) this.hurtPlayer(dmg, z.from, p, z.x, z.y);
      burst(z.x, z.y, '#ff4d6d', 24, 260, 0.5, 3);
      ringFx(z.x, z.y, z.r, '#ff4d6d');
      this.shake(4); Events.emit('explode', z);
    }
    this.zones = this.zones.filter(z => z.t > 0);
  },
  updatePickups(dt) {
    for (const c of this.pickups) {  // 晶體不會消失（以前 14 秒沒撿就不見）；life 只在撿到時歸零
      const p = this.nearestPlayer(c.x, c.y), range = CFG.MAGNET_RANGE * (1 + this.passivesOf(p).magnet);  // 晶體飛向最近的玩家（雙人：撿到的人和隊友都 +1）
      const d2 = dist2(c.x, c.y, p.x, p.y);
      stepPickup(c, p, range, d2, dt);
      if (!Arena.rect && !c.vacuum && Arena.f(c.x, c.y) < 6) [c.x, c.y] = Arena.clampIn(c.x, c.y, 6);  // 大地圖：晶體不會飛進牆裡（全場吸取時直接穿過）
      if (d2 < 20 * 20) {
        c.life = 0; this.credits++; Events.emit('pickup', c);
        if (this.mode === 'coop') Net.lootTotal++;  // 雙人：不管誰撿到，隊友也 +1（透過同步傳過去）
      }
    }
    this.pickups = this.pickups.filter(c => c.life > 0);
  },
  updateFx(dt) {
    Events.emit('fxTick', dt);  // 粒子、浮動數字、光圈、電弧、閃光、橫幅、震動（ui/fx.js）
  },
  updateCamera(dt) {
    const p = this.viewShip(), c = this.cam;  // 自己被擊墜時看隊友
    const tx = clamp(p.x - ZW / 2, -80, Arena.W - ZW + 80);
    const ty = clamp(p.y - ZH / 2, -80, Arena.H - ZH + 80);
    c.x += (tx - c.x) * Math.min(1, dt * 8);
    c.y += (ty - c.y) * Math.min(1, dt * 8);
  },
});
