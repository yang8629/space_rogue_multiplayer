// 星環電路 多人版 · game_stations.js：Game 的獎勵與各種站：取得晶片、改裝廠、商店、武器（軍械台）、？事件
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   往 game.js 的 Game 加方法（外面照樣呼叫 Game.xxx）
'use strict';

Object.assign(Game, {
  // ---------- 取得晶片：放進倉庫（不會自動合成：同種晶片玩家自己拖到一起才合成，見 Editor.merge） ----------
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
  // mode：稀有版本、身上那個已經有不同的詞條時，replace 替換／boost 增強（預設）
  takeReward(id) {
    if (this.reward && this.reward.only && id !== this.reward.only) return;  // 新手教學：指定選哪張
    let msg;
    if (id && id.startsWith('part:')) {  // 零件
      const k = id.slice(5);
      if (!this.addPart(k)) return;
      Events.emit('upgrade');
      this.afterReward(`裝上零件 ${PARTS[k].name}（${this.parts[k]} 層）` + this.mechGain());
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
      const j = this.inventory.lastIndexOf(id), P = this.autoPlace(id);
      if (j >= 0 && P && P.sock != null) { const h = P.sock; (this.socks[h] = this.socks[h] || []).push(id); this.inventory[j] = null; this.recalc(); msg = `「${CHIPS[id].name}」已插在${CHIPS[this.chain[h]].name}上`; }
      else if (j >= 0 && P) { this.insertChip(id); this.inventory[j] = null; this.recalc(); msg = `「${CHIPS[id].name}」已裝上電路，接在最後`; }
      else toInv = j >= 0;
    }
    this.afterReward(msg);
    if (toInv) this.openEditorWith(msg);
  },
  // 拿到 id 會自動裝在哪：{ sock: h } 第 h 格的插座、{ tail: true } 接在線的最後、null = 進倉庫（三選一卡片的預覽也用它）
  autoPlace(id) {
    if (isComp(id)) {  // 插件：插進武器或電路上第一片還有空插座的晶片
      const h = this.chain.findIndex((c, i) => c && (this.socks[i] || []).length < socketsOf(c));
      return h >= 0 ? { sock: h } : null;
    }
    if (!this.chain.includes(null)) return null;
    return { tail: true };
  },
  // ---------- 電路格（見 chips.js 開頭）：空格集中在最後 ----------
  // 晶片往前靠、空格集中在最後；插座跟著晶片走（原地改：編輯器拖放登記的位置還指著同一個陣列）
  packChain() {
    const C = this.chain, order = [...C.keys()].sort((a, b) => !C[a] - !C[b] || a - b);
    const socks = order.map(i => C[i] ? (this.socks[i] || []) : []);
    C.splice(0, Infinity, ...order.map(i => C[i]));
    this.socks = socks;
  },
  // 把 id 接在線的最後（用掉一個空位；sk = 帶著的插件）；沒有空位回傳 false
  insertChip(id, sk = []) {
    this.packChain();
    const z = this.chain.indexOf(null);
    if (z < 0) return false;
    this.chain[z] = id; this.socks[z] = sk;
    return true;
  },
  // 選完三選一：回到 CFG.REWARDS 的 after（旗艦：勝利畫面），沒寫就回航圖
  afterReward(msg) {
    const R = this.reward;
    this.reward = null;
    if (R && R.again > 0) { this.openReward('combat', { again: R.again - 1, rare: (R.rare || 0) - 1, note: `${msg || ''}<br>✦ 再選一次` }); this.view(); return; }  // 求救訊號「只護送」：打贏多一次三選一
    if (R && R.after === 'play') { this.state = 'play'; this.view(); return; }  // 新手教學：選完回戰場
    if (!R || R.after !== 'victory') return this.showMap(msg);
    const V = this.victory;
    V.rew = true;
    if (this.isClient() && bossDone(V)) Net.send({ t: 'moddone' });
    this.state = 'victory';
    this.view();
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
    const items = this.withComp(pickN(this.chipOffers(), 4).map(id => newChip(id, undefined, rollRare(id, CFG.RARE.shop)))).map(id => ({ id, price: this.shopPrice(chipPrice(id)), sold: false }));
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
    const W = WEAPONS[this.weapon.id], st = this.weapon, c = CHIPS.weapon, sh = SHIPS[this.shipId];
    this.wp = weaponParams(st);
    c.name = sh ? `${sh.name}・${W.short}` : weaponTitle(st);
    c.short = W.short;
    const lines = [descList(W.desc)];
    if (st.path) lines.push(`第一段・${W.paths[st.path].name}：${W.paths[st.path].desc}`);
    if (st.final != null) { const n = W.paths[st.path].next[st.final]; lines.push(`第二段・${n.name}：${n.desc}`); }
    c.desc = lines.join('<br>') + (this.mode === 'range' ? '<br><span style="color:#6a79ad">武器固定在電路第 1 格；靶場可在「🚀 機體・武器」分頁更換。</span>'
      : '<br><span style="color:#6a79ad">武器固定在電路第 1 格，這一場不能更換。</span>');
    if (this.player) this.recalc();
  },
  swapShip(id) {  // 靶場：換機體（保留位置、電路與倉庫）
    const old = this.player;
    this.shipId = id;
    this.parts = { ...SHIPS[id].parts }; this.partSlots = SHIPS[id].partSlots; this.cap = SHIPS[id].cap;
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
      // 武器都已經升滿（雙人：每個人都升滿）就不再出現軍械台，改成戰鬥
      const maxed = W => W && W.final != null;
      if (maxed(this.weapon) && this.mates.every(m => maxed(m.L && m.L.weapon)))
        for (const n of this.map.flat()) if (n.type === 'armory') n.type = 'combat';
    }
    this.node = null; this.visited = [];
    if (this.mode === 'coop' && Net.role === 'host') Net.sendSector();
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.3));
    this.showMap(this.sector === this.lastSector() + 1
      ? `進入無盡模式：星區 ${this.sector}，船體修復 30%。旗艦改為隨機出現`
      : `進入星區 ${this.sector}：船體修復 30%，敵人更強了`);
  },
  // ---------- ？事件節點（EVENTS，data/events.js）：看情境、選一個選項 ----------
  openEvent(node) {
    const E = EVENTS[node.ev];
    if (!E) { this.showMap(); return; }
    this.ev = { id: node.ev, node };
    this.state = 'event';
    this.view();
  },
  // 選第 i 個選項（回傳值見 data/events.js 開頭）：賭運氣的結果先留在事件畫面揭曉（ev.res），按「繼續」才到 evNext
  evChoose(i) {
    const V = this.ev, E = V && EVENTS[V.id], o = E && E.opts[i];
    if (this.state !== 'event' || !o || V.res || (o.can && !o.can(this, V.node))) return;
    if (E.team && this.mode === 'coop' && Net.linked) {  // 全隊投票的事件：這一下是投票，結果等房主抽（evResolve）
      if (V.vote == null) { V.vote = i; Net.evVote(i); this.view(); }
      return;
    }
    const r = o.go(this, V.node);
    if (this.runStats) this.runStats.got.push(`${this.here()} 事件 ${E.name}：${o.lab}${r && typeof r === 'object' ? ' → ' + r.msg : ''}`);
    if (r && typeof r === 'object') { V.res = r; this.view(); return; }
    this.ev = null;
    if (r === true) this.view(); else this.showMap(r || '');
  },
  // 全隊投票的結果（房主抽的，全隊一樣）：照第 i 個選項做，事件畫面寫出每個人投什麼、抽中哪個，按「繼續」回航圖
  evResolve(i, votes) {
    const V = this.ev, E = V && EVENTS[V.id], o = E && E.opts[i];
    if (this.state !== 'event' || !o || V.res) return;
    this.evTeamNow = true;  // 全隊各自套用同一個結果：addSos 不用再廣播
    const r = o.go(this, V.node);
    this.evTeamNow = false;
    const who = Object.keys(votes).map(Number).sort((a, b) => a - b).map(s => `${s}P 投「${E.opts[votes[s]] ? E.opts[votes[s]].lab : '?'}」`).join('、');
    const drawn = new Set(Object.values(votes)).size > 1;
    if (this.runStats) this.runStats.got.push(`${this.here()} 事件 ${E.name}：${o.lab}（全隊投票）`);
    V.res = { msg: `${drawn ? '🎲 抽中：' : '全隊：'}${o.lab}`, sub: who, color: E.color, then: () => false, map: typeof r === 'string' ? r : '' };  // sub：每個人投了什麼（小字）
    this.view();
  },
  evNext() {
    const r = this.ev && this.ev.res;
    if (this.state !== 'event' || !r) return;
    this.ev = null;
    if (r.then && r.then(this)) this.view(); else this.showMap(r.map != null ? r.map : r.msg);  // map：回航圖時的提示（全隊投票的結果用選項自己的文字）
  },
  evHp(k) { return Math.round(this.player.maxHp * k); },  // 事件：最大 HP 的 k 是多少
  evHurt(k) { const p = this.player, hp = this.evHp(k); p.hp = Math.max(1, p.hp - hp); return hp; },  // 事件扣血：最少留 1 HP
  // 下一場一般戰鬥或精英戰變難（CFG.EVENT.sos 的 key）：全隊一起（雙人：誰觸發都告訴所有人；敵人由房主產生）
  //   sos.mul = 全隊最大的倍數；sos.mine = 自己選的、sos.team = 隊友選的裡面倍數最大的；打贏的獎勵照自己選的，自己沒選（或選的沒獎勵）就照隊友的
  addSos(key, fromNet = false) {
    const S = CFG.EVENT.sos[key], cur = this.sos || { mul: 1, mine: null, team: null };
    if (!S) return;
    cur.mul = Math.max(cur.mul, S.mul);
    if (fromNet) { if (!cur.team || S.mul > CFG.EVENT.sos[cur.team].mul) cur.team = key; } else cur.mine = key;
    this.sos = cur;
    if (!fromNet && this.mode === 'coop' && !this.evTeamNow) Net.sendSos(key);  // 全隊投票的結果：每個人各自套用，不用廣播
  },
  // 進下一場戰鬥：帶上變難的倍數（sos）和自己的獎勵（sosKey），用掉
  takeSos() {
    const S = this.sos;
    this.sos = null;
    return S ? { sos: S.mul, sosKey: this.sosPay(S) } : {};
  },
  // 打贏拿哪一種獎勵（CFG.EVENT.sos 的 key）：自己選的有獎勵就照自己的，不然照隊友的；都沒有 = null
  sosPay(S) { const pays = k => k && (CFG.EVENT.sos[k].bonus || CFG.EVENT.sos[k].again); return pays(S.mine) ? S.mine : pays(S.team) ? S.team : null; },
  // 星圖情報：把這幾場一般戰鬥標成寶藏星域（全隊：雙人時告訴所有人）
  markHoard(ids, fromNet = false) {
    const L = ids.map(id => this.nodeById(id)).filter(n => n && n.type === 'combat');
    for (const n of L) n.hoard = true;
    if (!fromNet && this.mode === 'coop' && L.length) Net.sendHoard(L.map(n => n.id));
  },
  wardOf(p) { const B = p === this.player ? this.boons : p.L ? p.L.boons : null; return B ? B.ward : p.ward || 0; },  // 還能免死幾次（隊友那邊看別人的：同步來的 p.ward）

  // 終焉護殼：受到致命傷害時留 1 HP、無敵一下，用掉一次（隊友的由房主判定，用掉時告訴那個隊友）
  wardSave(p) {
    const B = p.L ? p.L.boons : this.boons;
    if (!B || !(B.ward > 0)) return false;
    B.ward--;
    p.hp = 1; p.iframe = Math.max(p.iframe, CFG.EVENT.ward.iframe);
    burst(p.x, p.y, '#ffd166', 50, 320, 0.8, 3); ringFx(p.x, p.y, 110, '#ffd166');
    bannerFx('⛨ 終焉護殼', `${this.mode === 'coop' ? this.tagOf(p) + ' ' : ''}撐住了致命的一擊（無敵 ${CFG.EVENT.ward.iframe} 秒）`, 2);
    if (p.L) Net.sendWard(p);
    Events.emit('wardSave', p);
    return true;
  },

});
