// QA 模式（找 bug 用，不量平衡）：電腦照真實規則打完整局，但所有選擇都隨機
//   （三選一、晶片放哪一格、組件插哪裡、武器路線、模組、補給站買什麼、奇異點投什麼）→ 把各種奇怪的組合都跑一遍
//   每一幀檢查：程式錯誤、子彈／敵人爆量、座標或血量變成 NaN、單幀太慢；戰鬥超過 300 秒而且最近 60 秒沒打掉血（或超過 900 秒）= 卡住（watchdog）
//   有問題就印出局號（--only=局號 可以重現）和當時的狀態
// 用法：node qasim.js --n=200 [--only=3,17] [--tweak="..."]
'use strict';
const T_ = require('./load_game').loadGame();
const G = T_.Game, CH = T_.CHIPS;
G.simFast = true;  // 模擬：不等給人看的時間（區域肅清 1.6 秒）
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
if (arg('tweak')) require('vm').runInThisContext(arg('tweak'));
const { seed, splitEnemyRng, noFx, resetRun } = require('./rng');
splitEnemyRng(T_); noFx();
const N = +(arg('n') || 100), ONLY = arg('only') ? arg('only').split(',').map(Number) : null, dt = 1 / 60;
const LIMIT = { bullets: +(process.env.QA_BULLETS || 4000), eBullets: 3000, enemies: 250, frameMs: 400 };  // QA_BULLETS：子彈上限（量效能時調高）

// 戰鬥操作照整局模擬的熟練玩家（runsim.js 的 baseBot / bot）
const fs = require('fs'), QB = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));  // bot/fight.js
const bot = QB.bot;
const { isComp, socketsOf, NORMAL_IDS, WEAPONS, SHIPS, CFG } = T_, PART_IDS = require('vm').runInThisContext('PART_IDS');
const pickR = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// 隨機配裝：電路、插座、倉庫裡的東西全部拿出來洗牌，晶片隨便放進電路格，組件隨便插在有空插座的地方，剩下的回倉庫
function randomEquip() {
  const all = [...G.chain.slice(1), ...(G.socks || []).flat(), ...G.inventory].filter(Boolean);
  const chips = shuffle(all.filter(id => !isComp(id))), comps = shuffle(all.filter(id => isComp(id)));
  const n = G.chain.length - 1, chain = ['weapon', ...Array(n).fill(null)];
  const slots = shuffle([...Array(n).keys()].map(i => i + 1));
  const rest = [];
  for (const id of chips) { const i = slots.pop(); if (i != null && Math.random() < 0.9) chain[i] = id; else rest.push(id); }
  const socks = chain.map(() => []);
  for (const c of comps) {
    const hosts = chain.map((id, i) => i).filter(i => chain[i] && socks[i].length < (i === 0 ? (G.wSock || 0) : socketsOf(chain[i])));
    if (hosts.length && Math.random() < 0.9) socks[pickR(hosts)].push(c); else rest.push(c);
  }
  G.chain = chain; G.socks = socks;
  G.inventory = [...rest, ...Array(CFG.INV_SLOTS).fill(null)].slice(0, CFG.INV_SLOTS);
  G.recalc();
}

const issues = [];
function report(s, kind, msg) {
  const st = `星區 ${G.sector} 第 ${G.node ? G.node.L + 1 : 0} 層｜${WEAPONS[G.weapon.id].name}${G.weapon.path ? ' ' + G.weapon.path + (G.weapon.final ?? '') : ''}｜電路 ${G.chain.map((id, i) => (id || '空') + ((G.socks || [])[i] && G.socks[i].length ? '[' + G.socks[i].join('+') + ']' : '')).join(',')}`;
  issues.push({ s, kind, msg, st });
  console.log(`✖ 第 ${s} 局 ${kind}：${msg}\n    ${st}`);
}

function oneRun(s) {
  seed(77000 + s * 131); resetRun(T_); QB.resetBot();
  const w = pickR(Object.keys(WEAPONS)), ship = pickR(Object.keys(SHIPS));
  G.newRun('run', ship, w, pickR(NORMAL_IDS));
  for (let guard = 0; guard < 300; guard++) {
    const st = G.state;
    try {
      if (st === 'map') {
        const opts = G.reachable() || [];
        const n = opts.length ? pickR(opts) : null;
        if (!n) { report(s, '航圖', '沒有可以走的節點'); return; }
        G.enterNode(n);
      } else if (st === 'play') {
        const p = G.player; let t = 0;
        while (G.state === 'play' && (t < 300 || (t < 900 && QB.stallSecs() < 60))) {  // 300 秒後還在打掉血（最近 60 秒內）就繼續，最多 900 秒
          bot(p);
          const t0 = Date.now();
          G.update(dt); t += dt;
          const ms = Date.now() - t0;
          if (ms > LIMIT.frameMs) { report(s, '單幀太慢', `${ms}ms（子彈 ${G.bullets.length}、敵彈 ${G.eBullets.length}、敵人 ${G.enemies.length}）`); return; }
          if (G.bullets.length > LIMIT.bullets) { report(s, '子彈爆量', `${G.bullets.length} 發`); return; }
          if (G.eBullets.length > LIMIT.eBullets) { report(s, '敵彈爆量', `${G.eBullets.length} 發`); return; }
          if (G.enemies.length > LIMIT.enemies) { report(s, '敵人爆量', `${G.enemies.length} 隻`); return; }
          if (!isFinite(p.x) || !isFinite(p.y) || !isFinite(p.hp)) { report(s, 'NaN', `飛船 ${p.x},${p.y} HP ${p.hp}`); return; }
          const bad = G.enemies.find(e => !isFinite(e.x) || !isFinite(e.y) || !isFinite(e.hp));
          if (bad) { report(s, 'NaN', `敵人 ${bad.t.name} ${bad.x},${bad.y} HP ${bad.hp}`); return; }
        }
        if (G.state === 'play') { report(s, '卡住', `戰鬥超過 300 秒、最近 60 秒沒打掉血（最多 900 秒）：波次 ${G.combat.wave}/${G.combat.wavesTotal}，敵人 ${G.enemies.filter(e => !e.dead).map(e => `${e.t.name}@${Math.round(e.x)},${Math.round(e.y)}`).join(' ') || '無'}，飛船 ${Math.round(p.x)},${Math.round(p.y)} 區${p.zone}`); return; }
      } else if (st === 'reward') {
        const R = G.reward;
        if (R.kind === 'elite' && R.slot && Math.random() < 0.3) G.expandSlot('reward');  // 精英：多一張電路擴充
        else {
          if (Math.random() < 0.15 && G.credits >= R.reroll) G.rerollReward();
          const ok = R.options.filter(id => G.canAcquire(id));
          G.takeReward(Math.random() < 0.1 || !ok.length ? null : pickR(ok));
        }
        if (G.state === 'editor') G.toggleEditor();
        randomEquip();
      } else if (st === 'shop') {
        if (Math.random() < 0.5) G.shopHeal();
        if (Math.random() < 0.3) G.expandSlot('shop');
        G.shop.items.forEach((it, i) => { if (!it.sold && Math.random() < 0.5) G.buy(i); });
        randomEquip(); G.showMap();
      } else if (st === 'workshop') {
        G.wsPick(pickR(G.ws.options));
        if (Math.random() < 0.3) { const own = Object.keys(G.parts).filter(k => G.parts[k] > 0); if (own.length) { G.wsFrom(pickR(own)); G.wsTo(pickR(PART_IDS)); } }
        G.showMap();
      } else if (st === 'armory') {
        const W = WEAPONS[G.weapon.id];
        if (G.weaponStage() === 0) G.upgradeWeapon(pickR(Object.keys(W.paths)));
        else if (G.weaponStage() === 1) G.upgradeWeapon(String(Math.floor(Math.random() * 2)));
        else G.armoryBonus();
      } else if (st === 'blackhole') {
        const own = G.ownedFusable ? G.ownedFusable() : [];
        if (own.length && Math.random() < 0.6) { G.bhToggle(pickR(own).key); G.bhFuse(); }
        if (G.state === 'blackhole') G.showMap();
        randomEquip();
      } else if (st === 'repair') G.showMap();
      else if (st === 'victory') {
        if (G.victory && !G.victory.pick) G.pickBossSlot(Math.random() < 0.5 ? 'chain' : 'part');
        if (G.chapterDone()) return 'won';
        G.nextSector(); randomEquip();
      } else if (st === 'dead') return 'dead';
      else if (st === 'editor') G.toggleEditor();
      else { report(s, '畫面卡住', `狀態 ${st} 沒有處理`); return; }
    } catch (e) {
      report(s, '程式錯誤', `${st}：${String(e && e.stack || e).split('\n').slice(0, 4).join(' ← ')}`);
      return;
    }
  }
  report(s, '卡住', '超過 300 個步驟沒有結束');
}

const t0 = Date.now(), res = { won: 0, dead: 0 };
for (const s of ONLY || [...Array(N).keys()]) { const r = oneRun(s); if (r) res[r]++; if (process.env.QA_SIG) console.log(`局 ${s}：${r || '問題'} 星區 ${G.sector} 層 ${G.node ? G.node.L + 1 : 0} 殺 ${G.kills} HP ${Math.round(G.player.hp)} 時間 ${G.time.toFixed(2)}`); }  // QA_SIG：每局印一行（確認同一局重現得出來）
const kinds = {}; for (const q of issues) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
console.log(`QA 模式：${(ONLY || Array(N)).length} 局（${Math.round((Date.now() - t0) / 1000)} 秒）｜通關 ${res.won}、死 ${res.dead}｜問題 ${issues.length} 個${issues.length ? '：' + Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join('、') + `（重現：--only=${issues.map(q => q.s).join(',')}）` : ''}`);
