// 星環電路 多人版 · game_mech.js：Game 的機體與飛船能力：零件、機體成長線、星門號
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   往 game.js 的 Game 加方法（外面照樣呼叫 Game.xxx）
'use strict';

Object.assign(Game, {
  // ---------- 星門號：衝刺時在起點和落點開一對門（3 秒，同時只有一對） ----------
  openPortal(p, ax, ay, bx, by) {
    if (ax == null || Math.hypot(bx - ax, by - ay) < 40) return;
    this.portals = this.portals.filter(q => q.owner !== p);
    this.portals.push({ ax, ay, bx, by, t: 3, owner: p, color: p.ship.color });
  },
  updatePortals(dt) {
    for (const q of this.portals) q.t -= dt;
    this.portals = this.portals.filter(q => q.t > 0 && !q.owner.dead);
  },
  // 物體（子彈、敵彈、飛船）從門外走進門：從另一個門出來，放在門的前方（照移動方向）免得馬上又碰到；cd 秒內不能再走
  // (x0, y0) = 這一幀移動前的位置；本來就在門裡（例如門開在飛船身上）不算走進去，要先離開再走回來
  portalHop(o, r, cdKey, cd, dirA, x0, y0) {
    if (!this.portals.length || this.time < (o[cdKey] || 0)) return false;
    for (const q of this.portals) {
      for (const [x1, y1, x2, y2] of [[q.ax, q.ay, q.bx, q.by], [q.bx, q.by, q.ax, q.ay]]) {
        const rr = (22 + r) ** 2;
        if (dist2(o.x, o.y, x1, y1) > rr || dist2(x0, y0, x1, y1) <= rr) continue;
        const a = dirA != null ? dirA : Math.atan2(o.vy || 0, o.vx || 0), k = 22 + r + 2;
        o.x = x2 + Math.cos(a) * k; o.y = y2 + Math.sin(a) * k;
        o[cdKey] = this.time + cd;
        burst(x2, y2, q.color, 6, 120, 0.25, 2);
        return true;
      }
    }
    return false;
  },
  portalShip(p, x0, y0) {
    if (!this.portalHop(p, p.r, 'portalT', 0.6, null, x0, y0)) return;
    p.px = p.x; p.py = p.y;
    if (p.dashT > 0) { p.dashSX = p.x; p.dashSY = p.y; }  // 衝刺途中穿門：起點改成出口，新門不會越拉越長
  },
  // ---------- 機體成長線（零件、飛船能力）：房主執行，隊友的飛船用隊友的配裝 ----------
  maxHpOf(ship, P, M) { return Math.max(20, Math.round((ship.hp + P.maxHp + M.maxHp) * M.hpMul)); },
  mechOf(p) { return p.L ? p.L.mech : this.mech; },
  wpOf(p) { return p.L ? p.L.wp : this.wp; },
  // 無傷連殺（輕裝甲 4 層）：打出最後一擊的人沒被打中時每殺一隻 +1 層
  onStreakKill(e) {
    const p = this.shipOf(e.killer);
    if (!p || p.dead || !this.mechOf(p).traits.streak) return;
    p.streak = Math.min(STREAK.max, (p.streak || 0) + 1);
  },
  // 機體的持續效果（每幀，房主）：沒被打的時間、堡壘號的灰血回復
  tickMech(p, dt) {
    p.calm = (p.calm || 0) + dt;
    // 灰血：只回「最近受的傷」存下來的那段（每次受傷的 40%，最多最大 HP 的 25%）；戰鬥結束時剩下的回滿（見 combatWon）
    if (p.ship.ability !== 'gray') p.drRec = 0;
    else if (p.drRec > 0 && p.calm >= CFG.GRAY.delay) {
      const h = Math.min(p.drRec, CFG.GRAY.rate * dt, Math.max(0, p.maxHp - p.hp));
      p.hp += h; p.drRec = p.hp >= p.maxHp ? 0 : p.drRec - h;
    }
  },
  // 每場戰鬥開始時重置的機體狀態
  resetMechCombat(p) {
    p.shield = 0; p.calm = 0; p.quenchT = 0;
    p.portalCd = 0; p.pullV = null; p.icWs = [];
    p.streak = 0;  // 無傷連殺
  },
  // 零件：加 1 層（零件格滿了就不行）、換零件（改裝廠）
  // 機體強化（零件 1 層）：每拿 CFG.MECH_SLOT_EVERY 個，電路格 +1（最多 MAX_SLOTS）；回傳要接在提示後面的文字
  mechGain() {
    const k = CFG.MECH_SLOT_EVERY;
    if (!k) return '';
    this.mechN = (this.mechN || 0) + 1;
    if (this.mechN % k || this.chain.length >= CFG.MAX_SLOTS) return '';
    this.chain.push(null);
    this.recalc();
    if (this.runStats) this.runStats.got.push(`${this.here()} 插槽 +1（機體強化）`);
    return `；機體強化 ${this.mechN} 個：電路格 +1`;
  },
  addPart(id) {
    if (!PARTS[id] || partsUsed(this.parts) >= this.partSlots) return false;
    this.parts[id] = (this.parts[id] || 0) + 1;
    this.recalc();
    if (this.runStats) this.runStats.got.push(`${this.here()} 零件 ${PARTS[id].name}（${this.parts[id]} 層）`);
    return true;
  },
  swapPart(from, to) {
    if (!PARTS[from] || !PARTS[to] || from === to || !(this.parts[from] > 0) || this.credits < this.shopPrice(PART_SWAP_PRICE)) return false;
    this.pay(this.shopPrice(PART_SWAP_PRICE), () => {
      this.parts[from]--; this.parts[to] = (this.parts[to] || 0) + 1;
      this.recalc();
      if (this.runStats) this.runStats.got.push(`${this.here()} 改裝：${PARTS[from].name} → ${PARTS[to].name}`);
    });
    return true;
  },
  // 雙人：一方被擊墜 → 等隊友；兩人都被擊墜 → 結束（房主判定）
  // 這個人的統計（房主：自己的 runStats、隊友的 mate.L.R）：倒下、救人次數記在這裡
  statsOf(p) { return p === this.player ? this.runStats : p && p.L ? p.L.R : null; },
  playerDown(p) {
    p.hp = 0; p.dead = true;
    const RS = this.statsOf(p); if (RS) RS.downs = (RS.downs || 0) + 1;  // 雙人紀錄：被擊墜幾次
    burst(p.x, p.y, p.ship.color, 80, 400, 1.2, 3);
    if (this.players().length) {
      bannerFx(`${this.tagOf(p)} 被擊墜！`, `隊友靠近倒下的位置 ${CFG.REVIVE.time} 秒可以救起來`, 2.5);
      return;
    }
    this.state = 'dead'; Input.down = false;
    // 結束訊息帶上隊友的最終血量與擊毀原因（最後一次同步可能還沒送到）；先送最終傷害統計
    Net.sendDmg();
    Net.sendOver(this.combat.wave);
    this.saveRecord('dead');
    Events.emit('died');
  },
  // 雙人救援（房主判定）：倒下的人留在原地，活著的隊友待在範圍內累積秒數，離開就慢慢退回
  updateRevive(dt) {
    const R = CFG.REVIVE, all = this.allShips();
    for (const p of all) {
      if (!p.dead) continue;
      const q = all.find(q => q !== p && !q.dead && !q.gone && dist2(p.x, p.y, q.x, q.y) < R.range * R.range);  // 救的人：旁邊還活著的任一個
      p.reviveT = q ? p.reviveT + dt : Math.max(0, p.reviveT - dt);
      if (p.reviveT >= R.time) this.revivePlayer(p, q);
    }
  },
  revivePlayer(p, q) {  // 救的人分出自己當前一半的血量
    const give = q.hp / 2, tag = x => this.tagOf(x);  // 只在房主執行：自己是 1P
    q.hp -= give;
    p.hp = give; p.dead = false; p.reviveT = 0; p.iframe = CFG.REVIVE.iframe;
    const RS = this.statsOf(q); if (RS) RS.revives = (RS.revives || 0) + 1;  // 雙人紀錄：救起隊友幾次
    bannerFx(`${tag(p)} 救援成功！`, `${tag(q)} 分出 ${Math.ceil(give)} HP`, 2);
    burst(p.x, p.y, '#9dff6b', 40, 260, 0.8, 3);
    Events.emit('revive', { p, q });
  },
});
