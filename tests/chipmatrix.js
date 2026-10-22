// 晶片 × 武器 模擬矩陣：4 種戰況、每格 4 秒、自動瞄準最近的敵人（靶不會動；衝刺射擊、擦彈沒測）
// 用法：
//   node chipmatrix.js                    印整張表（數字 = 對比只用武器的倍數；清場 = 擊殺數）
//   node chipmatrix.js --save             存成基準 chipmatrix_base.json
//   node chipmatrix.js --diff             只印跟基準差 10% 以上（清場差 2 殺以上）的格子 ← 改完晶片用這個
//   篩選：--sc=包圍  --chips=boomerang,sticky  --w=laser,blade
const fs = require('fs'), path = require('path');
const T_ = require('./load_game').loadGame();
const M = T_.MechCheck, G = T_.Game;
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const has = k => process.argv.includes(`--${k}`);
const BASE = path.join(__dirname, 'chipmatrix_base.json');
const dt = 1 / 60, SEC = 4;
const WN = Object.fromEntries(Object.entries(T_.WEAPONS).map(([id, w]) => [id, w.short || w.name]));
const WPN = arg('w') ? arg('w').split(',') : Object.keys(WN);
const CH = [null, ...(arg('chips') ? arg('chips').split(',') : ['boomerang', 'stasis', 'infect', 'echo', 'shard', 'homing', 'vortex',
  'amp', 'bigshot', 'blast', 'ignite', 'frost', 'shred', 'shock'])];
const ring = (n, r) => Array.from({ length: n }, (_, i) => [Math.cos(i / n * 6.283) * r, Math.sin(i / n * 6.283) * r]);
const SC = {
  '包圍8隻': () => M.targets(ring(8, 70), 'brute', true, 60),
  '前方散開8隻': () => M.targets(M.cone, 'brute', true, 60),
  '遠方單體350': () => M.targets([[350, 0]], 'brute', true, 60),
  '清場20隻': () => M.targets(Array.from({ length: 20 }, (_, i) => [110 + (i % 5) * 60, ((i / 5 | 0) - 1.5) * 40]), 'swarmer', true, 1),
};
const SCS = Object.keys(SC).filter(s => s.startsWith(arg('sc') || ''));
const isKill = sc => sc.startsWith('清場');

// 每格固定亂數種子：同樣的程式跑出同樣的數字，--diff 才不會被隨機散布干擾
function seed(n) { Math.random = () => { n = (n + 0x6D2B79F5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function run(w, chip, sc) {
  seed(12345);
  M.setup('sandbox', 'vanguard', w, null, null, ['weapon', chip, null, null]);
  const es = SC[sc](), hp0 = es.map(e => e.hp), p = G.player;
  p.aim = 0; p.fireCd = 0;
  for (let f = 0; f < SEC * 60; f++) {
    let bt = null, bd = Infinity;
    for (const e of G.enemies) { if (e.dead) continue; const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < bd) { bd = d; bt = e; } }
    if (bt) p.aim = Math.atan2(bt.y - p.y, bt.x - p.x);
    const want = chip === 'orbit' ? (f * dt) % 2.5 < 2.2 : chip === 'charge' ? (f * dt) % 1.1 < 0.1 : true;  // 環繞：按 2.2 秒放 0.3 秒；蓄力：每 1.1 秒點一下（停火 1 秒蓄滿）
    p.wantFire = want;
    G.time += dt; p.tickAlt(dt); p.tickFire(dt, want);  // tickAlt：武器每幀的事（熱度、無人機；不按右鍵）
    G.updateEnemies(dt); G.updateBullets(dt); G.updateEnemyBullets(dt);
  }
  if (isKill(sc)) return es.filter(e => e.dead || e.hp <= 0).length;
  return Math.round(es.reduce((a, e, i) => a + Math.min(hp0[i], hp0[i] - e.hp), 0));
}

const res = {};  // res[sc][chip|'-'][w] = 數值
for (const sc of SCS) {
  res[sc] = {};
  for (const chip of CH) { res[sc][chip || '-'] = {}; for (const w of WPN) res[sc][chip || '-'][w] = run(w, chip, sc); }
}
const name = c => c === '-' ? '（只有武器）' : T_.CHIPS[c].name;
const cell = (sc, c, w) => {
  const v = res[sc][c][w], b = res[sc]['-'][w];
  return isKill(sc) ? `${v}殺` : c === '-' ? `${v}` : `${(v / Math.max(1, b)).toFixed(1)}x`;
};

if (has('save')) {
  const old = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : {};
  for (const sc in res) for (const c in res[sc]) for (const w in res[sc][c]) ((old[sc] = old[sc] || {})[c] = old[sc][c] || {})[w] = res[sc][c][w];
  fs.writeFileSync(BASE, JSON.stringify(old));
  console.log('已存基準 chipmatrix_base.json');
} else if (has('diff')) {
  if (!fs.existsSync(BASE)) { console.log('沒有基準，先跑 --save'); process.exit(1); }
  const old = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  let n = 0;
  for (const sc in res) for (const c in res[sc]) for (const w in res[sc][c]) {
    const v = res[sc][c][w], o = old[sc] && old[sc][c] && old[sc][c][w];
    if (o == null) continue;
    const moved = isKill(sc) ? Math.abs(v - o) >= 2 : Math.abs(v - o) > Math.max(5, o * 0.1);
    if (!moved) continue;
    const ob = old[sc]['-'][w], nb = res[sc]['-'][w];
    const f = (x, b) => isKill(sc) ? `${x}殺` : c === '-' ? `${x}` : `${(x / Math.max(1, b)).toFixed(1)}x`;
    console.log(`${sc} / ${name(c)} / ${WN[w]}：${f(o, ob)} → ${f(v, nb)}`);
    n++;
  }
  console.log(n ? `${n} 格有變化` : '跟基準一樣');
} else {
  for (const sc of SCS) {
    console.log(`== ${sc}`);
    console.log('晶片'.padEnd(8) + WPN.map(w => WN[w].padStart(8)).join(''));
    for (const c of Object.keys(res[sc])) console.log(name(c).padEnd(8) + WPN.map(w => cell(sc, c, w).padStart(8)).join(''));
  }
}
