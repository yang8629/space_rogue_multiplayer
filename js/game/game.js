// 星環電路 雙人版 · game.js：Game：一局的流程、戰鬥、獎勵、商店、黑洞、傷害、主更新
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// GAME
// =====================================================================
const Game = {
  state: 'title', returnState: null, mode: null,
  chain: [], inventory: [], credits: 0,
  stats: null, passives: computePassives([]),
  map: null, node: null, visited: [], combat: null, inArena: false,
  cam: { x: 0, y: 0, shake: 0 },
  stars: [], bullets: [], enemies: [], eBullets: [], particles: [], texts: [], pickups: [], triggerQueue: [], rings: [], zaps: [],
  weapon: { id: 'laser', path: null, final: null }, wp: null,
  time: 0, nextId: 1,
  // 雙人：mate = 隊友的飛船（房主這邊是真的模擬對象，隊友那邊只是畫出來的影子）
  //   mate.L = 隊友的配裝（電路、倉庫、武器…），房主算隊友的子彈時用 withLoadout 暫時換上
  mate: null, shooter: null,
  // V2 晶片：各晶片的累積用量（成長）、開火模式（衝刺射擊／擦彈）、目前的蓄力、引力漩渦
  parts: {}, module: null, partSlots: 6, mech: mechStats({}, null), objs: [], portals: [],
  growth: {}, fireMode: null, fireHit: false, chargeC: null, vortices: [], pullHits: 0, arcT: 0,

  // ---------- 雙人共用 ----------
  players() { return [this.player, this.mate].filter(p => p && !p.dead && !p.gone); },  // gone：隊友離線，房主一個人繼續
  nearestPlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players()) { const d = dist2(x, y, p.x, p.y); if (d < bd) { bd = d; best = p; } }
    return best || this.player;
  },
  // 暫時把 Game 的配裝換成 L（隊友的），執行完再換回來；L 為 null 時就是房主自己
  withLoadout(L, fn) {
    if (!L) return fn();
    const saved = {}, prev = this.shooter;
    for (const k of LOADOUT_KEYS) { saved[k] = this[k]; this[k] = L[k]; }
    this.shooter = L;
    try { return fn(); } finally {
      for (const k of LOADOUT_KEYS) { L[k] = this[k]; this[k] = saved[k]; }
      this.shooter = prev;
    }
  },
  passivesOf(p) { return p.L ? p.L.passives : this.passives; },
  isClient() { return Net.role === 'client' && this.mode === 'coop'; },
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
    this.weapon = { id: weaponId, path: null, final: null };
    const S = SHIPS[shipId];
    // 先換上新的電路、倉庫、飛船，再計算數值（不能拿上一場的電路來算）
    // 遠征／雙人：開局三選一的起始晶片直接裝在電路上（武器右邊）；飛船不再自帶晶片
    this.chain = mode === 'sandbox' ? ['weapon', 'split', null, null]
      : mode === 'range' ? ['weapon', null, null, null, null, null] : startChain(startChip);  // 靶場：6 格空電路
    this.inventory = Array(CFG.INV_SLOTS).fill(null);
    this.growth = {}; this.pullHits = 0;
    this.parts = { ...S.parts }; this.module = null; this.partSlots = S.partSlots;  // 機體成長線：開局零件由飛船決定
    this.credits = this.freePlay() ? 999 : 0;
    this.player = new Player(S);
    this.map = mode === 'run' || (mode === 'coop' && Net.role === 'host') ? genMap() : null;  // 雙人：星圖由房主產生後傳給隊友
    this.node = null; this.visited = []; this.sector = 1; this.bossId = this.bossFor(1);
    this.runStats = { dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])), chips: {}, kills: 0, maxHit: 0, time: 0,
      bosses: [], started: Date.now(), recorded: false,
      // 遊玩紀錄用的判斷資料：受到的傷害來源、被打中次數、衝刺次數、走過的節點、取得的晶片、武器升級、各關摘要
      taken: {}, hits: 0, dashes: 0, path: [], got: [], upgrades: [], sectors: [] };
    this.sectorStats = { chips: {}, t0: 0, kills0: 0, dmg0: 0 };  // 「本關」＝目前這個星區
    this.nodeLog = null;
    this.lastHit = '';
    this.refreshWeapon();  // 內含 recalc()
    this.player.hp = this.player.maxHp;
    if (mode !== 'coop') { this.mate = null; Net.close(); }
    if (mode === 'sandbox') this.startCombat({ sandbox: true, level: 0 });
    else if (mode === 'range') { this.startCombat({ sandbox: true, range: true, level: 0 }); Range.reset('single'); }
    else if (mode === 'coop') return;  // 雙人：由 Net 建好隊友之後再開戰
    else this.showMap();
  },
  // ---------- 遊玩紀錄：走過的節點 ----------
  here() { return `${this.sector}-${this.node ? this.node.L + 1 : 0}`; },
  totalDmg() { return this.runStats ? Object.values(this.runStats.dmg).reduce((a, b) => a + b, 0) : 0; },
  logNodeStart(node) {
    const R = this.runStats;
    if (!R) return;
    const label = node.type === 'boss' ? `旗艦・${ENEMY_TYPES[this.bossId].name}` : NODE_META[node.type].label;
    if (['combat', 'elite', 'boss'].includes(node.type))
      this.nodeLog = { at: this.here(), label, t0: R.time, hp0: this.player.hp, hits0: R.hits, dmg0: this.totalDmg() };
    else R.path.push(`${this.here()} ${label}`);
  },
  // 戰鬥節點的摘要：花幾秒、掉多少血、被打中幾下、打出多少傷害（ongoing = 還在打）
  nodeSummary(ongoing = false) {
    const N = this.nodeLog, R = this.runStats;
    if (!N || !R) return null;
    return `${N.at} ${N.label} ${Math.round(R.time - N.t0)}秒 HP ${Math.ceil(N.hp0)}→${Math.max(0, Math.ceil(this.player.hp))}` +
      `（被打 ${R.hits - N.hits0} 下）傷害 ${Math.round(this.totalDmg() - N.dmg0)}${ongoing ? ' ←進行中' : ''}`;
  },
  logNodeEnd() {
    const s = this.nodeSummary();
    if (s) this.runStats.path.push(s);
    this.nodeLog = null;
  },
  // 前三關依序打三隻不同的旗艦；無盡模式（第 4 關起）隨機抽
  bossFor(sector) { return sector <= CFG.CAMPAIGN_SECTORS ? CFG.BOSS_ORDER[sector - 1] : pick(CFG.BOSS_ORDER); },
  isEndless() { return this.sector > CFG.CAMPAIGN_SECTORS; },
  nodeById(id) { return this.map.flat().find(n => n.id === id); },
  reachable() {
    return this.node ? this.node.next.map(id => this.nodeById(id)) : this.map[0];
  },
  showMap(toast = '') {
    this.inArena = false; this.state = 'map';
    if (this.mode === 'coop') Net.atMap();  // 雙人：告訴隊友「我回到航圖了」（隊友這邊順便送出最新配裝）
    Screen.map(toast);
  },
  enterNode(node) {
    if (!this.reachable().includes(node)) return;
    this.node = node; this.visited.push(node.id);
    const L = node.L, level = L + (this.sector - 1) * 7;  // 每個星區難度往上疊
    this.logNodeStart(node);
    switch (node.type) {
      case 'combat': this.startCombat({ level, wavesTotal: 2 + (L >= 3 ? 1 : 0), elites: 0 }); break;
      case 'elite':  this.startCombat({ level, wavesTotal: 2, elites: 1 }); break;
      case 'boss':   this.startCombat({ level, wavesTotal: 1, elites: 0, boss: true }); break;
      case 'shop':   this.openShop(); break;
      case 'blackhole': this.openBlackhole(); break;
      case 'workshop': this.openWorkshop(); break;
      case 'armory': this.state = 'armory'; this.armorySource = 'armory'; Screen.armory('armory'); break;
      case 'repair': {
        const p = this.player, heal = Math.round(p.maxHp * CFG.REPAIR_RATIO);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        if (this.findScrap()) { this.state = 'repair'; this.repairMsg = `維修完成：HP +${heal}`; Screen.repair(); }  // 有廢鐵：留在維修站拆除
        else this.showMap(`維修完成：HP +${heal}`);
        break;
      }
    }
  },

  // ---------- 戰鬥 ----------
  startCombat(cfg) {
    this.combat = Object.assign({ wave: 0, waveTimer: 1.2, pending: [], spawnClock: 0, cleared: false, clearT: 0,
      wavesTotal: Infinity, elites: 0 }, cfg);
    this.bullets = []; this.enemies = []; this.eBullets = []; this.particles = [];
    this.texts = []; this.pickups = []; this.triggerQueue = []; this.rings = []; this.zaps = []; this.vortices = []; this.portals = [];
    this.kills = 0; this.banner = null; this.nextId = 1;
    if (Net.stats) Net.stats.lastRecv = 0;  // 同步間隔從這場戰鬥重新算（不把航圖、商店的時間算進去）
    this.player.resetPos();
    // 雙人：房主在左、隊友在右（隊友的位置由隊友自己的電腦決定）
    if (Net.role === 'host') this.player.x -= 50;
    if (Net.role === 'client') this.player.x += 50;
    if (this.mate) { this.mate.resetPos(); this.mate.x += Net.role === 'host' ? 50 : -50; this.mate.dead = false; }
    this.player.dead = false;
    for (const p of [this.player, this.mate]) if (p) this.resetMechCombat(p);
    this.objs = this.isClient() ? [] : Objects.gen(this.combat, this.node);  // 地圖物件（雙人：房主產生，隨同步傳給隊友）
    this.cam.x = this.player.x - ZW / 2; this.cam.y = this.player.y - ZH / 2;
    Input.down = false; Input.dash = false; Input.joy = null; Input.aimStick = null;
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
    this.inArena = true; this.state = 'play';
    Screen.hide();
  },
  startWave(n) {
    const C = this.combat;
    C.wave = n;
    if (C.boss) {
      C.pending = [this.bossId];
      this.banner = { text: `♛ ${ENEMY_TYPES[this.bossId].name}`, sub: '守關旗艦接近中', t: 2.5 };
      SFX.play('boss');
      return;
    }
    let budget = 5 + n * 3 + C.level * 3;
    const list = [];
    while (budget > 0) {
      const r = Math.random(), lv = C.sandbox ? n : C.level + n;
      if (lv >= 3 && r < 0.18 && budget >= 6) { list.push('brute'); budget -= 6; }
      else if (lv >= 2 && r < 0.45 && budget >= 3) { list.push('spitter'); budget -= 3; }
      else { list.push('swarmer'); budget -= 1; }
    }
    if (!C.sandbox && n === C.wavesTotal) for (let i = 0; i < C.elites; i++) list.push('elite');
    // 沙盒：每 10 波輪流出現三隻旗艦
    const sbBoss = C.sandbox && n % 10 === 0 ? CFG.BOSS_ORDER[(n / 10 - 1) % CFG.BOSS_ORDER.length] : null;
    if (sbBoss) list.push(sbBoss);
    else if (C.sandbox && n % 5 === 0) list.push('elite');
    C.pending = list;
    this.banner = { text: C.sandbox ? `WAVE ${n}` : `WAVE ${n} / ${C.wavesTotal}`, t: 2 };
    SFX.play(sbBoss ? 'boss' : 'wave');
    if (sbBoss) this.banner.sub = `♛ ${ENEMY_TYPES[sbBoss].name}接近中`;
    else if (list.includes('elite')) this.banner.sub = '⚠ 精英反應接近中';
  },
  spawnEnemy(type) {
    const C = this.combat, p = this.player, a = rand(0, TAU), d = rand(520, 780);
    const x = clamp(p.x + Math.cos(a) * d, 40, CFG.WORLD_W - 40);
    const y = clamp(p.y + Math.sin(a) * d, 40, CFG.WORLD_H - 40);
    const scale = (C.sandbox ? 1 + (C.wave - 1) * 0.12 : 1 + C.level * 0.15 + (C.wave - 1) * 0.08) *
      (this.mode === 'coop' && this.mate && !this.mate.gone ? 1.6 : 1);  // 雙人：敵人血量 ×1.6（暫定，第 3 步再調）；隊友離線時恢復單人血量
    const e = new Enemy(type, x, y, scale);
    this.enemies.push(e);
    burst(x, y, e.t.color, 10, 90, 0.5, 2);
  },
  updateWaves(dt) {
    const C = this.combat;
    if (C.range) return;  // 靶場：沒有波次，標靶由 Range 管理
    if (C.cleared) {
      for (const c of this.pickups) c.vacuum = true;
      C.clearT -= dt;
      if (C.clearT <= 0) this.combatWon();
      return;
    }
    if (C.pending.length) {
      C.spawnClock -= dt;
      if (C.spawnClock <= 0) { C.spawnClock = 0.22; this.spawnEnemy(C.pending.shift()); }
    } else if (this.enemies.length === 0) {
      for (const c of this.pickups) c.vacuum = true;  // 每一波清完就把地上的晶體全部吸過來
      if (C.wave >= C.wavesTotal) {
        C.cleared = true; C.clearT = 1.6;
        this.banner = { text: '區域肅清', t: 1.6 };
        SFX.play('clear');
        return;
      }
      C.waveTimer -= dt;
      if (C.waveTimer <= 0) { C.waveTimer = 2.5; this.startWave(C.wave + 1); }
    }
  },
  combatWon() {
    const client = this.isClient();  // 雙人的隊友：地上剩下的晶體由房主算好數量傳過來
    this.inArena = false;
    const left = client ? 0 : this.pickups.length;
    this.credits += left;  // 沒吸完的晶體直接入帳（雙人時兩人都拿）
    this.pickups = [];
    const p = this.player;
    if (this.mode === 'coop') Net.afterCombat(left);  // 雙人：被擊墜的人在戰鬥結束後以 30% HP 歸隊，並同步血量
    this.logNodeEnd();  // 先記下戰鬥結果（先鋒號回血之前的 HP）
    const type = this.node.type;
    if (type === 'boss') {  // 擊敗旗艦：插槽 +1、晶體獎勵，可前往下一星區
      const slot = this.chain.length < CFG.MAX_SLOTS;
      if (slot) this.chain.push(null);
      this.credits += 50;  // 雙人：兩人各自拿
      this.partSlots++;    // 零件格 +1
      this.recalc();
      if (this.runStats) this.runStats.bosses.push(ENEMY_TYPES[this.bossId].name);
      this.victory = { slot, boss: this.bossId, module: bossModuleOf(this.bossId), took: false };
      this.state = 'victory';
      Screen.victory();
      return;
    }
    const kind = type === 'elite' ? 'elite' : 'combat';
    this.reward = { kind, options: kind === 'elite' ? pickN(NORMAL_MODULES.filter(id => id !== this.module), 3) : pickN(NORMAL_IDS, 3), bonus: kind === 'elite' ? 15 : 0,
      slot: kind === 'elite' && this.chain.length < CFG.MAX_SLOTS };  // 精英獎勵多一張「電路擴充」
    this.credits += this.reward.bonus;  // 精英獎勵：雙人時兩人各自拿
    this.state = 'reward';
    Screen.reward();
  },
  // ---------- 取得晶片：已擁有同種晶片（且未滿級）就合成升級，否則放進倉庫 ----------
  mergeTarget(id) {
    if (!canLevelUp(id)) return null;
    const b = baseOf(id);
    for (const arr of [this.chain, this.inventory])
      for (let i = 0; i < arr.length; i++)
        if (arr[i] && baseOf(arr[i]) === b && levelOf(arr[i]) < CFG.MAX_CHIP_LV) return { arr, i };
    return null;
  },
  canAcquire(id) { return !!this.mergeTarget(id) || this.inventory.includes(null); },
  acquire(id) {
    if (this.runStats) this.runStats.got.push(`${this.here()} ${CHIPS[id].name}`);
    const t = this.mergeTarget(id);
    if (t) {
      const lv = levelOf(t.arr[t.i]) + 1;
      t.arr[t.i] = leveledId(baseOf(id), lv);
      this.recalc();
      SFX.play('upgrade');
      return `「${CHIPS[baseOf(id)].name}」合成升級為 Lv${lv}`;
    }
    const i = this.inventory.indexOf(null);
    if (i < 0) return null;
    this.inventory[i] = id;
    this.recalc();
    return `獲得「${CHIPS[id].name}」，已放入倉庫`;
  },
  takeModule(id) {  // 精英獎勵：裝上背包模組（取代目前的）
    if (!MODULES[id]) return;
    this.setModule(id);
    SFX.play('upgrade');
    this.showMap(`裝上背包模組「${MODULES[id].name}」`);
  },
  takeBossModule() {  // 擊沉旗艦：裝上旗艦專屬模組
    const V = this.victory;
    if (!V || V.took || !V.module) return;
    V.took = true;
    this.setModule(V.module);
    SFX.play('upgrade');
    Screen.victory();
  },
  // ---------- 改裝廠：零件三選一、付錢換零件 ----------
  openWorkshop() {
    this.ws = { options: pickN(PART_IDS, 3), picked: false, from: null, msg: '' };
    this.state = 'workshop';
    Screen.workshop();
  },
  wsPick(id) {
    const W = this.ws;
    if (!W || W.picked || !W.options.includes(id)) return;
    if (!this.addPart(id)) { W.msg = '零件格已滿：可以用「換零件」改成別種'; Screen.workshop(); return; }
    W.picked = true; W.msg = `裝上 ${PARTS[id].name}（${this.parts[id]} 層）`;
    SFX.play('upgrade');
    Screen.workshop();
  },
  wsFrom(id) { if (this.ws) { this.ws.from = this.ws.from === id ? null : id; Screen.workshop(); } },
  wsTo(id) {
    const W = this.ws;
    if (!W || !W.from) return;
    const from = W.from;
    if (this.swapPart(from, id)) { W.msg = `改裝完成：${PARTS[from].name} → ${PARTS[id].name}`; W.from = null; SFX.play('upgrade'); }
    Screen.workshop();
  },
  takeReward(id) {
    let msg;
    if (id) {
      msg = this.acquire(id);
      if (!msg) return;
    } else {
      this.earn(10);
      msg = '跳過獎勵：◆ +10';
    }
    this.showMap(msg);
    if (id) this.openEditorWith(msg);  // 拿到晶片後直接打開電路編輯器，方便馬上裝上
  },
  openEditorWith(msg) {
    this.toggleEditor();
    if (this.state === 'editor') Editor.infoEl.innerHTML = `<b style="color:#9dff6b">${msg}</b><br>新晶片在下方倉庫：拖到上方電路（或點一下再點插槽）就能裝上。按 Tab 或「返回」回到航圖。`;
  },

  // ---------- 商店 ----------
  openShop() {
    const items = pickN(NORMAL_IDS, 4).map(id => ({ id, price: chipPrice(id), sold: false }));
    if (COMPOSITE_IDS.length && Math.random() < 0.6) { const id = pick(COMPOSITE_IDS); items.push({ id, price: chipPrice(id), sold: false }); }
    this.shop = { items, slotBought: false, healed: false };
    this.state = 'shop';
    Screen.shop();
  },
  shopHeal() {  // 補給站補血：每間限 1 次
    const p = this.player, R = CFG.SHOP_REPAIR;
    if (this.shop.healed || this.credits < R.price || p.hp >= p.maxHp) return;
    this.pay(R.price, () => {
      this.shop.healed = true;
      p.hp = Math.min(p.maxHp, p.hp + R.hp);
      Screen.shop(`補血完成：HP +${R.hp}`);
    });
  },
  buy(idx) {
    const it = this.shop.items[idx];
    if (!it || it.sold || this.credits < it.price || !this.canAcquire(it.id)) return;
    this.pay(it.price, () => { it.sold = true; Screen.shop(this.acquire(it.id)); });
  },
  // ---------- 武器 ----------
  refreshWeapon() {  // 重新計算武器參數，並更新電路第 1 格的顯示
    const W = WEAPONS[this.weapon.id], st = this.weapon, c = CHIPS.weapon;
    this.wp = weaponParams(st);
    c.name = weaponTitle(st);
    c.short = W.short;
    const lines = [W.desc];
    if (st.path) lines.push(`第一段・${W.paths[st.path].name}：${W.paths[st.path].desc}`);
    if (st.final != null) { const n = W.paths[st.path].next[st.final]; lines.push(`第二段・${n.name}：${n.desc}`); }
    c.desc = lines.join('<br>') + (this.mode === 'range' ? '<br><span style="color:#6a79ad">武器固定在電路第 1 格；靶場可在「🚀 機體・武器」分頁更換。</span>'
      : '<br><span style="color:#6a79ad">武器固定在電路第 1 格，這一場不能更換。</span>');
    if (this.player) this.recalc();
  },
  swapShip(id) {  // 靶場：換機體（保留位置、電路與倉庫）
    const old = this.player;
    this.shipId = id;
    this.parts = { ...SHIPS[id].parts }; this.partSlots = SHIPS[id].partSlots;
    this.player = new Player(SHIPS[id]);
    if (old) { this.player.x = old.x; this.player.y = old.y; }
    this.recalc();
    this.player.hp = this.player.maxHp;
  },
  weaponStage() { return this.weapon.final != null ? 2 : this.weapon.path ? 1 : 0; },
  upgradeWeapon(choice) {  // 只在軍械台升級
    const st = this.weapon;
    if (st.final != null) return;
    if (!st.path) st.path = choice; else st.final = +choice;
    this.refreshWeapon();
    if (this.runStats) this.runStats.upgrades.push(`${this.here()} ${weaponTitle(st)}`);
    SFX.play('upgrade');
    this.showMap(`武器升級：${weaponTitle(st)}`);
  },
  // 電路擴充（插槽 +1）的來源：補給站購買、精英獎勵、武器升滿後的軍械台、擊敗 Boss
  expandSlot(source) {
    if (this.chain.length >= CFG.MAX_SLOTS) return;
    if (source === 'shop') {
      if (this.credits < CFG.SHOP_SLOT || this.shop.slotBought) return;
      this.pay(CFG.SHOP_SLOT, () => { this.shop.slotBought = true; this.addSlot(source); });
      return;
    }
    this.addSlot(source);
  },
  addSlot(source) {
    this.chain.push(null);
    this.recalc();
    SFX.play('upgrade');
    if (this.runStats) this.runStats.got.push(`${this.here()} 插槽 +1（${{ shop: '補給站', reward: '精英獎勵', armory: '軍械台' }[source] || source}）`);
    const msg = `電路擴充：插槽 +1（目前 ${this.chain.length} 格）`;
    if (source === 'shop') Screen.shop(msg);
    else this.showMap(msg);
  },
  armoryBonus() {
    const B = CFG.ARMORY_BONUS, p = this.player;
    this.earn(B.credits);
    p.hp = Math.min(p.maxHp, p.hp + B.hp);
    this.showMap(`武器已升滿：改領 ◆ +${B.credits}、HP +${B.hp}`);
  },
  // 目前這一關的摘要（遊玩紀錄用）
  sectorSummary() {
    const R = this.runStats, S = this.sectorStats;
    return `星區 ${this.sector}：戰鬥 ${Math.round(R.time - S.t0)} 秒、擊殺 ${R.kills - S.kills0}、傷害 ${Math.round(this.totalDmg() - S.dmg0)}、` +
      `離開時 HP ${Math.max(0, Math.ceil(this.player.hp))}/${this.player.maxHp}、晶體 ${this.credits}`;
  },
  nextSector() {
    if (this.runStats) this.runStats.sectors.push(this.sectorSummary());
    this.sector++;
    // chips0：這一關開始時的整局晶片傷害（隊友的傷害由房主算，本關 = 整局 − chips0）
    this.sectorStats = { chips: {}, chips0: { ...this.runStats.chips }, t0: this.runStats.time, kills0: this.runStats.kills, dmg0: this.totalDmg() };
    if (this.isClient()) { this.bossId = Net.nextMap.bossId; this.map = Net.nextMap.map; }  // 隊友：用房主產生的星圖
    else { this.bossId = this.bossFor(this.sector); this.map = genMap(); }
    this.node = null; this.visited = [];
    if (this.mode === 'coop' && Net.role === 'host') Net.sendSector();
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3));
    this.showMap(this.sector === CFG.CAMPAIGN_SECTORS + 1
      ? `進入無盡模式：星區 ${this.sector}，船體修復 30%。旗艦改為隨機出現`
      : `進入星區 ${this.sector}：船體修復 30%，敵人更強了`);
  },
  // 結束遠征（通關或中途撤退）：存下遊玩紀錄後回到標題
  finishRun() {
    this.saveRecord(this.sector >= CFG.CAMPAIGN_SECTORS ? 'cleared' : 'retired');
    if (this.mode === 'coop') {  // 雙人：房主決定結束，兩人一起回到房間
      if (Net.role === 'host') Net.send({ t: 'finish' });
      Net.backToRoom();
      return;
    }
    this.state = 'title'; this.inArena = false;
    Screen.title();
  },

  // ---------- 遊玩紀錄（存在瀏覽器；標題畫面「遊玩紀錄」可以查看、複製） ----------
  loadRecords() {
    try { const r = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; }
  },
  saveRecord(result) {
    const R = this.runStats;
    if (!['run', 'coop'].includes(this.mode) || !R || R.recorded || MechCheck.running) return;  // 機制檢查的模擬局不存
    R.recorded = true;
    const rec = this.mode === 'coop' ? Net.buildRecord(result) : this.buildRecord(result);
    const list = [rec, ...this.loadRecords()].slice(0, CFG.MAX_RECORDS);
    try { localStorage.setItem(RECORDS_KEY, JSON.stringify(list)); } catch (e) {}
  },
  // 目前這一局的紀錄（結算畫面的「複製這局紀錄」也用它，打完 Boss 還沒結束的局也能複製）
  buildRecord(result) {
    const R = this.runStats;
    const total = Object.values(R.dmg).reduce((a, b) => a + b, 0);
    const chips = Object.entries(R.chips).sort((a, b) => b[1] - a[1]).map(([k, v]) => [dmgKeyName(k), Math.round(v)]);
    const name = id => id ? CHIPS[id].name : null;
    // 打到哪：星區、層、節點種類、波次；王戰時再加上王剩多少血
    const node = this.node, C = this.combat, boss = (this.enemies || []).find(e => e.t.boss && !e.dead);
    let where = node ? `${this.isEndless() ? '無盡 · ' : ''}星區 ${this.sector} 第 ${node.L + 1} 層（${NODE_META[node.type].label}）` : `星區 ${this.sector} 航圖`;
    if (node && C && this.inArena && C.wavesTotal !== Infinity) where += ` 第 ${C.wave} / ${C.wavesTotal} 波`;
    if (boss && this.inArena) where += `，${boss.t.name}剩 ${Math.max(0, Math.round(boss.hp / boss.maxHp * 100))}% 血${boss.enraged ? '（暴走中）' : ''}`;
    const s = this.stats, P = this.passives;
    const inFight = this.inArena && this.nodeLog;
    const rec = {
      v: 2, build: CFG.VERSION, at: new Date().toISOString(), result, where,
      input: Input.touch ? `觸控（自動攻擊${Input.autoFire ? '開' : '關'}）` : '滑鼠鍵盤',
      ship: SHIPS[this.shipId].name, weapon: weaponTitle(this.weapon),
      sector: this.sector, layer: this.node ? this.node.L + 1 : 0, endless: this.isEndless(),
      bosses: R.bosses.slice(), cause: result === 'dead' ? this.lastHit : '',
      time: Math.round(R.time), kills: R.kills, dmg: Math.round(total), maxHit: Math.round(R.maxHit),
      dps: R.time > 0 ? Math.round(total / R.time) : 0,
      dmgBySource: Object.fromEntries(DMG_SOURCES.filter(([k]) => R.dmg[k] > 0).map(([k, label]) => [label, Math.round(R.dmg[k])])),
      chipDmg: chips, chain: this.chain.map(name), inv: this.inventory.filter(Boolean).map(name),
      // 最後的電路數值：插槽數、能量、射速、每發子彈數與傷害、編輯器的估算 DPS、倉庫被動
      stats: { slots: this.chain.length, heat: s.heat, rateCut: `-${Math.round((1 - heatRateMul(s.heat)) * 100)}%`, rps: +s.rps.toFixed(2),
        perFire: s.count, fireDmg: Math.round(s.dmg), estDps: Math.round(s.dpsEst), triggerLayers: s.layers.length, knock: this.wp.knock,
        passives: Object.entries(P).filter(([, v]) => v > 0).map(([k, v]) => PASSIVE_LABEL[k](+v.toFixed(2))) },
      credits: this.credits, hp: Math.max(0, Math.ceil(this.player.hp)), maxHp: this.player.maxHp,
      mech: this.mechRecord(),
      // 生存：受到的傷害依來源、被打中次數、衝刺次數
      taken: Object.fromEntries(Object.entries(R.taken).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)])),
      hits: R.hits, dashes: R.dashes,
      // 過程：各關摘要、走過的節點（戰鬥節點含秒數與掉血）、武器升級、取得的晶片與插槽
      sectors: [...R.sectors, this.sectorSummary() + (result === 'cleared' || result === 'retired' ? '' : ' ←目前')],
      path: [...R.path, ...(inFight ? [this.nodeSummary(true)] : [])],
      upgrades: R.upgrades.slice(), got: R.got.slice(),
    };
    return rec;
  },
  // 機體（遊玩紀錄用）：零件層數、零件格、背包模組、開啟的特性、各晶片的用量成長
  mechRecord() {
    const T = this.mech.traits;
    return { parts: Object.fromEntries(PART_IDS.filter(id => this.parts[id]).map(id => [PARTS[id].name, this.parts[id]])), slots: this.partSlots,
      module: this.module ? MODULES[this.module].name : null,
      traits: [...PART_IDS.flatMap(id => [PARTS[id].t2, PARTS[id].t4]).filter(t => T[t.id]).map(t => t.name), ...(T.balance ? ['均衡'] : [])],
      growth: Object.fromEntries(Object.entries(this.growth).map(([k, v]) => [CHIPS[k] ? CHIPS[k].name : k, Math.round(v)])) };
  },
  findScrap() {
    for (const arr of [this.chain, this.inventory]) {
      const i = arr.indexOf('scrap');
      if (i >= 0) return { arr, i };
    }
    return null;
  },
  removeScrap() {
    const s = this.findScrap(), price = CFG.SCRAP_REMOVE;
    if (!s || this.credits < price) return;
    this.pay(price, () => {
      s.arr[s.i] = null;
      this.recalc();
      if (this.state === 'repair') Screen.repair('已拆除 1 塊廢鐵。');
    });
  },

  // ---------- 黑洞 ----------
  ownedFusable() {  // 電路與倉庫中可以投入黑洞的晶片
    const out = [];
    this.chain.forEach((id, i) => { if (canFuse(id)) out.push({ key: 'chain:' + i, arr: this.chain, i, id }); });
    this.inventory.forEach((id, i) => { if (canFuse(id)) out.push({ key: 'inv:' + i, arr: this.inventory, i, id }); });
    return out;
  },
  openBlackhole() {
    this.bh = { sel: [], result: null };
    this.state = 'blackhole';
    Screen.blackhole();
  },
  bhToggle(key) {
    const S = this.bh.sel, k = S.indexOf(key);
    if (k >= 0) S.splice(k, 1);
    else if (S.length < 2) S.push(key);
    Screen.blackhole();
  },
  bhFuse() {
    const owned = this.ownedFusable(), [a, b] = this.bh.sel.map(k => owned.find(o => o.key === k));
    if (!a || !b) return;
    const ok = Math.random() < CFG.FUSE_SUCCESS;
    const result = ok ? fuseChips(a.id, b.id) : 'scrap';
    if (this.runStats) this.runStats.got.push(`${this.here()} 黑洞融合 ${CHIPS[a.id].name}＋${CHIPS[b.id].name} → ${ok ? CHIPS[result].name : '廢鐵'}`);
    a.arr[a.i] = result;   // 結果留在第一個素材的位置
    b.arr[b.i] = null;
    this.recalc();
    this.bh = { sel: [], result: { ok, id: result, where: a.arr === this.chain ? '電路' : '倉庫' }, fusing: true };
    Screen.blackhole();
    SFX.play('fusing');
    setTimeout(() => {
      if (this.state !== 'blackhole') return;
      this.bh.fusing = false;
      SFX.play(ok ? 'fuseok' : 'fusefail');
      Screen.blackhole();
    }, 1200);
  },

  // ---------- 共用 ----------
  recalc() {
    this.stats = analyzeChain(this.chain);
    this.passives = computePassives(this.inventory);
    this.mech = mechStats(this.parts, this.module);
    const p = this.player;
    if (p) {
      const newMax = this.maxHpOf(p.ship, this.passives, this.mech);
      if (newMax > p.maxHp) p.hp += newMax - p.maxHp;
      p.maxHp = newMax;
      p.hp = Math.min(p.hp, p.maxHp);
    }
  },
  toggleEditor() {
    // 雙人：戰鬥中按 Tab → 兩邊一起暫停，關掉編輯器時把新電路傳給房主再繼續
    if (this.state === 'editor') {
      this.state = this.returnState;
      Editor.close();
      this.recalc();
      if (this.mode === 'range') Range.clearStats();  // 靶場：改完電路重新計算
      if (this.mode === 'coop') {
        Net.sendLoadout();
        if (this.state === 'play') Net.setEditing(false);
        if (this.state === 'map') { Net.checkVoteTimer(); Net.tryResolve(); }  // 時間到的情況由 Net.tick 處理
      }
      if (this.state === 'map') Screen.map();
      else if (this.state === 'reward') Screen.reward();
      else if (this.state === 'shop') Screen.shop();
      else if (this.state === 'repair') Screen.repair();
      else if (this.state === 'blackhole') { this.bh.sel = []; Screen.blackhole(); }
      else if (this.state === 'armory') Screen.armory(this.armorySource || 'armory');
      else if (this.state === 'workshop') Screen.workshop();
    } else if (['play', 'map', 'reward', 'shop', 'repair', 'blackhole', 'armory', 'workshop'].includes(this.state)) {
      this.returnState = this.state;
      this.state = 'editor';
      Input.down = false; Input.dash = false; Input.joy = null; Input.aimStick = null;
      if (this.mode === 'coop' && this.returnState === 'play') Net.setEditing(true);
      Editor.open();
    }
  },
  shake(v) { this.cam.shake = Math.max(this.cam.shake, v); },
  recordDamage(source, amount, att) {  // 本局傷害統計：依來源分類，並依晶片分攤（見 splitDamage）
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
  restoreScreen() {  // 依目前狀態重畫對應的畫面（機制檢查跑完後用）
    const st = this.state === 'editor' ? this.returnState : this.state;
    switch (st) {
      case 'title': Screen.title(); break;
      case 'map': Screen.map(); break;
      case 'reward': Screen.reward(); break;
      case 'shop': Screen.shop(); break;
      case 'repair': Screen.repair(); break;
      case 'blackhole': Screen.blackhole(); break;
      case 'armory': Screen.armory(this.armorySource || 'armory'); break;
      case 'workshop': Screen.workshop(); break;
      case 'victory': Screen.victory(); break;
      case 'dead': Screen.dead(); break;
      default: Screen.hide();
    }
  },

  onEnemyKilled(e) {
    this.kills++;
    const KR = e.killer ? e.killer.R : this.runStats;  // 雙人：擊殺算在打出最後一擊的人身上
    if (KR) KR.kills++;
    const big = e.type === 'brute' || e.type === 'elite';
    if (!this.isClient()) this.infectBurst(e);
    burst(e.x, e.y, e.t.color, big ? 40 : 16, big ? 320 : 220, 0.6, 2.5);
    SFX.play(e.t.boss ? 'bossdeath' : big ? 'bigkill' : 'kill');
    if (big) this.shake(e.type === 'elite' ? 14 : 6);
    if (e.t.boss) {  // 母艦爆炸：清除所有小怪與敵彈
      this.shake(28);
      burst(e.x, e.y, e.t.color, 150, 600, 1.4, 3.5);
      burst(e.x, e.y, '#ffd166', 80, 400, 1.2, 3);
      for (const o of this.enemies) if (o !== e && !o.dead) { o.dead = true; burst(o.x, o.y, o.t.color, 10, 200, 0.5, 2); }
      this.eBullets = [];
      this.banner = { text: '旗艦擊沉！', t: 2 };
    }
    let n = e.t.credits;
    for (let i = 0; i < e.t.credits; i++) if (Math.random() < this.passives.greed) n++;
    for (let i = 0; i < n; i++)
      this.pickups.push({ id: this.nextId++, x: e.x + rand(-8, 8), y: e.y + rand(-8, 8), vx: rand(-80, 80), vy: rand(-80, 80), life: 14 });
    if (e.type === 'elite' && this.combat.sandbox && COMPOSITE_IDS.length) {
      const i = this.inventory.indexOf(null), id = pick(COMPOSITE_IDS);
      if (i >= 0) { this.inventory[i] = id; this.recalc(); floatText(e.x, e.y - 30, `獲得 ${CHIPS[id].name}`, '#ff9f1c', true); }
    }
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
    if (T.thick) dmg = Math.min(dmg, p.maxHp * 0.2);  // 厚甲
    if (M.module === 'endshell' && !p.shellUsed && p.hp - dmg <= 0) {  // 終焉護殼：留 1 HP
      p.shellUsed = true; dmg = Math.max(0, p.hp - 1); p.iframe = 2;
      floatText(p.x, p.y - 30, '終焉護殼', '#2ee6a6', true);
    }
    p.hp -= dmg; p.iframe = Math.max(p.iframe, CFG.IFRAME + (T.deflect ? 0.3 : 0)); p.calm = 0;
    this.withLoadout(p.L, () => this.onPlayerHurt(p, sx, sy));
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
    SFX.play(p.hp <= 0 ? 'death' : 'hurt');
    if (p.hp <= 0 && this.mode === 'coop') { this.playerDown(p); return; }
    if (p.hp <= 0) {
      p.hp = 0; this.state = 'dead'; Input.down = false;
      this.saveRecord('dead');
      burst(p.x, p.y, '#4cc9f0', 80, 400, 1.2, 3);
      this.shake(20);
      setTimeout(() => { if (this.state === 'dead') Screen.dead(); }, 900);
    }
  },

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
  // 物體（子彈、敵彈、飛船）碰到門：從另一個門出來，放在門的前方（照移動方向）免得馬上又碰到；cd 秒內不能再走
  portalHop(o, r, cdKey, cd, dirA = null) {
    if (!this.portals.length || this.time < (o[cdKey] || 0)) return false;
    for (const q of this.portals) {
      for (const [x1, y1, x2, y2] of [[q.ax, q.ay, q.bx, q.by], [q.bx, q.by, q.ax, q.ay]]) {
        if (dist2(o.x, o.y, x1, y1) > (22 + r) ** 2) continue;
        const a = dirA != null ? dirA : Math.atan2(o.vy || 0, o.vx || 0), k = 22 + r + 2;
        o.x = x2 + Math.cos(a) * k; o.y = y2 + Math.sin(a) * k;
        o[cdKey] = this.time + cd;
        burst(x2, y2, q.color, 6, 120, 0.25, 2);
        return true;
      }
    }
    return false;
  },
  portalShip(p) { if (this.portalHop(p, p.r, 'portalT', 0.6)) { p.px = p.x; p.py = p.y; } },

  // ---------- 機體成長線（零件、背包模組）：房主執行，隊友的飛船用隊友的配裝 ----------
  maxHpOf(ship, P, M) { return Math.max(20, Math.round((ship.hp + P.maxHp + M.maxHp) * M.hpMul)); },
  mechOf(p) { return p.L ? p.L.mech : this.mech; },
  // 被打到之後：反擊裝甲、反應裝甲（在打到的那個人的配裝下執行）
  onPlayerHurt(p, sx, sy) {
    const M = this.mech;
    if (M.traits.counter) {  // 朝打你的方向回射 8 發
      const a = sx != null ? Math.atan2(sy - p.y, sx - p.x) : p.aim, w = this.wp;
      const list = Array.from({ length: 8 }, (_, i) => shot({ angle: (i / 7 - 0.5) * 0.8, speed: w.speed, damage: w.damage, radius: w.radius,
        life: Math.max(0.5, w.life), color: '#b8d4ff', shape: w.shape === 'blade' ? 'dot' : w.shape, src: 'ship' }));
      spawnShots(list, p.x, p.y, a, 0, null);
    }
    if (M.module === 'reactive') this.explode(p.x, p.y, M.heavy ? 180 : 120, 30, '#ff9f1c', null, { src: 'ship', cr: null, owner: this.shooter || null });
  },
  // 背包模組的持續效果（每幀，房主）：護盾回復、修復無人機、重力井、星噬核心
  tickModules(p, dt) {
    const M = this.mech, mod = M.module;
    p.calm = (p.calm || 0) + dt;
    if (mod === 'shield') {
      const max = M.heavy ? 2 : 1;
      if (p.shield < max) { p.shieldT = (p.shieldT || 0) + dt; if (p.shieldT >= (M.light ? 4 : 8)) { p.shield++; p.shieldT = 0; } }
      else p.shieldT = 0;
    } else p.shield = 0;
    if (mod === 'drone' && p.calm >= (M.light ? 3 : 5)) p.hp = Math.min(p.maxHp, p.hp + (M.heavy ? 16 : 8) * dt);
    if (mod === 'gravity' && (p.gravT -= dt) <= 0) {  // 每 6 秒把周圍敵人吸到飛船前方
      p.gravT = 6;
      const px = clamp(p.x + Math.cos(p.aim) * 150, 0, CFG.WORLD_W), py = clamp(p.y + Math.sin(p.aim) * 150, 0, CFG.WORLD_H), R = M.light ? 320 : 220;
      for (const e of this.enemies) {
        if (e.dead || e.t.boss || e.spawnT > 0 || dist2(e.x, e.y, p.x, p.y) > R * R) continue;
        const d = Math.hypot(px - e.x, py - e.y) || 1;
        e.vx += (px - e.x) / d * Math.min(900, d * 5); e.vy += (py - e.y) / d * Math.min(900, d * 5);
      }
      if (this.rings.length < 40) this.rings.push({ x: px, y: py, r: R, life: 0.5, max: 0.5, color: '#b388ff' });
      if (Net.role === 'host') Net.fx(['r', Math.round(px), Math.round(py), R, '#b388ff']);
    }
    if (mod === 'swarmcore' && (p.coreT -= dt) <= 0) {  // 每 5 秒朝四周放出 12 發
      p.coreT = 5;
      const w = this.wp, list = Array.from({ length: 12 }, (_, i) => shot({ angle: i / 12 * TAU, speed: Math.min(700, w.speed), damage: w.damage,
        radius: w.radius, life: 0.8, color: '#ff4d6d', shape: w.shape === 'blade' ? 'dot' : w.shape, src: 'ship' }));
      spawnShots(list, p.x, p.y, 0, 0, null);
    }
  },
  // 每場戰鬥開始時重置的機體狀態
  resetMechCombat(p) {
    p.shield = 0; p.shieldT = 0; p.calm = 0; p.gravT = 6; p.coreT = 5; p.shellUsed = false; p.noFireT = 0; p.quenchT = 0;
    p.portalCd = 0; p.pullV = null;
  },
  // 零件：加 1 層（零件格滿了就不行）、換零件（改裝廠）
  addPart(id) {
    if (!PARTS[id] || partsUsed(this.parts) >= this.partSlots) return false;
    this.parts[id] = (this.parts[id] || 0) + 1;
    this.recalc();
    if (this.runStats) this.runStats.got.push(`${this.here()} 零件 ${PARTS[id].name}（${this.parts[id]} 層）`);
    return true;
  },
  swapPart(from, to) {
    if (!PARTS[from] || !PARTS[to] || from === to || !(this.parts[from] > 0) || this.credits < PART_SWAP_PRICE) return false;
    this.pay(PART_SWAP_PRICE, () => {
      this.parts[from]--; this.parts[to] = (this.parts[to] || 0) + 1;
      this.recalc();
      if (this.runStats) this.runStats.got.push(`${this.here()} 改裝：${PARTS[from].name} → ${PARTS[to].name}`);
    });
    return true;
  },
  setModule(id) {
    const old = this.module;
    this.module = MODULES[id] ? id : null;
    this.recalc();
    if (this.runStats && id) this.runStats.got.push(`${this.here()} 背包模組 ${MODULES[id].name}${old ? `（取代 ${MODULES[old].name}）` : ''}`);
  },

  // 雙人：一方被擊墜 → 等隊友；兩人都被擊墜 → 結束（房主判定）
  playerDown(p) {
    p.hp = 0; p.dead = true;
    burst(p.x, p.y, p.ship.color, 80, 400, 1.2, 3);
    if (this.players().length) {
      this.banner = { text: `${p === this.player ? '1P' : '2P'} 被擊墜！`, sub: `隊友靠近倒下的位置 ${CFG.REVIVE.time} 秒可以救起來`, t: 2.5 };
      return;
    }
    this.state = 'dead'; Input.down = false;
    // 結束訊息帶上隊友的最終血量與擊毀原因（最後一次同步可能還沒送到）；先送最終傷害統計
    Net.sendDmg();
    Net.send({ t: 'over', wave: this.combat.wave, cause: this.mate ? this.mate.lastHit || '' : '' });
    this.saveRecord('dead');
    setTimeout(() => { if (this.state === 'dead') Screen.dead(); }, 900);
  },
  // 雙人救援（房主判定）：倒下的人留在原地，活著的隊友待在範圍內累積秒數，離開就慢慢退回
  updateRevive(dt) {
    const R = CFG.REVIVE;
    for (const [p, q] of [[this.player, this.mate], [this.mate, this.player]]) {
      if (!p || !q || !p.dead) continue;
      const near = !q.dead && !q.gone && dist2(p.x, p.y, q.x, q.y) < R.range * R.range;
      p.reviveT = near ? p.reviveT + dt : Math.max(0, p.reviveT - dt);
      if (p.reviveT >= R.time) this.revivePlayer(p, q);
    }
  },
  revivePlayer(p, q) {  // 救的人分出自己當前一半的血量
    const give = q.hp / 2, tag = x => (x === this.player ? '1P' : '2P');  // 只在房主執行：自己是 1P
    q.hp -= give;
    p.hp = give; p.dead = false; p.reviveT = 0; p.iframe = CFG.REVIVE.iframe;
    this.banner = { text: `${tag(p)} 救援成功！`, sub: `${tag(q)} 分出 ${Math.ceil(give)} HP`, t: 2 };
    burst(p.x, p.y, '#9dff6b', 40, 260, 0.8, 3);
    SFX.play('clear');
  },

  // ---------- 主更新 ----------
  update(dt) {
    if (Net.role === 'client' && this.mode === 'coop') { Net.clientUpdate(dt); return; }
    const frozen = !!Net.pauseReason();  // 雙人：隊友在編輯電路、切到其他視窗、斷線重連中 → 全員暫停
    if (this.state === 'play' && this.mate && !frozen) Net.hostUpdateMate(dt);
    if (this.state === 'play' && !frozen) {
      this.time += dt;
      if (this.runStats) this.runStats.time += dt;  // 只算實際戰鬥的時間
      if (!this.player.dead) this.player.update(dt);
      this.updateWaves(dt);
      this.updateEnemies(dt);
      for (const p of this.players()) this.withLoadout(p.L, () => this.tickModules(p, dt));
      Objects.update(dt);
      this.updatePortals(dt);
      this.updateBullets(dt);
      this.updateEnemyBullets(dt);
      this.updatePickups(dt);
      if (this.mate) this.updateRevive(dt);
    }
    if (this.state === 'play' || this.state === 'dead') this.updateFx(dt);
    if (this.inArena && this.state !== 'editor') this.updateCamera(dt);
    if (!this.inArena) { this.cam.x += dt * 20; this.cam.y += dt * 8; }
    if (Net.role === 'host' && this.mode === 'coop') Net.hostSend(dt);
  },
  updateEnemies(dt) {
    const E = this.enemies;
    for (const e of E) {
      if (e.stickT > 0 && (e.stickT -= dt) <= 0) this.detonate(e);  // 黏著的子彈時間到一起爆炸
      if (e.dead) continue;
      e.update(dt, this.nearestPlayer(e.x, e.y));  // 雙人：追最近的玩家
      if (e.spawnT <= 0) for (const p of this.players()) {
        const rr = e.r + p.r;
        if (dist2(e.x, e.y, p.x, p.y) >= rr * rr) continue;
        const M = this.mechOf(p);
        if (M.traits.ram) {  // 衝撞（重裝甲 4 層）：撞到的敵人受傷並被撞飛，自己不受碰撞傷害
          if (this.time < (e.ramT || 0)) continue;
          e.ramT = this.time + 0.5;
          const d = Math.hypot(e.x - p.x, e.y - p.y) || 1, k = 520 * (14 / e.r);
          e.hurt(M.armor * 20, (e.x - p.x) / d * k, (e.y - p.y) / d * k, 'shock', { src: 'ship', cr: null, owner: p.L || null }, 3);
          floatText(e.x, e.y - e.r, M.armor * 20, '#ffd166', true);
          continue;
        }
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
    this.enemies = E.filter(e => !e.dead);
  },
  updateBullets(dt) {
    const B = this.bullets, E = this.enemies, Q = this.triggerQueue, SQ = [];
    for (const b of B) {
      if (b.dead) continue;
      b.update(dt);
      if (b.dead || b.mode === 'wait') continue;  // 停滯：停住的子彈不會打到敵人
      if (b.mode !== 'orbit' && this.portalHop(b, b.r, 'portalT', 0.3, b.angle)) { b.px = b.x; b.py = b.y; }
      if (Objects.bulletHit(b)) continue;  // 行星、小行星、彗星
      const orbit = b.mode === 'orbit';
      for (const e of E) {
        if (e.dead) continue;
        if (orbit ? this.time < (b.orbitCd.get(e.id) || 0) : b.hitSet.has(e.id)) continue;  // 環繞：同一隻每 0.3 秒最多打一次
        const rr = b.r + e.r;
        if (segDist2(b.px, b.py, b.x, b.y, e.x, e.y) >= rr * rr) continue;
        if (orbit) b.orbitCd.set(e.id, this.time + 0.3); else b.hitSet.add(e.id);
        // 用量成長：照著晶片的玩法打中敵人
        const own = b.owner;
        if (b.mode === 'return') this.grow(own, 'boomerang');
        if (orbit) this.grow(own, 'orbit');
        if (b.dashed) this.grow(own, 'stasis');
        if (b.accel && b.accelMul >= 1.5) this.grow(own, 'accel');
        if (b.full) this.grow(own, 'charge');
        if (b.rear) this.grow(own, 'rear');
        if (b.dashShot) this.grow(own, 'dashfire');
        if (b.infGen > 0) this.grow(own, 'infect');
        if (b.pull) this.pullAt(b);
        let dmg = b.damage * (b.accel ? b.accelMul : 1);
        if (b.sticky) {  // 黏著：先造成 30%，黏上去的部分之後一起爆炸
          (e.stuck = e.stuck || []).push({ dmg, att: b.att, lv: b.sticky, owner: own });
          if (!(e.stickT > 0)) e.stickT = 2;
          dmg *= 0.3;
        }
        const kb = Math.min(220, dmg * 5) * (14 / e.r) * b.knock;
        e.hurt(dmg, Math.cos(b.angle) * kb, Math.sin(b.angle) * kb, b.shard ? 'shard' : b.depth > 0 ? 'echo' : 'direct', b.att, b.knock);
        if (b.mark) e.markT = 3;  // 弱點標記（感測器 4 層）
        floatText(e.x, e.y - e.r, Math.round(dmg), b.depth > 0 ? '#ff9dbd' : '#ffffff', dmg >= 40);
        burst(b.x, b.y, b.color, 4, 160, 0.25, 2);
        SFX.play('hit');
        // 武器升級帶來的命中效果
        if (b.burn) { e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, b.burn.dps); e.burnT = Math.max(e.burnT, b.burn.t); e.burnAtt = b.att; }
        if (b.slow) { e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, b.slow); e.slowT = 1.5; }
        if (b.lifesteal) this.healPlayer(b.lifesteal, b.owner ? this.mate : this.player);
        if (b.explode) this.explode(b.x, b.y, b.explode.r, b.damage * b.explode.ratio, b.color, e.id, b.att);
        if (b.shards && SQ.length < 60) SQ.push({ x: b.x, y: b.y, angle: b.angle, b, ignore: e.id });
        if (b.arcs) this.arc(e, b);
        if (b.payload && Q.length < CFG.MAX_TRIGGERS_PER_FRAME)
          Q.push({ payload: b.payload, x: b.x, y: b.y, angle: b.angle, depth: b.depth + 1, ignore: e.id, owner: b.owner });
        if (b.sticky) b.dead = true;  // 黏上去了
        else if (b.infPierce) { /* 環繞、迴旋、超音速：不會消失 */ }
        else if (b.pierce > 0) b.pierce--;
        else b.dead = true;
        break;
      }
    }
    this.updateVortices(dt);
    this.updateStasisArcs(dt);
    for (const t of Q) {  // 命中觸發：從命中點展開子管線（用射出這顆子彈的人的武器與電路）
      this.withLoadout(t.owner, () => spawnShots(runOps(t.payload, t.depth), t.x, t.y, t.angle, t.depth, t.ignore));
      burst(t.x, t.y, '#ff6b9d', 6, 140, 0.3, 2);
    }
    Q.length = 0;
    for (const s of SQ) {  // 碎片：從命中點往前方扇形散開
      const { n, ratio, homing = 0 } = s.b.shards, list = [];
      for (let k = 0; k < n; k++)
        list.push(shot({ angle: (k - (n - 1) / 2) * (1.6 / n), speed: 620, damage: s.b.damage * ratio, radius: 3,
          life: 0.4, color: s.b.color, homing, shard: true, src: s.b.att.src, cr: s.b.att.cr }));
      this.withLoadout(s.b.owner, () => spawnShots(list, s.x, s.y, s.angle, s.b.depth, s.ignore));
    }
    this.bullets = B.filter(b => !b.dead);
  },
  // 電弧（軌道砲・磁暴線圈）：命中時瞬間打中附近其他敵人；附近敵人不夠時，剩下的電弧打回目標本身（傷害減半）
  arc(hit, b) {
    const { n, ratio } = b.arcs, R = CFG.ARC_RANGE, dmg = b.damage * ratio;
    const near = this.enemies.filter(o => !o.dead && o !== hit && o.spawnT <= 0 && dist2(o.x, o.y, hit.x, hit.y) < (R + o.r) ** 2)
      .sort((p, q) => dist2(p.x, p.y, hit.x, hit.y) - dist2(q.x, q.y, hit.x, hit.y));
    for (let k = 0; k < n; k++) {
      const t = near[k] || hit, d = near[k] ? dmg : dmg * 0.5;
      if (t.dead) continue;
      if (b.slow) { t.slowAmt = Math.max(t.slowT > 0 ? t.slowAmt : 0, b.slow); t.slowT = 1.5; }
      t.hurt(d, 0, 0, 'arc', b.att);
      floatText(t.x, t.y - t.r, Math.round(d), '#9fe8ff');
      if (this.zaps.length < 60) this.zaps.push({ x1: hit.x, y1: hit.y, x2: t.x + rand(-6, 6), y2: t.y + rand(-6, 6), life: 0.18, max: 0.18 });
      if (Net.role === 'host') Net.fx(['z', Math.round(hit.x), Math.round(hit.y), Math.round(t.x), Math.round(t.y)]);
    }
  },
  // ---------- V2 改玩法的晶片（房主執行） ----------
  // 吸引：命中時把附近的敵人往命中點拉（旗艦不會被拉）；引力漩渦：每命中 8 次生成一個
  pullAt(b) {
    const R = b.pull >= 2 ? 130 : 90;
    let n = 0;
    for (const o of this.enemies) {
      if (o.dead || o.t.boss || o.spawnT > 0) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d > R + o.r || d < 1) continue;
      o.vx += (b.x - o.x) / d * 380; o.vy += (b.y - o.y) / d * 380;
      n++;
    }
    this.grow(b.owner, 'pull', n);
    if (b.pull >= 3) {
      const L = b.owner || this;
      L.pullHits = (L.pullHits || 0) + 1;
      if (L.pullHits % 8 === 0 && this.vortices.length < 12) this.vortices.push({ x: b.x, y: b.y, t: 1.5, r: 140, fx: 0, owner: b.owner });
    }
  },
  updateVortices(dt) {
    for (const v of this.vortices) {
      v.t -= dt; v.fx -= dt;
      for (const o of this.enemies) {
        if (o.dead || o.t.boss || o.spawnT > 0) continue;
        const d = Math.hypot(o.x - v.x, o.y - v.y);
        if (d > v.r || d < 4) continue;
        o.vx += (v.x - o.x) / d * 1600 * dt; o.vy += (v.y - o.y) / d * 1600 * dt;
        if (Math.random() < dt * 2) this.grow(v.owner, 'pull');
      }
      if (v.fx <= 0) {
        v.fx = 0.3;
        if (this.rings.length < 40) this.rings.push({ x: v.x, y: v.y, r: v.r, life: 0.3, max: 0.3, color: '#f78cff' });
        if (Net.role === 'host') Net.fx(['r', Math.round(v.x), Math.round(v.y), v.r, '#f78cff']);
      }
    }
    this.vortices = this.vortices.filter(v => v.t > 0);
  },
  // 伏擊網（停滯 Lv3）：停住的子彈之間拉出電弧，每 0.2 秒傷害碰到的敵人
  updateStasisArcs(dt) {
    this.arcT -= dt;
    if (this.arcT > 0) return;
    this.arcT = 0.2;
    const W = this.bullets.filter(b => !b.dead && b.mode === 'wait' && b.stasis >= 3).slice(0, 120);
    for (let i = 0; i < W.length; i++) for (let j = i + 1; j < W.length; j++) {
      const p = W[i], q = W[j];
      if (dist2(p.x, p.y, q.x, q.y) > 110 * 110) continue;
      if (this.zaps.length < 60) {
        this.zaps.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, life: 0.18, max: 0.18 });
        if (Net.role === 'host') Net.fx(['z', Math.round(p.x), Math.round(p.y), Math.round(q.x), Math.round(q.y)]);
      }
      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        if (segDist2(p.x, p.y, q.x, q.y, e.x, e.y) < (e.r + 5) ** 2) e.hurt(p.damage * 0.4, 0, 0, 'arc', p.att);
      }
    }
  },
  // 黏著：時間到，黏在身上的子彈一起爆炸
  detonate(e) {
    const S = e.stuck || [], n = S.length;
    e.stuck = []; e.stickT = 0;
    if (!n || e.dead) return;
    const lv = S[0].lv, total = S.reduce((a, q) => a + q.dmg, 0) * (lv >= 2 ? 3 : 2), att = S[0].att, x = e.x, y = e.y;
    if (n >= 5) this.grow(S[0].owner, 'sticky');
    const ring = (r, c) => {
      if (this.rings.length < 40) this.rings.push({ x, y, r, life: 0.3, max: 0.3, color: c });
      if (Net.role === 'host') Net.fx(['r', Math.round(x), Math.round(y), Math.round(r), c]);
    };
    ring(e.r + 20 + n * 3, '#f78cff');
    e.hurt(total, 0, 0, 'explode', att);
    floatText(x, y - e.r, Math.round(total), '#f78cff', true);
    SFX.play('explode');
    if (lv >= 3) {  // 連鎖引爆：波及周圍，並立刻引爆鄰近敵人身上的子彈
      for (const o of this.enemies) {
        if (o === e || o.dead || o.spawnT > 0 || dist2(x, y, o.x, o.y) > 90 * 90) continue;
        o.hurt(total * 0.5, 0, 0, 'explode', att);
        if (o.stuck && o.stuck.length) o.stickT = 0.05;
      }
      ring(90, '#f78cff');
    }
  },
  // 感染：被帶感染的子彈（或它造成的燃燒）擊殺的敵人爆出子彈
  infectBurst(e) {
    const A = e.killAtt, inf = A && A.inf;
    if (!inf) return;
    const n = inf.lv >= 2 ? 5 : 3, gen = inf.gen + 1, base = inf.tpl.infBase || inf.tpl.damage;
    const tpl = { ...inf.tpl, damage: base * 1.5, infBase: base, orbit: 0, full: 0, endBoom: false, rear: false, dashShot: false,
      infect: inf.lv >= 3 && gen <= 2 ? inf.lv : 0, infGen: gen, color: '#c6ff8a' };
    const a0 = rand(0, TAU), list = Array.from({ length: n }, (_, k) => ({ ...tpl, angle: a0 + k / n * TAU }));
    this.withLoadout(A.owner, () => spawnShots(list, e.x, e.y, 0, 0, e.id));
  },
  // 擦彈：敵彈從身邊擦過（沒打中）時，朝最近的敵人回射；反射鏡（Lv3）直接吸收敵彈
  graze(p, b) {
    const lv = Game.stats.graze;
    if (!lv || (b.grazed && b.grazed.has(p))) return false;
    const R = p.r + b.r + (lv >= 2 ? 30 : 18), d = dist2(b.x, b.y, p.x, p.y);
    const near = b.near || (b.near = new Map()), prev = near.get(p);
    if (d < R * R) near.set(p, d);
    // 擦過：進入擦彈範圍後開始遠離（最接近的那一刻已經過了）而且沒打中（打中的子彈已經消失）
    if (prev == null || d <= prev) return false;
    (b.grazed = b.grazed || new Set()).add(p);
    const t = nearestEnemy(p.x, p.y, 900, null), list = runSpecial(Game.stats.ops, 'graze');
    if (list.length) spawnShots(list, p.x, p.y, t ? Math.atan2(t.y - p.y, t.x - p.x) : p.aim, 0, null);
    this.grow(Game.shooter || null, 'graze');
    burst(b.x, b.y, '#9dff6b', 5, 120, 0.2, 2);
    if (lv >= 3) b.life = 0;
    return true;
  },
  // 用量成長：owner = 隊友的配裝（房主這邊記在隊友身上，同步給隊友）；null = 自己
  grow(owner, id, n = 1) {
    const g = owner ? owner.growth : this.growth;
    if (!g || !(n > 0)) return;
    g[id] = (g[id] || 0) + n;
    if (!owner) this.checkGrowth();
  },
  // 電路上的晶片累積用量到了就升級（Lv3 進化）。雙人的隊友：房主把累積量傳過來，隊友升級後把新電路傳回去
  checkGrowth() {
    const msgs = [];
    this.chain.forEach((id, i) => {
      const base = baseOf(id), g = id && CHIPS[base] && CHIPS[base].grow;
      if (!g || CHIPS[id].type === 'singularity') return;
      let lv = levelOf(id);
      while (lv < CFG.MAX_CHIP_LV && (this.growth[base] || 0) >= g.need[lv - 1]) lv++;
      if (lv <= levelOf(id)) return;
      this.chain[i] = leveledId(base, lv);
      msgs.push(lv >= CFG.MAX_CHIP_LV ? `${CHIPS[base].name} 進化 → ${CHIPS[base].evo}！` : `${CHIPS[base].name} 升到 Lv${lv}`);
    });
    if (!msgs.length) return;
    this.recalc();
    const p = this.player;
    for (const [k, m] of msgs.entries()) floatText(p.x, p.y - 40 - k * 20, m, '#ffd166', true);
    SFX.play('upgrade');
    if (this.runStats) for (const m of msgs) this.runStats.got.push(`${this.here()} ${m}（用量成長）`);
    if (this.isClient()) Net.sendLoadout();
  },
  explode(x, y, r, dmg, color, skipId, att = null) {
    for (const e of this.enemies) {
      if (e.dead || e.id === skipId) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > r + e.r) continue;
      const k = 120 * (14 / e.r) / (d || 1);
      e.hurt(dmg, (e.x - x) * k, (e.y - y) * k, 'explode', att);
      floatText(e.x, e.y - e.r, Math.round(dmg), '#ffd166');
    }
    Objects.explodeRocks(x, y, r, dmg, att);
    if (this.rings.length < 40) this.rings.push({ x, y, r, life: 0.3, max: 0.3, color });
    if (Net.role === 'host') Net.fx(['r', Math.round(x), Math.round(y), Math.round(r), color]);
    SFX.play('explode');
  },
  healPlayer(v, p = this.player) {  // 吸血：每秒最多回復 4 HP（每位玩家各自計算）
    if (!p || p.dead) return;
    if (this.time - (p.healWin || 0) > 1) { p.healWin = this.time; p.healed = 0; }
    const add = Math.min(v, 4 - p.healed);
    if (add <= 0) return;
    p.healed += add;
    p.hp = Math.min(p.maxHp, p.hp + add);
  },
  updateEnemyBullets(dt) {
    const ps = this.players();
    for (const b of this.eBullets) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      this.portalHop(b, b.r, 'portalT', 0.3);  // 敵彈也會穿門
      if (Objects.eBulletHit(b)) continue;
      for (const p of ps) {
        const rr = b.r + p.r;
        if (dist2(b.x, b.y, p.x, p.y) < rr * rr && !p.invuln && !p.dead) { b.life = 0; this.hurtPlayer(b.dmg, (b.from || '敵人') + '（子彈）', p, b.x - b.vx, b.y - b.vy); break; }
        if (this.withLoadout(p.L, () => this.graze(p, b))) break;
      }
    }
    this.eBullets = this.eBullets.filter(b => b.life > 0);
  },
  updatePickups(dt) {
    for (const c of this.pickups) {
      c.life -= dt;
      const p = this.nearestPlayer(c.x, c.y), range = CFG.MAGNET_RANGE * (1 + this.passivesOf(p).magnet);  // 晶體飛向最近的玩家（雙人：撿到的人和隊友都 +1）
      const d2 = dist2(c.x, c.y, p.x, p.y);
      stepPickup(c, p, range, d2, dt);
      if (d2 < 20 * 20) {
        c.life = 0; this.credits++; SFX.play('pickup');
        if (this.mode === 'coop') Net.lootTotal++;  // 雙人：不管誰撿到，隊友也 +1（透過同步傳過去）
      }
    }
    this.pickups = this.pickups.filter(c => c.life > 0);
  },
  updateFx(dt) {
    for (const q of this.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.94; q.vy *= 0.94; q.life -= dt; }
    this.particles = this.particles.filter(q => q.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter(r => r.life > 0);
    for (const z of this.zaps) z.life -= dt;
    this.zaps = this.zaps.filter(z => z.life > 0);
    for (const t of this.texts) { t.y -= 40 * dt; t.life -= dt; }
    this.texts = this.texts.filter(t => t.life > 0);
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
  },
  updateCamera(dt) {
    const p = this.player.dead && this.mate && !this.mate.dead ? this.mate : this.player, c = this.cam;  // 自己被擊墜時看隊友
    const tx = clamp(p.x - ZW / 2, -80, CFG.WORLD_W - ZW + 80);
    const ty = clamp(p.y - ZH / 2, -80, CFG.WORLD_H - ZH + 80);
    c.x += (tx - c.x) * Math.min(1, dt * 8);
    c.y += (ty - c.y) * Math.min(1, dt * 8);
    c.shake = Math.max(0, c.shake - dt * 40);
  },
};
