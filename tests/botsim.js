// 自動對戰模擬：電腦用手機操作（自動瞄準、自動攻擊、搖桿走位、危險時衝刺）打真正的戰鬥（波次、會動會攻擊的敵人、地圖物件）
// 量每個玩法晶片的「玩法擊殺（每分鐘）」「發動（每秒）」、清場時間、掉血。晶片固定 Lv1（沒插組件）。
//   發動每秒的中位數就是 CHIPS[晶片].actRate（稀有詞條「爆發」照它算充能速度）
// 配裝裡的等級：玩法晶片的等級 = 1 ＋ 插在它上面的組件數（遊戲的組件升級），隨機配裝不另外抽 Lv2。
// 用法：node botsim.js                  所有玩法晶片 × 5 把武器，各打 N 場（預設 3）
//       node botsim.js --chips=stasis,graze --w=laser --n=5 --level=3
'use strict';
const T_ = require('./load_game').loadGame();
const G = T_.Game, CH = T_.CHIPS;
globalThis.__NOCAPTRIM = true;  // 量價值的時候，電腦不因為超載把晶片拿下來（bot/pick.js capTrim；整局模擬才拿）
G.simFast = true;  // 模擬：不等給人看的時間（區域肅清 1.6 秒）
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
// --tweak="CHIPS.frost.cost=0"：先改數值再跑（試調整用，不改遊戲檔案；跟 runsim.js 一樣）
if (arg('tweak')) require('vm').runInThisContext(process.argv.find(a => a.startsWith('--tweak=')).slice(8));
const WN = { laser: '雷射', scatter: '散彈', plasma: '電漿', railgun: '軌道', blade: '相刃', drone: '蜂群' };
const WPN = arg('w') ? arg('w').split(',') : Object.keys(WN);
const PLAY = NORMAL_IDS.filter(id => CH[id].type === 'chip');  // 晶片（10-22：放在線上、會往下傳的那種）
const CHIPS = arg('chips') ? arg('chips').split(',') : PLAY;
const N = +(arg('n') || 3), LEVEL = +(arg('level') || 3), dt = 1 / 60, CAP = 150;

// --hold：一直按住射擊（用右搖桿手動瞄準最近的敵人，不會自動放出環繞；真人可以這樣玩）
const HOLD = process.argv.includes('--hold');
// --nolock：拿掉感測器 2 層的鎖定（找出感測器強在哪）
if (process.argv.includes('--nolock')) PARTS.sensor.t2.id = 'nolock';
// 固定亂數：同樣的程式跑出同樣的數字；敵人用另一串亂數（見 rng.js）
const { seed, splitEnemyRng, noFx } = require('./rng');
splitEnemyRng(T_); noFx();
// 飛船不會死（2026-10-09）：用真的最大 HP 打（衝撞、裝甲供能、修復無人機、厚甲都照最大 HP 算；以前設成 10 萬會失真），
//   HP 會掉到 0 以下的那一下補滿一條、記進 BANK.lost；總掉血 = 開打的 HP − 現在的 HP + BANK.lost
const BANK = { on: false, lost: 0 };
{
  const hurt = G.hurtPlayer;
  G.hurtPlayer = function (dmg, cause, p = this.player, sx = null, sy = null) {
    if (!BANK.on || p !== this.player) return hurt.call(this, dmg, cause, p, sx, sy);
    p.hp += 1e7; hurt.call(this, dmg, cause, p, sx, sy); p.hp -= 1e7;
    while (p.hp <= 0) { p.hp += p.maxHp; BANK.lost += p.maxHp; if (DEBUG) process.stderr.write(`[補滿一條：最大 HP ${p.maxHp}]\n`); }
  };
}
function immortal(p) { BANK.on = true; BANK.lost = 0; p.hp = p.maxHp; return p.hp; }
const lostSince = (hp0, hpNow) => hp0 - hpNow + BANK.lost;
const DEBUG = process.argv.includes('--debug');

const T_A = () => (typeof Arena !== 'undefined' ? Arena : T_.Arena);
// 區域出口：自己這一區沒有敵人、出口出現時，直接飛進去（不開火、不衝刺）
//   大地圖：看自己這一區的閘門開了沒（雙人：隊友先穿過去時 exit 已經收掉、下一區的敵人在閘門另一邊，不算擋路）
//   卡住（1.5 秒移動不到 20，例如頂著牆角）：0.6 秒往離牆的方向加側移
const exitStuck = {};
function goExit(p) {
  const AR = T_A(), X = G.exit, g = !AR.rect && AR.gates[p.zone], gate = !!(g && g.open);
  if (!gate && !X) return false;
  if (G.enemies.some(e => !e.dead && (!gate || AR.zoneOf(e.x, e.y) <= p.zone))) return false;
  const d = gate ? AR.exitDir(p.x, p.y, p.zone, p.r) : null;  // 大地圖：照繞牆的路線飛到閘門（穿過去就到下一區）
  let dx = d ? d[0] : X.x - p.x, dy = d ? d[1] : X.y - p.y;
  const S = exitStuck;
  if (!S.t0 || G.time < S.t0 || Math.hypot(p.x - S.x, p.y - S.y) > 20) { S.x = p.x; S.y = p.y; S.t0 = G.time; }
  else if (G.time - S.t0 > 1.5) { S.until = G.time + 0.6; S.side = Math.random() < 0.5 ? 1 : -1; S.t0 = G.time; }
  if (!AR.rect && G.time < (S.until || 0)) { const [gx, gy] = AR.grad(p.x, p.y); dx = gx - gy * S.side; dy = gy + gx * S.side; }
  const l = Math.hypot(dx, dy) || 1;
  Object.assign(Input, { touch: true, aimStick: null, dash: false, joy: { bx: 0, by: 0, x: dx / l * 60, y: dy / l * 60 } });
  return true;
}
function bot(p) {
  if (goExit(p)) return;
  const I = Input, E = G.enemies.filter(e => !e.dead && !(e.spawnT > 0));
  I.touch = true; I.autoFire = !HOLD; I.aimStick = null;
  let near = null, nd = Infinity;
  for (const e of E) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < nd) { nd = d; near = e; } }
  // 保持在射程七成的距離；照晶片的玩法站位：加速站遠（射程 ×1.5，最多 700）、佈雷站在地雷停住的距離（射程一半）
  const has = b => G.chain.some(id => id && String(id).split(/[#~]/)[0] === b);
  const wp = G.wp, R = wp.speed * wp.life * (has('accel') ? 1.5 : 1);
  let want = Math.max(70, Math.min(has('accel') ? 700 : 360, R * 0.7));
  if (has('stasis')) want = Math.max(70, R * 0.5);
  let mx = 0, my = 0;
  if (near) {
    const ux = (near.x - p.x) / nd, uy = (near.y - p.y) / nd, side = Math.sin(G.time * 0.7) > 0 ? 1 : -1;
    const k = nd > want + 40 ? 1 : nd < want - 40 ? -1 : 0;
    mx = ux * k - uy * side * 0.8; my = uy * k + ux * side * 0.8;
  }
  const AR = T_A(), nav = near && AR.navTo(p, near.x, near.y);  // 大地圖：敵人躲在牆後，繞牆過去
  if (nav) { mx = nav[0]; my = nav[1]; }
  if (AR.rect) { const cx = CFG.WORLD_W / 2 - p.x, cy = CFG.WORLD_H / 2 - p.y, cd = Math.hypot(cx, cy); if (cd > 500) { mx += cx / cd; my += cy / cd; } }  // 別貼牆
  else if (!nav) { const v = AR.f(p.x, p.y); if (v < 110) { const [gx, gy] = AR.grad(p.x, p.y), w = (110 - v) / 110 * 1.5; mx += gx * w; my += gy * w; } }  // 大地圖：離牆 110 內往空地推
  if (HOLD) I.aimStick = near ? { bx: 0, by: 0, x: (near.x - p.x) / nd * 60, y: (near.y - p.y) / nd * 60 } : { bx: 0, by: 0, x: 60, y: 0 };
  const l = Math.hypot(mx, my);
  I.joy = l > 0.01 ? { bx: 0, by: 0, x: mx / l * 60, y: my / l * 60 } : null;
  // 危險時衝刺：敵彈 60 內朝自己飛來，或敵人貼身
  const danger = G.eBullets.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 60 && (b.vx * (p.x - b.x) + b.vy * (p.y - b.y)) > 0) || nd < 40;
  if (danger && p.dashCd <= 0) I.dash = true;
}

// 數每個晶片被觸發幾次（Game.lineFire：線上那一格放出產物）
const ACTS = {};
{ const o = G.lineFire.bind(G); G.lineFire = t => { const b = t.line.cells[t.k].key; ACTS[b] = (ACTS[b] || 0) + 1; return o(t); }; }
let SKILLED = null;  // 熟練玩家（bot/，跟整局模擬同一套；會放開蓄力、站著架設），用到才載入
function fight(w, chip, s) {
  SKILLED = SKILLED || require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
  SKILLED.resetBot(); Object.assign(Input, { down: false, dash: false, joy: null, aimStick: null, mx: 0, my: 0 }); Input.keys.clear(); G.time = 0; G.nextId = 1;
  seed(1000 + s);
  for (const k in ACTS) delete ACTS[k];
  G.newRun('run', 'vanguard', w);
  G.chain = ['weapon', chip, null, null]; G.recalc();
  G.playKills = {};
  G.node = { type: 'combat', L: 2, id: 'sim' };
  G.startCombat({ level: LEVEL, wavesTotal: 3, elites: 0 });
  const p = G.player, hp0 = immortal(p);
  let t = 0, hpNow = p.hp;
  while (G.state === 'play' && t < CAP) { SKILLED.bot(p); G.update(dt); t += dt; if (G.state === 'play') hpNow = p.hp; }
  return { t, hp: lostSince(hp0, hpNow), pk: (chip && G.playKills[chip]) || 0, act: (chip && ACTS[chip]) || 0, kills: G.kills };
}

// --weapons：只比較武器（不裝晶片），打很多種戰鬥：一般戰（不同難度）、精英戰、三隻旗艦
if (process.argv.includes('--weapons')) {
  const SC = [
    ['一般 難度1', { level: 1, wavesTotal: 3, elites: 0 }], ['一般 難度3', { level: 3, wavesTotal: 3, elites: 0 }],
    ['一般 難度6', { level: 6, wavesTotal: 3, elites: 0 }], ['精英 難度3', { level: 3, wavesTotal: 2, elites: 1 }],
    ...CFG.BOSS_ORDER.map(b => [`旗艦 ${ENEMY_TYPES[b].name}`, { level: 6, wavesTotal: 1, elites: 0, boss: true }, b])];
  console.log(`只有武器，${N} 場平均。欄位：清場秒數／掉血（超過 240 秒算沒打完）`);
  console.log('戰鬥'.padEnd(12) + WPN.map(w => WN[w].padStart(12)).join(''));
  const rank = Object.fromEntries(WPN.map(w => [w, 0]));
  for (const [name, cfg, boss] of SC) {
    const res = WPN.map(w => {
      let t = 0, hp = 0;
      for (let s = 0; s < N; s++) {
        seed(2000 + s); G.newRun('run', 'vanguard', w); G.chain = ['weapon', null, null, null]; G.recalc();
        G.node = { type: boss ? 'boss' : 'combat', L: 2, id: 'sim' }; if (boss) G.bossId = boss;
        G.startCombat({ ...cfg });
        const p = G.player, hp0 = immortal(p);
        let tt = 0, hpNow = p.hp;
        while (G.state === 'play' && tt < 240) { bot(p); G.update(dt); tt += dt; if (G.state === 'play') hpNow = p.hp; }
        t += tt; hp += lostSince(hp0, hpNow);
      }
      return { t: t / N, hp: hp / N };
    });
    const best = Math.min(...res.map(r => r.t));
    WPN.forEach((w, i) => { rank[w] += res[i].t / best; });
    console.log(name.padEnd(12) + res.map(r => `${Math.round(r.t)}s/${Math.round(r.hp)}`.padStart(12)).join(''));
  }
  console.log('平均倍數'.padEnd(12) + WPN.map(w => `${(rank[w] / SC.length).toFixed(2)}x`.padStart(12)).join('') + '   （清場時間 ÷ 該戰最快的武器，越小越強）');
  process.exit(0);
}

// 打一場（通用）：cfg = 戰鬥設定；setup() 在開打前調整配裝；real = 用真的 HP（會死）
function run1(w, chain, s, cfg, setup, real, botFn = bot) {  // botFn：電腦（預設這個檔案的；--upval 用 bot/ 的熟練玩家）
  seed(3000 + s); G.newRun('run', 'vanguard', w); G.parts = {};
  if (T_.splitChain) {  // 組件寫在晶片後面 = 插在它的插座上；沒有插座數的晶片給 2 個
    const r = T_.splitChain(chain.map(id => id && T_.isHost(id) && id !== 'weapon' && !T_.socketsOf(id) ? T_.chipId(T_.baseOf(id), 2, T_.lvOf(id), T_.rareOf(id)) : id));  // 等級、稀有照原本的
    G.chain = r.chain; G.socks = r.socks;
  } else G.chain = chain.slice();
  G.wSock = (cfg.level || 0) < 7 ? 0 : cfg.level < 14 ? 1 : 2;  // 武器插座照難度（打完幾隻王）
  if (setup) setup(); G.recalc();
  G.node = { type: cfg.boss ? 'boss' : 'combat', L: 2, id: 'sim' }; if (cfg.boss) G.bossId = cfg.boss;
  G.startCombat({ ...cfg, boss: !!cfg.boss });
  const p = G.player; BANK.on = false; BANK.lost = 0; p.hp = p.maxHp; if (!real) immortal(p);
  if (DEBUG) process.stderr.write(`[開打：最大 HP ${p.maxHp}，零件 ${JSON.stringify(G.parts)}，衝撞 ${!!G.mech.traits.ram}]\n`);
  const hp0 = p.hp; let t = 0, hpNow = p.hp;
  while (G.state === 'play' && t < 240) { botFn(p); G.update(dt); t += dt; if (G.state === 'play') hpNow = p.hp; }
  return { t, lost: hp0 - hpNow, died: G.state === 'dead', maxHp: p.maxHp };
}

// --routeval：路線價值表（2026-10-09；取代只分武器的單晶片價值表）
//   每把武器 10 條路線（none = 沒升級、A／B／C = 只升第一段、A0～C1 = 6 個終極升級）× 每樣東西：晶片、零件 +1／+2／+4 層（part:armor:2）
//   量法：照難度隨機配一組基本配裝（晶片少一格、零件、路線），同一組配裝、同一個亂數種子「加這樣東西」和「不加」各打一般戰＋精英戰，
//     飛船不會死，比清場時間和掉血（電腦是整局模擬的熟練玩家 bot/）。單位跟晶片價值表一樣：速度 = 不加的時間 ÷ 加的時間、掉血 = 加的掉血 ÷ 不加的掉血
//     掉血用「最大 HP 的幾 %」記（lost／lost0），所以重裝甲 +20 HP 這種加血量的東西也算得到
//   難度：none 量 1／3／6，只升第一段量 6（第 1 星區後段～第 2 星區前段），終極升級量 8（大約第 2 星區中段，升滿的時候）
//   改玩法的晶片（有成長的）、零件每條路線都量；數值晶片、組件、觸發器跟路線關係小，只量 none（電腦查不到路線的就用 none 的）
//   存 routevalue_<武器>.json：{ 路線: { 難度: { 東西: { t, lost, t0, lost0, n } } } }（原始加總，只重跑某幾樣時合併進去）
//   用法：node botsim.js --routeval --w=laser --n=6 [--items=sticky,part:armor:1] [--routes=none,A0]
if (process.argv.includes('--routeval')) {
  const B = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
  const fs = require('fs');
  const TIER = { 1: { chips: 1, parts: 0 }, 3: { chips: 3, parts: 1 }, 6: { chips: 5, parts: 3 }, 8: { chips: 6, parts: 4 } };
  const POOL = NORMAL_IDS.filter(id => !CH[id].comp);  // 基本配裝的晶片（組件由 sortChain 插）
  const PLAY = NORMAL_IDS.filter(id => CH[id].kill);
  const ITEMS_ROUTE = [...PLAY, ...PART_IDS.flatMap(k => [1, 2, 4].map(n => `part:${k}:${n}`))];
  const ITEMS_NONE = [...NORMAL_IDS.filter(id => !CH[id].kill), ...ITEMS_ROUTE];
  const SOFF = +(arg('seedoff') || 0);  // --seedoff=6：換一批配裝和亂數（量雜訊用）
  const only = arg('items') ? arg('items').split(',') : null, onlyR = arg('routes') ? arg('routes').split(',') : null;
  for (const w of WPN) {
    const file = (process.env.TABLE_DIR || __dirname) + '/routevalue_' + w + '.json';  // TABLE_DIR：試改版的表（見 bot/load.js）
    let out = {}; try { out = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
    const W = WEAPONS[w], routes = [['none', null, null, [1, 3, 6]], ...Object.keys(W.paths).map(p => [p, p, null, [6]]), ...Object.keys(W.paths).flatMap(p => [0, 1].map(fi => [p + fi, p, fi, [8]]))];
    const t0 = Date.now();
    for (const [rk, path, fi, tiers] of routes) {
      if (onlyR && !onlyR.includes(rk)) continue;
      const items = (rk === 'none' ? ITEMS_NONE : ITEMS_ROUTE).filter(it => !only || only.includes(it));
      if (!items.length) continue;
      for (const L of tiers) {
        const tier = TIER[L], cell = ((out[rk] = out[rk] || {})[L] = out[rk][L] || {});
        const baseCache = new Map();
        const fight = (chain, parts, s) => {
          let t = 0, lost = 0;
          for (const cfg of [{ level: L, wavesTotal: 3, elites: 0 }, { level: L, wavesTotal: 2, elites: 1 }]) {
            const r = run1(w, chain, s, cfg, () => { B.resetBot(); G.weapon = { id: w, path, final: fi }; G.refreshWeapon(); G.parts = { ...parts }; B.sortChain(); }, false, B.bot);
            t += r.t; lost += r.lost / r.maxHp * 100;  // 掉血 = 最大 HP 的幾 %（加血量的零件才算得到價值）
          }
          return { t, lost };
        };
        for (const it of items) {
          const acc = { t: 0, lost: 0, t0: 0, lost0: 0, n: 0, s: [] };  // s：每一組分開存 [時間, 掉血%, 不加的時間, 不加的掉血%]
          for (let s = SOFF; s < SOFF + N; s++) {
            seed(6000 + s * 41 + L);
            const chip = CH[it] ? it : null, ids = [];
            while (ids.length < Math.max(0, tier.chips - 1)) { const id = pick(POOL); if (!ids.includes(id) && id !== chip) ids.push(id); }
            const base = ['weapon', ...ids];
            const parts = {}; for (let k = 0; k < tier.parts; k++) { const q = pick(PART_IDS); parts[q] = (parts[q] || 0) + 1; }
            const key = base.join() + '|' + JSON.stringify(parts) + '|' + s;
            if (!baseCache.has(key)) baseCache.set(key, fight(base, parts, s));
            const b0 = baseCache.get(key);
            let r;
            if (chip) r = fight([...base, chip], parts, s);
            else { const [, k, n] = it.split(':'), p2 = { ...parts }; p2[k] = (p2[k] || 0) + +n; r = fight(base, p2, s); }
            acc.t += r.t; acc.lost += r.lost; acc.t0 += b0.t; acc.lost0 += b0.lost; acc.n++; acc.s.push([+r.t.toFixed(2), +r.lost.toFixed(2), +b0.t.toFixed(2), +b0.lost.toFixed(2)]);
          }
          cell[it] = acc;
        }
        fs.writeFileSync(file, JSON.stringify(out));  // 每個難度跑完就存（中途停掉也留得住）
        process.stderr.write(`${WN[w]} ${rk} 難度 ${L}：${items.length} 樣，累計 ${Math.round((Date.now() - t0) / 1000)} 秒\n`);
      }
    }
    if (!process.env.TABLE_DIR && !process.env.GAME_DIR) require('./exportvalue').exportValue();  // 遊戲裡「數值圖表」的兩張模擬表
    // 印每條路線分數最高的 5 樣（速度 ÷ √掉血）
    const nm = it => CH[it] ? CH[it].name : PARTS[it.split(':')[1]].name + ' +' + it.split(':')[2];
    for (const [rk, path, fi] of routes) {
      const R = out[rk]; if (!R) continue;
      const L = Object.keys(R).map(Number).pop(), C = R[L];
      const val = it => B.rvScore(out, it, C[it]);  // 跟電腦查表同一個算法（速度照這一格、掉血合併所有路線）
      const top = Object.keys(C).sort((a, b) => val(b) - val(a)).slice(0, 5);
      console.log(`${W.name} ${rk === 'none' ? '沒升級' : fi == null ? W.paths[path].name : W.paths[path].next[fi].name}（難度 ${L}）：${top.map(it => nm(it) + ' ' + val(it).toFixed(2)).join('、')}`);
    }
  }
  process.exit(0);
}

// --upval：武器升級價值表（整局模擬的電腦挑武器升級用；2026-10-09）
//   每把武器的 6 個終極升級（3 條路線 × 2 個第二段）各打一輪，跟「沒升級」比；配裝照難度隨機（晶片、零件），同一個 s 每種升級拿到一樣的配裝
//   電腦用整局模擬的熟練玩家（bot/），飛船不會死，量清場時間和掉血；數字跟晶片價值表一樣：速度 = 沒升級的時間 ÷ 時間、掉血 = 掉血 ÷ 沒升級的掉血
//   存成 upgradevalue_<武器>.json（每把武器一個檔，可以平行跑、中途停掉也留得住跑完的）：{ 難度: { 'A0': { speed, dmg }, ... } }
//   2026-10-12：另外量 3 條「只升第一段」（鍵 'A'／'B'／'C'）：第一段太弱的路線撐不到升滿（自動軌道、相位灼燒），只看終極會漏掉
//     跑完存武器升級的指紋到 upval_fp.json（upfp.js；升級健檢 upcheck.js 用來判斷表過期）
//   用法：node botsim.js --upval --w=laser --n=10 [--tiers=3,6,10]
if (process.argv.includes('--upval')) {
  const B = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
  const TIERS = (arg('tiers') || '3,6,10').split(',').map(Number);
  const TIER = { 3: { chips: 3, parts: 1 }, 6: { chips: 5, parts: 3 }, 10: { chips: 6, parts: 4 }, 17: { chips: 7, parts: 6 } };
  const POOL = NORMAL_IDS.filter(id => !T_.isComp || !T_.isComp(id));
  //   2026-10-09 改：每一組各自比（跟同一組的「沒升級」），掉血用「最大 HP 的 %」＋底數 20、合併 3 個難度算（雜訊大），速度照每個難度
  //   存 { 難度: { 'A0': { speed, dmg, s: [[時間, 掉血%, 沒升級時間, 沒升級掉血%], ...] } } }；speed、dmg 是算好的倍數（bot/value.js 直接用）
  //   --seedoff=20 換一批配裝（量雜訊）；--out=檔名 存到別的檔（不蓋掉 upgradevalue_<武器>.json）
  const SOFF = +(arg('seedoff') || 0), F = 20, lg = Math.log, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  for (const w of WPN) {
    const W = WEAPONS[w], combos = [['none', null, null], ...Object.keys(W.paths).flatMap(p => [0, 1].map(fi => [p + fi, p, fi])), ...Object.keys(W.paths).map(p => [p, p, null])];
    const out = {}, file = (process.env.TABLE_DIR || __dirname) + '/' + (arg('out') ? arg('out').replace('%w', w) : 'upgradevalue_' + w + '.json');
    for (const L of TIERS) {
      // --full：電路裝滿（7 顆、全部 Lv2，能量高、射速慢；量連殺裝填這類「冷卻越長越有用」的升級）
      const tier = process.argv.includes('--full') ? { ...(TIER[L] || TIER[6]), chips: 7 } : TIER[L] || TIER[6], groups = {};
      for (let s = SOFF; s < SOFF + N; s++) {
        seed(5000 + s * 37 + L);
        const ids = []; while (ids.length < tier.chips) { const id = pick(POOL); if (!ids.includes(id)) ids.push(id); }
        const chain = ['weapon', ...ids];
        const parts = {}; for (let k = 0; k < tier.parts; k++) { const q = pick(Object.keys(PARTS)); parts[q] = (parts[q] || 0) + 1; }
        let base = null;
        for (const [key, path, fi] of combos) {
          let t = 0, lost = 0;
          for (const cfg of [{ level: L, wavesTotal: 3, elites: 0 }, { level: L, wavesTotal: 2, elites: 1 }]) {
            // --heavy=3：前 3 格電路加「能量 +2」的屬性（拉高能量、射速變慢）
            const r = run1(w, chain, s, cfg, () => { B.resetBot(); G.weapon = { id: w, path, final: fi }; G.refreshWeapon(); G.parts = { ...parts }; B.sortChain(); if (arg('heavy')) G.slotAttr = G.chain.map((_, i) => i > 0 && i <= +arg('heavy') ? 'heavy' : null); }, false, B.bot);
            t += r.t; lost += r.lost / r.maxHp * 100;
          }
          if (key === 'none') base = [t, lost]; else (groups[key] = groups[key] || []).push([+t.toFixed(2), +lost.toFixed(2), +base[0].toFixed(2), +base[1].toFixed(2)]);
        }
        process.stderr.write(`${WN[w]} 難度 ${L} 第 ${s - SOFF + 1}/${N} 組\n`);
      }
      out[L] = {};
      for (const key in groups) out[L][key] = { s: groups[key] };
      // 速度照這個難度；掉血合併所有已經跑完的難度
      for (const L2 in out) for (const key in out[L2]) {
        const all = Object.values(out).flatMap(o => o[key] ? o[key].s : []);
        out[L2][key].speed = Math.exp(mean(out[L2][key].s.map(g => lg(g[2] / g[0]))));
        out[L2][key].dmg = Math.exp(mean(all.map(g => lg((g[1] + F) / (g[3] + F)))));
      }
      const row = combos.slice(1).map(([key, p, fi]) => { const v = out[L][key]; return `${fi == null ? '第一段' + W.paths[p].name : W.paths[p].next[fi].name} ${(v.speed / Math.sqrt(v.dmg)).toFixed(2)}（速 ${v.speed.toFixed(2)} 血 ${v.dmg.toFixed(2)}）`; });
      console.log(`${W.name} 難度 ${L}（${N} 組）：${row.join('　')}`);
      require('fs').writeFileSync(file, JSON.stringify(out));  // 每個難度跑完就存
    }
    // 標準的表（沒有 --out／--full／--heavy／--seedoff）跑完才記指紋
    if (!arg('out') && !arg('heavy') && !SOFF && !process.argv.includes('--full')) {
      const fpFile = (process.env.TABLE_DIR || __dirname) + '/upval_fp.json', fp = (() => { try { return JSON.parse(require('fs').readFileSync(fpFile, 'utf8')); } catch (e) { return {}; } })();
      fp[w] = { fp: require('./upfp').weaponFp(w), date: new Date().toLocaleString(), n: N, tiers: TIERS };
      require('fs').writeFileSync(fpFile, JSON.stringify(fp, null, 1));
    }
  }
  if (!arg('out') && !process.env.TABLE_DIR && !process.env.GAME_DIR) console.log('數值圖表資料：' + require('./exportvalue').exportValue());  // 遊戲裡「數值圖表」的兩張模擬表
  process.exit(0);
}

// --combo：指定組合 vs 同一組隨機配裝（跟武器升級價值表同一套算法：每組各自比、掉血合併難度、底數 20）
//   每組隨機配裝打三種：沒升級（基準）／只換成這條終極升級／終極升級＋組合（指定的晶片換掉隨機的、零件加上去；--empty = 晶片全拿掉、留空格）
//   用法：node botsim.js --combo --w=laser --route=C0 --add=accel,orbit [--parts=sensor:4] [--empty] --n=20 [--tiers=6,10]
if (process.argv.includes('--combo')) {
  const B = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
  const TIERS = (arg('tiers') || '6,10').split(',').map(Number);
  const TIER = { 3: { chips: 3, parts: 1 }, 6: { chips: 5, parts: 3 }, 10: { chips: 6, parts: 4 }, 17: { chips: 7, parts: 6 } };
  const w = WPN[0], RT = arg('route'), ADD = arg('add') ? arg('add').split(',') : [], EMPTY = process.argv.includes('--empty');
  const PA = arg('parts') ? arg('parts').split(',').map(x => x.split(':')) : [];
  const POOL = NORMAL_IDS.filter(id => (!T_.isComp || !T_.isComp(id)) && !ADD.includes(id));
  const F = 20, lg = Math.log, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const W = WEAPONS[w], path = RT[0], fin = +RT[1];
  const name = `${W.name} ${W.paths[path].next[fin].name}${EMPTY ? '＋空電路' : ''}${ADD.length ? '＋' + ADD.map(id => CH[id].name).join('＋') : ''}${PA.length ? '＋' + PA.map(([k, n]) => PARTS[k].name + ' ' + n + ' 層').join('＋') : ''}`;
  const G2 = { route: [], combo: [] };  // 每組 [時間, 掉血%, 基準時間, 基準掉血%, 難度]
  for (const L of TIERS) {
    const tier = TIER[L] || TIER[6];
    for (let s = 0; s < N; s++) {
      seed(5000 + s * 37 + L);
      const ids = []; while (ids.length < tier.chips) { const id = pick(POOL); if (!ids.includes(id)) ids.push(id); }
      const chain = ['weapon', ...ids];
      const parts = {}; for (let k = 0; k < tier.parts; k++) { const q = pick(Object.keys(PARTS)); parts[q] = (parts[q] || 0) + 1; }
      // 組合：指定的非組件晶片換掉最後幾顆隨機的；組件插在武器插座上（插在別的晶片上只影響那顆晶片的產物）；--empty 全部留空
      const hostAdd = ADD.filter(id => !T_.isComp(id)), compAdd = ADD.filter(id => T_.isComp(id));
      const cchain = EMPTY ? ['weapon', ...ids.map(() => null)] : ['weapon', ...chain.slice(1, 1 + Math.max(0, ids.length - hostAdd.length)), ...hostAdd];
      const cparts = { ...parts }; for (const [k, n] of PA) cparts[k] = Math.max(cparts[k] || 0, +n);
      const one = (ch, pa, p, fi) => {
        let t = 0, lost = 0;
        for (const cfg of [{ level: L, wavesTotal: 3, elites: 0 }, { level: L, wavesTotal: 2, elites: 1 }]) {
          const r = run1(w, ch, s, cfg, () => {
            B.resetBot(); G.weapon = { id: w, path: p, final: fi }; G.refreshWeapon(); G.parts = { ...pa }; if (!EMPTY || ch === chain) B.sortChain();
            if (ch === cchain && compAdd.length) { G.socks[0] = [...(G.socks[0] || []), ...compAdd]; G.wSock = Math.max(G.wSock, G.socks[0].length); }
          }, false, B.bot);
          t += r.t; lost += r.lost / r.maxHp * 100;
        }
        return [t, lost];
      };
      const b = one(chain, parts, null, null), r = one(chain, parts, path, fin), c = one(cchain, cparts, path, fin);
      if (s === 0) process.stderr.write(`  隨機：${JSON.stringify(chain)} 零件 ${JSON.stringify(parts)}｜組合：${JSON.stringify(G.chain)} 插座 ${JSON.stringify(G.socks)} 武器插座 ${G.wSock} 武器子彈 減速 ${T_.runOps(G.stats.ops, 0)[0].slow} 破甲 ${T_.runOps(G.stats.ops, 0)[0].shred} 零件 ${JSON.stringify(G.parts)} 武器 ${JSON.stringify(G.weapon)}
`);
      G2.route.push([...r, ...b, L]); G2.combo.push([...c, ...b, L]);
      process.stderr.write(`${name} 難度 ${L} 第 ${s + 1}/${N} 組\n`);
    }
  }
  const blood = k => Math.exp(mean(G2[k].map(g => lg((g[1] + F) / (g[3] + F)))));
  const line = (k, L) => { const g = G2[k].filter(x => x[4] === L), sp = Math.exp(mean(g.map(x => lg(x[2] / x[0])))), bl = blood(k); return `${(sp / Math.sqrt(bl)).toFixed(2)}（速 ${sp.toFixed(2)} 血 ${bl.toFixed(2)}）`; };
  for (const L of TIERS) console.log(`${name} 難度 ${L}（${N} 組）：只升級 ${line('route', L)}　升級＋組合 ${line('combo', L)}`);
  require('fs').writeFileSync(arg('out') || 'combo_last.json', JSON.stringify({ name, ...G2 }));
  process.exit(0);
}

// --levels：每個玩法晶片 Lv1／Lv2／Lv3（進化）的輸出，跟只有武器比（清場時間倍數，越大越強）
//   等級寫在晶片 id（同種合成，見 mergedChip）
const lvChain = (chip, lv) => [T_.chipId(chip, 0, lv)];
if (process.argv.includes('--levels')) {
  const cfg = { level: LEVEL, wavesTotal: 3, elites: 0 };
  const avgT = chain => WPN.map(w => { let t = 0; for (let s = 0; s < N; s++) t += run1(w, chain(w), s, cfg).t; return t / N; });
  const base = avgT(() => ['weapon', null, null, null]);
  console.log(`難度 ${LEVEL}、${N} 場平均。數字 = 只有武器的清場時間 ÷ 裝了晶片的清場時間（越大越強），括號 = 武器裡最高／最低`);
  console.log('晶片'.padEnd(10) + ['Lv1', 'Lv2', 'Lv3'].map(s => s.padStart(22)).join(''));
  for (const chip of CHIPS) {
    const cells = [1, 2, 3].map(lv => {
      const t = avgT(() => ['weapon', ...lvChain(chip, lv), null, null]), r = t.map((x, i) => base[i] / x);
      const avg = r.reduce((a, b) => a + b, 0) / r.length, hi = r.indexOf(Math.max(...r)), lo = r.indexOf(Math.min(...r));
      return `${avg.toFixed(2)}x（${WN[WPN[hi]]}${r[hi].toFixed(1)}／${WN[WPN[lo]]}${r[lo].toFixed(1)}）`.padStart(22);
    });
    console.log(CH[chip].name.padEnd(10) + cells.join(''));
  }
  process.exit(0);
}

// --build：依難度隨機產生「那個時候玩家大概會有的配裝」（晶片數、武器升級、零件；組件插在左邊的晶片上 = 升級），用真的 HP 打，比較武器
//   --force=orbit,intercept 每組配裝都一定包含這些晶片（測組合）；搭 --hold 測一直按住
if (process.argv.includes('--build')) {
  const TIERS = [
    { name: '難度1（開頭）', level: 1, chips: 1, stage: 0, parts: 0 },
    { name: '難度3（中段）', level: 3, chips: 3, stage: 1, parts: 1 },
    { name: '難度6（後段）', level: 6, chips: 5, stage: 2, parts: 3 }];
  const FORCE = arg('force') ? arg('force').split(',') : [];
  const POOL = NORMAL_IDS.filter(id => !FORCE.includes(id));
  const build = (w, tier, s) => {  // 用 s 決定這組配裝（每把武器同一個 s 拿到同樣的晶片，比較公平）
    seed(7000 + s * 31 + tier.level);
    const ids = [...FORCE];
    while (ids.length < Math.max(tier.chips, FORCE.length)) { const id = pick(POOL); if (!ids.includes(id)) ids.push(id); }
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const chain = ['weapon', ...ids];
    const path = tier.stage >= 1 ? pick(['A', 'B', 'C']) : null, fin = tier.stage >= 2 ? randInt(0, 1) : null;
    const parts = {}; for (let k = 0; k < tier.parts; k++) { const p = pick(Object.keys(PARTS)); parts[p] = (parts[p] || 0) + 1; }
    return { chain, setup: () => { G.weapon = { id: w, path, final: fin }; G.refreshWeapon(); G.parts = parts; } };
  };
  if (process.argv.includes('--curve')) {  // 武器強度曲線：整局 9 個階段的隨機配裝，量清場速度（不會死），輸出 JSON 給圖表用
    const STAGES = [[1, 1, 1], [1, 3, 3], [1, 6, 3], [2, 8, 4], [2, 10, 4], [2, 13, 5], [3, 15, 5], [3, 17, 6], [3, 20, 6]].map(([sec, level, chips]) =>
      ({ name: `星區${sec} 難度${level}`, level, chips, stage: level >= 8 ? 2 : level >= 3 ? 1 : 0, parts: Math.min(6, Math.floor(level / 3)) }));
    const out = { stages: STAGES.map(s => s.name), weapons: {} };
    for (const w of WPN) out.weapons[WN[w]] = [];
    for (const tier of STAGES) {
      const times = WPN.map(w => {
        let t = 0;
        for (let s = 0; s < N; s++) {
          const b = build(w, tier, s);
          for (const cfg of [{ level: tier.level, wavesTotal: 3, elites: 0 }, { level: tier.level, wavesTotal: 2, elites: 1 }]) t += run1(w, b.chain, s, cfg, b.setup, false).t;
        }
        return t / N / 2;
      });
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      WPN.forEach((w, i) => out.weapons[WN[w]].push(Math.round(avg / times[i] * 100)));  // 100 = 五把平均；越高清得越快
      process.stderr.write(`${tier.name} 完成\n`);
    }
    console.log(JSON.stringify(out));
    process.exit(0);
  }
  if (process.argv.includes('--mechscan')) {  // 零件：配裝的晶片和武器照樣隨機，只把零件換成要測的那一種
    const CONF = [['（沒有零件）', () => {}],
      ...Object.keys(PARTS).flatMap(k => [2, 4].map(n => [`${PARTS[k].name} ${n} 層`, () => { G.parts = { [k]: n }; }]))];
    console.log(`零件／模組：難度 3、6 的隨機配裝（晶片、武器升級照樣隨機），五把武器 × ${N} 組 × 一般戰＋精英戰，真的 HP。欄位：清場秒數（活著打完的）｜掉血｜陣亡率`);
    for (const [name, apply] of CONF.filter(([nm]) => !arg('only') || arg('only').split(',').some(k => nm.includes(k)))) {
      let t = 0, tn = 0, lost = 0, dead = 0, n = 0;
      for (const tier of TIERS.slice(1)) for (const w of WPN) for (let s = 0; s < N; s++) {
        const b = build(w, tier, s);
        for (const cfg of [{ level: tier.level, wavesTotal: 3, elites: 0 }, { level: tier.level, wavesTotal: 2, elites: 1 }]) {
          const r = run1(w, b.chain, s, cfg, () => { b.setup(); G.parts = {}; apply(); }, true);
          if (!r.died) { t += r.t; tn++; } lost += r.lost; dead += r.died ? 1 : 0; n++;
        }
      }
      console.log(name.padEnd(16) + `${Math.round(t / Math.max(1, tn))}s`.padStart(8) + `｜掉血 ${Math.round(lost / n)}`.padStart(10) + `｜陣亡 ${(dead / n * 100).toFixed(1)}%`);
    }
    process.exit(0);
  }
  console.log(`依難度隨機配裝（每格 ${N} 組配裝 × 一般戰＋精英戰，真的 HP）${FORCE.length ? `，每組都含 ${FORCE.map(id => CH[id].name).join('＋')}` : ''}${HOLD ? '，一直按住' : ''}。欄位：清場秒數（活著打完的）／掉血／陣亡率`);
  console.log('難度'.padEnd(12) + WPN.map(w => WN[w].padStart(16)).join(''));
  // --boss：改打第一隻旗艦（難度 6 的配裝；死在第 1 星區旗艦的局最多）
  const BOSS = process.argv.includes('--boss');
  for (const tier of BOSS ? TIERS.slice(2) : TIERS) {
    const cells = WPN.map(w => {
      let t = 0, tn = 0, lost = 0, dead = 0, n = 0;
      for (let s = 0; s < N; s++) {
        const b = build(w, tier, s);
        for (const cfg of BOSS ? [{ level: tier.level, wavesTotal: 1, elites: 0, boss: CFG.BOSS_ORDER[0] }]
          : [{ level: tier.level, wavesTotal: 3, elites: 0 }, { level: tier.level, wavesTotal: 2, elites: 1 }]) {
          const r = run1(w, b.chain, s, cfg, b.setup, true);
          if (!r.died) { t += r.t; tn++; } lost += r.lost; dead += r.died ? 1 : 0; n++;
        }
      }
      return `${Math.round(t / Math.max(1, tn))}s/${Math.round(lost / n)}/${Math.round(dead / n * 100)}%`.padStart(16);
    });
    console.log(tier.name.padEnd(12) + cells.join(''));
  }
  process.exit(0);
}

// --mech：零件（2 層、4 層），用真的 HP 打難度 6 的一般戰＋第一隻旗艦
if (process.argv.includes('--mech')) {
  const FIGHTS = [{ level: 6, wavesTotal: 3, elites: 0 }, { level: 4, wavesTotal: 2, elites: 1 }];
  const CHAIN = arg('chain') ? ['weapon', ...arg('chain').split(','), null] : ['weapon', null, null, null];
  const CONF = arg('chain') ? [[arg('chain'), () => {}]] : [['（沒有零件）', () => {}],
    ...Object.keys(PARTS).flatMap(k => [2, 4].map(n => [`${PARTS[k].name} ${n} 層`, () => { G.parts = { [k]: n }; }]))];
  console.log(`難度 6 一般戰＋難度 4 精英戰，真的 HP，五把武器 × ${N} 場。欄位：清場秒數（只算活著打完的）｜平均掉血（最大 HP）｜陣亡率`);
  for (const [name, setup] of CONF) {
    let t = 0, tn = 0, lost = 0, dead = 0, n = 0, mh = 0;
    for (const w of WPN) for (const cfg of FIGHTS) for (let s = 0; s < N; s++) {
      const r = run1(w, CHAIN, s, cfg, setup, true);
      if (!r.died) { t += r.t; tn++; } lost += r.lost; dead += r.died ? 1 : 0; n++; mh = r.maxHp;
    }
    console.log(name.padEnd(16) + `${Math.round(t / Math.max(1, tn))}s`.padStart(8) + `｜掉血 ${Math.round(lost / n)}（${mh}）`.padStart(16) + `｜陣亡 ${Math.round(dead / n * 100)}%`);
  }
  process.exit(0);
}

const rows = [];
for (const chip of [null, ...CHIPS]) {
  const per = {};
  for (const w of WPN) {
    let t = 0, hp = 0, gr = 0, act = 0;
    for (let s = 0; s < N; s++) { const r = fight(w, chip, s); t += r.t; hp += r.hp; gr += r.pk; act += r.act; }
    per[w] = { t: t / N, hp: hp / N, gpm: gr / (t / 60), aps: act / t };
  }
  rows.push({ chip, per });
}
const base = rows[0].per;
console.log(`每場：星區難度 ${LEVEL}、3 波，${N} 場平均。欄位：清場秒數／掉血（只有武器的對照）｜玩法擊殺每分鐘｜發動每秒`);
const med = a => { const v = [...a].sort((x, y) => x - y); return v[v.length >> 1]; };
console.log('晶片'.padEnd(10) + WPN.map(w => WN[w].padStart(20)).join('') + '   玩法擊殺｜發動（actRate）');
for (const { chip, per } of rows) {
  const name = chip ? CH[chip].name : '（只有武器）';
  const cells = WPN.map(w => {
    const r = per[w];
    return (chip ? `${Math.round(r.t)}s/${Math.round(r.hp)}｜${r.gpm.toFixed(0)}｜${r.aps.toFixed(2)}` : `${Math.round(r.t)}s/${Math.round(r.hp)}`).padStart(20);
  }).join('');
  const m = chip ? med(WPN.map(w => per[w].gpm)) : 0, a = chip ? med(WPN.map(w => per[w].aps)) : 0;
  const g = chip ? `   中位數 ${m.toFixed(1)}/分｜${CH[chip].kill}｜發動 ${a.toFixed(2)}/秒（現在 actRate ${CH[chip].actRate}）` : '';
  console.log(name.padEnd(10) + cells + g);
}
