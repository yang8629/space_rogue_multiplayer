// 星環電路 雙人版 · game.js：Game：一局的流程、戰鬥、獎勵、商店、黑洞（強化格子）、傷害、主更新
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// GAME
// =====================================================================
// 吸引：被拉的敵人往中心的速度（同時被拉很多次也只到這個速度）
const PULL_V = 380;

const Game = {
  state: 'title', returnState: null, mode: null,
  chain: [], socks: [], inventory: [], slotAttr: [], credits: 0,  // socks[i]：插在第 i 格晶片上的組件
  stats: null, passives: computePassives([]),
  map: null, node: null, visited: [], combat: null, inArena: false,
  cam: { x: 0, y: 0 },
  stars: [], bullets: [], enemies: [], eBullets: [], pickups: [], triggerQueue: [], zones: [], flames: [], links: [], quakes: [], trails: [],
  weapon: { id: 'laser', path: null, final: null }, wp: null,
  time: 0, nextId: 1,
  // 雙人：mate = 隊友的飛船（房主這邊是真的模擬對象，隊友那邊只是畫出來的影子）
  //   mate.L = 隊友的配裝（電路、倉庫、武器…），房主算隊友的子彈時用 withLoadout 暫時換上
  mate: null, shooter: null,
  // V2 晶片：各晶片的累積用量（成長）、開火模式（衝刺射擊／擦彈）、目前的蓄力、引力漩渦
  parts: {}, module: null, partSlots: 6, mech: mechStats({}, null), objs: [], portals: [],
  growth: {}, fireMode: null, chargeC: null, heatC: null, standFull: false, vortices: [], pullHits: 0, arcT: 0,

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
  coopOn() { return this.mode === 'coop' && !!this.mate && !this.mate.gone; },  // 雙人而且隊友在線（離線時敵人數量、血量、成長需求都恢復單人）
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
    this.socks = mode === 'sandbox' ? [['split']] : [];
    this.inventory = mode === 'sandbox' || mode === 'range' ? Array(CFG.INV_SLOTS).fill(null) : startInv(startChip);  // 起始晶片是組件 → 放倉庫
    this.growth = {}; this.pullHits = 0; this.slotAttr = []; this.playDry = false; this.mechN = 0;  // mechN：這一局拿了幾個機體強化  // playDry：上一次三選一沒有玩法晶片（下一次保底）
    this.wSock = this.freePlay() ? CFG.WEAPON_SOCKETS : CFG.START_WSOCK;  // 武器插座：每打完一隻王 +1；slotAttr：奇異點強化過的電路格（index 跟 chain 一樣）
    this.parts = { ...S.parts }; this.module = null; this.partSlots = S.partSlots;  // 機體成長線：開局零件由飛船決定
    this.credits = this.freePlay() ? 999 : 0;
    this.player = new Player(S);
    this.map = mode === 'run' || (mode === 'coop' && Net.role === 'host') ? genMap() : null;  // 雙人：星圖由房主產生後傳給隊友
    this.node = null; this.visited = []; this.sector = 1; this.bossId = this.bossFor(1);
    this.runStats = { dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])), chips: {}, kills: 0, maxHit: 0, time: 0,
      bosses: [], started: Date.now(), recorded: false,
      // 遊玩紀錄用的判斷資料：受到的傷害來源、被打中次數、衝刺次數、走過的節點、取得的晶片、武器升級、各關摘要
      taken: {}, hits: 0, dashes: 0, path: [], got: [], upgrades: [], sectors: [],
      perf: { worst: 0, worstAt: '', slow: 0 } };  // 效能：戰鬥中最慢的一幀（ms）、在哪裡、超過 100ms 的幀數
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
  // 現在在哪、場上多少子彈（效能、連線卡頓的紀錄用）
  whereNow() { const C = this.combat; return `${this.here()}${C && this.inArena ? ` 第${C.wave}波` : ''}・子彈${this.bullets.length + this.eBullets.length}`; },
  // 每幀（main.js）：戰鬥中這一幀花了 ms 毫秒；超過 2 秒的不算（切到別的分頁回來）
  notePerf(ms) {
    const R = this.runStats;
    if (!R || !R.perf || this.state !== 'play' || !this.inArena || ms > 2000) return;
    if (ms > 100) R.perf.slow++;
    if (ms > R.perf.worst) { R.perf.worst = Math.round(ms); R.perf.worstAt = this.whereNow(); }
  },
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
    this.view(toast);
  },
  // 畫面：照目前的 state 顯示對應的畫面（怎麼畫由 ui/listeners.js 決定）；msg：畫面上的提示文字
  view(msg = '') { Events.emit('view', { state: this.state, msg }); },
  enterNode(node) {
    if (!this.reachable().includes(node)) return;
    this.node = node; this.visited.push(node.id);
    const L = node.L, level = L + (this.sector - 1) * 7;  // 每個星區難度往上疊
    this.logNodeStart(node);
    switch (node.type) {
      // 一般戰：第 1 星區前 3 層 2 波，之後都是 3 波（新星區開頭不會比上一個星區結尾少）
      case 'combat': this.startCombat({ level, wavesTotal: 2 + (L >= 3 || this.sector > 1 ? 1 : 0), elites: 0 }); break;
      case 'elite':  this.startCombat({ level, wavesTotal: 2, elites: 1 }); break;
      case 'boss':   this.startCombat({ level, wavesTotal: 1, elites: 0, boss: true }); break;
      case 'shop':   this.openShop(); break;
      case 'blackhole': this.openBlackhole(); break;  // 航圖節點「奇異點」（程式代號沿用 blackhole）
      case 'workshop': this.openWorkshop(); break;
      case 'armory': this.state = 'armory'; this.armorySource = 'armory'; this.view(); break;
      case 'repair': {
        const p = this.player, heal = Math.round(p.maxHp * CFG.REPAIR_RATIO);
        p.hp = Math.min(p.maxHp, p.hp + heal);
        this.showMap(`維修完成：HP +${heal}`);
        break;
      }
    }
  },

  // ---------- 戰鬥 ----------
  startCombat(cfg) {
    this.combat = Object.assign({ wave: 0, waveTimer: 1.2, pending: [], spawnClock: 0, cleared: false, clearT: 0,
      wavesTotal: Infinity, elites: 0 }, cfg);
    this.bullets = []; this.enemies = []; this.eBullets = []; Events.emit('fxClear');
    for (const q of this.players()) if (q) q.drRec = 0;  // 修復無人機的可回復量每場重算
    this.pickups = []; this.triggerQueue = []; this.vortices = []; this.portals = []; this.zones = []; this.flames = []; this.links = []; this.quakes = []; this.trails = [];
    this.kills = 0; this.nextId = 1; this.exit = null;
    // 大地圖：一般戰、精英戰分區；旗艦戰一區、形狀照王（雙人：隊友收到種子才產生，之前先用方形場地）
    if (this.isClient()) Arena.reset();
    else if (this.usesAreas()) Arena.gen(randInt(1, 2 ** 31 - 2), this.combat.wavesTotal, this.areaScale(this.combat.level));
    else if (this.combat.boss && !this.combat.sandbox) Arena.genBoss(randInt(1, 2 ** 31 - 2), this.bossId);
    else Arena.reset();
    if (Net.stats) Net.stats.lastRecv = 0;  // 同步間隔從這場戰鬥重新算（不把航圖、商店的時間算進去）
    this.player.resetPos();
    // 雙人：房主在左、隊友在右（隊友的位置由隊友自己的電腦決定）
    if (Net.role === 'host') this.player.x -= 50;
    if (Net.role === 'client') this.player.x += 50;
    if (this.mate) { this.mate.resetPos(); this.mate.x += Net.role === 'host' ? 50 : -50; this.mate.dead = false; }
    this.player.dead = false;
    for (const p of [this.player, this.mate]) if (p) this.resetMechCombat(p);
    this.objs = this.isClient() ? [] : Objects.gen(this.combat, this.node);
    if (!this.combat.boss && !this.combat.sandbox && !this.combat.range) this.combat.themes = this.pickThemes(this.sector, !!this.node && this.node.L >= 3);  // 地圖物件（雙人：房主產生，隨同步傳給隊友）
    this.cam.x = this.player.x - ZW / 2; this.cam.y = this.player.y - ZH / 2;
    Input.down = false; Input.dash = false; Input.joy = null; Input.aimStick = null;
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
    this.inArena = true; this.state = 'play';
    this.view();
  },
  // 區域大小照難度縮放：前面敵人少，地圖小一點（第 1 星區 0.72～0.84、第 2 星區 0.86～0.98、之後 1）
  areaScale(level) { return clamp(0.7 + 0.02 * (level || 0), 0.7, 1); },
  startWave(n) {
    const C = this.combat;
    C.wave = n;
    if (C.boss) {
      C.pending = [this.bossId];
      bannerFx(`♛ ${ENEMY_TYPES[this.bossId].name}`, '守關旗艦接近中', 2.5);
      Events.emit('bossArrive', this.bossId);
      return;
    }
    let budget = (5 + n * 3 + C.level * 3) * CFG.WAVE_MUL * (this.coopOn() ? coopMul(CFG.COOP_COUNT, C.level) : 1);  // 雙人：敵人數量 ×2 → ×2.5（隨難度）
    const list = [], TH = C.sandbox ? this.pickThemes(1 + Math.floor(n / 5), n % 5 >= 3) : C.themes || { list: [], share: 0 };
    while (budget > 0) {
      if (TH.list.length && Math.random() < TH.share) {  // 主題小兵
        const k = pick(TH.list), c = THEMES[k];
        if (budget >= c.cost && !(c.max && list.filter(x => x === k).length >= c.max)) { list.push(k); budget -= c.cost; continue; }
      }
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
    const bText = C.sandbox ? `WAVE ${n}` : this.usesAreas() ? `區域 ${n} / ${C.wavesTotal}` : `WAVE ${n} / ${C.wavesTotal}`;
    Events.emit('waveStart', { n, boss: !!sbBoss });
    bannerFx(bText, sbBoss ? `♛ ${ENEMY_TYPES[sbBoss].name}接近中` : list.includes('elite') ? '⚠ 精英反應接近中' : '', 2);
  },
  // 主題小兵：每場戰鬥抽幾種、佔一波多少比例，都隨進度增加（第 1 星區前半 0～1 種 20% → 第 3 星區 2～3 種 55% → 無盡 3 種以上 65%）
  pickThemes(sector, late) {
    const s = sector;
    const [n, share] = s >= 4 ? [Math.min(5, 3 + Math.floor((s - 4) / 2)), 0.65] : s === 3 ? [randInt(2, 3), 0.55]
      : s === 2 ? [randInt(1, 2), 0.4] : late ? [1, 0.3] : [randInt(0, 1), 0.2];
    const pool = Object.keys(THEMES).filter(k => THEMES[k].from <= Math.min(s, 3));
    return { list: pickN(pool, Math.min(n, pool.length)), share };
  },
  spawnEnemy(type) {
    const C = this.combat, p = this.player, zone = Math.max(0, C.wave - 1);
    let x, y;
    for (let t = 0; t < 30; t++) {
      const a = rand(0, TAU), d = rand(520, 780);
      x = clamp(p.x + Math.cos(a) * d, 40, CFG.WORLD_W - 40);
      y = clamp(p.y + Math.sin(a) * d, 40, CFG.WORLD_H - 40);
      if (!Arena.rect) [x, y] = Arena.spawnPoint(zone, this.players().filter(q => q.zone === zone), 500, 60);  // 大地圖：散在這一波的區域各處（離在這一區的玩家至少 500）
      // 不生在黑洞出不來的範圍：母巢不會動，整個引力範圍都不行；列隊蟲後面 5 節往外排到 110
      const R = type === 'hive' ? OBJ.HOLE_R : OBJ.HOLE_NOESC + (type === 'worm' ? 110 : 0);
      if (!Objects.inHole({ x, y, r: ENEMY_TYPES[type].radius }, R)) break;
    }
    const scale = (C.sandbox ? 1 + (C.wave - 1) * 0.12 : enemyHpMul(C.level, C.wave)) *
      (this.coopOn() ? coopMul(CFG.COOP_HP, C.level) : 1) *  // 雙人：敵人血量 ×1 → ×1.3（隨難度）；隊友離線時恢復單人血量
      (this.isEndless() ? Math.pow(CFG.ENDLESS_HP, this.sector - CFG.CAMPAIGN_SECTORS) : 1);  // 無盡：每個星區血量再 ×1.2（乘算）
    const e = new Enemy(type, x, y, scale);
    if (!Arena.rect) e.zone = zone;
    this.enemies.push(e);
    burst(x, y, e.t.color, 10, 90, 0.5, 2);
    if (type === 'worm') {  // 列隊蟲：再往外排 5 節，每節跟著前一節
      const ux = (x - p.x) / (Math.hypot(x - p.x, y - p.y) || 1), uy = (y - p.y) / (Math.hypot(x - p.x, y - p.y) || 1);
      let prev = e;
      for (let i = 1; i < 6; i++) {
        const w = new Enemy('worm', ...Arena.clampIn(x + ux * 22 * i, y + uy * 22 * i, 20), scale);
        if (!Arena.rect) w.zone = zone;
        w.ahead = prev; prev = w; this.enemies.push(w);
      }
    }
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
        C.cleared = true; C.clearT = this.simFast ? 0 : 1.6;  // simFast：模擬（電腦不用看「區域肅清」）
        bannerFx('區域肅清', '', 1.6);
        Events.emit('areaClear', { last: true });
        return;
      }
      // 一場戰鬥分成幾個區域（一區一波）：清完打開閘門，有人穿過閘門就開始下一區（另一個人之後自己飛過去加入）
      if (C.wave >= 1 && this.usesAreas() && C.exitUsed !== C.wave) {
        if (!this.exit) this.openExit();
        else if (this.players().some(p => p.zone >= C.wave)) this.nextArea();
        return;
      }
      C.waveTimer -= dt;
      if (C.waveTimer <= 0) { C.waveTimer = 2.5; this.startWave(C.wave + 1); }
    }
  },
  // ---------- 區域：一般戰、精英戰分成 2～3 個區域（旗艦戰、沙盒、靶場照舊） ----------
  usesAreas() {
    const C = this.combat;
    return !!C && !C.sandbox && !C.range && !C.boss && isFinite(C.wavesTotal) && C.wavesTotal > 1;
  },
  // 打開這一區的閘門（exit = 閘門中央，畫箭頭、同步用）
  openExit() {
    const g = Arena.gates[this.combat.wave - 1];
    if (!g) { this.combat.exitUsed = this.combat.wave; return; }  // 不該發生（大地圖的閘門數 = 區域數 - 1）：直接開始下一波
    g.open = true;
    this.exit = { x: g.x, y: g.y, r: 40, gate: true };
    bannerFx('區域肅清', '閘門已開啟，穿過閘門前往下一區', 2);
    Events.emit('areaClear', { last: false });
  },
  // 換區：地上的晶體直接收下；倒下的人如果留在後面的區域，搬到新區域的入口（閘門不能回頭，不搬隊友救不到）；下一波照常倒數
  nextArea() {
    const C = this.combat, n = this.pickups.length;
    this.credits += n;
    if (this.mode === 'coop') Net.lootTotal += n;
    this.pickups = [];
    this.exit = null; C.exitUsed = C.wave; C.areaN = (C.areaN || 0) + 1; C.waveTimer = 1.2;
    for (const p of [this.player, this.mate]) if (p && p.dead && !p.gone) this.toEntry(p, C.wave);
  },
  toEntry(p, k) {
    if (Arena.rect || (p.zone || 0) >= k) return;
    const E = Arena.entryOf(k);
    p.x = E.x; p.y = E.y; p.vx = p.vy = 0; p.zone = k;
  },
  combatWon() {
    const client = this.isClient();  // 雙人的隊友：地上剩下的晶體由房主算好數量傳過來
    this.inArena = false;
    const left = client ? 0 : this.pickups.length;
    this.credits += left;  // 沒吸完的晶體直接入帳（雙人時兩人都拿）
    this.pickups = [];
    const p = this.player;
    if (!client) for (const q of this.players()) if (q && !q.dead && q.drRec > 0) { q.hp = Math.min(q.maxHp, q.hp + q.drRec); q.drRec = 0; }  // 修復無人機：沒補完的補回
    if (this.mode === 'coop') Net.afterCombat(left);  // 雙人：被擊墜的人在戰鬥結束後以 30% HP 歸隊，並同步血量
    this.logNodeEnd();  // 先記下戰鬥結果（先鋒號回血之前的 HP）
    Events.emit('combatWon', { boss: this.node.type === 'boss' });
    const type = this.node.type;
    if (type === 'boss') {  // 擊敗旗艦：電路插槽 +1／零件格 +1 二選一（勝利畫面上選）、晶體獎勵，可前往下一星區
      const slot = this.chain.length < CFG.MAX_SLOTS;
      this.credits += 50;  // 雙人：兩人各自拿
      if (!slot) this.partSlots++;  // 電路已滿：沒得選，直接給零件格
      const ws = (this.wSock || CFG.START_WSOCK) < CFG.WEAPON_SOCKETS;
      if (ws) this.wSock = (this.wSock || CFG.START_WSOCK) + 1;  // 武器插座 +1（最多 3）
      this.recalc();
      if (this.runStats) this.runStats.bosses.push(ENEMY_TYPES[this.bossId].name);
      this.victory = { slot, ws, boss: this.bossId, module: bossModuleOf(this.bossId), took: false, pick: slot ? null : 'part' };  // pick：二選一選了哪個（'chain' 電路插槽／'part' 零件格）
      if (this.mode === 'coop' && Net.role === 'host') Net.mateModWait = this.coopOn();  // 雙人：等隊友選好二選一、裝上或略過旗艦模組才能前往
      if (client && bossDone(this.victory)) Net.send({ t: 'moddone' });
      this.state = 'victory';
      this.view();
      return;
    }
    const kind = type === 'elite' ? 'elite' : 'combat';
    this.reward = { kind, options: kind === 'elite' ? pickN(NORMAL_MODULES.filter(id => id !== this.module), 3) : this.rewardOptions(), bonus: kind === 'elite' ? 15 : 0, reroll: this.shopPrice(15),
      slot: kind === 'elite' && this.chain.length < CFG.MAX_SLOTS };  // 精英獎勵多一張「電路擴充」
    this.credits += this.reward.bonus;  // 精英獎勵：雙人時兩人各自拿
    this.state = 'reward';
    this.view();
  },
  // 一般戰鬥獎勵三選一：每一格 30% 是零件（"part:armor"），其他是晶片；不重複
  // 保底：電路有空格時，零件只會出現在最後一格；上一次三選一沒有玩法晶片，這一次一定有（刷新也算一次）
  rewardOptions() {
    const offers = this.chipOffers(), chips = pickN(offers, 3), parts = pickN(PART_IDS, 3), empty = this.chain.includes(null);
    const out = this.withComp([0, 1, 2].map(i => (!empty || i === 2) && Math.random() < 0.3 ? 'part:' + parts[i] : newChip(chips[i])));  // 晶片的插座數在這裡決定
    const isPlay = id => !String(id).startsWith('part:') && !!CHIPS[baseOf(id)].grow;
    if (this.playDry && !out.some(isPlay)) {
      const pool = offers.filter(id => CHIPS[id].grow && !out.some(o => CHIPS[o] && baseOf(o) === id));
      const nComp = out.filter(isComp).length, k = out.findIndex(id => !isComp(id) || nComp > 1);  // 換掉零件、觸發器（或多出來的組件）；保底的那個組件留著
      if (pool.length && k >= 0) out[k] = newChip(pick(pool));
    }
    this.playDry = !out.some(isPlay);
    return out;
  },
  // 至少一格是組件（組件才填得滿插座）：沒抽到就隨機把一格換成組件
  withComp(ids) {
    if (ids.some(id => isComp(id))) return ids;
    const pool = NORMAL_IDS.filter(id => isComp(id) && !ids.includes(id));
    if (pool.length) ids[Math.floor(Math.random() * ids.length)] = pick(pool);
    return ids;
  },
  // 花晶體刷新三選一（第一次 ◆15，之後每次多 ◆10）
  rerollReward() {
    const R = this.reward;
    if (!R || R.kind === 'elite' || this.credits < R.reroll) return;
    this.pay(R.reroll, () => { R.reroll += this.shopPrice(10); R.options = this.rewardOptions(); this.view(); });
  },
  // 獎勵、商店可以出現的晶片：已經有的改玩法晶片不再出現（它們只能靠用量成長升級）
  chipOffers() {
    const own = new Set([...this.chain, ...this.socks.flat(), ...this.inventory].filter(Boolean).map(baseOf));
    return NORMAL_IDS.filter(id => !(CHIPS[id].grow && own.has(id)));
  },
  // ---------- 取得晶片：放進倉庫（不會合成：改玩法的晶片靠用量成長升級，組件、觸發器不會升級） ----------
  canAcquire(id) {
    if (String(id).startsWith('part:')) return partsUsed(this.parts) < this.partSlots;  // 零件：要有空的零件格
    return this.inventory.includes(null);
  },
  acquire(id) {
    if (this.runStats) this.runStats.got.push(`${this.here()} ${CHIPS[id].name}${socketsOf(id) ? `（插座 ${socketsOf(id)}）` : ''}`);
    const i = this.inventory.indexOf(null);
    if (i < 0) return null;
    this.inventory[i] = id;
    this.recalc();
    return `獲得「${CHIPS[id].name}」，已放入倉庫`;
  },
  takeModule(id) {  // 精英獎勵：裝上背包模組（取代目前的）
    if (!MODULES[id]) return;
    this.setModule(id);
    Events.emit('upgrade');
    this.showMap(`裝上背包模組「${MODULES[id].name}」`);  // 背包模組本身就是強化，不算機體強化（不加電路格）
  },
  pickBossSlot(k) {  // 擊沉旗艦的二選一：電路插槽 +1 或零件格 +1
    const V = this.victory;
    if (!V || V.pick || (k !== 'chain' && k !== 'part') || (k === 'chain' && this.chain.length >= CFG.MAX_SLOTS)) return;
    V.pick = k;
    if (k === 'chain') this.chain.push(null); else this.partSlots++;
    this.recalc();
    if (this.runStats) this.runStats.got.push(`${this.here()} ${k === 'chain' ? '插槽 +1' : '零件格 +1'}（旗艦二選一）`);
    Events.emit('upgrade');
    if (this.isClient() && bossDone(V)) Net.send({ t: 'moddone' });
    this.view();
  },
  takeBossModule() {  // 擊沉旗艦：裝上旗艦專屬模組
    const V = this.victory;
    if (!V || V.took || !V.module) return;
    V.took = true;
    this.setModule(V.module);
    Events.emit('upgrade');
    if (this.isClient() && bossDone(V)) Net.send({ t: 'moddone' });
    this.view();
  },
  skipBossModule() {  // 雙人的隊友：不裝旗艦模組（房主才能前往）
    const V = this.victory;
    if (!V || V.took || V.skip) return;
    V.skip = true;
    if (this.isClient() && bossDone(V)) Net.send({ t: 'moddone' });
    this.view();
  },
  // ---------- 改裝廠：零件三選一、付錢換零件 ----------
  openWorkshop() {
    this.ws = { options: pickN(PART_IDS, 3), picked: false, from: null, msg: '' };
    this.state = 'workshop';
    this.view();
  },
  wsPick(id) {
    const W = this.ws;
    if (!W || W.picked || !W.options.includes(id)) return;
    if (!this.addPart(id)) { W.msg = '零件格已滿：可以用「換零件」改成別種'; this.view(); return; }
    W.picked = true; W.msg = `裝上 ${PARTS[id].name}（${this.parts[id]} 層）` + this.mechGain();
    Events.emit('upgrade');
    this.view();
  },
  wsFrom(id) { if (this.ws) { this.ws.from = this.ws.from === id ? null : id; this.view(); } },
  wsTo(id) {
    const W = this.ws;
    if (!W || !W.from) return;
    const from = W.from;
    if (this.swapPart(from, id)) { W.msg = `改裝完成：${PARTS[from].name} → ${PARTS[id].name}`; W.from = null; Events.emit('upgrade'); }
    this.view();
  },
  takeReward(id) {
    let msg;
    if (id && id.startsWith('part:')) {  // 零件
      const k = id.slice(5);
      if (!this.addPart(k)) return;
      Events.emit('upgrade');
      this.showMap(`裝上零件 ${PARTS[k].name}（${this.parts[k]} 層）` + this.mechGain());
      return;
    }
    if (id) {
      msg = this.acquire(id);
      if (!msg) return;
    } else {
      this.earn(10);
      msg = '跳過獎勵：◆ +10';
    }
    // 電路有空格就直接裝上；只有放進倉庫（電路滿了）才打開電路編輯器
    let toInv = false;
    if (id) {
      const j = this.inventory.lastIndexOf(id), slot = this.chain.indexOf(null, 1);
      // 組件：插進武器或電路上還有空插座的晶片
      const h = isComp(id) ? this.chain.findIndex((c, i) => c && (this.socks[i] || []).length < socketsOf(c) && (baseOf(id) !== 'overclock' || i === 0) && (baseOf(c) !== 'pull' || baseOf(id) === 'bigshot')) : -1;  // 不會沒作用的地方才自動插
      if (j >= 0 && h >= 0) { (this.socks[h] = this.socks[h] || []).push(id); this.inventory[j] = null; this.recalc(); msg = `「${CHIPS[id].name}」已插在${CHIPS[this.chain[h]].name}上`; }
      else if (j >= 0 && !isComp(id) && slot > 0) { this.chain[slot] = id; this.inventory[j] = null; this.recalc(); msg = `「${CHIPS[id].name}」已裝上電路第 ${slot + 1} 格`; }
      else toInv = j >= 0;
    }
    this.showMap(msg);
    if (toInv) this.openEditorWith(msg);
  },
  openEditorWith(msg) {
    this.toggleEditor();
    if (this.state === 'editor') Events.emit('editorMsg', { msg, hint: 'newChip' });  // 編輯器上方的說明：新晶片放在倉庫
  },

  // ---------- 商店 ----------
  // 花晶體的價格照星區漲（見 CFG.SHOP_PRICE_UP）：補給站、刷新獎勵、換零件、拆廢鐵
  shopMul() { const k = Math.max(0, this.sector - 1); return 1 + CFG.SHOP_PRICE_UP * k * k; },
  shopPrice(base) { return Math.round(base * this.shopMul()); },
  shopHealHp(p = this.player) { return Math.ceil(p.maxHp * CFG.SHOP_REPAIR.ratio); },
  openShop() {
    const items = this.withComp(pickN(this.chipOffers(), 4).map(id => newChip(id))).map(id => ({ id, price: this.shopPrice(chipPrice(id)), sold: false }));
    if (COMPOSITE_IDS.length && Math.random() < 0.6) { const id = pick(COMPOSITE_IDS); items.push({ id, price: this.shopPrice(chipPrice(id)), sold: false }); }
    this.shop = { items, slotBought: false, healed: false };
    this.state = 'shop';
    this.view();
  },
  shopHeal() {  // 補給站補血：回復最大 HP 的 20%，每間限 1 次
    const p = this.player, price = this.shopPrice(CFG.SHOP_REPAIR.price), hp = this.shopHealHp(p);
    if (this.shop.healed || this.credits < price || p.hp >= p.maxHp) return;
    this.pay(price, () => {
      this.shop.healed = true;
      p.hp = Math.min(p.maxHp, p.hp + hp);
      this.view(`補血完成：HP +${hp}`);
    });
  },
  buy(idx) {
    const it = this.shop.items[idx];
    if (!it || it.sold || this.credits < it.price || !this.canAcquire(it.id)) return;
    this.pay(it.price, () => { it.sold = true; this.view(this.acquire(it.id)); });
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
    Events.emit('upgrade');
    this.showMap(`武器升級：${weaponTitle(st)}`);
  },
  // 電路擴充（插槽 +1）的來源：補給站購買、精英獎勵、武器升滿後的軍械台、擊敗 Boss
  expandSlot(source) {
    if (this.chain.length >= CFG.MAX_SLOTS) return;
    if (source === 'shop') {
      const price = this.shopPrice(CFG.SHOP_SLOT);
      if (this.credits < price || this.shop.slotBought) return;
      this.pay(price, () => { this.shop.slotBought = true; this.addSlot(source); });
      return;
    }
    this.addSlot(source);
  },
  addSlot(source) {
    this.chain.push(null);
    this.recalc();
    Events.emit('upgrade');
    if (this.runStats) this.runStats.got.push(`${this.here()} 插槽 +1（${{ shop: '補給站', reward: '精英獎勵', armory: '軍械台' }[source] || source}）`);
    const msg = `電路擴充：插槽 +1（目前 ${this.chain.length} 格）`;
    if (source === 'shop') this.view(msg);
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
    else {
      this.bossId = this.bossFor(this.sector); this.map = genMap();
      // 武器都已經升滿（雙人：兩人都升滿）就不再出現軍械台，改成戰鬥
      const maxed = W => W && W.final != null;
      if (maxed(this.weapon) && (!this.mate || maxed(this.mate.L && this.mate.L.weapon)))
        for (const n of this.map.flat()) if (n.type === 'armory') n.type = 'combat';
    }
    this.node = null; this.visited = [];
    if (this.mode === 'coop' && Net.role === 'host') Net.sendSector();
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3));
    this.showMap(this.sector === CFG.CAMPAIGN_SECTORS + 1
      ? `進入無盡模式：星區 ${this.sector}，船體修復 30%。旗艦改為隨機出現`
      : `進入星區 ${this.sector}：船體修復 30%，敵人更強了`);
  },
  // ---------- 戰鬥中的選單（Esc／手機的「選單」鈕）：繼續、離開遊戲（離開 = 中途結束，存紀錄、顯示結算） ----------
  togglePauseMenu(open = !this.pauseMenu) {
    this.pauseMenu = open;
    Input.down = false; Input.dash = false; Input.dashHeld = false; Input.joy = null; Input.aimStick = null;
    this.view();  // 戰鬥中：開著選單就畫選單，沒開就收起畫面
  },
  quitRun() {
    this.pauseMenu = false;
    if (this.freePlay()) { this.state = 'title'; this.inArena = false; this.view(); return; }  // 靶場、沙盒：沒有結算，直接回標題
    this.saveRecord('retired');
    this.state = 'ended'; this.inArena = false;
    this.view();
    if (this.mode === 'coop') Net.leave();  // 雙人：自己離開，隊友可以一個人繼續（跟隊友離線一樣）
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
    this.view();
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
    // 晶片名稱＋插座數（◇2）；電路格另外標奇異點強化的屬性
    const name = id => id ? CHIPS[id].name + (isHost(id) && id !== 'weapon' ? '◇' + socketsOf(id) : '') : null, A = this.slotAttr || [];
    const withSock = (id, i) => id && (this.socks[i] || []).length ? `${name(id)}［${this.socks[i].map(c => CHIPS[c].name).join('、')}］` : name(id);
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
      chipDmg: chips, chain: this.chain.map((id, i) => A[i] ? (withSock(id, i) || '空') + '｛' + SLOT_ATTRS[A[i]].name + '｝' : withSock(id, i)), inv: this.inventory.filter(Boolean).map(name),
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
      perf: R.perf ? { ...R.perf } : null,
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
  // ---------- 奇異點：投入 1 個晶片，隨機一個還沒強化過的電路格（武器格也可以）抽一個屬性 ----------
  //   好結果的機率照投入晶片的等級（BH_GOOD）；屬性留在格子上（換晶片也還在），每格只能強化一次
  ownedFusable() {  // 電路、倉庫、插座中可以投入奇異點的晶片
    const out = [];
    this.chain.forEach((id, i) => { if (i > 0 && canSacrifice(id)) out.push({ key: 'chain:' + i, arr: this.chain, i, id }); });
    this.inventory.forEach((id, i) => { if (canSacrifice(id)) out.push({ key: 'inv:' + i, arr: this.inventory, i, id }); });
    this.socks.forEach((S, h) => (S || []).forEach((id, k) => out.push({ key: `sock:${h}:${k}`, arr: S, i: k, id, sock: h })));
    return out;
  },
  bhFreeSlots() { return this.chain.map((_, i) => i).filter(i => !(this.slotAttr || [])[i]); },  // 武器格也可以
  openBlackhole() {
    this.bh = { sel: null, result: null };
    this.state = 'blackhole';
    this.view();
  },
  bhToggle(key) {
    this.bh.sel = this.bh.sel === key ? null : key;
    this.view();
  },
  bhFuse() {
    const a = this.ownedFusable().find(o => o.key === this.bh.sel), free = this.bhFreeSlots();
    if (!a || !free.length) return;
    const good = Math.random() < BH_GOOD[Math.min(levelOf(a.id), 3) - 1];
    const attr = pick(good ? GOOD_ATTRS : BAD_ATTRS), slot = pick(free);
    if (this.runStats) this.runStats.got.push(`${this.here()} 奇異點 投入${CHIPS[a.id].name} → 第 ${slot + 1} 格${SLOT_ATTRS[attr].name}`);
    if (a.arr === this.chain) for (const c of this.socks[a.i] || []) { const k = this.inventory.indexOf(null); if (k >= 0) this.inventory[k] = c; }  // 投入電路上的晶片：插座上的組件退回倉庫（放不下的一起被吞掉）
    if (a.arr === this.chain) this.socks[a.i] = [];
    if (a.sock != null) a.arr.splice(a.i, 1); else a.arr[a.i] = null;
    this.slotAttr = this.slotAttr || [];
    this.slotAttr[slot] = attr;
    this.recalc();
    this.bh = { sel: null, result: { good, attr, slot, chip: CHIPS[a.id].name }, fusing: true };
    this.view();
    Events.emit('fuseStart');
    setTimeout(() => {
      if (this.state !== 'blackhole') return;
      this.bh.fusing = false;
      Events.emit('fuseEnd', { good });
      this.view();
    }, 1200);
  },

  // ---------- 共用 ----------
  recalc() {
    this.mech = mechStats(this.parts, this.module, this.wp);  // 先算機體：估算 DPS 會用到（玻璃砲看受到的傷害、重量砲看移動速度）
    this.stats = analyzeChain(this.chain);
    this.passives = computePassives(this.inventory);
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
      Events.emit('editor', { open: false });
      this.recalc();
      if (this.mode === 'range') Range.clearStats();  // 靶場：改完電路重新計算
      if (this.mode === 'coop') {
        Net.sendLoadout();
        if (this.state === 'play') Net.setEditing(false);
        if (this.state === 'map') { Net.checkVoteTimer(); Net.tryResolve(); }  // 時間到的情況由 Net.tick 處理
      }
      if (this.state === 'blackhole') this.bh.sel = [];
      this.view();
    } else if (['play', 'map', 'reward', 'shop', 'blackhole', 'armory', 'workshop'].includes(this.state)) {
      this.returnState = this.state;
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
  restoreScreen() {  // 依目前狀態重畫對應的畫面（機制檢查跑完後用）；開著編輯器時畫底下那一頁
    Events.emit('view', { state: this.state === 'editor' ? this.returnState : this.state, msg: '' });
  },

  onEnemyKilled(e) {
    this.kills++;
    const KR = e.killer ? e.killer.R : this.runStats;  // 雙人：擊殺算在打出最後一擊的人身上
    if (KR) KR.kills++;
    const big = e.type === 'brute' || e.type === 'elite';
    if (!this.isClient()) {
      this.infectBurst(e); this.payGrowTags(e); this.onStreakKill(e); this.onReloadKill(e);
      if (e.wild && e.burnT > 0) {  // 野火：燒著死掉 → 火噴到附近所有敵人
        const R = e.wild.deathR;
        for (const o of enemiesNear(e.x, e.y, R)) if (o !== e && !o.dead && !(o.spawnT > 0) && dist2(o.x, o.y, e.x, e.y) < R * R) this.igniteFrom(e, o);
        ringFx(e.x, e.y, R, '#ff9f1c');
      }
      if (e.type === 'splitter') for (let i = 0; i < 3; i++) {  // 分裂體：分成 3 隻碎裂體
        const a = i / 3 * TAU + rand(0, 1), k = new Enemy('splitling', ...Arena.clampIn(e.x + Math.cos(a) * 20, e.y + Math.sin(a) * 20, 20), e.hpScale);
        k.zone = e.zone; k.spawnT = 0.15; k.vx = Math.cos(a) * 200; k.vy = Math.sin(a) * 200; this.enemies.push(k);
      }
    }
    burst(e.x, e.y, e.t.color, big ? 40 : 16, big ? 320 : 220, 0.6, 2.5);
    Events.emit('enemyKilled', { e, big });
    if (big) this.shake(e.type === 'elite' ? 14 : 6);
    if (e.t.boss) {  // 母艦爆炸：清除所有小怪與敵彈
      this.shake(28);
      burst(e.x, e.y, e.t.color, 150, 600, 1.4, 3.5);
      burst(e.x, e.y, '#ffd166', 80, 400, 1.2, 3);
      for (const o of this.enemies) if (o !== e && !o.dead) { o.dead = true; burst(o.x, o.y, o.t.color, 10, 200, 0.5, 2); }
      this.eBullets = [];
      bannerFx('旗艦擊沉！', '', 2);
    }
    const base = e.summoned ? 0 : e.t.credits;  // 旗艦叫出來的小怪不掉晶體
    let n = base;
    for (let i = 0; i < base; i++) if (Math.random() < this.passives.greed) n++;
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
      this.onRevenge(p);  // 逆襲：護盾擋下也算受傷（無傷連殺不歸零）
      burst(p.x, p.y, '#4cc9f0', 14, 200, 0.35, 2); floatText(p.x, p.y - 26, '護盾', '#4cc9f0');
      return;
    }
    dmg *= (1 - Math.min(0.6, this.passivesOf(p).armor)) * M.taken;
    const RV = this.wpOf(p).revenge;
    if (RV && !(p.revengeT > 0)) dmg *= RV.first;  // 逆襲（散彈升級）：沒開時被打中，那一下減半（挨一下換爆發）
    if (this.isEndless()) dmg *= Math.pow(CFG.ENDLESS_DMG, this.sector - CFG.CAMPAIGN_SECTORS);  // 無盡：每過一個星區，受到的傷害 ×1.25（乘算）
    if (T.thick) dmg = Math.min(dmg, p.maxHp * 0.2);  // 厚甲
    if (M.module === 'endshell' && !p.shellUsed && p.hp - dmg <= 0) {  // 終焉護殼：留 1 HP
      p.shellUsed = true; dmg = Math.max(0, p.hp - 1); p.iframe = 2;
      floatText(p.x, p.y - 30, '終焉護殼', '#2ee6a6', true);
    }
    if (this.mode === 'range' && p.hp - dmg <= 0) { p.hp = p.maxHp; p.iframe = 1; floatText(p.x, p.y - 26, '靶場：回滿', '#9dff6b', true); return; }  // 靶場實戰：不會死
    p.hp -= dmg; p.iframe = Math.max(p.iframe, CFG.IFRAME + (T.deflect ? 0.8 : 0)); p.calm = 0;
    if (dmg > 0) { this.onRevenge(p); p.streak = 0; }  // 逆襲開始；無傷連殺歸零
    if (M.module === 'drone' && dmg > 0) p.drRec = Math.min(p.maxHp * CFG.DRONE_CAP, (p.drRec || 0) + dmg * CFG.DRONE_SHARE);  // 修復無人機：這次傷害的一半之後可以補回來
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

  // ---------- 機體成長線（零件、背包模組）：房主執行，隊友的飛船用隊友的配裝 ----------
  maxHpOf(ship, P, M) { return Math.max(20, Math.round((ship.hp + P.maxHp + M.maxHp) * M.hpMul)); },
  mechOf(p) { return p.L ? p.L.mech : this.mech; },
  wpOf(p) { return p.L ? p.L.wp : this.wp; },
  // 逆襲（散彈升級）：受傷或護盾擋下 → 一段時間內傷害 ×2.5＋爆炸
  onRevenge(p) {
    const R = this.wpOf(p).revenge;
    if (!R) return;
    if (!(p.revengeT > 0)) floatText(p.x, p.y - 30, '逆襲！', '#ff4d6d', true);
    p.revengeT = R.t;
  },
  // 連殺裝填（軌道升級）：打出最後一擊的人下一發冷卻歸零
  onReloadKill(e) {
    const p = e.killer ? (this.mate && this.mate.L === e.killer ? this.mate : null) : this.player;
    if (p && !p.dead && this.wpOf(p).reload) p.fireCd = Math.min(p.fireCd, 0);
  },
  // 無傷連殺（輕裝甲 4 層）：打出最後一擊的人沒被打中時每殺一隻 +1 層
  onStreakKill(e) {
    const p = e.killer ? (this.mate && this.mate.L === e.killer ? this.mate : null) : this.player;
    if (!p || p.dead || !this.mechOf(p).traits.streak) return;
    p.streak = Math.min(STREAK.max, (p.streak || 0) + 1);
  },
  // 散彈升級的每幀效果（在那個人的配裝下執行，房主）：逆襲倒數、群戰數身邊的敵人
  tickWeaponFx(p, dt) {
    const w = this.wp;
    if (p.revengeT > 0) p.revengeT -= dt;
    if (w.crowd) {
      let n = 0;
      const R2 = w.crowd.r * w.crowd.r;
      for (const e of enemiesNear(p.x, p.y, w.crowd.r)) if (!e.dead && !(e.spawnT > 0) && dist2(e.x, e.y, p.x, p.y) < R2 && ++n >= w.crowd.max) break;
      p.crowdK = n;
    } else p.crowdK = 0;
    // 靜電（軌道升級）：飛船移動的距離充電
    if (w.static) {
      if (p.stX != null) p.stD = (p.stD || 0) + Math.hypot(p.x - p.stX, p.y - p.stY);
      while (p.stD >= w.static.dist && (p.staticK || 0) < w.static.max) { p.stD -= w.static.dist; p.staticK = (p.staticK || 0) + 1; }
      if ((p.staticK || 0) >= w.static.max) p.stD = 0;
      p.stX = p.x; p.stY = p.y;
    } else p.staticK = 0;
    // 分散、擦彈：一段時間沒疊就開始掉層
    for (const [U, K, T] of [[w.spreadUp, 'spreadK', 'spreadT'], [w.graze, 'grazeK', 'grazeT'], [w.parryUp, 'parryK', 'parryT']]) {
      if (!U) { p[K] = 0; continue; }
      if (p[K] > 0 && (p[T] -= dt) <= 0) { p[K]--; p[T] += U.decay; }
    }
  },
  // 專注（雷射升級）：打中的是上一隻 → 層數 +1，換一隻 → 歸零；回傳這一下的傷害倍率
  focusMul(P, e, F) {
    if (!P) return 1;
    if (P.focusId === e.id) P.focusK = Math.min(F.max, (P.focusK || 0) + 1); else { P.focusId = e.id; P.focusK = 0; }
    return 1 + F.per * P.focusK;
  },
  // 分散（雷射升級）：碎光打中敵人 → 射速疊一層
  spreadHit(P) {
    const U = P && (P.L ? P.L.wp : this.wp).spreadUp; if (!U) return;
    P.spreadK = Math.min(U.max, (P.spreadK || 0) + 1); P.spreadT = U.idle;
  },
  // 格擋流（相位刃升級）：刃片砍掉敵彈 → 傷害疊一層
  parryHit(P) {
    const U = P && (P.L ? P.L.wp : this.wp).parryUp; if (!U) return;
    P.parryK = Math.min(U.max, (P.parryK || 0) + 1); P.parryT = U.idle;
  },
  // 擦彈（雷射升級）：敵彈從身邊飛過沒打中 → 射速疊一層
  grazeHit(p) {
    const U = this.wpOf(p).graze; if (!U) return;
    p.grazeK = Math.min(U.max, (p.grazeK || 0) + 1); p.grazeT = U.idle;
    floatText(p.x, p.y - 26, '擦', '#5ef2ff');
  },
  // 火毯（散彈升級）：彈丸消失的地方留一團火（場上太多時最舊的先熄）
  dropFlame(b) {
    const C = b.carpet;
    this.flames.push({ x: b.x, y: b.y, r: C.r, t: C.t, max: C.t, dps: C.dps, att: b.att });
    if (this.flames.length > C.max) this.flames.shift();
  },
  // 殘留彈道（軌道升級）：子彈直直飛的一段算一條電軌；轉向（反彈、追蹤）、不在飛（環繞、迴旋回程、停住）、消失時收尾
  trailStep(b) {
    if (!b.ta && !b.taDone && b.mode === 'fly') b.ta = [b.sx, b.sy, b.angle];  // 第一段從發射點開始
    const fly = b.mode === 'fly' && !b.dead;
    if (b.ta && (!fly || Math.abs(angleDiff(b.ta[2], b.angle)) > 0.12)) {
      const T = b.trail;
      this.trails.push({ x1: b.ta[0], y1: b.ta[1], x2: b.x, y2: b.y, t: T.t, max: T.t, dmg: b.damage * T.ratio, att: b.att, hit: new Set(b.hitSet) });
      if (this.trails.length > T.max) this.trails.shift();
      b.ta = null; b.taDone = true;
    }
    if (fly && !b.ta && b.taDone) b.ta = [b.x, b.y, b.angle];
  },
  // 電軌：碰到的敵人受到那發子彈的 50%（每條每隻一次，子彈本身打中的不算）
  updateTrails(dt) {
    if (!this.trails.length) return;
    for (const L of this.trails) {
      L.t -= dt;
      if (L.t <= 0) continue;
      const x0 = Math.min(L.x1, L.x2), x1 = Math.max(L.x1, L.x2), y0 = Math.min(L.y1, L.y2), y1 = Math.max(L.y1, L.y2);
      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0 || L.hit.has(e.id)) continue;
        const r = e.r + 4;
        if (e.x < x0 - r || e.x > x1 + r || e.y < y0 - r || e.y > y1 + r || segDist2(L.x1, L.y1, L.x2, L.y2, e.x, e.y) >= r * r) continue;
        this.trailHit(L, e);
      }
    }
    this.trails = this.trails.filter(L => L.t > 0);
  },
  trailHit(L, e) { L.hit.add(e.id); e.hurt(L.dmg, 0, 0, 'shock', L.att); },
  // 火毯的火：每 0.2 秒讓碰到的敵人燃燒（每秒 dps，持續 3 秒）
  updateFlames(dt) {
    if (!this.flames.length) return;
    this.flameTick = (this.flameTick || 0) + dt;
    const hit = this.flameTick >= 0.2;
    if (hit) this.flameTick = 0;
    for (const z of this.flames) {
      z.t -= dt;
      if (!hit || z.t <= 0) continue;
      for (const e of enemiesNear(z.x, z.y, z.r)) {
        if (e.dead || e.spawnT > 0 || dist2(e.x, e.y, z.x, z.y) >= (z.r + e.r) ** 2) continue;
        e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, z.dps); e.burnT = Math.max(e.burnT, 3); e.burnAtt = z.att;
      }
    }
    this.flames = this.flames.filter(z => z.t > 0);
  },
  // 野火（散彈升級）：燃燒中的敵人每隔一段時間把火傳給附近一隻還沒燒的；燒著死掉時火噴到附近所有敵人（onEnemyKilled）
  updateWildfire(dt) {
    for (const e of this.enemies) {
      if (e.dead || !(e.burnT > 0) || !e.wild) continue;
      if ((e.wildT = (e.wildT || 0) + dt) < e.wild.every) continue;
      e.wildT = 0;
      let best = null, bd = e.wild.r * e.wild.r;
      for (const o of enemiesNear(e.x, e.y, e.wild.r)) {
        if (o === e || o.dead || o.spawnT > 0 || o.burnT > 0) continue;
        const d = dist2(o.x, o.y, e.x, e.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) { this.igniteFrom(e, best); zapFx(e.x, e.y, best.x, best.y, '#ff9f1c'); }
    }
  },
  // 撞牆（散彈升級）：被彈丸打飛的敵人撞到牆、小行星、行星或別的敵人 → 彈丸傷害加總 ×2＋暈眩（同一隻冷卻 0.5 秒）
  wallSlam(e) {
    const W = e.wh;
    if (!W || e.dead || this.time < (e.whCd || 0)) return;
    e.whCd = this.time + W.cd; e.whT = 0;
    const dmg = e.whDmg * W.mul;
    e.stunT = W.stun;
    e.hurt(dmg, 0, 0, 'shock', e.whAtt || null);
    floatText(e.x, e.y - e.r, Math.round(dmg), '#ffb347', true);
    burst(e.x, e.y, '#ffb347', 10, 180, 0.3, 2);
  },
  // 共鳴（電漿升級）：連結
  joinLink(L, e) {
    if (L.t <= 0 || e.dead || L.es.includes(e)) return;
    if (L.es.length) zapFx(L.es[0].x, L.es[0].y, e.x, e.y, '#c77dff');
    L.es.push(e); e.link = L;
  },
  shareLink(e, dmg, att) {
    const L = e.link;
    if (L.t <= 0) return;
    const zap = this.time >= (L.zapT || 0);
    if (zap) L.zapT = this.time + 0.25;
    for (const o of L.es) {
      if (o === e || o.dead || o.link !== L) continue;
      o.hurt(dmg * L.share, 0, 0, 'link', att);
      if (zap) zapFx(e.x, e.y, o.x, o.y, '#c77dff');
    }
  },
  // 共鳴的連結到時間就斷；餘震到時間就炸
  updateLinksQuakes(dt) {
    if (this.links.length) {
      for (const L of this.links) if ((L.t -= dt) <= 0) for (const e of L.es) if (e.link === L) e.link = null;
      this.links = this.links.filter(L => L.t > 0);
    }
    if (this.quakes.length) {
      for (const q of this.quakes) if ((q.t -= dt) <= 0) this.explode(q.x, q.y, q.r, q.dmg, q.color, null, q.att);
      this.quakes = this.quakes.filter(q => q.t > 0);
    }
  },
  igniteFrom(e, o) { o.burnDps = Math.max(o.burnT > 0 ? o.burnDps : 0, e.burnDps); o.burnT = Math.max(o.burnT, 3); o.burnAtt = e.burnAtt; o.wild = e.wild; o.wildT = 0; },
  // 被打到之後：反應裝甲（在打到的那個人的配裝下執行）
  onPlayerHurt(p, sx, sy) {
    const M = this.mech;
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
    // 修復無人機：只補「最近受的傷」存下來的可回復量（每次受傷的一半，最多最大 HP 的 30%），不會無限回；戰鬥結束時沒補完的直接補回（見 combatWon）
    if (mod !== 'drone') p.drRec = 0;
    else if (p.drRec > 0 && p.calm >= (M.light ? 3 : 5)) {
      const h = Math.min(p.drRec, (M.heavy ? 16 : 8) * dt, Math.max(0, p.maxHp - p.hp));
      p.hp += h; p.drRec = p.hp >= p.maxHp ? 0 : p.drRec - h;
    }
    // 重力井：身邊的減速場，敵人移動 −40%（重裝甲加成 −60%），敵彈在場內也變慢（見 updateEnemyBullets）
    p.gravField = mod === 'gravity' ? { R: M.light ? 220 : 150, slow: M.heavy ? 0.6 : 0.4 } : null;
    if (p.gravField) {
      const F = p.gravField;
      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0 || dist2(e.x, e.y, p.x, p.y) > F.R * F.R) continue;
        e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, F.slow); e.slowT = Math.max(e.slowT, 0.1);
      }
    }
    if (mod === 'swarmcore' && (p.coreT -= dt) <= 0) {  // 每 6 秒朝四周 6 個方向各用電路開一槍（吃全部晶片效果；環繞不存彈，直接射出）
      p.coreT = CFG.SWARMCORE.every;
      const list = runOps(this.stats.ops, 0).map(q => q.orbit ? { ...q, orbit: 0 } : q), n = CFG.SWARMCORE.dirs;
      if (list.length) for (let i = 0; i < n; i++) spawnShots(list, p.x, p.y, p.aim + i / n * TAU, 0, null);
    }
  },
  // 每場戰鬥開始時重置的機體狀態
  resetMechCombat(p) {
    p.shield = 0; p.shieldT = 0; p.calm = 0; p.gravT = 6; p.coreT = CFG.SWARMCORE.every; p.shellUsed = false; p.noFireT = 0; p.quenchT = 0;
    p.portalCd = 0; p.pullV = null; p.icWs = [];
    p.revengeT = 0; p.streak = 0; p.crowdK = 0;  // 逆襲、無傷連殺、群戰
    p.focusId = null; p.focusK = 0; p.spreadK = 0; p.spreadT = 0; p.grazeK = 0; p.grazeT = 0;  // 專注、分散、擦彈
    p.staticK = 0; p.stD = 0; p.stX = null; p.stY = null;  // 靜電
    p.parryK = 0; p.parryT = 0;  // 格擋流
  },
  // 零件：加 1 層（零件格滿了就不行）、換零件（改裝廠）
  // 機體強化（零件 1 層；背包模組不算）：每拿 CFG.MECH_SLOT_EVERY 個，電路格 +1（最多 MAX_SLOTS）；回傳要接在提示後面的文字
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
  setModule(id) {
    const old = this.module;
    this.module = MODULES[id] ? id : null;
    this.recalc();
    if (this.runStats && id) this.runStats.got.push(`${this.here()} 背包模組 ${MODULES[id].name}${old ? `（取代 ${MODULES[old].name}）` : ''}`);
  },

  // 雙人：一方被擊墜 → 等隊友；兩人都被擊墜 → 結束（房主判定）
  // 這個人的統計（房主：自己的 runStats、隊友的 mate.L.R）：倒下、救人次數記在這裡
  statsOf(p) { return p === this.player ? this.runStats : p && p.L ? p.L.R : null; },
  playerDown(p) {
    p.hp = 0; p.dead = true;
    const RS = this.statsOf(p); if (RS) RS.downs = (RS.downs || 0) + 1;  // 雙人紀錄：被擊墜幾次
    burst(p.x, p.y, p.ship.color, 80, 400, 1.2, 3);
    if (this.players().length) {
      bannerFx(`${p === this.player ? '1P' : '2P'} 被擊墜！`, `隊友靠近倒下的位置 ${CFG.REVIVE.time} 秒可以救起來`, 2.5);
      return;
    }
    this.state = 'dead'; Input.down = false;
    // 結束訊息帶上隊友的最終血量與擊毀原因（最後一次同步可能還沒送到）；先送最終傷害統計
    Net.sendDmg();
    Net.send({ t: 'over', wave: this.combat.wave, cause: this.mate ? this.mate.lastHit || '' : '' });
    this.saveRecord('dead');
    Events.emit('died');
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
    const RS = this.statsOf(q); if (RS) RS.revives = (RS.revives || 0) + 1;  // 雙人紀錄：救起隊友幾次
    bannerFx(`${tag(p)} 救援成功！`, `${tag(q)} 分出 ${Math.ceil(give)} HP`, 2);
    burst(p.x, p.y, '#9dff6b', 40, 260, 0.8, 3);
    Events.emit('revive', { p, q });
  },

  // ---------- 主更新 ----------
  update(dt) {
    if (this.pauseMenu && (this.state !== 'play' || this.mode === 'coop' && !Net.active())) this.pauseMenu = false;
    if (this.pauseMenu && this.mode !== 'coop') return;  // 選單開著：單人暫停（雙人不暫停，隊友那邊照常進行）
    if (Net.role === 'client' && this.mode === 'coop') { Net.clientUpdate(dt); return; }
    const frozen = !!Net.pauseReason();  // 雙人：隊友在編輯電路、切到其他視窗、斷線重連中 → 全員暫停
    if (this.state === 'play' && this.mate && !frozen) Net.hostUpdateMate(dt);
    if (this.state === 'play' && !frozen) {
      this.time += dt;
      if (this.runStats) this.runStats.time += dt;  // 只算實際戰鬥的時間
      if (!this.player.dead) this.player.update(dt);
      this.updateWaves(dt);
      this.updateEnemies(dt);
      for (const p of this.players()) this.withLoadout(p.L, () => { this.tickModules(p, dt); this.tickWeaponFx(p, dt); });
      this.updateFlames(dt); this.updateWildfire(dt); this.updateLinksQuakes(dt); this.updateTrails(dt);
      Objects.update(dt);
      this.updatePortals(dt);
      this.updateBullets(dt);
      this.updateEnemyBullets(dt);
      this.updateZones(dt);
      this.updatePickups(dt);
      if (this.mate) this.updateRevive(dt);
    }
    if (this.state === 'play' || this.state === 'dead') this.updateFx(dt);
    if (this.inArena && this.state !== 'editor') this.updateCamera(dt);
    if (!this.inArena) { this.cam.x += dt * 20; this.cam.y += dt * 8; }
    if (Net.role === 'host' && this.mode === 'coop') Net.hostSend(dt);
  },
  // 盾衛的盾是實心的：飛船撞到盾（盾那一側 ±60°、盾外緣 r+13 以內）會被推到盾外、往外彈開（0.2 秒不吃操控），回傳 true（房主再算撞擊傷害）
  //   雙人：隊友自己的船由隊友那邊推（net.js clientUpdate），不然會被自己送來的位置蓋掉
  shieldBlock(e, p) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1, R = e.r + SHIELD_OUT + p.r;
    if (d >= R || Math.abs(angleDiff(Math.atan2(dy, dx), e.shieldA)) >= Math.PI / 3) return false;
    p.x = e.x + dx / d * R; p.y = e.y + dy / d * R;
    if (!(p.dashT > 0)) { p.vx = dx / d * 520; p.vy = dy / d * 520; p.kbT = 0.2; }
    return true;
  },
  updateEnemies(dt) {
    const E = this.enemies;
    for (const e of E) {
      if (e.stickT > 0 && (e.stickT -= dt) <= 0) this.detonate(e);  // 黏著的子彈時間到一起爆炸
      if (e.dead) continue;
      e.update(dt, this.nearestPlayer(e.x, e.y));  // 雙人：追最近的玩家
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
          if (a.whT > 0) this.wallSlam(a); if (b.whT > 0) this.wallSlam(b);  // 撞牆（散彈升級）：被打飛的撞到別的敵人
        }
      }
    }
    if (!Arena.rect) for (const e of E) if (!e.dead && Arena.f(e.x, e.y) < e.r) Arena.collide(e, e.r, null);  // 大地圖：被擠進牆裡的推回來
    this.enemies = E.filter(e => !e.dead);
  },
  updateBullets(dt) {
    const B = this.bullets, E = this.enemies, Q = this.triggerQueue, SQ = [];
    buildEnemyGrid();  // 共用的敵人格子（追蹤、地雷、迴旋折返、找最近的敵人用；見 spatial.js）
    Objects.buildGrid();  // 地圖物件格子（子彈打行星、小行星、彗星、黑洞）
    for (const p of this.players()) {  // 環繞：按住射擊越久轉越快（轉速見 orbSpinOf）；orbV（存著的「發」）由存著的子彈每幀重新數
      p.orbHeld = p.orbT || 0;
      p.orbT = p.orbV && p.orbV.size && p.wantFire ? (p.orbT || 0) + dt : 0;
      p.orbV = new Set();
    }
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
    for (const b of B) {
      if (b.dead) continue;
      b.update(dt);
      if (b.trail) this.trailStep(b);  // 殘留彈道（軌道升級）：記錄飛過的路徑
      if (b.dead || b.mode === 'wait') continue;  // 停滯：停住的子彈不會打到敵人
      if (b.comet && this.cometShardHit(b)) continue;  // 彗星碎片：也會打到飛船
      if (b.mode !== 'orbit' && this.portalHop(b, b.r, 'portalT', 0.3, b.angle, b.px, b.py)) { b.px = b.x; b.py = b.y; }
      if (Objects.bulletHit(b)) continue;  // 行星、小行星、彗星
      if (b.overT > 0) continue;  // 迴旋：正在穿過打中的敵人，準備折返
      const orbit = b.mode === 'orbit';  // 環繞：繞圈時每碰到一次都算命中、照穿甲規則扣（同一隻隔 0.5 秒），穿甲用完就消失
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
        if (orbit ? this.time < ((b.orbitCd && b.orbitCd.get(e.id)) || 0) : b.hitSet.has(e.id)) continue;
        const rr = b.r + e.r, d2 = segDist2(b.px, b.py, b.x, b.y, e.x, e.y);
        if (d2 >= rr * rr) {  // 沒碰到身體：盾衛的盾（外緣 r+SHIELD_OUT）從盾那一側碰到也算（反彈）
          if (e.shieldA == null || d2 >= (rr + SHIELD_OUT) ** 2 || Math.abs(angleDiff(Math.atan2(b.py - e.y, b.px - e.x), e.shieldA)) >= Math.PI / 3) continue;
        }
        if (orbit) (b.orbitCd = b.orbitCd || new Map()).set(e.id, this.time + 0.5); else b.hitSet.add(e.id);
        b.hitAny = true;  // 相刃＋迴旋：揮到盡頭時有砍到過才折返
        if (e.shieldA != null) {  // 盾衛：從盾的那一側（±60°）打過來的子彈反彈回去
          const ca = Math.atan2(b.py - e.y, b.px - e.x);
          if (Math.abs(angleDiff(ca, e.shieldA)) < Math.PI / 3) { this.reflectShot(e, b, ca); break; }
        }
        if (b.lock && b.ownerP) { b.ownerP.lockE = e; b.ownerP.lockT = this.time + 1; }  // 鎖定（感測器 2 層）：打中後 1 秒內子彈追蹤這一隻
        // 用量成長：照著晶片的玩法打中敵人 → 在牠身上貼標記（1 秒），牠死掉時每個標記各加「牠的晶體值」（見 tagGrow）
        const own = b.owner;
        if (b.mode === 'return') this.tagGrow(e, own, 'boomerang');
        if (orbit || b.orbShot) this.tagGrow(e, own, 'orbit');
        if (b.stasis && b.dashed) this.tagGrow(e, own, 'stasis');
        if (b.accel && b.accelMul >= 2) this.tagGrow(e, own, 'accel');
        if (b.quick && b.accelMul >= 2) this.tagGrow(e, own, 'quick');
        if (b.bounced) this.tagGrow(e, own, 'wallbounce');
        if (b.full) this.tagGrow(e, own, 'charge');
        if (b.rear) this.tagGrow(e, own, 'rear');
        if (b.dashShot) this.tagGrow(e, own, 'dashfire');
        if (b.stand) this.tagGrow(e, own, 'stand');
        if (b.infGen > 0) this.tagGrow(e, own, 'infect');
        if (b.att.src === 'intercept') this.tagGrow(e, own, 'intercept');  // 攔截回射（含反射鏡反彈的敵彈）打中
        if (b.pull && b.mode !== 'orbit') this.pullAt(b, e);  // 環繞中（還在繞圈）的子彈打中不拉；放出去之後照常拉
        let dmg = hitDamage(b);  // 速度倍率 = 傷害倍率（加速、環繞放出）
        let att = b.att;
        if (dmg !== b.damage && b.damage > 0) {  // 傷害統計：速度倍率多出來的傷害平分給造成它的晶片（環繞放出、加速、疾射）
          const ks = [b.orbShot && 'orbit', b.accel && 'accel', b.quick && 'quick'].filter(Boolean);
          for (const k of ks) att = attCredit(att, k, Math.pow(dmg / b.damage, 1 / ks.length));
        }
        if (b.kin) dmg *= kineticMul(b);  // 動能彈頭（雷射升級）：子彈越快越痛（算武器本身的傷害）
        if (b.focus) dmg *= this.focusMul(b.ownerP, e, b.focus);  // 專注（雷射升級）：連續打中同一隻越打越痛
        if (b.skewer) dmg *= 1 + b.skewer.per * b.skN++;           // 串燒（雷射升級）：前面每穿過一隻 +30%
        if (b.spreadSh) this.spreadHit(b.ownerP);                  // 分散（雷射升級）：碎光打中 → 射速疊層
        if (b.frostbite && e.slowT > 0) dmg *= 1 + e.slowAmt * b.frostbite.per;  // 冰封（電漿升級）：被減速越多越痛
        if (b.res) this.joinLink(b.res, e);                        // 共鳴（電漿升級）：小電漿打中的加進連結
        if (b.execute && e.burnT > 0 && !e.t.boss && e.hp - dmg < e.maxHp * (e.t.elite ? b.execute.elite : b.execute.hp)) {  // 灼燒處決（相位刃升級）
          dmg = Math.max(dmg, e.hp + 1); floatText(e.x, e.y - e.r - 14, '斬殺', '#ff8fd8', true);
          const r = b.execute.r;  // 斬殺時火噴到旁邊的敵人（接著燒、接著斬）
          for (const o of enemiesNear(e.x, e.y, r)) if (o !== e && !o.dead && !(o.spawnT > 0) && dist2(o.x, o.y, e.x, e.y) < r * r) this.igniteFrom(e, o);
        }
        if (b.sticky) {  // 黏著：先造成 30%，黏上去的部分之後一起爆炸（插在黏著上的組件、消失觸發器等爆炸時才算）
          const P = b.payload && b.payload[0].trig === 'end' ? b.payload : null;
          // 黏上去的部分（之後爆炸）是產物：不算武器插座的傷害加成（先打的 30% 是直擊，照算）
          const wb = b.wsb || 0, sd = wb > 0 ? dmg * Math.max(0.1, b.bonus - wb + (b.accelMul || 1)) / Math.max(0.1, b.bonus + (b.accelMul || 1)) : dmg;
          (e.stuck = e.stuck || []).push({ dmg: sd, att, lv: b.sticky, owner: own, hm: b.hm && b.hm.sticky, hb: b.hb, color: b.color, angle: b.angle,
            end: P && { payload: P, depth: b.depth + 1 }, fi: b.fromIntercept });
          if (!(e.stickT > 0)) e.stickT = 2;
          dmg *= 0.3;
        }
        const knock = b.knock * (b.quick >= 3 && b.accelMul >= 2 ? 3 : 1);  // 衝擊（疾射 Lv3）：2 倍速以上打中強力擊退
        const kb = Math.min(220 * (knock > b.knock ? 2 : 1), dmg * 5) * (14 / e.r) * knock;
        if (b.wallhit && !e.t.boss) { if (!(e.whT > 0)) e.whDmg = 0; e.whDmg += dmg; e.whT = b.wallhit.t; e.whAtt = att; e.wh = b.wallhit; }  // 撞牆：記下這波彈丸的傷害
        e.hurt(dmg, Math.cos(b.angle) * kb, Math.sin(b.angle) * kb, b.comet ? 'comet' : b.shard ? 'shard' : b.att.src === 'intercept' ? 'counter' : b.depth > 0 ? 'echo' : 'direct', att, knock);
        if (b.mark) e.markT = 3;  // 弱點標記（感測器 4 層）
        const wid = (b.owner && this.mate && this.mate.L ? this.mate.L.weapon : this.weapon).id;
        floatText(e.x, e.y - e.r, Math.round(dmg), ...dmgTextStyle(dmg, WEAPONS[wid] && WEAPONS[wid].base.damage));
        burst(b.x, b.y, b.color, 4, 160, 0.25, 2);
        Events.emit('hit', { e, b, dmg });
        this.hitFx(e, b, dmg, b.x, b.y);  // 命中效果（武器升級、元素組件）：燃燒、減速、爆炸、電弧
        if (b.lifesteal) this.healPlayer(b.lifesteal, b.owner ? this.mate : this.player);
        if (b.shards && SQ.length < 60) SQ.push({ x: b.x, y: b.y, angle: b.angle, b, ignore: e.id });
        if (b.payload && b.payload[0].trig === 'hit' && Q.length < CFG.MAX_TRIGGERS_PER_FRAME)  // 命中觸發器
          Q.push({ payload: b.payload, x: b.x, y: b.y, angle: b.angle, depth: b.depth + 1, ignore: null, owner: b.owner, fi: b.fromIntercept });  // 回響可以打到被命中的這一隻
        if (b.sticky && !b.infPierce && !(b.pierce > 0) && !(b.boom && b.mode === 'fly')) b.dead = true;  // 黏著：穿甲用完才黏住；會穿透的子彈（和迴旋）每穿過一隻就留一份
        else if (b.infPierce) { /* 迴旋的回程、超音速：不會消失 */ }
        else if (b.pierce > 0) b.pierce--;
        else if (b.boom && b.mode === 'fly') { b.overT = (e.r * 2 + 30) / b.speed; b.overId = e.id; }  // 迴旋：去程穿甲用完，穿過這隻再折返（回程會再打牠一次）
        else { b.dead = true; b.endTrig(); }  // 穿甲用完：算消失（黏住的等引爆才算）
        break;
      }
    }
    this.updateVortices(dt);
    this.updateStasisArcs(dt);
    for (const t of Q) {  // 觸發器：從觸發點展開子管線（用射出這顆子彈的人的武器與電路）；回響沿子彈原本的方向射（定時觸發器是往兩側）
      const ang = t.angle;
      const n0 = B.length;
      this.withLoadout(t.owner, () => spawnShots(runOps(t.payload, t.depth), t.x, t.y, ang, t.depth, t.ignore));
      if (t.fi) for (let i = n0; i < B.length; i++) B[i].fromIntercept = true;  // 攔截重射的子彈觸發的回響：一樣算攔截重射（不能再攔截）
      burst(t.x, t.y, '#ff6b9d', 6, 140, 0.3, 2);
    }
    Q.length = 0;
    for (const s of SQ) {  // 碎片：從命中點往前方扇形散開
      const { n, ratio, homing = 0, seek, focus, spread, breed, resonance } = s.b.shards, list = [];
      let res = null;
      if (resonance) {  // 共鳴（電漿升級）：被打中的那隻開一個連結，這一發的小電漿打中的都加進來
        const e0 = this.enemies.find(o => o.id === s.ignore);
        if (e0 && !e0.dead) { res = { es: [], t: resonance.t, share: resonance.share }; this.links.push(res); this.joinLink(res, e0); }
      }
      if (focus) {  // 專注（雷射升級）：碎光不散開，折回打同一隻（也算連續打中）
        const e0 = this.enemies.find(o => o.id === s.ignore);
        for (let k = 0; k < n && e0 && !e0.dead; k++) e0.hurt(s.b.damage * ratio * this.focusMul(s.b.ownerP, e0, s.b.focus || FOCUS), 0, 0, 'shard', s.b.att);
        burst(s.x, s.y, s.b.color, 6, 160, 0.25, 2);
        continue;
      }
      if (seek) {  // seek（雷射稜鏡）：命中點 350 內沒有別的敵人 → 碎光折回打原本那一隻（打王時碎光不會全部打空）
        const e0 = this.enemies.find(o => o.id === s.ignore);
        if (e0 && !e0.dead && !this.enemies.some(o => o !== e0 && !o.dead && !(o.spawnT > 0) && dist2(o.x, o.y, s.x, s.y) < 350 * 350)) {
          for (let k = 0; k < n && !e0.dead; k++) e0.hurt(s.b.damage * ratio, 0, 0, 'direct', s.b.att);
          burst(s.x, s.y, s.b.color, 6, 160, 0.25, 2);
          continue;
        }
      }
      for (let k = 0; k < n; k++)
        list.push(shot({ angle: (k - (n - 1) / 2) * (1.6 / n), speed: 620, damage: s.b.damage * ratio, radius: 3,
          life: 0.4, color: s.b.color, homing, shard: true, src: s.b.att.src, cr: s.b.att.cr, spreadSh: !!spread, res,
          shards: breed ? { n: breed.n, ratio: breed.ratio / ratio } : null }));  // 增殖（電漿升級）：小電漿打中再分裂一次（第二代沒有 breed，不再分）
      this.withLoadout(s.b.owner, () => spawnShots(list, s.x, s.y, s.angle, s.b.depth, s.ignore));
    }
    let w = 0;  // 原地拿掉消失的子彈（不每幀建新陣列：子彈很多時記憶體回收會造成卡頓）
    for (let i = 0; i < B.length; i++) if (!B[i].dead) B[w++] = B[i]; else if (B[i].carpet) this.dropFlame(B[i]);  // 火毯：消失的地方留火
    B.length = w;
  },
  // 命中效果：武器升級的燃燒／減速／爆炸／電弧，加上元素組件（燃燒照這一下的傷害 dmg 算），兩邊相加
  hitFx(e, b, dmg, x, y) {
    const bd = (b.burn ? b.burn.dps : 0) + (b.burnR || 0) * dmg;
    if (bd > 0) { e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, bd); e.burnT = Math.max(e.burnT, b.burn ? b.burn.t : 0, b.burnR ? 3 : 0); e.burnAtt = b.att; if (b.wild) e.wild = b.wild; }
    if (b.slow) { e.slowAmt = Math.max(e.slowT > 0 ? e.slowAmt : 0, b.slow); e.slowT = Math.max(e.slowT, b.slowDur || 1.5); }
    if (b.explode) {
      this.explode(x, y, b.explode.r, b.damage * b.explode.ratio, b.color, e.id, b.att, b.explode.compress || 0);
      if (b.aftershock && this.quakes.length < 40)  // 餘震（電漿升級）：同一點過一下再炸一次
        this.quakes.push({ x, y, r: b.explode.r, dmg: b.damage * b.explode.ratio, color: b.color, att: b.att, t: b.aftershock.t, max: b.aftershock.t });
    }
    if (b.crack) { e.shredAmt = (e.shredT > 0 ? e.shredAmt : 0) + (b.shred || b.crack.per); e.shredT = b.crack.t; }  // 碎甲（軌道升級）：每次命中疊一層（破甲彈頭改疊 +25%），沒有上限
    else if (b.shred) { e.shredAmt = Math.max(e.shredT > 0 ? e.shredAmt : 0, b.shred); e.shredT = 3; }  // 破甲：打中之後才生效（這一下不算）
    if (b.arcs) this.arc(e, b);
  },
  // 電弧（軌道砲・磁暴線圈、電擊線圈）：命中時瞬間打中附近其他敵人；附近敵人不夠時，剩下的電弧打回目標本身（傷害減半）
  arc(hit, b) {
    const { n, ratio, chain } = b.arcs, R = CFG.ARC_RANGE, dmg = b.damage * ratio;
    const near = this.enemies.filter(o => !o.dead && o !== hit && o.spawnT <= 0 && dist2(o.x, o.y, hit.x, hit.y) < (R + o.r) ** 2)
      .sort((p, q) => dist2(p.x, p.y, hit.x, hit.y) - dist2(q.x, q.y, hit.x, hit.y));
    for (let k = 0; k < n; k++) {
      const t = near[k] || hit, d = near[k] ? dmg : dmg * 0.5;
      if (t.dead) continue;
      if (b.slow) { t.slowAmt = Math.max(t.slowT > 0 ? t.slowAmt : 0, b.slow); t.slowT = Math.max(t.slowT, b.slowDur || 1.5); }
      t.hurt(d, 0, 0, 'arc', b.att);
      floatText(t.x, t.y - t.r, Math.round(d), '#9fe8ff');
      zapFx(hit.x, hit.y, t.x, t.y, { jitter: 6 });
      if (chain && near[k]) this.arcChain(t, d, chain, new Set([hit, t]), b);
    }
  },
  // 導電（軌道升級）：電弧打中後再跳到最近一隻還沒被這道電弧打過的，每跳一次 ×decay
  arcChain(from, d, C, seen, b) {
    const R2 = CFG.ARC_RANGE * CFG.ARC_RANGE;
    for (let j = 0; j < C.jumps; j++) {
      let best = null, bd = R2;
      for (const o of this.enemies) {
        if (o.dead || o.spawnT > 0 || seen.has(o)) continue;
        const q = dist2(o.x, o.y, from.x, from.y);
        if (q < bd) { bd = q; best = o; }
      }
      if (!best) return;
      d *= C.decay; seen.add(best);
      best.hurt(d, 0, 0, 'arc', b.att);
      floatText(best.x, best.y - best.r, Math.round(d), '#9fe8ff');
      zapFx(from.x, from.y, best.x, best.y, { jitter: 6 });
      from = best;
    }
  },
  // ---------- V2 改玩法的晶片（房主執行） ----------
  // 吸引：命中時把附近的敵人往命中點拉（旗艦不會被拉）；引力漩渦：每命中 8 次生成一個
  // 吸引：把被打中那一隻附近的敵人拉向牠的中心（被打中的那一隻不動）
  //   以前是拉向子彈的位置，連被打中的那一隻也拉；命中點在牠靠近飛船的那一側，等於每打一下就把敵人往飛船拖
  //   往中心的速度「補到」PULL_V，不相加：以前每次命中 +380 疊上去，散彈＋鏡像＋分裂一幀命中 20 次以上，敵人被甩到每秒幾萬、飛進牆裡卡住（2026-10-09）
  pullAt(b, hit) {
    const R = (b.pull >= 2 ? 130 : 90) * (b.pullMul || 1);  // 巨彈插在吸引上：範圍 ×1.5
    const cx = hit.x, cy = hit.y;
    let n = 0;
    for (const o of this.enemies) {
      if (o === hit || o.dead || o.t.boss || o.spawnT > 0) continue;
      const d = Math.hypot(o.x - cx, o.y - cy);
      if (d > R + o.r || d < 1) continue;
      const ux = (cx - o.x) / d, uy = (cy - o.y) / d, add = Math.max(0, PULL_V - (o.vx * ux + o.vy * uy));
      o.vx += ux * add; o.vy += uy * add;
      this.tagGrow(o, b.owner, 'pull');
      n++;
    }
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
        this.tagGrow(o, v.owner, 'pull');
      }
      if (v.fx <= 0) {
        v.fx = 0.3;
        ringFx(v.x, v.y, v.r, '#f78cff');
      }
    }
    this.vortices = this.vortices.filter(v => v.t > 0);
  },
  // 伏擊網（停滯 Lv3）：停住的子彈之間拉出電弧，每 0.2 秒傷害碰到的敵人
  updateStasisArcs(dt) {
    this.arcT -= dt;
    if (this.arcT > 0) return;
    this.arcT = 0.2;
    // 每顆地雷只連到最近的 2 顆（110 以內），連成一張網；所有地雷都算（原本只取前 120 顆、畫面只畫前 60 條，新放的地雷和側邊、後方的網看不到）
    const W = this.bullets.filter(b => !b.dead && b.mode === 'wait' && b.stasis >= 3), G = new Map(), C = 110, key = (x, y) => x * 1e4 + y;
    W.forEach((b, i) => { b.netI = i; const k = key(Math.floor(b.x / C), Math.floor(b.y / C)); (G.get(k) || G.set(k, []).get(k)).push(b); });
    const links = new Set(), pairs = [];
    for (const p of W) {
      const cx = Math.floor(p.x / C), cy = Math.floor(p.y / C), near = [];
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (const q of G.get(key(cx + ox, cy + oy)) || []) {
        if (q === p) continue;
        const d = dist2(p.x, p.y, q.x, q.y);
        if (d <= C * C && d > 16) near.push([d, q]);  // 疊在同一點的不連（散彈同一發的彈丸幾乎重疊）
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [, q] of near.slice(0, 2)) {
        const id = p.netI < q.netI ? p.netI * 1e5 + q.netI : q.netI * 1e5 + p.netI;
        if (!links.has(id)) { links.add(id); pairs.push([p, q]); }
      }
    }
    for (const [p, q] of pairs) {
      zapFx(p.x, p.y, q.x, q.y, { life: 0.22, cap: 400, share: 60 / pairs.length });
      for (const e of this.enemies) {
        if (e.dead || e.spawnT > 0) continue;
        if (segDist2(p.x, p.y, q.x, q.y, e.x, e.y) < (e.r + 5) ** 2) e.hurt(p.damage * 0.4, 0, 0, 'arc', p.arcAtt || (p.arcAtt = { ...p.att, src: 'stasis' }));  // 電弧的傷害算伏擊網的
      }
    }
  },
  // 黏著：時間到，黏在身上的子彈一起爆炸
  detonate(e) {
    const S = e.stuck || [], n = S.length;
    e.stuck = []; e.stickT = 0;
    if (!n || e.dead) return;
    // 爆炸倍率隨黏著發數往上加（Lv1 ×1.5＋0.1／發，最多 ×3；Lv2 起 ×2＋0.15／發，最多 ×4.5）；多出來的算黏著的
    const lv = S[0].lv, M = lv >= 2 ? Math.min(4.5, 2 + 0.15 * n) : Math.min(3, 1.5 + 0.1 * n);
    let total = S.reduce((a, q) => a + q.dmg, 0) * M, att = attCredit(mergeAtt(S.map(q => ({ att: q.att, w: q.dmg }))), 'sticky', M);
    const x = e.x, y = e.y, H = this.stickyHost(S, total, att);  // 插在黏著上的組件
    total = H.total; att = H.att;
    this.tagGrow(e, S[0].owner, 'sticky');
    const ring = (r, c) => ringFx(x, y, r, c);
    ring(e.r + 20 + n * 3, '#f78cff');
    e.hurt(total, 0, 0, 'explode', att);
    floatText(x, y - e.r, Math.round(total), '#f78cff', true);
    if (H.el.length) {  // 元素組件插在黏著上：爆炸帶命中效果（爆裂再炸一圈、燃燒、冰凍、電弧）
      const fb = runComps([shot({ damage: total, color: S[0].color || '#f78cff', cr: att.cr })], H.el, 'h')[0];
      this.hitFx(e, { ...fb, att }, total, x, y);
    }
    Events.emit('explode', { x, y });
    if (lv >= 3) {  // 連鎖引爆：立刻引爆周圍敵人身上的子彈（範圍 90，插巨彈時取波及範圍；波及傷害交給巨彈）
      const R = Math.max(90, H.splash);
      for (const o of this.enemies) {
        if (o === e || o.dead || o.spawnT > 0 || !(o.stuck && o.stuck.length) || dist2(x, y, o.x, o.y) > (R + o.r) ** 2) continue;
        o.stickT = 0.05;
      }
      ring(R, '#f78cff');
    }
    if (H.splash) {  // 巨彈插在黏著上：爆炸波及周圍（50%）
      for (const o of this.enemies) {
        if (o === e || o.dead || o.spawnT > 0 || dist2(x, y, o.x, o.y) > (H.splash + o.r) ** 2) continue;
        o.hurt(total * 0.5, 0, 0, 'explode', att);
      }
      ring(H.splash, '#ffd166');
    }
    if (H.shards) {  // 分裂插在黏著上：爆炸時噴出碎片
      const a0 = rand(0, TAU), q = S[0];
      const list = Array.from({ length: H.shards }, (_, k) => shot({ angle: a0 + k / H.shards * TAU, speed: 650, damage: total * 0.2 * H.shardM, radius: 4,
        life: 0.5, color: q.color || '#f78cff', shard: true, src: 'sticky', cr: att.cr }));
      this.withLoadout(q.owner, () => spawnShots(list, x, y, 0, 0, e.id));
    }
    const T = S.find(q => q.end);  // 消失觸發器：黏住的子彈引爆時才算消失（一次爆炸觸發一次）
    if (T && this.triggerQueue.length < CFG.MAX_TRIGGERS_PER_FRAME)
      this.triggerQueue.push({ payload: T.end.payload, x, y, angle: T.angle || 0, depth: T.end.depth, ignore: null, owner: T.owner, fi: T.fi });
  },
  // 插在黏著上的組件（爆炸是產物）：倍增、巨彈的 +30%、超載・威力加進宿主層；巨彈 → 波及周圍；分裂 → 噴出碎片；鏡像 → 再爆一次（傷害、碎片都多一份）
  stickyHost(S, total, att) {
    const comps = (S.find(q => q.hm) || {}).hm, out = { total, att, splash: 0, shards: 0, shardM: 0, el: [] };
    if (!comps) return out;
    const hb0 = S[0].hb || 0;
    let add = 0, rep = 1;
    for (const c of comps) {
      if (c.flaky && flakyOff()) continue;
      const b = baseOf(c.id);
      if (b === 'amp') add += c.m;
      else if (c.id === 'ov_power') add += 0.5;
      else if (b === 'bigshot') { add += 0.3 * c.m; out.splash = Math.max(out.splash, 70 + 40 * c.m); }
      else if (b === 'split') { out.shards += Math.max(2, Math.round(3 + 2 * (c.m - 1))); out.shardM = Math.max(out.shardM, c.m); }
      else if (b === 'mirror') rep += c.n || 1;
      else if (CHIPS[c.id] && CHIPS[c.id].elem) out.el.push(c);
    }
    if (add) {
      const f = Math.max(0.1, 1 + hb0 + add) / Math.max(0.1, 1 + hb0);
      out.total = total * f;
      out.att = attCredit(att, 'sticky', f);
    }
    if (rep > 1) { out.total *= rep; out.att = attCredit(out.att, 'mirror', rep); out.shards *= rep; }
    return out;
  },
  // 感染：被帶感染的子彈（或它造成的燃燒）擊殺的敵人爆出子彈
  infectBurst(e) {
    const A = e.killAtt, inf = A && A.inf;
    if (!inf) return;
    const n = inf.lv >= 2 ? 5 : 3, gen = inf.gen + 1, base = inf.tpl.infBase || inf.tpl.damage;
    const tpl0 = { ...inf.tpl, src: 'infect', damage: base * 1.5, infBase: base,  // 爆出的子彈算感染的（src） orbit: 0, full: 0, endBoom: false, rear: false, dashShot: false,
      infect: inf.lv >= 3 && gen <= 2 ? inf.lv : 0, infGen: gen, color: '#c6ff8a' };
    const tpl = stripW(tpl0);  // 爆出來的子彈是產物：不算武器插座的傷害加成
    tpl.infBase = tpl.damage / 1.5;  // 下一代也照拿掉之後的算
    const a0 = rand(0, TAU), comps = inf.tpl.hm && inf.tpl.hm.infect;
    if (comps) tpl.hm = { ...tpl.hm, infect: undefined };
    let list = Array.from({ length: n }, (_, k) => ({ ...tpl, angle: a0 + k / n * TAU }));
    if (comps) list = runComps(list, comps, 'h');  // 插在感染上的組件：爆出來的子彈
    this.withLoadout(A.owner, () => spawnShots(list, e.x, e.y, 0, 0, e.id));
  },
  // 攔截：帶攔截的子彈碰到敵彈就把它打掉（自己照常飛），從那裡用整條電路朝最近的敵人回射；反射鏡（Lv3）把敵彈反彈回去
  interceptHit(eb, I) {
    for (const b of I) {
      if (b.dead) continue;
      const rr = b.r + eb.r + 2;
      if (segDist2(b.px, b.py, b.x, b.y, eb.x, eb.y) >= rr * rr) continue;
      eb.life = 0;
      burst(eb.x, eb.y, b.intercept ? '#9dff6b' : '#ff8fd8', 6, 140, 0.25, 2);
      if (!b.infPierce) { if (b.pierce > 0) b.pierce--; else b.dead = true; }  // 打掉一發敵彈跟打中敵人一樣扣穿甲（相刃無限穿透，不受影響）
      if (b.parry) this.parryHit(b.ownerP);  // 格擋流（相位刃升級）：砍掉敵彈疊傷害
      if (!b.intercept || b.fromIntercept || b.mode === 'return') return true;  // 相位刃格擋：只打掉敵彈，沒有攔截晶片就不回射（攔截重射的、飛回來的迴旋也只格擋不回射）
      // 合併回射：第一顆擋下的位置當集結點，0.2 秒內 300 以內再擋下的用綠色電弧拉進集結點，時間到才回射一次（見 CFG.COUNTER）
      //   離所有集結點都太遠就另開一個池。不然「很多攔截子彈 × 很多敵彈 × 整條電路」一幀就能生出幾十萬發
      const p = (b.owner ? this.mate : this.player) || this.player, C = CFG.COUNTER, Ws = p.icWs || (p.icWs = []);
      let W = null, wd = C.join * C.join;
      for (const w of Ws) { const d = dist2(w.x, w.y, eb.x, eb.y); if (d <= wd) { wd = d; W = w; } }
      if (!W) {
        Ws.push({ x: eb.x, y: eb.y, ang: b.angle, n: 1, t: C.win });
        this.fxRing(eb.x, eb.y, 18, '#9dff6b');
      } else {
        W.n++;
        const k = this.counterMult(W.n);
        zapFx(eb.x, eb.y, W.x, W.y, { c: '#9dff6b' });
        this.fxRing(W.x, W.y, 18 + (k - 1) * 14, mixWhite('#9dff6b', this.counterWhite(k)));
      }
      this.withLoadout(b.owner, () => {
        if (b.intercept >= 3) spawnShots([shot({ angle: 0, speed: Math.min(900, Math.hypot(eb.vx, eb.vy) * 1.5), damage: eb.dmg * 2, radius: Math.max(4, eb.r),
          life: 2, color: '#9dff6b', shape: 'reflect', src: 'intercept' })], eb.x, eb.y, Math.atan2(-eb.vy, -eb.vx), 1, null);  // 反射鏡：每顆都反彈（一顆換一顆，不受冷卻）
      });
      return true;
    }
    return false;
  },
  counterMult(n) { const C = CFG.COUNTER; return Math.min(C.max, 1 + C.per * (n - 1)); },
  counterWhite(k) { return Math.min(0.75, (k - 1) * 0.4); },  // 倍率越高越白：×2 約 4 成白
  fxRing(x, y, r, color) { ringFx(x, y, r, color); },
  // 合併回射的計時（在 withLoadout 裡呼叫）：每個池時間到就從它的集結點回射
  tickCounter(p, dt) {
    const Ws = p.icWs;
    for (const W of Ws) W.t -= dt;
    const due = Ws.filter(W => W.t <= 0);
    if (!due.length) return;
    p.icWs = Ws.filter(W => W.t > 0);
    for (const W of due) this.counterFire(W.x, W.y, W.ang, this.counterMult(W.n));
  },
  // 攔截回射：從集結點用整條電路朝最近的敵人射出（沒有敵人就照攔截子彈的方向）；mult > 1 的越大、越亮、越白
  counterFire(x, y, ang, mult) {
    const t = nearestEnemy(x, y, 900, null);
    this.fireMode = 'intercept'; this.chargeC = null;
    let list;
    try { list = runOps(this.stats.ops, 0); } finally { this.fireMode = null; }
    for (const s of list) s.src = 'intercept';  // 回射的子彈算攔截的
    if (mult > 1) {
      const grow = 1 + 0.3 * (mult - 1), wk = this.counterWhite(mult), c = mixWhite('#9dff6b', wk);
      for (const s of list) { s.damage *= mult; s.radius *= grow; s.color = mixWhite(s.color, wk); }
      burst(x, y, c, Math.round(6 + mult * 6), 220, 0.35, 2 + mult);
      floatText(x, y - 14, '×' + mult.toFixed(1), c, mult >= 2);
    }
    const n0 = this.bullets.length;
    if (list.length) spawnShots(list, x, y, t ? Math.atan2(t.y - y, t.x - x) : ang, 1, null);  // 第 1 層：不會進環繞的圈
    for (let i = n0; i < this.bullets.length; i++) this.bullets[i].fromIntercept = true;  // 永久標記（迴旋折返會把來源改成迴旋，盾要靠這個認）
  },
  // 用量成長：owner = 隊友的配裝（房主這邊記在隊友身上，同步給隊友）；null = 自己
  // 盾衛反彈：子彈照盾面的法線反彈，變成敵人的子彈（傷害 ×0.5，最多 25），我方子彈消失
  reflectShot(e, b, ca) {
    const nx = Math.cos(ca), ny = Math.sin(ca), vx = Math.cos(b.angle), vy = Math.sin(b.angle), dot = vx * nx + vy * ny;
    // 攔截回射的子彈打到盾只會消失、不反彈：不然「反彈成敵彈 → 被攔截 → 整條電路回射 → 又打到盾」會無限放大（拿掉子彈上限之後）
    if (b.att.src === 'intercept' || b.fromIntercept) { b.dead = true; burst(e.x + nx * (e.r + SHIELD_OUT), e.y + ny * (e.r + SHIELD_OUT), '#bfefff', 4, 120, 0.2, 2); return; }
    let rx = vx - 2 * dot * nx, ry = vy - 2 * dot * ny;
    if (rx * nx + ry * ny < 0.3) { rx = nx; ry = ny; }  // 擦邊的也往外彈
    const l = Math.hypot(rx, ry) || 1, spd = clamp(b.speed * 0.6, 200, 450), dmg = Math.min(25, hitDamage(b) * 0.5);
    this.eBullets.push({ x: e.x + nx * (e.r + SHIELD_OUT + 6), y: e.y + ny * (e.r + SHIELD_OUT + 6), vx: rx / l * spd, vy: ry / l * spd, r: 5, dmg, life: 2.5, from: e.t.name, col: b.color });  // col：原本子彈的顏色（畫成紅框＋原本顏色的芯）
    b.dead = true;
    burst(e.x + nx * (e.r + SHIELD_OUT), e.y + ny * (e.r + SHIELD_OUT), '#bfefff', 6, 160, 0.25, 2);
  },
  // 成長標記：照玩法打中時貼上（同一個晶片、同一個人再打中就重新計時），1 秒內敵人死掉就各加「牠的晶體值」
  //   蟲群 1、噴吐者 2、刺殼 4、虛空獵手 12、旗艦 40；子彈再多，同一隻敵人死掉也只算一份
  tagGrow(e, owner, id, dur = CFG.GROW_TAG_TIME) {
    const T = e.growTags || (e.growTags = []), o = owner || null;
    const t = T.find(q => q.id === id && q.owner === o);
    if (t) { t.t = this.time; t.dur = dur; } else T.push({ id, owner: o, t: this.time, dur });
  },
  payGrowTags(e) {
    if (e.noGrow) { e.growTags = null; return; }  // 母巢生的蟲群不給成長
    for (const q of e.growTags || []) if (this.time - q.t <= (q.dur || CFG.GROW_TAG_TIME)) this.grow(q.owner, q.id, e.t.credits || 0);
    e.growTags = null;
  },
  grow(owner, id, n = 1) {
    const L = owner || this, g = L.growth;
    if (!g || !(n > 0)) return;
    const at = (L.slotAttr || [])[L.chain.findIndex(c => c && baseOf(c) === id)];  // 奇異點強化的格子：成長 ×2／不會成長
    if (at === 'nogrow') return;
    if (at === 'grow2') n *= 2;
    g[id] = (g[id] || 0) + n;
    if (!owner) this.checkGrowth();
  },
  // 電路上的晶片累積用量到了就升級（Lv3 進化）。雙人的隊友：房主把累積量傳過來，隊友升級後把新電路傳回去
  checkGrowth() {
    const msgs = [];
    this.chain.forEach((id, i) => {
      const base = baseOf(id), g = id && CHIPS[base] && CHIPS[base].grow;
      if (!g) return;
      let lv = levelOf(id);
      while (lv < CFG.MAX_CHIP_LV && (this.growth[base] || 0) >= growNeed(base, lv)) lv++;
      if (lv <= levelOf(id)) return;
      this.chain[i] = chipId(base, lv, socketsOf(id));  // 插座數不變
      msgs.push(lv >= CFG.MAX_CHIP_LV ? `${CHIPS[base].name} 進化 → ${CHIPS[base].evo}！` : `${CHIPS[base].name} 升到 Lv${lv}`);
    });
    if (!msgs.length) return;
    this.recalc();
    const p = this.player;
    for (const [k, m] of msgs.entries()) floatText(p.x, p.y - 40 - k * 20, m, '#ffd166', true);
    Events.emit('upgrade');
    if (this.runStats) for (const m of msgs) this.runStats.got.push(`${this.here()} ${m}（用量成長）`);
    if (this.isClient()) Net.sendLoadout();
  },
  // per：壓縮（電漿升級）——第 2 隻起每多炸到 1 隻，傷害 +per
  explode(x, y, r, dmg, color, skipId, att = null, per = 0) {
    if (per) {
      let n = 0;
      for (const e of this.enemies) if (!e.dead && e.id !== skipId && Math.hypot(e.x - x, e.y - y) <= r + e.r) n++;
      dmg *= 1 + per * Math.max(0, n - 1);
    }
    for (const e of this.enemies) {
      if (e.dead || e.id === skipId) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > r + e.r) continue;
      const k = 120 * (14 / e.r) / (d || 1);
      e.hurt(dmg, (e.x - x) * k, (e.y - y) * k, 'explode', att);
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
  updateEnemyBullets(dt) {
    const ps = this.players();
    for (const p of ps) if (p.icWs && p.icWs.length) this.withLoadout(p.L, () => this.tickCounter(p, dt));  // 合併回射：集氣時間到就射
    // 攔截晶片、相位刃的格擋：打掉敵彈。飛回來途中的迴旋不能攔截（攔截會用整條電路重射，裡面又有迴旋 → 飛回飛船附近又攔截，子彈一直翻倍）
    //   攔截重射出來的子彈（和它們觸發的回響）也不能再攔截：不然「攔截 → 重射 → 再攔截」會一直滾大
    Objects.buildGrid();  // 地圖物件格子（敵彈打行星、小行星）
    const I = this.bullets.filter(b => !b.dead && ((b.intercept && b.mode !== 'return' && !b.fromIntercept) || b.parry) && b.mode !== 'wait');
    // 攔截子彈照這一幀的路徑分進格子，敵彈只跟附近幾格的比（以前每顆敵彈跟全部攔截子彈比：上千 × 上千）；候選照 I 的順序，結果不變
    if (I.length > 16) IGrid.build(I, q => { const p = q.r + 2; return [Math.min(q.px, q.x) - p, Math.min(q.py, q.y) - p, Math.max(q.px, q.x) + p, Math.max(q.py, q.y) + p]; });
    const fields = ps.filter(p => p.gravField);  // 重力井：場內的敵彈變慢
    for (const b of this.eBullets) {
      let k = 1;
      for (const p of fields) if (dist2(b.x, b.y, p.x, p.y) < p.gravField.R ** 2) k = Math.min(k, 1 - p.gravField.slow);
      b.x += b.vx * dt * k; b.y += b.vy * dt * k; b.life -= dt;
      this.portalHop(b, b.r, 'portalT', 0.3, null, b.x - b.vx * dt, b.y - b.vy * dt);  // 敵彈也會穿門
      if (!Arena.rect && (Arena.f(b.x, b.y) < 0 || Arena.gateCross(b.x - b.vx * dt * k, b.y - b.vy * dt * k, b.x, b.y))) { b.life = 0; continue; }  // 大地圖：敵彈打到牆、閘門就消失
      if (Objects.eBulletHit(b)) continue;
      if (I.length && this.interceptHit(b, I.length > 16 ? IGrid.query(b.x - b.r, b.y - b.r, b.x + b.r, b.y + b.r) : I)) continue;
      for (const p of ps) {
        const rr = b.r + p.r, d2 = dist2(b.x, b.y, p.x, p.y);
        if (d2 < rr * rr && !p.invuln && !p.dead) { b.life = 0; if (b.dmg > 0) this.hurtPlayer(b.dmg, (b.from || '敵人') + '（子彈）', p, b.x - b.vx, b.y - b.vy); break; }
        const Gz = this.wpOf(p).graze;  // 擦彈（雷射升級）：進到身邊又離開、沒打中才算
        if (Gz && !p.dead) {
          const gz = b.gz || (b.gz = new Map()), st = gz.get(p);
          if (d2 < (rr + Gz.r) ** 2) { if (!st) gz.set(p, 1); }
          else if (st === 1) { gz.set(p, 2); this.grazeHit(p); }
        }
      }
    }
    this.eBullets = this.eBullets.filter(b => b.life > 0);
  },
  // 王的落點轟炸：時間到就爆炸，圈裡的飛船受傷
  updateZones(dt) {
    for (const z of this.zones) {
      if ((z.t -= dt) > 0) continue;
      for (const p of this.players()) if (dist2(p.x, p.y, z.x, z.y) < (z.r + p.r * 0.5) ** 2) this.hurtPlayer(z.dmg, z.from, p, z.x, z.y);
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
    const p = this.player.dead && this.mate && !this.mate.dead ? this.mate : this.player, c = this.cam;  // 自己被擊墜時看隊友
    const tx = clamp(p.x - ZW / 2, -80, Arena.W - ZW + 80);
    const ty = clamp(p.y - ZH / 2, -80, Arena.H - ZH + 80);
    c.x += (tx - c.x) * Math.min(1, dt * 8);
    c.y += (ty - c.y) * Math.min(1, dt * 8);
  },
};

// 主題小兵：cost = 佔一波的預算、from = 第幾星區開始出現、max = 一波最多幾隻
const THEMES = {
  gunboat: { cost: 3, from: 1 }, worm: { cost: 4, from: 1 }, splitter: { cost: 4, from: 1 },
  shield: { cost: 5, from: 2 }, lurker: { cost: 3, from: 2 }, hive: { cost: 8, from: 3, max: 1 },
};
// 擊沉旗艦的勝利畫面：二選一選好了、旗艦模組裝上或略過了（雙人的隊友這時才通知房主可以前往）
function bossDone(V) { return !!V && !!V.pick && (!V.module || !!V.took || !!V.skip); }
