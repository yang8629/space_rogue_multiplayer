// 星環電路 多人版 · game_record.js：Game 的遊玩紀錄與戰鬥中選單：走過的節點、Esc 選單、遊玩紀錄（存檔、複製）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   往 game.js 的 Game 加方法（外面照樣呼叫 Game.xxx）
'use strict';

Object.assign(Game, {
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
  // 子彈上限防呆（CFG.BULLET_CAP）：超過就刪最舊的（標 dead，別處還拿著的也當成消失）；記下觸發的地方
  capBullets() {
    const C = CFG.BULLET_CAP, R = this.runStats;
    let hit = false;
    for (const [k, cap] of [['bullets', C.mine], ['eBullets', C.enemy]]) {
      const arr = this[k], over = arr.length - cap;
      if (over <= 0) continue;
      hit = true;
      if (R && R.cap) {
        const at = `${this.whereNow()}（${k === 'bullets' ? '我方' : '敵方'}）`;
        if (!R.cap.first) R.cap.first = at;
        R.cap.cut += over;
        // 最多那次：記下子彈從哪來（數量最多的 3 種）和當下的電路，才追得到是哪個組合爆量（電路之後可能換掉）
        //   只在數量創新高時數一次（一萬多顆約 0.1ms）
        if (arr.length > R.cap.max) { R.cap.max = arr.length; R.cap.at = at; R.cap.src = this.bulletSources(arr, k === 'bullets'); R.cap.chain = this.chain.map((id, i) => id ? lvName(id, slotLv(i)) + ((this.socks[i] || []).length ? `［${this.socks[i].map(c => CHIPS[c].name).join('、')}］` : '') : '空'); }
      }
      for (let i = 0; i < over; i++) arr[i].dead = true;
      arr.splice(0, over);
    }
    if (hit && R && R.cap) R.cap.n++;  // 這一幀觸發（我方、敵方都超過也只算一幀）
  },
  // 子彈來源前 3 名（[名稱, 顆數]）：我方照產生它的晶片（att.src，回響產生的加「・回響」），敵方照哪種敵人（from）
  bulletSources(arr, mine) {
    const cnt = {}, SRC = { weapon: '武器', ship: '機體', comet: '彗星' };
    for (const b of arr) {
      const s = mine ? (b.att && b.att.src) || 'weapon' : b.from || '?';
      const key = mine ? (CHIPS[s] ? CHIPS[s].name : SRC[s] || s) + (b.depth > 0 ? '・回響' : '') : s;
      cnt[key] = (cnt[key] || 0) + 1;
    }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3);
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
  // 章節：這一局從哪個星區打到哪個星區、每個星區的王（見 chapters.js）；打完最後一個星區之後是無盡模式，王隨機抽
  chapter() { return chapterById(this.chapterId); },
  lastSector() { return this.chapter().sectors[1]; },
  bossFor(sector) { return this.chapter().bosses[sector] || pick(CFG.BOSS_ORDER); },
  isEndless() { return this.sector > this.lastSector(); },
  // 這章打完了沒：最後一個星區的王打掉了（停在那一關的旗艦獎勵畫面），或已經進了無盡模式（結算、紀錄、模擬判斷通關都用這個）
  chapterDone() { return this.isEndless() || (this.sector === this.lastSector() && this.state === 'victory'); },
  nodeById(id) { return this.map.flat().find(n => n.id === id); },
  reachable() {
    return this.node ? this.node.next.map(id => this.nodeById(id)) : this.map[0];
  },
  showMap(toast = '') {
    if (this.bonusPicks > 0) { this.bonusPicks--; this.openStartPick(toast); return; }  // 章節的開局補償：先選完三選一才到航圖
    this.inArena = false; this.state = 'map';
    if (this.mode === 'coop') Net.atMap();  // 雙人：告訴隊友「我回到航圖了」（隊友這邊順便送出最新配裝）
    this.view(toast);
  },
  // 章節的開局補償：一般戰鬥的三選一（晶片或零件），選完（或跳過）回到 showMap，次數用完才真的到航圖
  //   note：上一次三選一的結果（第一次是章節開場文字），顯示在標題下面，不然會被下一個三選一蓋掉
  openStartPick(note = '') {
    this.inArena = false;
    this.openReward('start', { note });
    if (this.mode === 'coop') Net.sendLoadout();  // 雙人的隊友：每次都把配裝和剩下的次數傳給房主（重新整理重連時還原用）
    this.view();
  },
  // 開局三選一還剩幾次（正在選的這一次也算）
  startPicksLeft() { return (this.bonusPicks || 0) + (this.state === 'reward' && this.reward && this.reward.kind === 'start' ? 1 : 0); },
  // 畫面：照目前的 state 顯示對應的畫面（怎麼畫由 ui/listeners.js 決定）；msg：畫面上的提示文字
  view(msg = '') { Events.emit('view', { state: this.state, msg }); },
  enterNode(node) {
    if (!this.reachable().includes(node)) return;
    this.node = node; this.visited.push(node.id);
    const L = node.L, level = L + (this.sector - 1) * 7;  // 每個星區難度往上疊
    this.logNodeStart(node);
    switch (node.type) {
      // 一般戰：第 1 星區前 3 層 2 波，之後都是 3 波（新星區開頭不會比上一個星區結尾少）
      case 'combat': {  // 第幾區有：treasure 寶藏無人機、swarm 蟲潮、intrude 精英亂入（0 = 這場沒有；亂入只在 3 區的戰鬥、第 2 區以後）
        const n = 2 + (L >= 3 || this.sector > 1 ? 1 : 0), roll = (p, lo = 1) => lo <= n && Math.random() < p ? randInt(lo, n) : 0;
        this.startCombat({ level, wavesTotal: n, elites: 0, treasure: roll(CFG.TREASURE.chance), swarm: roll(CFG.SWARM.chance), intrude: n >= 3 ? roll(CFG.INTRUDE.chance, 2) : 0,
          hoard: !!node.hoard, ...this.takeSos() });  // hoard：星圖情報標出的寶藏星域（每一區都有寶藏無人機）
        break;
      }
      case 'elite':  this.startCombat({ level, wavesTotal: 2, elites: 1, ...this.takeSos() }); break;
      case 'event':  this.openEvent(node); break;
      case 'boss':   this.startCombat({ level, wavesTotal: 1, elites: 0, boss: true }); break;
      case 'shop':   this.openShop(); break;
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
  // ---------- 戰鬥中的選單（Esc／手機的「選單」鈕）：繼續、離開遊戲（離開 = 中途結束，存紀錄、顯示結算） ----------
  togglePauseMenu(open = !this.pauseMenu) {
    this.pauseMenu = open;
    Input.down = false; Input.dash = false; Input.dashHeld = false; Input.joy = null; Input.aimStick = null;
    this.view();  // 戰鬥中：開著選單就畫選單，沒開就收起畫面
  },
  quitRun() {
    this.pauseMenu = false;
    if (this.mode === 'tutorial') Save.setFlag('tutorial', true);  // 新手引導：打完、跳過、從選單離開都算看過（之後不再自動進）
    if (this.freePlay() || this.mode === 'tutorial') { this.state = 'title'; this.inArena = false; this.view(); return; }  // 靶場、沙盒、新手引導：沒有結算，直接回基地
    this.saveRecord('retired');
    this.state = 'ended'; this.endCleared = false; this.inArena = false;
    this.view();
    if (this.mode === 'coop') Net.leave();  // 雙人：自己離開，隊友可以一個人繼續（跟隊友離線一樣）
  },
  // 結束遠征（通關或中途撤退）：存下遊玩紀錄後回到基地
  finishRun() {
    this.saveRecord(this.chapterDone() ? 'cleared' : 'retired');
    if (this.mode === 'coop') {  // 雙人：房主決定結束；之後每個人各自看結算、各自按「回到房間」（不用等房主，除非房主關掉房間）
      if (Net.role === 'host') Net.send({ t: 'finish' });
      this.state = 'ended'; this.endCleared = this.chapterDone(); this.inArena = false;
      this.view();
      return;
    }
    this.state = 'title'; this.inArena = false;
    this.view();
  },
  // ---------- 遊玩紀錄（存在瀏覽器；標題畫面「遊玩紀錄」可以查看、複製） ----------
  loadRecords() {
    const r = Save.load('records', []); return Array.isArray(r) ? r : [];
  },
  saveRecord(result) {
    const R = this.runStats;
    if (!['run', 'coop'].includes(this.mode) || !R || R.recorded || MechCheck.running) return;  // 機制檢查的模擬局不存
    R.recorded = true;
    // 局外成長：這一局的成績加進解鎖進度（先加再存紀錄：第一次讀進度時會用紀錄補成績，不能先看到這一局）；新達成的記在 unlockFresh（結算畫面、回到基地時顯示）
    const ulk = { sector: this.sector, bossIds: R.bossIds.slice(), weapon: this.weapon.id, kills: R.kills, elites: R.elites, echoK: R.echoK, play: { ...this.playKills } };
    this.unlockFresh = unlockAddRun(ulk);
    const rec = this.mode === 'coop' ? Net.buildRecord(result) : this.buildRecord(result);
    rec.ulk = ulk;  // 以後加新的解鎖條件時，用它補成績（unlockUpgrade）
    const list = [rec, ...this.loadRecords()].slice(0, CFG.MAX_RECORDS);
    Save.save('records', list);
  },
  // 目前這一局的紀錄（結算畫面的「複製這局紀錄」也用它，打完 Boss 還沒結束的局也能複製）
  buildRecord(result) {
    const R = this.runStats;
    const total = Object.values(R.dmg).reduce((a, b) => a + b, 0);
    const chips = Object.entries(R.chips).sort((a, b) => b[1] - a[1]).map(([k, v]) => [dmgKeyName(k), Math.round(v)]);
    // 晶片名稱（電路上的照插件升到的等級）＋插座數（◇2）
    const name = (id, lv = 1) => id ? lvName(id, lv) + (isHost(id) && id !== 'weapon' ? '◇' + socketsOf(id) : '') : null;
    const withSock = (id, i) => id && (this.socks[i] || []).length ? `${name(id, slotLv(i))}［${this.socks[i].map(c => CHIPS[c].name).join('、')}］` : name(id, slotLv(i));
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
      chapter: this.chapterId, sector: this.sector, layer: this.node ? this.node.L + 1 : 0, endless: this.isEndless(),
      bosses: R.bosses.slice(), cause: result === 'dead' ? this.lastHit : '',
      time: Math.round(R.time), kills: R.kills, dmg: Math.round(total), maxHit: Math.round(R.maxHit),
      dps: R.time > 0 ? Math.round(total / R.time) : 0,
      dmgBySource: Object.fromEntries(DMG_SOURCES.filter(([k]) => R.dmg[k] > 0).map(([k, label]) => [label, Math.round(R.dmg[k])])),
      chipDmg: chips, chain: this.chain.map((id, i) => withSock(id, i)), inv: this.inventory.filter(Boolean).map(name),
      // 最後的電路數值：插槽數、線數、射速、每發子彈數與傷害、編輯器的估算 DPS、倉庫被動
      stats: { slots: this.chain.length, rps: +s.rps.toFixed(2),
        perFire: s.count, fireDmg: Math.round(s.dmg), estDps: Math.round(s.dpsEst), knock: this.wp.knock,
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
      perf: R.perf ? { ...R.perf } : null, cap: R.cap && R.cap.n ? { ...R.cap } : null,
    };
    return rec;
  },
  // 機體（遊玩紀錄用）：零件層數、零件格、開啟的特性、各晶片的玩法擊殺數
  mechRecord() {
    const T = this.mech.traits;
    return { parts: Object.fromEntries(PART_IDS.filter(id => this.parts[id]).map(id => [PARTS[id].name, this.parts[id]])), slots: this.partSlots,
      traits: [...PART_IDS.flatMap(id => [PARTS[id].t2, PARTS[id].t4]).filter(t => T[t.id]).map(t => t.name), ...(T.balance ? ['均衡'] : [])],
      playKills: Object.fromEntries(Object.entries(this.playKills).map(([k, v]) => [CHIPS[k] ? CHIPS[k].name : k, v])) };
  },
});
