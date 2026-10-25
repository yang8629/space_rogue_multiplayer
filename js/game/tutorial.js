// 星環電路 多人版 · tutorial.js：新手教學：一次教一件事的短戰鬥（每一步的文字在 data/tutorial.js，數字在 CFG.TUTORIAL）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   第一次開遊戲自動進（main.js），之後從中央大廳的終端機進；按住 Esc 跳過；打完、跳過、從選單離開都算看過（Save 的 tutorial）
'use strict';

// 每一步的行為：setup = 開始這一步時擺場地；tick = 每幀（移動的光圈換下一個）；done = 完成了沒；prog = 進度文字（沒有就不顯示）
//   S = Tutorial.S（這一步自己的暫存），每一步開始時清空
const TUTORIAL_PLAY = {
  move: {  // 光圈一個一個亮，衝刺另外算次數；兩個都做到才算
    setup(S) { S.k = 0; S.d0 = Game.runStats.dashes; Tutorial.point(0); },
    tick(S) {
      const X = Game.exit, p = Game.player;
      if (!X || dist2(p.x, p.y, X.x, X.y) > X.r * X.r) return;
      S.k++; ringFx(X.x, X.y, X.r, '#2ee6a6');
      Tutorial.point(S.k);
    },
    done: S => S.k >= CFG.TUTORIAL.points.length && Game.runStats.dashes - S.d0 >= CFG.TUTORIAL.dashes,
    prog: S => `光圈 ${S.k} / ${CFG.TUTORIAL.points.length}　衝刺 ${Math.min(CFG.TUTORIAL.dashes, Game.runStats.dashes - S.d0)} / ${CFG.TUTORIAL.dashes}`,
  },
  shoot: {
    setup() {  // 飛船前方排成一列弧形，不會動、不會打人
      const p = Game.player, n = CFG.TUTORIAL.shootN;
      for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 0.22; Range.spawn(1, p.x + Math.cos(a) * 320, p.y + Math.sin(a) * 320, { type: 'swarmer', move: false, kill: true, lv: 1 }); }
    },
    done: () => Tutorial.alive() === 0,
    prog: () => `${CFG.TUTORIAL.shootN - Tutorial.alive()} / ${CFG.TUTORIAL.shootN}`,
  },
  vent: {
    setup(S) {  // 一圈圍在飛船身邊（排熱的衝擊波打得到；血量一下打得掉）
      const T = CFG.TUTORIAL, p = Game.player;
      S.a0 = p.altN || 0;
      for (let i = 0; i < T.ventN; i++) { const a = i / T.ventN * TAU; for (const e of Range.spawn(1, p.x + Math.cos(a) * T.ventR, p.y + Math.sin(a) * T.ventR, { type: 'swarmer', move: false, kill: true, lv: 1 })) e.hp = e.maxHp = T.ventHp; }
    },
    done: S => Tutorial.alive() === 0 && (Game.player.altN || 0) > S.a0,  // 一隻一隻射掉也行，但要排熱過一次
    prog: () => `剩 ${Tutorial.alive()} 隻`,
  },
  reward: {  // 正式的三選一畫面：晶片、插件、零件各一張，只能選晶片（Game.reward.only）；選完回戰場（CFG.REWARDS.tutorial 的 after）
    setup() {
      const options = tutorialOptions();
      Game.openReward('tutorial', { options, only: options[0] });
      Game.view();
    },
    done: () => Game.state === 'play' && Tutorial.chipAt() >= 0,
  },
  trigger: {  // 前排打不死、後排一列：光束被前排擋住，迴旋刃打得到後排；第一次打到後排停下來說明
    setup(S) { S.row = Tutorial.row(CFG.TUTORIAL.row.hp); },
    tick(S) { if (!S.cued) { const e = S.row.find(q => q.lastAtt && CHIPS[q.lastAtt.src] && baseOf(q.lastAtt.src) === CFG.TUTORIAL.chip); if (e) Tutorial.cue(S, e); } },
    done: S => S.row.every(e => e.dead),
    prog: S => `後排 ${S.row.filter(e => e.dead).length} / ${S.row.length}`,
  },
  plug: {
    keep: true,  // 前排留著
    setup() { const T = CFG.TUTORIAL; if (!Game.inventory.includes(T.plug) && !Game.socks.some(s => s && s.includes(T.plug))) Tutorial.give(T.plug); },  // 已經有了就不再給
    done: () => { const i = Tutorial.chipAt(); return i >= 0 && (Game.socks[i] || []).includes(CFG.TUTORIAL.plug); },
  },
  burn: {  // 同樣的隊形、後排血比較厚：迴旋刃帶著燃燒；第一隻燒起來停下來說明
    setup(S) { S.row = Tutorial.row(CFG.TUTORIAL.row.burnHp); },
    tick(S) { if (!S.cued) { const e = S.row.find(q => q.burnT > 0); if (e) Tutorial.cue(S, e); } },
    done: S => S.row.every(e => e.dead),
    prog: S => `後排 ${S.row.filter(e => e.dead).length} / ${S.row.length}`,
  },
  fight: {
    setup() { Game.combat.wave = 1; for (const t of CFG.TUTORIAL.fight) Game.spawnEnemy(t); },
    done: () => Tutorial.alive() === 0,
    prog: () => `${CFG.TUTORIAL.fight.length - Tutorial.alive()} / ${CFG.TUTORIAL.fight.length}`,
  },
  elite: {
    setup() {
      Game.spawnEnemy(CFG.TUTORIAL.elite);
      const e = Game.enemies[Game.enemies.length - 1];
      e.hp = e.maxHp *= CFG.TUTORIAL.eliteHp;
      bannerFx(`⚠ ${eliteName(e)}`, '', 2);
    },
    done: () => Tutorial.alive() === 0,
  },
};

const Tutorial = {
  i: 0, S: {}, wait: 0, endT: 0, holding: false, hold: 0,
  // 第一次開遊戲要不要自動進（看過就不再自動進）
  //   自動化的瀏覽器（tests/perf 的截圖、連線測試，navigator.webdriver）不自動進：那些腳本開頁面就要在基地
  firstRun() { return !Save.flag('tutorial', false) && !(typeof navigator !== 'undefined' && navigator.webdriver); },
  begin() {
    Game.newRun('tutorial', CFG.TUTORIAL.ship, CFG.TUTORIAL.weapon);
    this.holding = false; this.hold = 0; this.endT = 0;
    this.go(0);
  },
  go(i) {
    this.i = i; this.S = {}; this.wait = 0; Game.exit = null;
    const st = TUTORIAL[i];
    if (!st) { this.endT = CFG.TUTORIAL.endT; bannerFx('教學完成', '回到基地', CFG.TUTORIAL.endT); return; }
    if (!TUTORIAL_PLAY[st.id].keep) { Game.enemies = []; Game.bullets = []; Game.eBullets = []; }  // 新場地：上一步還在飛的子彈（迴旋刃）也清掉，免得一生出來就被打到
    if (i === 0 || TUTORIAL[i - 1].sec !== st.sec) bannerFx(st.sec, '', 1.6);  // 新的一段
    TUTORIAL_PLAY[st.id].setup(this.S);
    Events.emit('tutorialTip');  // 這一步一開始就有泡泡框（熱度條）：叫畫面畫
  },
  tick(dt) {
    if (this.holding && (this.hold += dt) >= CFG.TUTORIAL.skipHold) { this.holding = false; Game.quitRun(); return; }
    if (this.endT > 0) { if ((this.endT -= dt) <= 0) Game.quitRun(); return; }
    if (this.halted()) return;  // 停下來說明中
    const st = TUTORIAL[this.i];
    if (!st) return;
    if (this.wait > 0) { if ((this.wait -= dt) <= 0) this.go(this.i + 1); return; }
    const P = TUTORIAL_PLAY[st.id];
    if (P.tick) P.tick(this.S);
    if (P.done(this.S)) { this.wait = CFG.TUTORIAL.wait; floatText(Game.player.x, Game.player.y - 34, '✓ 完成', '#9dff6b', true); }
  },
  // 按住 Esc：按住 skipHold 秒跳過；沒按滿就放開 = 平常的 Esc（打開選單）
  escDown() { this.holding = true; this.hold = 0; },
  escUp() { if (!this.holding) return; this.holding = false; if (Game.state === 'play') Game.togglePauseMenu(); },
  // 畫面要的：第幾段、目標、進度、按住 Esc 的進度（ui/render.js 畫）
  view() {
    const st = TUTORIAL[this.i];
    if (!st) return null;
    const P = TUTORIAL_PLAY[st.id];
    return { sec: `${TUTORIAL_SECS.indexOf(st.sec) + 1} / ${TUTORIAL_SECS.length}　${st.sec}`, goal: st.goal(), prog: P.prog ? P.prog(this.S) : '',
      done: this.wait > 0, hold: this.holding ? clamp(this.hold / CFG.TUTORIAL.skipHold, 0, 1) : 0 };
  },
  // 泡泡框（ui/bubble.js 畫）：這一步現在要跳的那一個；做完這一步（停一下換下一步的期間）就不跳
  tipNow() {
    const st = TUTORIAL[this.i], t = st && st.tips && st.tips[this.S.tip || 0];
    if (!t || this.wait > 0) return null;
    const term = t.term && TUTORIAL_TERMS[t.term];
    if (t.cue && !this.S.cued) return null;  // 等這一步說「發生了」
    const title = term ? term.title : typeof t.title === 'function' ? t.title() : t.title;
    return { title, text: (term || t).text(), at: t.at, item: t.item && t.item(), stay: !!t.stay, dim: t.dim !== false, cue: !!t.cue, pos: t.cue ? this.S.cueAt : null };
  },
  // 戰場上發生了要說明的事（迴旋刃打到後排、後排燒起來）：記下位置、停住戰場、叫畫面跳泡泡框
  cue(S, e) { S.cued = true; S.cueAt = { x: e.x, y: e.y, r: e.t.radius }; Events.emit('tutorialTip'); },
  halted() { const t = this.tipNow(); return !!(t && (t.cue || t.at === 'hud')); },  // 戰鬥中跳泡泡框：戰場停住
  nextTip() { const t = this.tipNow(); if (t && !t.stay) this.S.tip = (this.S.tip || 0) + 1; },  // 點畫面：換下一個
  // 電路畫面底下提示列的字：這一步要做的事；在電路畫面裡就做到了（插好插件）= 叫玩家回戰鬥
  tip() {
    const st = TUTORIAL[this.i];
    return !st ? '' : TUTORIAL_PLAY[st.id].done(this.S) ? '✓ 完成：按 Tab 回到戰鬥' : st.goal();
  },
  // 移動要飛到的第 k 個點（沒有了就收掉）：畫成出口的光圈（gl_world.js 的 exit）
  point(k) {
    const P = CFG.TUTORIAL.points[k];
    Game.exit = P ? { x: Arena.center.x + P[0], y: Arena.center.y + P[1], r: CFG.TUTORIAL.pointR, label: '目標' } : null;
  },
  alive() { return Game.enemies.filter(e => !e.dead).length; },
  // 插插件那一步：教學的插件只能插在教學的晶片上（插到飛船的插座就看不到迴旋刃燒起來）；不能插回傳原因（ui/editor.js 的 canPlug 顯示）
  plugLock(h, id) {
    const st = TUTORIAL[this.i], T = CFG.TUTORIAL;
    return st && st.id === 'plug' && baseOf(id) === T.plug && h !== this.chipAt() ? `這次插在${CHIPS[T.chip].name}下面的插座` : '';
  },
  // 迴旋的隊形：前排一隻打不死（光束被它擋住），後面一列 n 隻（血量 hp，只有迴旋刃打得到）
  //   一律橫著排、往場地中間那一側（飛船靠牆時不排到牆外）：直著排時整列約 440 長，畫面上下 720 放不下（10-25 使用者看到最後幾隻在畫面外）
  row(hp) {
    const T = CFG.TUTORIAL.row, p = Game.player;
    const a = Arena.center.x >= p.x ? 0 : Math.PI, at = d => [p.x + Math.cos(a) * d, p.y];
    Range.spawn(1, ...at(T.dist), { type: T.front, move: false, kill: false, lv: 1 });
    const out = [];
    for (let k = 1; k <= T.n; k++) for (const e of Range.spawn(1, ...at(T.dist + ENEMY_TYPES[T.front].radius + k * T.gap), { type: 'swarmer', move: false, kill: true, lv: 1 })) { e.hp = e.maxHp = hp; e.hurtBy = CFG.TUTORIAL.chip; out.push(e); }  // 後排只有迴旋刃打得到（光束從旁邊直接打也打不死）
    return out;
  },
  give(id) { const k = Game.inventory.indexOf(null); if (k >= 0) Game.inventory[k] = id; },  // 放進倉庫第一個空格
  chipAt() { return Game.chain.findIndex(id => id && baseOf(id) === CFG.TUTORIAL.chip); },  // 教學的晶片裝在電路第幾格（沒裝 = -1）
};
