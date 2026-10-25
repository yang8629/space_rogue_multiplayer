// 星環電路 多人版 · tutorial.js：新手引導：一次教一件事的短戰鬥（每一步的文字在 data/tutorial.js，數字在 CFG.TUTORIAL）
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
    setup(S) {  // 一圈圍在飛船身邊（排熱的衝擊波打得到）
      const p = Game.player, n = CFG.TUTORIAL.ventN;
      S.a0 = p.altN || 0;
      for (let i = 0; i < n; i++) { const a = i / n * TAU; Range.spawn(1, p.x + Math.cos(a) * CFG.TUTORIAL.ventR, p.y + Math.sin(a) * CFG.TUTORIAL.ventR, { type: 'swarmer', move: false, kill: true, lv: 1 }); }
    },
    done: S => (Game.player.altN || 0) > S.a0,
  },
  reward: {  // 正式的三選一畫面：晶片、插件、零件各一張，只能選晶片（Game.reward.only）；選完回戰場（CFG.REWARDS.tutorial 的 after）
    setup() {
      const T = CFG.TUTORIAL, options = [chipId(T.chip, 1), T.plug, 'part:' + T.part];
      Game.openReward('tutorial', { options, only: options[0] });
      Game.view();
    },
    done: () => Game.state === 'play' && Tutorial.chipAt() >= 0,
  },
  trigger: {
    setup() { const p = Game.player; for (const [dx, dy] of CFG.TUTORIAL.dummies) Range.dummy(p.x + dx, p.y + dy); },
    done: () => (Game.runStats.chips[CFG.TUTORIAL.chip] || 0) > 0,
  },
  plug: {
    keep: true,  // 標靶留著：插上之後打標靶看得到燃燒
    setup() { Tutorial.give(CFG.TUTORIAL.plug); },
    done: () => { const i = Tutorial.chipAt(); return i >= 0 && (Game.socks[i] || []).includes(CFG.TUTORIAL.plug); },
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
    if (!st) { this.endT = CFG.TUTORIAL.endT; bannerFx('引導完成', '回到基地', CFG.TUTORIAL.endT); return; }
    if (!TUTORIAL_PLAY[st.id].keep) Game.enemies = [];
    if (i === 0 || TUTORIAL[i - 1].sec !== st.sec) bannerFx(st.sec, '', 1.6);  // 新的一段
    TUTORIAL_PLAY[st.id].setup(this.S);
  },
  tick(dt) {
    if (this.holding && (this.hold += dt) >= CFG.TUTORIAL.skipHold) { this.holding = false; Game.quitRun(); return; }
    if (this.endT > 0) { if ((this.endT -= dt) <= 0) Game.quitRun(); return; }
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
    return { title: term ? term.title : t.title, text: (term || t).text(), at: t.at, i: t.i, item: t.item && t.item(), stay: !!t.stay };
  },
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
  give(id) { const k = Game.inventory.indexOf(null); if (k >= 0) Game.inventory[k] = id; },  // 放進倉庫第一個空格
  chipAt() { return Game.chain.findIndex(id => id && baseOf(id) === CFG.TUTORIAL.chip); },  // 引導的晶片裝在電路第幾格（沒裝 = -1）
};
