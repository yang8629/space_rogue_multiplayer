// 武器診斷（2026-10-12，合併電漿診斷、相位刃診斷）：跟武器升級價值表同一套隨機配裝，量每條升級路線實際觸發了多少
//   每條路線一行：時間（速度倍數）、掉血、傷害照來源分、每發平均傷害、子彈數/秒、擊殺數、每隻幾發／HP／活幾秒、移動速度
//   有觸發才印：燃燒（排進去的量、敵人死時沒燒完 %、燒著時平均幾層）、小電漿（打中率、第二代）、爆炸（每次炸到幾隻）
//   用法：node weapondiag.js --w=blade --n=20 [--level=6] [--routes=none,C,C0]（none 沒升級、A 第一段、A0／A1 終極）
//   GAME_DIR=… 載入試改版遊戲（例：複製一份遊戲改數字，比較試改前後）
'use strict';
const T_ = require('./load_game').loadGame();
const G = T_.Game;
globalThis.__NOCAPTRIM = true;
G.simFast = true;
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const { seed, splitEnemyRng, noFx } = require('./rng');
splitEnemyRng(T_); noFx();
const B = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
const w = arg('w'), N = +(arg('n') || 4), L = +(arg('level') || 6);
const W = T_.WEAPONS[w];
if (!W) { console.log(`用法：node weapondiag.js --w=<${Object.keys(T_.WEAPONS).join('|')}> --n=20 [--level=6] [--routes=none,A,A0]`); process.exit(1); }
const ROUTES = (arg('routes') || 'none,A,A0,A1,B,B0,B1,C,C0,C1').split(',');
const name = rk => rk === 'none' ? '沒升級' : rk.length === 1 ? W.paths[rk].name : W.paths[rk[0]].next[+rk[1]].name;
const TIER = { 3: { chips: 3, parts: 1 }, 6: { chips: 5, parts: 3 }, 10: { chips: 6, parts: 4 } }[L];
if (!TIER) { console.log('--level 只能是 3、6、10（跟武器升級價值表一樣）'); process.exit(1); }
const POOL = T_.NORMAL_IDS.filter(id => !T_.isComp || !T_.isComp(id));
const pick = a => a[Math.floor(Math.random() * a.length)];

let S;
const reset = () => ({ src: {}, hits: 0, hitDmg: 0, shots: 0, kills: 0, life: 0, hpSum: 0, speed: [],
  burnIn: 0, burnWaste: 0, layerSum: 0, layerN: 0, shardSpawn: 0, shardHit: 0, gen2Spawn: 0, gen2Hit: 0, boom: 0, boomN: 0, boomHist: {} });
const burnLeft = e => (e.burnL ? e.burnL.reduce((a, l) => a + l.dps * Math.max(0, l.t), 0) : 0) + (e.burnT > 0 ? e.burnDps * e.burnT : 0);
{
  const rd = G.recordDamage;  // 所有傷害（含燃燒）都經過這裡；只算實際扣掉的血
  G.recordDamage = function (source, amount, att) {
    if (!(att && att.nobody) && amount > 0) S.src[source] = (S.src[source] || 0) + amount;
    return rd.call(this, source, amount, att);
  };
  const hurt = T_.Enemy.prototype.hurt;
  T_.Enemy.prototype.hurt = function (dmg, kx, ky, source = 'direct', att, knock) {
    if (source === 'direct' || source === 'echo') { S.hits++; S.hitDmg += dmg; }
    return hurt.call(this, dmg, kx, ky, source, att, knock);
  };
  const hf = G.hitFx;
  G.hitFx = function (e, b, dmg, x, y) {
    const before = burnLeft(e), r = hf.call(this, e, b, dmg, x, y), after = burnLeft(e);
    if (after > before) S.burnIn += after - before;  // 這一下多排進去的燃燒量（一般燃燒刷新只算多出來的）
    return r;
  };
  const kill = G.onEnemyKilled;
  G.onEnemyKilled = function (e) {
    S.kills++; S.life += (G.__t || 0) - (e.__born || 0); S.hpSum += e.maxHp; S.burnWaste += burnLeft(e);
    return kill.call(this, e);
  };
  const ex = G.explode;
  G.explode = function (x, y, r, dmg, color, skipId, att, cmp) {
    const alive = this.enemies.filter(e => !e.dead);
    const ret = ex.call(this, x, y, r, dmg, color, skipId, att, cmp);
    const n = alive.filter(e => Math.hypot(e.x - x, e.y - y) <= r + e.r).length;  // 爆炸後的位置（壓縮會先吸）；含被直擊那隻
    S.boom++; S.boomN += n; S.boomHist[Math.min(n, 5)] = (S.boomHist[Math.min(n, 5)] || 0) + 1;
    return ret;
  };
}

const BANK = { lost: 0 };
{
  const hurt = G.hurtPlayer;
  G.hurtPlayer = function (dmg, cause, p = this.player, sx, sy) {
    if (p !== this.player) return hurt.call(this, dmg, cause, p, sx, sy);
    p.hp += 1e7; hurt.call(this, dmg, cause, p, sx, sy); p.hp -= 1e7;
    while (p.hp <= 0) { p.hp += p.maxHp; BANK.lost += p.maxHp; }
  };
}

function run1(chain, s, cfg, setup) {
  seed(3000 + s); G.newRun('run', 'vanguard', w); G.parts = {};
  const r = T_.splitChain(chain.map(id => id && T_.isHost(id) && id !== 'weapon' && !T_.socketsOf(id) ? T_.chipId(T_.baseOf(id), 2) : id));
  G.chain = r.chain; G.socks = r.socks;
  G.wSock = L < 7 ? 0 : L < 14 ? 1 : 2;
  setup(); G.recalc();
  G.node = { type: 'combat', L: 2, id: 'sim' };
  G.startCombat({ ...cfg, boss: false });
  const p = G.player; BANK.lost = 0; p.hp = p.maxHp;
  const hp0 = p.hp, shards = []; let t = 0;
  S.speed.push(G.mech.speed);
  while (G.state === 'play' && t < 240) {
    B.bot(p); G.update(1 / 60); t += 1 / 60; G.__t = t;
    for (const e of G.enemies) {
      if (e.__born == null) e.__born = t;
      if (!e.dead && e.burnL) { S.layerSum += e.burnL.length; S.layerN++; }
    }
    // 小電漿打中當下就消失：看上一幀還在的那些（不只看現在還在的）
    for (const b of shards) if (!b.__cnt && b.hitSet && b.hitSet.size > b.__h0) { b.__cnt = 1; if (b.shards) S.shardHit++; else S.gen2Hit++; }
    shards.length = 0;
    for (const b of G.bullets) {
      if (!b.__seen) {  // 新子彈
        b.__seen = 1; b.__h0 = b.hitSet ? b.hitSet.size : 0;
        if (b.shard) { if (b.shards) S.shardSpawn++; else S.gen2Spawn++; }
        else if (!b.depth && !b.comet) S.shots++;
      }
      if (b.shard && !b.__cnt) shards.push(b);
    }
  }
  return { t, lost: (hp0 - p.hp + BANK.lost) / p.maxHp * 100 };
}

const res = {};
for (const rk of ROUTES) res[rk] = { S: reset(), t: 0, lost: 0 };
for (let s = 0; s < N; s++) {
  seed(5000 + s * 37 + L);
  const ids = []; while (ids.length < TIER.chips) { const id = pick(POOL); if (!ids.includes(id)) ids.push(id); }
  const chain = ['weapon', ...ids];
  const parts = {}; for (let k = 0; k < TIER.parts; k++) { const q = pick(Object.keys(PARTS)); parts[q] = (parts[q] || 0) + 1; }
  for (const rk of ROUTES) {
    S = res[rk].S;
    const path = rk === 'none' ? null : rk[0], fi = rk !== 'none' && rk.length > 1 ? +rk[1] : null;
    for (const cfg of [{ level: L, wavesTotal: 3, elites: 0 }, { level: L, wavesTotal: 2, elites: 1 }]) {
      const r = run1(chain, s, cfg, () => { B.resetBot(); G.weapon = { id: w, path, final: fi }; G.refreshWeapon(); G.parts = { ...parts }; B.sortChain(); });
      res[rk].t += r.t; res[rk].lost += r.lost;
    }
  }
  process.stderr.write(`第 ${s + 1}/${N} 組\n`);
}
const base = res.none || res[ROUTES[0]];
console.log(`${W.name} 難度 ${L}，${N} 組隨機配裝（每組一般戰＋精英戰）${process.env.GAME_DIR ? `，遊戲：${process.env.GAME_DIR}` : ''}`);
console.log(`  時間、掉血是 ${N} 組加總（×速度倍數，跟「${name(ROUTES.includes('none') ? 'none' : ROUTES[0])}」比）；傷害是各來源占全部的 %；每發 = 直擊＋晶片多射的子彈打中一次的平均傷害`);
for (const rk of ROUTES) {
  const { S, t, lost } = res[rk], tot = Object.values(S.src).reduce((a, b) => a + b, 0) || 1;
  const src = Object.entries(S.src).sort((a, b) => b[1] - a[1]).filter(([, v]) => v / tot >= 0.005).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(0)}%`).join(' ');
  let out = `${name(rk)}`.padEnd(6, '　') + ` 時間 ${t.toFixed(0)}（×${(base.t / t).toFixed(2)}） 掉血 ${lost.toFixed(0)}% ｜ ${src}`;
  out += ` ｜ 每發 ${(S.hitDmg / S.hits).toFixed(1)}、子彈 ${(S.shots / t).toFixed(1)}/秒、擊殺 ${S.kills}、每隻 ${(S.hits / S.kills).toFixed(1)} 發／HP ${(S.hpSum / S.kills).toFixed(0)}／活 ${(S.life / S.kills).toFixed(1)} 秒`;
  const sp = S.speed.reduce((a, b) => a + b, 0) / S.speed.length;
  out += `、移動速度 ${sp.toFixed(2)}`;
  if (S.burnIn) out += ` ｜ 燃燒排進去 ${S.burnIn.toFixed(0)}，敵人死時沒燒完 ${(S.burnWaste / S.burnIn * 100).toFixed(0)}%` + (S.layerN ? `，燒著時平均 ${(S.layerSum / S.layerN).toFixed(1)} 層` : '');
  // 晶片偶爾也會生小子彈、爆炸：太少就不印
  if (S.shardSpawn + S.gen2Spawn > S.kills) {
    if (S.shardSpawn) out += ` ｜ 小電漿 ${S.shardSpawn} 顆打中 ${(S.shardHit / S.shardSpawn * 100).toFixed(0)}%`;
    if (S.gen2Spawn) out += ` ${S.shardSpawn ? '第二代' : '｜ 小電漿'} ${S.gen2Spawn} 顆打中 ${(S.gen2Hit / S.gen2Spawn * 100).toFixed(0)}%`;
  }
  if (S.boom > S.kills / 4) out += ` ｜ 爆炸 ${S.boom} 次、平均炸到 ${(S.boomN / S.boom).toFixed(2)} 隻（1/2/3/4/5+ 隻：${[1, 2, 3, 4, 5].map(k => ((S.boomHist[k] || 0) / S.boom * 100).toFixed(0) + '%').join('/')}）`;
  console.log(out);
}
process.exit(0);
