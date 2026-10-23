// 接線表：電路那條線（docs/設計方向.md「線」）上，晶片接晶片、武器接第一格、插件插晶片，接起來的效果
//   線是前一格的產物觸發下一格，所以「A 接 B 配不配」只看兩件事：A 讓 B 觸發幾次（傳遞）、B 觸發在哪（落點：例如漩渦結束時敵人都在中心）
//   遊戲本來就把傷害記在各自的晶片上（runStats.chips），一場就看得出每一格打了多少，不用「裝／不裝」各跑一次相減
//   固定亂數：同樣的程式跑出同樣的數字（改了晶片用 --diff 看哪幾格變了）
// 用法：
//   node chiplink.js                第一步：晶片接晶片（7 × 7 種接法，武器自動射最近的敵人，3 種戰況各 20 秒）
//   node chiplink.js --weapons      第二步：武器接第一格（熟練玩家打一般戰：第一格每秒被觸發幾次、多少是招牌動作）
//   node chiplink.js --plugs        第三步：插件插在每種晶片上（效果有沒有套到那格的產物）
//   篩選：--w=laser（第一、三步的武器；第二步 = 只跑這幾把）  --sc=群  --chips=vortex,boomerang  --n=3（第二步每格幾場）
//   --save 存成基準 chiplink_base.json；--diff 只印跟基準差 10% 以上的格子
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const T_ = require('./load_game').loadGame();
const M = T_.MechCheck, G = T_.Game, CH = T_.CHIPS;
const { seed, splitEnemyRng, noFx } = require('./rng');
splitEnemyRng(T_); noFx();
G.simFast = true;
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const has = k => process.argv.includes(`--${k}`);
const BASE = path.join(__dirname, 'chiplink_base.json');
const dt = 1 / 60, SEC = 20, LV = 3;  // 每場 20 秒（10 秒時 A 只觸發約 14 次，太少）；敵人血量照難度 3（第 1 星區後段）
const DECAY = vm.runInThisContext('LINE_DECAY'), HPM = vm.runInThisContext('enemyHpMul')(LV);
const WN = Object.fromEntries(Object.entries(T_.WEAPONS).map(([id, w]) => [id, w.short || w.name]));
const ALLCH = Object.keys(CH).filter(id => CH[id].type === 'chip'), PLUGS = Object.keys(CH).filter(id => CH[id].type === 'comp');
const CHIPS = arg('chips') ? arg('chips').split(',') : ALLCH;
const nm = id => CH[id].short || CH[id].name;
const pad = (s, n) => { s = String(s); const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 2 : 1), 0); return ' '.repeat(Math.max(0, n - w)) + s; };  // 中文字算兩格寬

// 飛船由熟練玩家開（bot/，跟整局模擬同一套：走位、瞄準、招牌動作都照真的玩法）
const BOT = require('./bot/load').loadBot(code => vm.runInThisContext(code));
// 戰況：敵人用真的 AI（會追、會打；飛船不會受傷），死掉的 0.5 秒後在外圈補一隻（密度不變，量的是穩定的觸發速度）
//   散開：敵人不會動（站在扇形的不同距離），看產物飛得到多遠
const ring = (n, r) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2) * r, Math.sin(i / n * Math.PI * 2) * r]);
const SC = {
  群: { list: ring(14, 260), type: 'swarmer', hp: HPM, frozen: false },
  精英: { list: [[260, 0]], type: 'brute', hp: HPM * 15, frozen: false },
  散開: { list: M.cone, type: 'brute', hp: HPM, frozen: true },
};
const SCS = Object.keys(SC).filter(s => !arg('sc') || arg('sc').split(',').includes(s));

// 打一場：chain = 電路（插件寫在晶片後面 = 插在它上面，見 MechCheck.setup）；回傳每一格被觸發幾次、每個晶片的傷害、減速了幾隻
function scene(w, chain, sc) {
  seed(12345);
  M.setup('run', 'vanguard', w, null, null, [...chain, null]);
  const S = SC[sc], p = G.player;
  const spawn = ([dx, dy]) => { const keep = G.enemies, e = M.targets([[dx, dy]], S.type, S.frozen, S.hp)[0]; G.enemies = keep; e.home0 = [dx, dy]; return e; };  // targets 會換掉整個 Game.enemies：放回去
  G.enemies = S.list.map(spawn); G.combat = null; G.state = 'play';
  BOT.resetBot(); Object.assign(Input, { down: false, dash: false, joy: null, aimStick: null, mx: 0, my: 0 }); Input.keys.clear();
  const n = {}, fire = G.lineFire, hurt = G.hurtPlayer, chips0 = { ...G.runStats.chips }, dead = [];
  let slowed = 0;
  G.lineFire = function (t) { n[t.k] = (n[t.k] || 0) + 1; return fire.call(this, t); };
  G.hurtPlayer = () => {};
  try {
    for (let f = 0; f < SEC * 60; f++) {
      BOT.bot(p); G.update(dt);
      for (const e of G.enemies) {
        if (e.slowT > 0 && !e.slowSeen) { e.slowSeen = true; slowed++; }
        if (e.dead && !e.gone) { e.gone = true; dead.push({ t: G.time + 0.5, at: e.home0 }); }
      }
      while (dead.length && dead[0].t <= G.time) {  // 補一隻：不會動的補回原位，會動的補在外圈（角度照幀數轉，固定不靠亂數）
        const d = dead.shift(), a = f * 2.4, e = spawn(S.frozen ? d.at : [Math.cos(a) * 320, Math.sin(a) * 320]);
        G.enemies.push(e); e.home0 = d.at;
      }
      G.enemies = G.enemies.filter(e => !e.gone);
    }
  } finally { G.lineFire = fire; G.hurtPlayer = hurt; }
  const dmg = {};
  for (const k in G.runStats.chips) dmg[k] = (G.runStats.chips[k] || 0) - (chips0[k] || 0);
  return { n, dmg, slowed };
}
const chipDmg = r => Object.entries(r.dmg).reduce((a, [k, v]) => a + (CH[k] && CH[k].type === 'chip' ? v : 0), 0);  // 線上晶片打的（不含武器、插件的元素傷害）
const r1 = x => x.toFixed(1);

// ---------- 第二步：武器接第一格 ----------
if (has('weapons')) {
  const B = BOT, N = +(arg('n') || 3), WPN = arg('w') ? arg('w').split(',') : Object.keys(WN);
  const n = { hit: 0, sig: 0 }, fire = G.lineFire, sig = G.lineSig;
  G.lineFire = function (t) { if (t.k === 0) n[t.sig ? 'sig' : 'hit']++; return fire.call(this, t); };
  G.lineSig = function (...a) { const Q = this.triggerQueue, before = Q.length; sig.apply(this, a); for (let i = before; i < Q.length; i++) Q[i].sig = true; };  // 招牌動作排進去的觸發做記號
  G.hurtPlayer = () => {};  // 飛船不會死（量的是觸發，不是掉血）
  console.log(`第二步：武器接第一格。熟練玩家打一般戰（難度 ${LV}、3 波），飛船不會死；每格 ${N} 場`);
  console.log('數字 = 第一格每秒被觸發幾次（括號 = 其中招牌動作佔幾成）；設計方向：命中頻率不同的武器觸發次數差不多');
  console.log('第一格'.padEnd(6) + WPN.map(w => pad(WN[w], 14)).join(''));
  const avg = Object.fromEntries(WPN.map(w => [w, []]));
  for (const c of CHIPS) {
    const cells = WPN.map(w => {
      let t = 0; n.hit = n.sig = 0;
      for (let s = 0; s < N; s++) {
        B.resetBot(); Object.assign(Input, { down: false, dash: false, joy: null, aimStick: null, mx: 0, my: 0 }); Input.keys.clear(); G.time = 0; G.nextId = 1;
        seed(4000 + s); G.newRun('run', 'vanguard', w); G.chain = ['weapon', c, null]; G.socks = [[], []]; G.recalc();
        G.node = { type: 'combat', L: 2, id: 'sim' }; G.startCombat({ level: LV, wavesTotal: 3, elites: 0 });
        let tt = 0; while (G.state === 'play' && tt < 240) { B.bot(G.player); G.update(dt); tt += dt; }
        t += tt;
      }
      const ps = (n.hit + n.sig) / t; avg[w].push(ps);
      return pad(`${r1(ps)}（${Math.round(n.sig / Math.max(1, n.hit + n.sig) * 10)}成）`, 14);
    });
    console.log(pad(nm(c), 6) + '  ' + cells.join(''));
  }
  console.log('平均'.padEnd(6) + WPN.map(w => pad(r1(avg[w].reduce((a, x) => a + x, 0) / avg[w].length), 14)).join(''));
  process.exit(0);
}

// ---------- 第三步：插件插在每種晶片上 ----------
//   看的是產物本身，不比整場的結果（整場的話傷害一變、敵人死的時間就變，後面全部跟著不同，看不出插件有沒有套上）：
//   17 隻不會動、打不死的靶排成一團，飛船不開火，直接觸發那格晶片 8 次（每 0.5 秒、在正中那隻身上），量 5 秒
function plugProbe(chain, c) {
  seed(12345);
  M.setup('run', 'vanguard', arg('w') || 'laser', null, null, [...chain, null]);
  const es = M.targets([[200, 0], ...ring(8, 45).map(([x, y]) => [200 + x, y]), ...ring(8, 95).map(([x, y]) => [200 + x, y])], 'brute', true, 60);
  G.combat = null; G.state = 'play';
  Object.assign(Input, { touch: false, autoFire: false, down: false, dash: false, joy: null, aimStick: null }); Input.keys.clear();
  const hurt = G.hurtPlayer, chips0 = { ...G.runStats.chips }, seen = { burn: new Set(), slow: new Set(), shred: new Set() }, src = c === 'echo' ? 'echo' : c;
  let maxR = 0;
  G.hurtPlayer = () => {};
  try {
    for (let f = 0; f < 5 * 60; f++) {
      if (f % 30 === 0 && f < 8 * 30) G.lineQueue(null, G.stats.line, 0, es[0].x, es[0].y, 0, es[0].id);
      G.update(dt);
      for (const b of G.bullets) if (b.att && b.att.src === src) maxR = Math.max(maxR, b.vortex || b.r);  // 大小：產物的半徑（漩渦 = 吸的範圍）
      for (const e of es) { if (e.burnT > 0) seen.burn.add(e.id); if (e.slowT > 0) seen.slow.add(e.id); if (e.shredT > 0) seen.shred.add(e.id); }
    }
  } finally { G.hurtPlayer = hurt; }
  const dmg = {}; for (const k in G.runStats.chips) dmg[k] = (G.runStats.chips[k] || 0) - (chips0[k] || 0);
  return { dmg, maxR, burn: seen.burn.size, slow: seen.slow.size, shred: seen.shred.size };
}
// ---------- 接線檢查（release.js 每次跑）：每種接法 B 都觸發得到、每種插件插在每種晶片上都有效果 ----------
//   接法：25 隻不會動的弱靶排成一團（感染要靠孢子打死才往下傳：靶要打得死），飛船不開火，每 0.25 秒在離中心最近、還活著的那隻身上觸發 A，量 3 秒
function pairCheck(a, b) {
  seed(12345);
  M.setup('run', 'vanguard', 'laser', null, null, ['weapon', a, b, null]);
  const es = M.targets(Array.from({ length: 25 }, (_, i) => [140 + (i % 5) * 30, ((i / 5 | 0) - 2) * 30]), 'swarmer', true, 0.4);
  G.combat = null; G.state = 'play';
  Object.assign(Input, { touch: false, autoFire: false, down: false, dash: false, joy: null, aimStick: null }); Input.keys.clear();
  const n = {}, fire = G.lineFire, hurt = G.hurtPlayer;
  G.lineFire = function (t) { n[t.k] = (n[t.k] || 0) + 1; return fire.call(this, t); };
  G.hurtPlayer = () => {};
  try {
    for (let f = 0; f < 3 * 60; f++) {
      const c = es.filter(e => !e.dead).sort((p, q) => Math.hypot(p.x - es[12].x, p.y - es[12].y) - Math.hypot(q.x - es[12].x, q.y - es[12].y))[0];
      if (f % 15 === 0 && c) G.lineQueue(null, G.stats.line, 0, c.x, c.y, 0, c.id);
      G.update(dt);
    }
  } finally { G.lineFire = fire; G.hurtPlayer = hurt; }
  return { nA: n[0] || 0, nB: n[1] || 0 };
}
if (has('check')) {
  const bad = [];
  for (const a of ALLCH) for (const b of ALLCH) { const r = pairCheck(a, b); if (!r.nB) bad.push(`${CH[a].name} → ${CH[b].name}：A 觸發 ${r.nA} 次，B 一次都沒觸發`); }
  const okP = { amp: (r, b, c) => r.dmg[c] > b.dmg[c] * 1.05, bigshot: (r, b) => r.maxR > b.maxR * 1.05, blast: (r, b, c, p) => r.dmg[p] > 0, shock: (r, b, c, p) => r.dmg[p] > 0, ignite: r => r.burn > 0, frost: r => r.slow > 0, shred: r => r.shred > 0 };
  for (const c of ALLCH) { const b = plugProbe(['weapon', c], c); for (const p of PLUGS) if (!okP[p] || !okP[p](plugProbe(['weapon', c, p], c), b, c, p)) bad.push(`${CH[c].name} ＋ ${CH[p].name}：插了沒效果${okP[p] ? '' : '（chiplink.js 沒有這種插件的檢查方法，要補）'}`); }
  console.log(`${bad.length}/${ALLCH.length * ALLCH.length + ALLCH.length * PLUGS.length}（晶片接晶片 ${ALLCH.length * ALLCH.length} 種、插件插晶片 ${ALLCH.length * PLUGS.length} 格）`);
  bad.forEach(s => console.log(s));
  process.exit(bad.length ? 1 : 0);
}
if (has('plugs')) {
  // 每種插件看什麼（照 chips.js 的說明）：傷害 = 那格晶片的傷害變幾倍；大小 = 產物半徑變幾倍；爆裂、電擊 = 記在插件名下的傷害；燃燒、冰凍、破甲 = 身上有那個狀態的敵人幾隻
  const LOOK = {
    amp: (r, b, c) => [`${r1(r.dmg[c] / Math.max(1, b.dmg[c]))}x`, r.dmg[c] > b.dmg[c] * 1.05],
    bigshot: (r, b) => [`${r1(r.maxR / Math.max(1, b.maxR))}x`, r.maxR > b.maxR * 1.05],
    blast: (r, b, c, p) => [`+${Math.round(r.dmg[p] || 0)}`, r.dmg[p] > 0], shock: (r, b, c, p) => [`+${Math.round(r.dmg[p] || 0)}`, r.dmg[p] > 0],
    ignite: r => [`燒${r.burn}隻`, r.burn > 0], frost: r => [`冰${r.slow}隻`, r.slow > 0], shred: r => [`破${r.shred}隻`, r.shred > 0],
  };
  console.log('第三步：插件插在晶片上（插件只插在這格晶片；17 隻不會動的靶，直接觸發這格 8 次，量 5 秒）');
  console.log('傷害：這格晶片的傷害變幾倍；大小：產物半徑變幾倍；爆裂、電擊：插件打出的傷害；燃燒、冰凍、破甲：身上有那個狀態的敵人幾隻（共 17 隻）。* = 沒效果');
  console.log('晶片'.padEnd(6) + PLUGS.map(p => pad(nm(p), 8)).join('') + pad('沒插時的傷害', 14));
  const off = [];
  for (const c of CHIPS) {
    const b = plugProbe(['weapon', c], c);
    console.log(pad(nm(c), 6) + '  ' + PLUGS.map(p => { const [txt, ok] = LOOK[p](plugProbe(['weapon', c, p], c), b, c, p); if (!ok) off.push(`${CH[c].name} ＋ ${CH[p].name}`); return pad(txt + (ok ? '' : '*'), 8); }).join('') + pad(Math.round(b.dmg[c] || 0), 14));
  }
  console.log(off.length ? `\n沒效果的 ${off.length} 格：${off.join('、')}` : '\n每一格都有效果');
  process.exit(0);
}

// ---------- 第一步：晶片接晶片 ----------
const w = arg('w') || 'laser', res = {};  // res[戰況][A][B 或 '-'] = 那一場
for (const sc of SCS) {
  res[sc] = {};
  for (const a of CHIPS) { res[sc][a] = { '-': scene(w, ['weapon', a], sc) }; for (const b of ALLCH) if (!res[sc][b]) res[sc][b] = { '-': scene(w, ['weapon', b], sc) }; }
  for (const a of CHIPS) for (const b of ALLCH) res[sc][a][b] = scene(w, ['weapon', a, b], sc);
}
// 一種接法的數字：傳遞 = B 觸發幾次 ÷ A 觸發幾次；配合 = 這條線的晶片傷害 ÷ 預期（A 自己一格的傷害 ＋ B 觸發的次數 × B 在第一格時每次的傷害 × 往下一層的折扣）
//   配合 > 1：B 落點比較好、或 B 反過來幫 A 打更多（例如漩渦把敵人吸成一團，迴旋刃一次打中更多隻）；< 1：B 觸發在打不到東西的地方
function link(sc, a, b) {
  const R = res[sc], r = R[a][b], A0 = R[a]['-'], B0 = R[b]['-'], nA = r.n[0] || 0, nB = r.n[1] || 0;
  const bPer = (B0.dmg[b] || 0) / Math.max(1, B0.n[0] || 0), want = (A0.dmg[a] || 0) + nB * bPer * DECAY;
  // 預期太小（A、B 單獨都幾乎打不到，例如只有一隻時碎片不打觸發的那隻）不算倍數：除出來會變成幾十倍，看不出什麼
  return { nA, nB, feed: nA ? nB / nA : 0, fit: want >= MIN_DMG ? chipDmg(r) / want : null, dmg: chipDmg(r), aHelp: a === b || (A0.dmg[a] || 0) < MIN_DMG ? null : (r.dmg[a] || 0) / A0.dmg[a] };
}
const MIN_DMG = 20;
const fitTxt = f => f == null ? '—' : f > 5 ? '>5' : r1(f);
if (has('save')) {
  const out = {}; for (const sc in res) for (const a of CHIPS) for (const b of ALLCH) ((out[w] = out[w] || {})[sc] = out[w][sc] || {})[`${a}>${b}`] = link(sc, a, b);
  const old = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
  for (const ww in out) for (const sc in out[ww]) Object.assign((old[ww] = old[ww] || {})[sc] = old[ww][sc] || {}, out[ww][sc]);
  fs.writeFileSync(BASE, JSON.stringify(old));
  console.log('已存基準 chiplink_base.json');
  process.exit(0);
}
if (has('diff')) {
  if (!fs.existsSync(BASE)) { console.log('沒有基準，先跑 --save'); process.exit(1); }
  const old = JSON.parse(fs.readFileSync(BASE, 'utf8'))[w] || {};
  let n = 0, miss = 0;
  for (const sc in res) for (const a of CHIPS) for (const b of ALLCH) {
    const v = link(sc, a, b), o = old[sc] && old[sc][`${a}>${b}`];
    if (!o) { miss++; continue; }
    if (Math.abs(v.dmg - o.dmg) <= Math.max(20, o.dmg * 0.1) && Math.abs(v.nB - o.nB) <= Math.max(1, o.nB * 0.1)) continue;
    console.log(`${sc} / ${nm(a)} → ${nm(b)}：晶片傷害 ${Math.round(o.dmg)} → ${Math.round(v.dmg)}、B 觸發 ${o.nB} → ${v.nB}`);
    n++;
  }
  console.log(n ? `${n} 格有變化` : '跟基準一樣');
  if (miss) console.log(`另外 ${miss} 格基準裡沒有（新晶片或新武器，沒得比；確認數字對了再 --save）`);
  process.exit(0);
}
console.log(`第一步：晶片接晶片（武器 ${WN[w]} 自動射最近的敵人；敵人血量照難度 ${LV}；每種戰況 ${SEC} 秒、固定亂數，每格 1 場）`);
console.log('格子 = 傳遞／配合。傳遞 = B 被觸發幾次 ÷ A 被觸發幾次（0 = 接不起來）；配合 = 這條線晶片的傷害 ÷ 預期（A 自己的傷害 ＋ B 的次數 × B 平常每次的傷害 × 0.8），>1 = 接起來比各自加起來強；— = A、B 單獨都幾乎打不到，不算倍數');
for (const sc of SCS) {
  console.log(`\n== ${sc}（${SC[sc].list.length} 隻${SC[sc].type === 'brute' && SC[sc].hp > HPM ? '、血量 ×15' : ''}${SC[sc].frozen ? '、不會動' : ''}）  列 = 前一格 A，欄 = 後一格 B`);
  console.log('A ＼ B'.padEnd(8) + ALLCH.map(b => pad(nm(b), 10)).join(''));
  console.log(pad('單獨', 6) + '  ' + ALLCH.map(b => pad(Math.round(res[sc][b]['-'].dmg[b] || 0), 10)).join('') + '   ← 只有這一格時打的傷害（20 秒）');
  for (const a of CHIPS) console.log(pad(nm(a), 6) + '  ' + ALLCH.map(b => { const L = link(sc, a, b); return pad(`${r1(L.feed)}／${fitTxt(L.fit)}`, 10); }).join(''));
  const all = CHIPS.flatMap(a => ALLCH.map(b => [a, b, link(sc, a, b)]));
  const dead = all.filter(([, , L]) => L.nB === 0), deadA = CHIPS.filter(a => ALLCH.every(b => link(sc, a, b).nB === 0));
  const deadTxt = [...deadA.map(a => `${nm(a)}→全部（A 觸發 ${link(sc, a, a).nA} 次）`), ...dead.filter(([a]) => !deadA.includes(a)).map(([a, b, L]) => `${nm(a)}→${nm(b)}（A 觸發 ${L.nA} 次）`)];
  if (deadTxt.length) console.log(`接不起來（B 一次都沒觸發）：${deadTxt.join('、')}`);
  const ok = all.filter(([, , L]) => L.nB > 0 && L.fit != null).sort((x, y) => y[2].fit - x[2].fit);
  const why = ([a, b, L]) => `${nm(a)}→${nm(b)} ${fitTxt(L.fit)}（B 觸發 ${L.nB} 次${L.aHelp != null && Math.abs(L.aHelp - 1) > 0.15 ? `、A 自己的傷害 ×${r1(L.aHelp)}` : ''}）`;
  console.log(`最配：${ok.slice(0, 5).map(why).join('、')}`);
  console.log(`最不配：${ok.slice(-5).reverse().map(why).join('、')}`);
}
