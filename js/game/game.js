// 星環電路 多人版 · game.js：Game：狀態、雙人共用、一局的流程、共用（傷害、電路重算）、主更新
//   其他的方法分在 game_record.js、game_combat.js、game_stations.js、game_chips.js、game_mech.js（Object.assign 加到 Game）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// GAME
// =====================================================================
// 吸引：被拉的敵人往中心的速度（同時被拉很多次也只到這個速度）
const PULL_V = 380;
// 章節的開局補償：電路格、武器插座（晶體和三選一另外給，見 newRun）；L 是 Game 自己或雙人隊友的配裝
function applyChapterStart(L, S) {
  if (!S) return;
  for (let i = 0; i < (S.slots || 0) && L.chain.length < CFG.MAX_SLOTS; i++) L.chain.push(null);
  L.wSock = Math.min(CFG.WEAPON_SOCKETS, (L.wSock || CFG.START_WSOCK) + (S.wSock || 0));
}

const Game = {
  state: 'title', returnState: null, mode: null,
  chapterId: 1,  // 這一局的章節（見 chapters.js）：單人在選章畫面設
  bonusPicks: 0,  // 章節的開局補償：到航圖之前還要連續三選一幾次
  chain: [], socks: [], inventory: [], credits: 0,  // socks[i]：插在第 i 格晶片上的插件
  stats: null, passives: computePassives([]),
  map: null, node: null, visited: [], combat: null, inArena: false,
  cam: { x: 0, y: 0 },
  stars: [], bullets: [], enemies: [], eBullets: [], pickups: [], triggerQueue: [], slashQ: [], zones: [],
  weapon: { id: 'laser', path: null, final: null }, wp: null,
  time: 0, nextId: 1,
  // 雙人：mate = 隊友的飛船（房主這邊是真的模擬對象，隊友那邊只是畫出來的影子）
  //   mate.L = 隊友的配裝（電路、倉庫、武器…），房主算隊友的子彈時用 withLoadout 暫時換上
  mates: [], shooter: null,  // mates：其他玩家的飛船（房主這邊每艘帶 L = 那個人的配裝；slot = 幾號玩家）
  // 各晶片的擊殺數（產物打死的，見 onEnemyKilled）、開火模式（砲台）
  parts: {}, partSlots: 6, cap: 4, mech: mechStats({}), objs: [], portals: [], decoys: [], turrets: [],
  playKills: {}, fireMode: null,

  // ---------- 雙人共用 ----------
  allShips() { return [this.player, ...this.mates]; },  // 所有飛船（含倒下、離線的）
  players() { return this.allShips().filter(p => p && !p.dead && !p.gone); },  // gone：隊友離線，其他人繼續
  // 配裝 L 是誰的飛船（L = null：房主自己）；子彈、傷害的 owner 都是配裝
  shipOf(L) { return L ? this.mates.find(m => m.L === L) || null : this.player; },
  // 畫面跟著誰：自己被擊墜時看還活著的隊友
  toWorld(sx, sy) { return this.inArena ? [sx / ZOOM + this.cam.x, sy / ZOOM + this.cam.y] : [sx / Hub.k + Hub.cam.x, sy / Hub.k + Hub.cam.y]; },  // 螢幕座標 → 世界座標（戰鬥的鏡頭／基地的鏡頭）
  viewShip() { return this.player.dead && this.mates.find(m => !m.dead) || this.player; },
  // 幾號玩家（1P＝房主）：自己的號碼問 Net，隊友的號碼記在飛船上
  tagOf(p) { return `${this.slotOf(p)}P`; },
  slotOf(p) { return p === this.player ? Net.mySlot() : p.slot || 2; },  // 玩家號碼（單人 = 1）
  shipBySlot(s) { return s === Net.mySlot() ? this.player : this.mates.find(m => m.slot === s) || null; },
  // 雙人：s 號玩家的出生點離中間多遠（照號碼由左到右、以中間為準，每人隔 100；兩人時是 -50／+50）
  slotX(s) { return (s - (this.mates.length + 2) / 2) * 100; },
  // 玩家顏色：雙人時照號碼（CFG.PLAYER_COLORS），單人就是飛船自己的顏色
  colorOf(p) { return this.mates.length ? this.slotColor(p === this.player ? Net.mySlot() : p.slot || 2) : p.ship.color; },
  slotColor(s) { return CFG.PLAYER_COLORS[(s - 1) % CFG.PLAYER_COLORS.length]; },
  nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players()) { const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    return best || this.player;
  },
  // 敵人的目標：身邊 CFG.DECOY.r 內有殘影（幻影號）就追最近的殘影，不然追最近的玩家
  enemyTarget(e) {
    let best = null, bd = CFG.DECOY.r * CFG.DECOY.r;
    for (const d of this.decoys) { const q = dist2(e.x, e.y, d.x, d.y); if (q < bd) { bd = q; best = d; } }
    return best || this.lockFoe(e);
  },
  // 多人時的王鎖定的那個人（沒鎖、倒下、離線 = 最近的玩家）
  lockFoe(e) { const L = e.lock && this.shipBySlot(e.lock); return L && !L.dead && !L.gone ? L : this.nearestPlayer(e.x, e.y); },
  // 多人時的王（使用者 10-24：多人時王只會朝一個人打，要有變化）：鎖定一個人（e.lock = 號碼，畫面標出來），每 CFG.BOSS_LOCK.t 秒換一次，
  //   換成這段時間打王最痛的人（e.aggro，hurt 記）；沒人打到 = 輪到下一個。鎖定的人倒下馬上換。單人不鎖（e.lock = 0，照舊追最近的）
  //   雙子獵艦：主艦鎖第一名，另一艘（share）鎖第二名，兩艘追不同的人
  bossLockTick(e, dt) {
    if (e.share) { e.lock = e.share.lock2 || e.share.lock || 0; return; }
    const P = this.players().filter(p => !p.dead && !p.gone), slot = p => this.slotOf(p);
    if (P.length < 2) { e.lock = e.lock2 = 0; return; }
    const cur = e.lock && this.shipBySlot(e.lock);
    if (cur && !cur.dead && !cur.gone && (e.lockT -= dt) > 0) return;
    const agg = e.aggro || {};
    let order = P.slice().sort((a, b) => (agg[slot(b)] || 0) - (agg[slot(a)] || 0));
    if (!(agg[slot(order[0])] > 0)) { const i = P.findIndex(p => slot(p) === e.lock); order = [...P.slice(i + 1), ...P.slice(0, i + 1)]; }
    e.lock = slot(order[0]); e.lock2 = slot(order[1]); e.lockT = CFG.BOSS_LOCK.t; e.aggro = {};
  },
  // 幻影號・殘影：衝刺起點留下一個假目標（打不壞），CFG.DECOY.t 秒後消失；同一個人同時只有一個
  addDecoy(p, x, y) {
    this.decoys = this.decoys.filter(d => d.owner !== p);
    this.decoys.push({ x, y, r: p.r, vx: 0, vy: 0, t: CFG.DECOY.t, owner: p, slot: p === this.player ? Net.mySlot() : p.slot || 0, aim: p.aim, decoy: true });
  },
  // 哨兵號・砲台：衝刺起點留一座砲台（CFG.TURRET），同一個人同時只有一座；pl = 放的那艘飛船（開火用 pl.L 的配裝）
  addTurret(p, x, y) {
    this.turrets = this.turrets.filter(q => q.pl !== p);
    this.turrets.push({ x, y, t: CFG.TURRET.t, pl: p, slot: p === this.player ? Net.mySlot() : p.slot || 0, aim: p.aim, cd: 0 });
  },
  // 砲台開火：射速照放的人（機體的射速增減；移動、站著不動才有的加成不算），朝射程內（跟自動攻擊一樣）最近的敵人
  //   用那個人的武器（命中照樣觸發武器線），傷害 ×CFG.TURRET.dmg；子彈標 turret（傷害統計另外一類）
  updateTurrets(dt) {
    for (const q of this.turrets) {
      q.t -= dt; q.cd -= dt;
      if (q.cd > 0 || q.pl.dead) continue;
      this.withLoadout(q.pl.L, () => {
        const S = this.stats, w = this.wp, M = this.mech, e = nearestEnemy(q.x, q.y, clamp(w.speed * w.life + 40, 140, CFG.AUTO_RANGE), null, true);
        if (!e || !S) return;
        q.aim = Math.atan2(e.y - q.y, e.x - q.x); q.cd = Math.max(q.cd, -dt) + S.interval / (M.rate * M.rateMul);
        const list = weaponShots().map(s => ({ ...s, damage: s.damage * CFG.TURRET.dmg }));
        const n0 = this.bullets.length;
        if (list.length) spawnShots(list, q.x + Math.cos(q.aim) * 10, q.y + Math.sin(q.aim) * 10, q.aim, 0, null);
        for (let i = n0; i < this.bullets.length; i++) this.bullets[i].turret = true;
      });
    }
    this.turrets = this.turrets.filter(q => q.t > 0);
  },
  // 暫時把 Game 的配裝換成 L（隊友的），執行完再換回來；L 為 null 時就是房主自己
  withLoadout(L, fn) {  // 算隊友的事：Game 的配裝欄位暫時指向 L（見 LOADOUT_KEYS），shooter = L（傷害記在他身上）
    if (!L) return fn();
    const prev = this.cur, prevS = this.shooter;
    this.cur = L; this.shooter = L === this.L ? null : L;  // 房主自己 = null（見 owner）
    try { return fn(); } finally { this.cur = prev; this.shooter = prevS; }
  },
  passivesOf(p) { return p.L ? p.L.passives : this.passives; },
  isClient() { return Net.role === 'client' && this.mode === 'coop'; },
  coopOn() { return this.mode === 'coop' && this.mates.some(m => !m.gone); },
  onlineN() { return 1 + this.mates.filter(m => !m.gone).length; },  // 在線的人數（含房主；倒下的也算）  // 雙人而且有隊友在線（都離線時敵人數量、血量都恢復單人）
  freePlay() { return this.mode === 'sandbox' || this.mode === 'range'; },  // 沙盒、靶場：晶片無限供應、可以隨意改武器
  // 錢：雙人時每人各自一個錢包。怪物掉落的晶體兩人都拿（見 Net 的 loot），其他收入、花費都是自己的
  pay(price, fn) {
    if (this.credits < price) return false;
    this.credits -= price;
    fn();
    return true;
  },
  earn(v) { this.credits += v; },

  // ---------- 一局的流程 ----------
  newRun(mode, shipId = this.shipId || 'vanguard', weaponId = this.weapon.id, startChip = null) {
    this.mode = mode;
    this.shipId = shipId;
    Arena.reset();
    this.weapon = { id: weaponId, path: null, final: null };
    const S = SHIPS[shipId];
    // 先換上新的電路、倉庫、飛船，再計算數值（不能拿上一場的電路來算）
    // 遠征／雙人：開局三選一的起始晶片直接裝在電路上（武器右邊）；飛船不再自帶晶片
    this.chain = mode === 'sandbox' ? ['weapon', null, null, null]
      : mode === 'range' ? ['weapon', null, null, null, null, null] : startChain(startChip);  // 靶場：6 格空電路
    this.socks = mode === 'sandbox' ? [['amp']] : mode === 'range' ? [] : startSocks(startChip);
    this.inventory = mode === 'sandbox' || mode === 'range' ? Array(CFG.INV_SLOTS).fill(null) : startInv(startChip);  // 起始晶片是組件 → 插武器（見 startSocks）
    this.playKills = {}; this.unlockFresh = []; this.playDry = false; this.mechN = 0;  // mechN：這一局拿了幾個機體強化  // playDry：上一次三選一沒有玩法晶片（下一次保底）
    this.wSock = this.freePlay() ? CFG.WEAPON_SOCKETS : CFG.START_WSOCK;  // 武器插座：每打完一隻王 +1
    this.parts = { ...S.parts }; this.partSlots = S.partSlots; this.cap = S.cap;  // 機體成長線：開局零件、能量容量由飛船決定
    this.credits = this.freePlay() ? 999 : 0;
    this.boons = cleanBoons(); this.sos = null;  // ？事件拿到的這一局效果（黑市、終焉護殼的次數，見 mechStats）；sos：下一場戰鬥變難（見 addSos）
    this.player = new Player(S);
    this.map = mode === 'run' || (mode === 'coop' && Net.role === 'host') ? genMap() : null;  // 雙人：星圖由房主產生後傳給隊友
    if (this.freePlay()) this.chapterId = 1;  // 靶場、沙盒用不到章節（雙人的章號由 Net 在開局前設好）
    this.node = null; this.visited = []; this.sector = this.chapter().sectors[0]; this.bossId = this.bossFor(this.sector);
    this.runStats = { dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])), chips: {}, kills: 0, maxHit: 0, time: 0,
      bosses: [], bossIds: [], elites: 0, echoK: 0, started: Date.now(), recorded: false,  // bossIds、elites、echoK：解鎖進度用（打倒的旗艦、精英、回響擊殺）
      // 遊玩紀錄用的判斷資料：受到的傷害來源、被打中次數、衝刺次數、走過的節點、取得的晶片、武器升級、各關摘要
      taken: {}, hits: 0, dashes: 0, path: [], got: [], upgrades: [], sectors: [],
      perf: { worst: 0, worstAt: '', slow: 0 },  // 效能：戰鬥中最慢的一幀（ms）、在哪裡、超過 100ms 的幀數
      cap: { n: 0, cut: 0, max: 0, at: '', first: '', src: [], chain: [] } };  // 子彈上限防呆：觸發幾幀、刪了幾顆、最多幾顆、在哪裡（最多那次）、第一次在哪、最多那次的子彈來源和電路
    this.sectorStats = { chips: {}, t0: 0, kills0: 0, dmg0: 0 };  // 「本關」＝目前這個星區
    this.chipSince = {};  // 實測 DPS 的起點（見 trackSince）
    this.nodeLog = null;
    this.lastHit = '';
    const ST = this.freePlay() ? null : this.chapter().start;  // 章節的開局補償（從星區 2 以後開始的章節）
    applyChapterStart(this, ST);
    this.credits += ST ? ST.credits || 0 : 0;
    this.bonusPicks = ST ? ST.picks || 0 : 0;  // 開局先連續三選一幾次（到航圖之前，見 showMap）
    this.refreshWeapon();  // 內含 recalc()
    this.player.hp = this.player.maxHp;
    if (mode !== 'coop') { this.mates = []; Net.close(); }
    if (mode === 'sandbox') this.startCombat({ sandbox: true, level: 0 });
    else if (mode === 'range') { this.startCombat({ sandbox: true, range: true, level: 0 }); Range.reset('single'); }
    else if (mode === 'coop') return;  // 雙人：由 Net 建好隊友之後再開戰
    else this.showMap(`${this.chapter().name}：${this.chapter().intro}`);
  },
  // ---------- 共用 ----------
  recalc() {
    this.mech = mechStats(this.parts, this.boons);
    this.stats = analyzeChain(this.chain);
    this.passives = computePassives(this.inventory);
    const p = this.player;
    if (p) {
      const newMax = this.maxHpOf(p.ship, this.passives, this.mech);
      if (newMax > p.maxHp) p.hp += newMax - p.maxHp;
      p.maxHp = newMax;
      p.hp = Math.min(p.hp, p.maxHp);
    }
    if (typeof Editor === 'undefined' || !Editor.dry) this.trackSince();  // 編輯器拖曳時的試放不算換位置
  },
  // 實測 DPS：每個晶片從裝在目前位置那一刻起的傷害 ÷ 戰鬥時間。換位置、拔掉再裝就重新起算（比較插哪裡好用）
  trackSince() {
    const R = this.runStats;
    if (!R) return;
    const pos = {}, add = (k, at) => (pos[k] = pos[k] || []).push(at);  // 傷害統計的 key（base）→ 在電路上的位置
    this.chain.forEach((id, i) => {
      if (id) add(baseOf(id), i);
      (this.socks[i] || []).forEach((c, k) => c && add(baseOf(c), i + '.' + k));
    });
    const S = this.chipSince = this.chipSince || {};
    for (const k in S) if (!pos[k]) delete S[k];
    for (const k in pos) { const at = pos[k].join(); if (!S[k] || S[k].at !== at) S[k] = { at, t: R.time, d: R.chips[k] || 0 }; }
  },
  // 每秒實際傷害；null = 還在測（戰鬥時間不到 CFG.MEASURE_MIN 秒）
  measuredDps(k) {
    const R = this.runStats, S = this.chipSince && this.chipSince[k];
    if (!R || !S) return null;
    const d = R.chips[k] || 0;
    if (R.time < S.t || d < S.d) { S.t = R.time; S.d = d; return null; }  // 靶場清掉統計：重新起算
    const dt = R.time - S.t;
    return dt < CFG.MEASURE_MIN ? null : (d - S.d) / dt;
  },
  toggleEditor() {
    // 雙人：戰鬥中按 Tab → 兩邊一起暫停，關掉編輯器時把新電路傳給房主再繼續
    if (this.state === 'editor') {
      this.state = this.returnState;
      Events.emit('editor', { open: false });
      this.recalc();
      // 戰鬥中改了電路：記下這一刻（三選一上面另外比「改電路前後」，見 Screen.fightSummary）
      const B = this.fightBase, R = this.runStats;
      if (this.state === 'play' && B && R && JSON.stringify([this.chain, this.socks]) !== this.editSig)
        B.cut = { t: R.time, d: Object.values(R.chips).reduce((a, v) => a + v, 0) };
      if (this.mode === 'range') Range.clearStats();  // 靶場：改完電路重新計算
      if (this.mode === 'coop') {
        Net.sendLoadout();
        if (this.state === 'play') Net.setEditing(false);
        if (this.state === 'map') { Net.checkVoteTimer(); Net.tryResolve(); }  // 時間到的情況由 Net.tick 處理
      }
      this.view();
    } else if (['play', 'map', 'reward', 'shop', 'event', 'armory', 'workshop', 'victory'].includes(this.state)) {
      this.returnState = this.state;
      this.editSig = JSON.stringify([this.chain, this.socks]);
      this.state = 'editor';
      Input.down = false; Input.dash = false; Input.joy = null; Input.aimStick = null;
      if (this.mode === 'coop' && this.returnState === 'play') Net.setEditing(true);
      Events.emit('editor', { open: true });
    }
  },
  shake(v) { Events.emit('shake', v); },  // 畫面震動（ui/fx.js）
  recordDamage(source, amount, att) {  // 本局傷害統計：依來源分類，並依晶片分攤（見 splitDamage）
    if (att && att.nobody) return;  // 不算任何人的（彗星自己撞爆、飛行中撞到）
    // 雙人：記在打出這一擊的人身上（owner = 隊友的配裝；null = 房主自己）
    const owner = att && att.owner !== undefined ? att.owner : this.shooter;
    const R = owner ? owner.R : this.runStats, stats = owner ? owner.stats : this.stats;
    if (!R || !(amount > 0)) return;
    R.dmg[source] = (R.dmg[source] || 0) + amount;
    if (source !== 'burn') R.maxHit = Math.max(R.maxHit, amount);
    const parts = splitDamage(amount, att, source === 'shock' ? null : stats && stats.rateCr);
    const sec = !owner && this.sectorStats && this.sectorStats.chips;
    for (const k in parts) {
      R.chips[k] = (R.chips[k] || 0) + parts[k];
      if (sec) sec[k] = (sec[k] || 0) + parts[k];
    }
  },
  screenState() { return this.state === 'editor' ? this.returnState : this.state; },  // 畫面底下是哪一頁（開著電路編輯器時 = 打開前那一頁）
  restoreScreen() {  // 依目前狀態重畫對應的畫面（機制檢查跑完後用）；開著編輯器時畫底下那一頁
    Events.emit('view', { state: this.screenState(), msg: '' });
  },

  onEnemyKilled(e) {
    this.kills++;
    const KR = e.killer ? e.killer.R : this.runStats;  // 雙人：擊殺算在打出最後一擊的人身上
    const lastOfGroup = !e.fleet || !e.fleet.members.some(m => m !== e && !m.dead);  // 編隊：最後一艘才算打倒一隻精英
    const kp = this.shipOf(e.killer);
    if (kp) this.withLoadout(loadoutOf(kp), () => weaponPlay().onKill(kp, e));  // 擊殺時（熱能光束的低溫）：打最後一擊那個人的武器
    if (KR) { KR.kills++; if (e.t.elite && lastOfGroup) KR.elites = (KR.elites || 0) + 1; if (e.lastSrc === 'echo') KR.echoK = (KR.echoK || 0) + 1; }  // 精英、回響擊殺（解鎖進度）
    const big = e.type === 'brute' || e.t.elite;
    if (!this.isClient()) {
      this.infectBurst(e); this.onStreakKill(e);
      const src = e.killAtt && e.killAtt.src, K = (e.killer || this).playKills;  // 晶片的產物打死的：記在那片晶片上（遊玩紀錄）
      if (K && !e.noPlay && CHIPS[src] && CHIPS[src].type === 'chip') K[src] = (K[src] || 0) + 1;
      if (e.type === 'splitter') for (let i = 0; i < 3; i++) {  // 分裂體：分成 3 隻碎裂體
        const a = i / 3 * TAU + rand(0, 1), k = new Enemy('splitling', ...Arena.clampIn(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, 20), e.hpScale);
        k.zone = e.zone; k.spawnT = 0.15; k.vx = Math.cos(a) * 200; k.vy = Math.sin(a) * 200; this.enemies.push(k);
      }
    }
    burst(e.x, e.y, e.t.color, big ? 40 : 16, big ? 320 : 220, 0.6, 2.5);
    Events.emit('enemyKilled', { e, big });
    if (e.t.treasure) this.bonusLoot(e, 'treasure');
    if (e.intruder && --e.intruder.left === 0) this.bonusLoot(e, 'intrude');
    if (big) this.shake(e.t.elite ? 14 : 6);
    if (e.t.boss) {  // 母艦爆炸：清除所有小怪與敵彈
      this.shake(28);
      burst(e.x, e.y, e.t.color, 150, 600, 1.4, 3.5);
      burst(e.x, e.y, '#ffd166', 80, 400, 1.2, 3);
      for (const o of this.enemies) if (o !== e && !o.dead) { o.dead = true; burst(o.x, o.y, o.t.color, 10, 200, 0.5, 2); }
      this.eBullets = [];
      bannerFx('旗艦擊沉！', '', 2);
    }
    const base = e.summoned ? 0 : e.credits != null ? e.credits : e.t.credits;  // 旗艦叫出來的小怪不掉晶體；分裂的精英兩隻平分（e.credits）
    let n = base;
    for (let i = 0; i < base; i++) if (Math.random() < this.passives.greed) n++;
    for (let i = 0; i < n; i++)
      this.pickups.push({ id: this.nextId++, x: e.x + rand(-8, 8), y: e.y + rand(-8, 8), vx: rand(-80, 80), vy: rand(-80, 80), life: 14 });
  },
  // 警戒（CFG.ALERT）：叫醒一隻待機的敵人。call：也叫醒同一區、身邊 call 以內待機的同伴（被叫醒的不再往外叫，不會一路傳遍整區）
  //   母巢醒了，牠生的蟲群一起醒
  wakeEnemy(e, call = true) {
    if (e.alert || e.dead) return;
    e.alert = true; e.alertT = CFG.ALERT.mark;
    Events.emit('enemyAlert', e);
    for (const k of e.kids || []) this.wakeEnemy(k, false);
    if (!call) return;
    const R2 = CFG.ALERT.call ** 2;
    for (const o of this.enemies) if (!o.alert && !o.dead && o.zone === e.zone && dist2(o.x, o.y, e.x, e.y) < R2) this.wakeEnemy(o, false);
  },
  // 警報艇叫人（CFG.ALARM，響著時每 every 秒一次）：叫醒同一區、身邊 r 以內待機的敵人；第一次出橫幅、震動、警報聲
  alarmPulse(e) {
    const A = CFG.ALARM, R2 = A.r * A.r;
    for (const o of this.enemies) if (!o.alert && !o.dead && o.zone === e.zone && dist2(o.x, o.y, e.x, e.y) < R2) this.wakeEnemy(o, false);
    ringFx(e.x, e.y, A.r, '#ff3b3b');
    if (e.rang) return;
    e.rang = true; this.shake(6);
    bannerFx('⚠ 警報', '警報艇邊逃邊叫醒附近的敵人：快打掉它', 2);
    Events.emit('alarm', e);
  },
  // 戰鬥中拿到額外獎勵（k = CFG.BONUS 的種類：寶藏無人機、精英亂入）：記在 combat.bonus，combatWon 時多幾次三選一；多人時房主在 'won' 告訴隊友
  bonusLoot(e, k) {
    (this.combat.bonus = this.combat.bonus || []).push(k);
    burst(e.x, e.y, '#ffd166', 60, 380, 1, 3); ringFx(e.x, e.y, 120, '#ffd166');
    this.shake(8);
    bannerFx(`✦ ${CFG.BONUS[k].note}`, '打贏後多一次三選一', 2);
    Events.emit('bonusLoot', { e, k });
  },
  // 寶藏無人機：時間到躍遷離開（不算擊殺、不掉東西）
  treasureEscape(e) {
    e.dead = true;
    burst(e.x, e.y, '#ffd166', 24, 260, 0.5, 2); ringFx(e.x, e.y, 60, '#bfefff');
    bannerFx('寶藏逃走了', '', 1.6);
    Events.emit('treasureLost', e);
  },
  hurtPlayer(dmg, cause = '', p = this.player, sx = null, sy = null) {
    if (p.dead || p.invuln || this.state !== 'play') return;
    const M = this.mechOf(p), T = M.traits;
    if (p.shield > 0) {  // 護盾產生器：擋下一次
      p.shield--; p.shieldT = 0; p.iframe = 0.3;
      burst(p.x, p.y, '#4cc9f0', 14, 200, 0.35, 2); floatText(p.x, p.y - 26, '護盾', '#4cc9f0');
      return;
    }
    dmg *= (1 - Math.min(0.6, this.passivesOf(p).armor)) * M.taken;
    if (this.isEndless()) dmg *= Math.pow(CFG.ENDLESS_DMG, this.sector - this.lastSector());  // 無盡：每過一個星區，受到的傷害 ×1.25（乘算）
    if (!this.freePlay()) dmg *= this.chapter().dmg;  // 章節：受到的傷害再 ×（第一章 1）
    if (T.thick) dmg = Math.min(dmg, p.maxHp * 0.2);  // 厚甲
    if (this.mode === 'range' && p.hp - dmg <= 0) { p.hp = p.maxHp; p.iframe = 1; floatText(p.x, p.y - 26, '靶場：回滿', '#9dff6b', true); return; }  // 靶場實戰：不會死
    p.hp -= dmg; p.iframe = Math.max(p.iframe, CFG.IFRAME + (T.deflect ? 0.8 : 0)); p.calm = 0;
    if (p.hp <= 0 && this.wardSave(p)) return;  // 終焉護殼（？事件）：免死一次
    if (dmg > 0) p.streak = 0;
    if (dmg > 0) this.withLoadout(loadoutOf(p), () => weaponPlay().onHurt(p));  // 被打中（能量刃的無盡連段歸零）
    if (p.ship.ability === 'gray' && dmg > 0) p.drRec = Math.min(p.maxHp * CFG.GRAY.cap, (p.drRec || 0) + dmg * CFG.GRAY.share);  // 堡壘號・灰血：這次傷害的一部分之後可以回來
    burst(p.x, p.y, '#ff4d6d', 16, 240, 0.4, 2);
    if (p !== this.player) {  // 房主這邊：隊友被打中（隊友的畫面震動、音效由隊友自己的電腦處理）
      p.lastHit = cause;
      if (p.hp <= 0) this.playerDown(p);
      return;
    }
    this.lastHit = cause;
    const R = this.runStats;
    if (R) { const k = cause || '其他'; R.taken[k] = (R.taken[k] || 0) + dmg; R.hits++; }
    this.shake(9);
    Events.emit('playerHurt', { p, dead: p.hp <= 0 });
    if (p.hp <= 0 && this.mode === 'coop') { this.playerDown(p); return; }
    if (p.hp <= 0) {
      p.hp = 0; this.state = 'dead'; Input.down = false;
      this.saveRecord('dead');
      burst(p.x, p.y, '#4cc9f0', 80, 400, 1.2, 3);
      this.shake(20);
      Events.emit('died');
    }
  },

  // ---------- 主更新 ----------
  // 戰場的一幀：戰鬥和基地共用（基地 = 一個房間的戰場，Hub.update 也呼叫這個；戰場的東西只加在這裡，基地就會跟著有）
  step(dt) {
    this.time += dt;
    if (this.runStats) this.runStats.time += dt;  // 只算實際戰鬥的時間（基地沒有 runStats）
    if (!this.player.dead) this.player.update(dt); else this.dragDowned(this.player, dt);  // 倒下被隊友勾住：拖著走
    this.updateWaves(dt);
    this.updateEnemies(dt);
    for (const p of this.players()) this.withLoadout(p.L, () => this.tickMech(p, dt));
    if (this.decoys.length) { for (const d of this.decoys) d.t -= dt; this.decoys = this.decoys.filter(d => d.t > 0); }  // 殘影
    if (this.turrets.length) this.updateTurrets(dt);  // 砲台（哨兵號）
    Objects.update(dt);
    this.updatePortals(dt);
    this.updateBullets(dt);
    this.updateEnemyBullets(dt);
    this.capBullets();
    this.updateZones(dt);
    this.beamHits();
    this.updatePickups(dt);
    if (this.mates.length) this.updateRevive(dt);
  },
  update(dt) {
    if (this.pauseMenu && (this.state !== 'play' || this.mode === 'coop' && !Net.active())) this.pauseMenu = false;
    if (this.pauseMenu && this.mode !== 'coop') return;  // 選單開著：單人暫停（雙人不暫停，隊友那邊照常進行）
    if (Net.role === 'client' && this.mode === 'coop') { Net.clientUpdate(dt); return; }
    const frozen = !!Net.pauseReason();  // 雙人：隊友在編輯電路、切到其他視窗、斷線重連中 → 全員暫停
    if (this.state === 'play' && !frozen) Net.hostUpdateMates(dt);
    if (this.state === 'play' && !frozen) this.step(dt);
    if (this.state === 'play' || this.state === 'dead') this.updateFx(dt);
    if (this.inArena && this.state !== 'editor') this.updateCamera(dt);
    if (!this.inArena) { this.cam.x += dt * 20; this.cam.y += dt * 8; }
    if (Net.role === 'host' && this.mode === 'coop') Net.hostSend(dt);
  },
  // 盾衛的盾是實心的：飛船撞到盾（盾那一側 ±60°、盾外緣 r+13 以內）會被推到盾外、往外彈開（0.2 秒不吃操控），回傳 true（房主再算撞擊傷害）；靠牆推不出去時改推盾衛
  //   雙人：隊友自己的船由隊友那邊推（net.js clientUpdate），不然會被自己送來的位置蓋掉
  shieldBlock(e, p) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, R = e.r + SHIELD_OUT + p.r;
    if (d >= R || Math.abs(angleDiff(Math.atan2(dy, dx), e.shieldA)) >= Math.PI / 3) return false;
    p.x = e.x + dx / d * R; p.y = e.y + dy / d * R;
    // 推出去之後照樣不能進牆（2026-10-10：以前直接設位置，靠牆時飛船被推進牆裡、每幀又被彈一次（0.2 秒不吃操控），卡死 200 秒）
    if (Arena.rect) { p.x = clamp(p.x, p.r, CFG.WORLD_W - p.r); p.y = clamp(p.y, p.r, CFG.WORLD_H - p.r); } else Arena.collide(p, p.r, Arena.shipPass(p));
    const d2 = Math.hypot(p.x - e.x, p.y - e.y), pinned = d2 < R - 0.5;
    if (pinned) {  // 夾在牆和盾中間：飛船推不出去，改把盾衛往後推並擊退（牠會一直追過來；飛船不進「被彈開」，保留操控）
      const k = R - d2, ux = d2 > 0.01 ? (p.x - e.x) / d2 : dx / d, uy = d2 > 0.01 ? (p.y - e.y) / d2 : dy / d;
      e.x -= ux * k; e.y -= uy * k;
      if (Arena.rect) { e.x = clamp(e.x, e.r, CFG.WORLD_W - e.r); e.y = clamp(e.y, e.r, CFG.WORLD_H - e.r); } else Arena.collide(e, e.r, null);
      if (!this.isClient()) e.push(-ux * 400, -uy * 400);  // 隊友那邊的敵人只是房主傳來的位置（不能推）：擊退由房主那邊算（房主也會替隊友的船算這次碰撞）
    }
    if (!(p.dashT > 0) && !pinned) { p.vx = dx / d * 520; p.vy = dy / d * 520; p.kbT = 0.2; }
    return true;
  },
  updateEnemies(dt) {
    const E = this.enemies;
    for (const e of E) {
      if (e.dead) continue;
      if (e.t.boss && !this.isClient()) this.bossLockTick(e, dt);
      e.update(dt, this.enemyTarget(e));  // 追最近的玩家（附近有殘影就追殘影；多人時的王追鎖定的人）
      if (e.spawnT <= 0) for (const p of this.players()) {
        if (e.shieldA != null && this.shieldBlock(e, p) && !this.mechOf(p).traits.ram) this.hurtPlayer(e.t.dmg, e.t.name + '（盾）', p, e.x, e.y);
        const rr = e.r + p.r;
        if (dist2(e.x, e.y, p.x, p.y) >= rr * rr) continue;
        const M = this.mechOf(p);
        if (M.traits.ram) {  // 衝撞（重裝甲 4 層）：撞到的敵人受到「最大 HP × 45%」並被撞飛，自己不受碰撞傷害
          if (this.time < (e.ramT || 0)) continue;
          e.ramT = this.time + 0.5;
          const d = Math.hypot(e.x - p.x, e.y - p.y) || 1, k = 520 * (14 / e.r);
          const rd = Math.round(p.maxHp * RAM_HP);
          e.hurt(rd, (e.x - p.x) / d * k, (e.y - p.y) / d * k, 'shock', { src: 'ship', cr: null, owner: p.L || null }, 3);
          floatText(e.x, e.y - e.r, rd, '#ffd166', true);
          continue;
        }
        if (!e.t.dmg) continue;  // 沒有撞擊傷害的（寶藏無人機、標靶）：碰到不算被打
        if (!e.t.boss && (e === p.hookE || (p.hookX && p.hookX.includes(e)))) continue;  // 自己勾住、拉在身前的（暈住）：碰到不算被撞（以前飛船往前走就撞上，牽引鉤扯的時候一直掉血，2026-10-22）
        this.hurtPlayer(e.t.dmg, e.t.name + '（撞擊）', p, e.x, e.y);
      }
    }
    for (let i = 0; i < E.length; i++) {  // 簡單分離，避免怪物疊在一起
      const a = E[i];
      for (let j = i + 1; j < E.length; j++) {
        const b = E[j], dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r, d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.01) {
          const d = Math.sqrt(d2), o = (rr - d) / 2, nx = dx / d, ny = dy / d;
          a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
        }
      }
    }
    if (!Arena.rect) for (const e of E) if (!e.dead && Arena.f(e.x, e.y) < e.r) Arena.collide(e, e.r, null);  // 大地圖：被擠進牆裡的推回來
    this.enemies = E.filter(e => !e.dead);
  },
  updateBullets(dt) {
    // 能量刃連段排隊的刃片（EnergyBlade.onFire）：時間到就從那艘船現在的位置放出（跟著船走）
    for (const q of this.slashQ) if ((q.t -= dt) <= 0) this.withLoadout(loadoutOf(q.p), () => spawnShots([q.s], q.p.x + Math.cos(q.a) * 4, q.p.y + Math.sin(q.a) * 4, q.a, 0, null));
    this.slashQ = this.slashQ.filter(q => q.t > 0);
    const B = this.bullets, E = this.enemies, Q = this.triggerQueue;
    buildEnemyGrid();  // 共用的敵人格子（追蹤、地雷、迴旋折返、找最近的敵人用；見 spatial.js）
    Objects.buildGrid();  // 地圖物件格子（子彈打行星、小行星、彗星、黑洞）
    // 敵人空間格子（碰撞用）：每幀把敵人照中心點分進 GS 大小的格子，子彈只跟路徑附近幾格的敵人比
    //   （以前每發子彈都跟全部敵人比：7000 發 × 40 隻 = 每幀 28 萬次）。結果跟以前一樣：候選照敵人在 E 裡的順序檢查（先打到排前面的），
    //   這一幀中途才出現的敵人（分裂、召喚，接在 E 後面）另外全部檢查。敵人在這個迴圈裡不會移動（擊退、吸引只改速度）
    const GS = 128, nE = E.length, grid = new Map(), cand = [];
    let maxR = 0;
    for (let i = 0; i < nE; i++) {
      const e = E[i];
      if (e.dead) continue;
      const er = e.shieldA != null ? e.r + SHIELD_OUT : e.r;  // 盾衛：盾比身體大
      if (er > maxR) maxR = er;
      const k = Math.floor(e.x / GS) * 100000 + Math.floor(e.y / GS), L = grid.get(k);
      if (L) L.push(i); else grid.set(k, [i]);
    }
    // 精英「磁場」：身邊 140 內的子彈變慢（整顆子彈的時間變慢：速度 ×0.5，射程不變）
    const fields = E.filter(e => !e.dead && !(e.spawnT > 0) && e.has && e.has('field')), FR2 = AFFIX.field.r ** 2;
    for (const b of B) {
      if (b.dead) continue;
      const bdt = fields.length && fields.some(e => dist2(b.x, b.y, e.x, e.y) < FR2) ? dt * AFFIX.field.slow : dt;
      if (b.owner) this.withLoadout(b.owner, () => b.update(bdt)); else b.update(bdt);  // 隊友的子彈：停留、飛回這些照隊友的武器升級
      if (b.dead || b.mode === 'wait') continue;  // 停滯：停住的子彈不會打到敵人
      if (b.comet && this.cometShardHit(b)) continue;  // 彗星碎片：也會打到飛船
      if (b.mode !== 'orbit' && this.portalHop(b, b.r, 'portalT', 0.3, b.angle, b.px, b.py)) { b.px = b.x; b.py = b.y; }
      if (Objects.bulletHit(b)) continue;  // 行星、小行星、彗星
      if (b.overT > 0) continue;  // 迴旋：正在穿過打中的敵人，準備折返
      cand.length = 0;
      if (grid.size) {
        const pad = b.r + maxR, x0 = Math.floor((Math.min(b.px, b.x) - pad) / GS), x1 = Math.floor((Math.max(b.px, b.x) + pad) / GS),
          y0 = Math.floor((Math.min(b.py, b.y) - pad) / GS), y1 = Math.floor((Math.max(b.py, b.y) + pad) / GS);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const L = grid.get(gx * 100000 + gy); if (L) for (const i of L) cand.push(i); }
        if (cand.length > 1) cand.sort((p, q) => p - q);
      }
      for (let j = nE; j < E.length; j++) cand.push(j);  // 這一幀才出現的敵人
      for (const ci of cand) {
        const e = E[ci];
        if (e.dead) continue;
        if (b.hitSet.has(e.id)) continue;
        const rr = b.r + e.r, d2 = segDist2(b.px, b.py, b.x, b.y, e.x, e.y);
        if (d2 >= rr * rr) {  // 沒碰到身體：盾衛的盾（外緣 r+SHIELD_OUT）從盾那一側碰到也算（反彈）
          if (e.shieldA == null || d2 >= (rr + SHIELD_OUT) ** 2 || Math.abs(angleDiff(Math.atan2(b.py - e.y, b.px - e.x), e.shieldA)) >= Math.PI / 3) continue;
        }
        b.hitSet.add(e.id);
        if (e.shieldA != null) {  // 盾衛：從盾的那一側（±60°）打過來的子彈反彈回去
          const ca = Math.atan2(b.py - e.y, b.px - e.x);
          if (Math.abs(angleDiff(ca, e.shieldA)) < Math.PI / 3) { this.wakeEnemy(e); this.reflectShot(e, b, ca); break; }  // 打在盾上不扣血，待機的也會醒（CFG.ALERT）
        }
        if (b.lock && b.ownerP) { b.ownerP.lockE = e; b.ownerP.lockT = this.time + 1; }  // 鎖定（感測器 2 層）：打中後 1 秒內子彈追蹤這一隻
        if (b.ownerP) this.withLoadout(loadoutOf(b.ownerP), () => weaponPlay().onHit(b.ownerP, b, e));  // 打中時（鉤爪勾住、吸能刃）：射的人的武器
        const dmg = hitDamage(b), att = b.att;
        const knock = b.knock, kb = Math.min(220, dmg * 5) * (14 / e.r) * knock;
        e.hurt(dmg, Math.cos(b.angle) * kb, Math.sin(b.angle) * kb, b.comet ? 'comet' : b.turret ? 'turret' : b.depth > 0 ? 'echo' : 'direct', att, knock);
        if (b.mark) e.markT = 3;  // 弱點標記（感測器 4 層）
        const wid = (b.owner ? b.owner.weapon : this.weapon).id;
        floatText(e.x, e.y - e.r, Math.round(dmg), ...dmgTextStyle(dmg, WEAPONS[wid] && WEAPONS[wid].base.damage));
        burst(b.x, b.y, b.color, 4, 160, 0.25, 2);
        Events.emit('hit', { e, b, dmg });
        this.hitFx(e, b, dmg, b.x, b.y);  // 命中效果（武器升級、元素組件）：燃燒、減速、爆炸、電弧
        if (b.lifesteal && this.shipOf(b.owner)) this.healPlayer(b.lifesteal, this.shipOf(b.owner));
        if (b.ln) { this.linePass(b, 'hit', e); if (e.dead) this.linePass(b, 'kill', e); }  // 線：命中、擊殺往下一格傳
        if (b.infPierce) { /* 迴旋的回程：不會消失 */ }
        else if (b.pierce > 0) b.pierce--;
        else if (b.boom && b.mode === 'fly') { b.overT = (e.r * 2 + 30) / b.speed; b.overId = e.id; }  // 迴旋：去程穿甲用完，穿過這隻再折返（回程會再打牠一次）
        else if (b.rare && b.homing > 0 && !b.hopped) {  // 稀有追蹤彈：彈去附近下一隻（第二下也往下傳）
          const n = nearestEnemy(e.x, e.y, 300, b.hitSet, true);
          if (n) { b.hopped = true; b.angle = Math.atan2(n.y - b.y, n.x - b.x); b.life = Math.max(b.life, 1); } else b.dead = true;
        }
        else b.dead = true;  // 穿甲用完
        break;
      }
    }
    const T = Q.splice(0);  // 線：這一幀排進來的觸發（命中往下傳、衝刺、定時）→ 放出產物
    for (const t of T) this.lineFire(t);
    if (T.length) Events.emit('chipTrigger', T.length);  // 音效（ui/listeners.js）
    let w = 0;  // 原地拿掉消失的子彈（不每幀建新陣列：子彈很多時記憶體回收會造成卡頓）；順便數每個人場上的產物（產物預算，見 lineSpawn）
    const prodN = new Map();
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      if (b.dead) continue;
      B[w++] = b;
      if (b.prod) { const L = b.owner || this.L; prodN.set(L, (prodN.get(L) || 0) + 1); }
    }
    B.length = w;
    for (const p of this.allShips()) { const L = loadoutOf(p); L.prodN = prodN.get(L) || 0; }
  },
  // 命中效果：武器升級的燃燒／減速／爆炸／電弧，加上元素組件（燃燒照這一下的傷害 dmg 算），兩邊相加
  // 武器升級的照這一下的傷害算（ratio）；元素插件是屬性傷害，照疊的層數算好的固定值（explode.dmg、burnEl、arcs.dmg，見 elemize）
  hitFx(e, b, dmg, x, y) {
    // 只有元素插件造成的（燃燒、爆炸、電弧）：傷害統計記在那個元素插件名下（編輯器插件下面的「每秒傷害」）
    const elAtt = k => b.att && { ...b.att, src: k, cr: null };
    const bd = (b.burn ? b.burn.dps : 0) + (b.burnR || 0) * dmg + (b.burnEl || 0);
    if (bd > 0) { e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, bd); e.burnT = Math.max(e.burnT, b.burn ? b.burn.t : 0, b.burnR || b.burnEl ? 3 : 0); e.burnAtt = bd === b.burnEl ? elAtt('ignite') : b.att; }
    if (b.slow) e.slowBy(b.comet ? 'comet' : 'shot', b.slow, b.slowDur || 1.5);
    if (b.explode) {
      this.explode(x, y, b.explode.r, b.damage * (b.explode.ratio || 0) + (b.explode.dmg || 0), b.color, e.id, b.explode.ratio ? b.att : elAtt('blast'));
    }
    if (b.shred) { e.shredAmt = Math.max(e.shredT > 0 ? e.shredAmt : 0, b.shred); e.shredT = 3; }  // 破甲：打中之後才生效（這一下不算）
    if (b.arcs) this.arc(e, b);
  },
  // 電弧（電擊線圈）：命中時瞬間打中附近其他敵人；附近敵人不夠時，剩下的電弧打回目標本身（傷害減半）
  arc(hit, b) {
    const { n, ratio } = b.arcs, R = CFG.ARC_RANGE, dmg = b.arcs.dmg != null ? b.arcs.dmg : b.damage * ratio;  // 元素插件的電弧：屬性傷害（固定值）
    const near = this.enemies.filter(o => !o.dead && o !== hit && o.spawnT <= 0 && dist2(o.x, o.y, hit.x, hit.y) < (R + o.r) ** 2)
      .sort((p, q) => dist2(p.x, p.y, hit.x, hit.y) - dist2(q.x, q.y, hit.x, hit.y));
    for (let k = 0; k < n; k++) {
      const t = near[k] || hit, d = near[k] ? dmg : dmg * 0.5;
      if (t.dead) continue;
      if (b.slow) t.slowBy('shot', b.slow, b.slowDur || 1.5);
      t.hurt(d, 0, 0, 'arc', b.arcs.dmg != null ? { ...b.att, src: 'shock', cr: null } : b.att);
      floatText(t.x, t.y - t.r, Math.round(d), '#9fe8ff');
      zapFx(hit.x, hit.y, t.x, t.y, { jitter: 6 });
    }
  },
};

// ---------- 座位：每個玩家一份配裝 L ----------
//   房主（單人就是只有自己的房間）的配裝是 Game.L；隊友的是 mate.L（Net.makeLoadout）
//   Game 身上這些欄位 = 「目前在算的那個人」的配裝（Game.cur）：平常是自己，withLoadout(L, fn) 時換成那個人的
const LOADOUT_KEYS = ['chain', 'socks', 'inventory', 'wSock', 'weapon', 'wp', 'stats', 'passives', 'shipId', 'playKills', 'parts', 'partSlots', 'cap', 'mech', 'boons'];
Game.L = {};
for (const k of LOADOUT_KEYS) {
  Game.L[k] = Game[k];
  delete Game[k];
  Object.defineProperty(Game, k, { get() { return this.cur[k]; }, set(v) { this.cur[k] = v; }, enumerable: true, configurable: true });
}
Game.cur = Game.L;
// 這艘船（房主自己或隊友）的配裝
const loadoutOf = p => (p && p.L) || Game.L;

// 主題小兵：cost = 佔一波的預算、from = 第幾星區開始出現、max = 一波最多幾隻
const THEMES = {
  gunboat: { cost: 3, from: 1 }, worm: { cost: 4, from: 1 }, splitter: { cost: 4, from: 1 },
  shield: { cost: 5, from: 2 }, lurker: { cost: 3, from: 2 }, hive: { cost: 8, from: 3, max: 1 },
};
// 擊沉旗艦的勝利畫面：二選一選好了（雙人的隊友這時才通知房主可以前往）
function bossDone(V) { return !!V && !!V.pick && V.rew !== false; }  // 旗艦獎勵選好了：二選一＋三選一（rew）
