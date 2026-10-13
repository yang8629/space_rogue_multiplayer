// 升級健檢（2026-10-12）：不跑模擬，讀現有的結果，標出武器升級可能有問題的地方（幾秒）
//   讀：武器升級價值表 upgradevalue_<武器>.json（botsim --upval）、它的指紋 upval_fp.json、整局模擬的路線結果 runsim_routes_<武器>.json（runsim）
//   標出：
//     第一段太弱：分數（速度 ÷ √掉血）不到 FIRST_SCORE，或掉血比沒升級多（10-12 改：只看速度會誤報「慢一點但掉血少很多」的攻城砲、飛刃）（只升第一段的時候撐不到升滿；10-12 發現自動軌道、相位灼燒）
//     終極偏離：分數（速度 ÷ √掉血）低於 FINAL_LO 或高於 FINAL_HI
//     第一段撐不過第一星區：整局模擬指定這個第一段（兩條終極合計）的局裡，死在第一星區的比例 ≥ S1_DIE
//       （10-12 改：原本看「很少升滿」，但終極在第二星區的軍械台才拿得到，活到第三星區的局幾乎都升滿 → 只是在量活多久；相位灼燒是死在 1-7 旗艦）
//     表過期：weapons.js 裡這把武器的升級在量完之後改過（upfp.js；改 game.js 的效果寫法抓不到）
//   用法：node upcheck.js [--w=railgun,blade] [--brief]（--brief 只印警告，release.js 用）
'use strict';
const fs = require('fs'), path = require('path');
const FIRST_SCORE = 1.15;  // 第一段：難度 3、6 的速度（幾何平均）÷ √掉血 至少這麼多
const FIRST_DMG = 1.0;     // 第一段：掉血（跟沒升級比）不能超過
const FINAL_LO = 1.2, FINAL_HI = 2.0;  // 終極：難度 6、10 的分數（幾何平均）
const S1_DIE = 0.5, S1_MIN_N = 10;  // 第一段：一半以上的局死在第一星區（至少 10 局才判斷）

const T_ = require('./load_game').loadGame();
const { weaponFp } = require('./upfp');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const BRIEF = process.argv.includes('--brief');
const WS = arg('w') ? arg('w').split(',') : ['laser', 'scatter', 'plasma', 'railgun', 'blade'];
const json = f => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8')); } catch (e) { return null; } };
const gmean = a => a.length ? Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length) : NaN;
const f2 = x => isFinite(x) ? x.toFixed(2) : '—';  // 判斷也用印出來的兩位小數（不會出現「1.15 不到 1.15」）
const FP = json('upval_fp.json') || {};

const warns = [];  // [武器簡稱, 內容]
const out = [];
for (const w of WS) {
  const W = T_.WEAPONS[w]; if (!W) { console.log(`沒有這把武器：${w}`); continue; }
  const U = json(`upgradevalue_${w}.json`), R = json(`runsim_routes_${w}.json`), cur = weaponFp(w);
  const warn = s => warns.push([W.short, s]);
  const tiers = U ? Object.keys(U).map(Number).sort((a, b) => a - b) : [];
  const at = (L, k) => U && U[L] && U[L][k];
  const score = x => x ? x.speed / Math.sqrt(Math.max(0.2, x.dmg)) : NaN;
  // 表的狀態
  let st;
  if (!U) { st = '沒有武器升級價值表'; warn('沒有武器升級價值表 → 量：node botsim.js --upval --w=' + w + ' --n=20'); }
  else if (!FP[w]) { st = '舊表（沒記錄指紋，不知道是不是最新）'; warn('武器升級價值表是舊表（10-12 以前量的：沒有指紋、沒有第一段）→ 重量：node botsim.js --upval --w=' + w + ' --n=20'); }
  else if (FP[w].fp !== cur) { st = `⚠ 過期（${FP[w].date} 量的，之後 weapons.js 改過）`; warn('武器升級價值表過期（weapons.js 這把武器的升級改過）→ 重量：node botsim.js --upval --w=' + w + ' --n=20'); }
  else st = `最新（${FP[w].date} 量的，每難度 ${FP[w].n} 組）`;
  let rst;
  if (!R) rst = '沒有整局模擬的路線結果（runsim 跑 30 局以上會存）';
  else if (R.fp == null) rst = `${R.date}，${R.runs} 局，版本不確定`;
  else rst = `${R.date}，${R.runs} 局${R.fp === cur ? '' : '，⚠ 之後 weapons.js 這把改過'}`;
  out.push(`== ${W.name}`, `  武器升級價值表：${st}`, `  整局模擬：${rst}`);
  if (!U) continue;
  // 第一段
  const firstT = tiers.filter(L => L <= 6), finalT = tiers.filter(L => L >= 6);
  out.push(`  第一段（跟沒升級比）　速度 難度 ${firstT.join('／')}　掉血　分數　｜整局：死在第一星區／局數`);
  if (!Object.keys(W.paths).some(p => at(firstT[0], p))) { out.push('    （表裡沒有第一段，重量武器升級價值表才有）'); if (FP[w] && FP[w].fp === cur) warn('表裡沒有第一段 → 重量：node botsim.js --upval --w=' + w + ' --n=20'); }
  else for (const p of Object.keys(W.paths)) {
    const sp = firstT.map(L => at(L, p) ? at(L, p).speed : NaN), dm = at(firstT[0], p) ? at(firstT[0], p).dmg : NaN, g = gmean(sp.filter(isFinite));
    const bad = [];
    const fs1 = g / Math.sqrt(Math.max(0.2, dm));
    if (+f2(fs1) < FIRST_SCORE) bad.push(`分數 ${f2(fs1)} 不到 ${FIRST_SCORE}`);
    if (+f2(dm) > FIRST_DMG) bad.push(`掉血 ×${f2(dm)} 比沒升級多`);
    const rr = R && R.routes ? [R.routes[p + '0'], R.routes[p + '1']].filter(Boolean) : [], s1 = rr.some(r => r[3] != null) ? rr.reduce((a, r) => a + (r[3] || 0), 0) : null, sn = rr.reduce((a, r) => a + r[1], 0);
    if (s1 != null && sn >= S1_MIN_N && s1 / sn >= S1_DIE) bad.push(`整局 ${s1}/${sn} 局死在第一星區`);
    out.push(`    ${W.paths[p].name.padEnd(5, '　')} ${sp.map(f2).join('／')}　×${f2(dm)}　${f2(fs1)}　｜${s1 != null ? `${s1}／${sn}` : '—'}${bad.length ? '　⚠ ' + bad.join('、') : ''}`);
    if (bad.length) warn(`第一段「${W.paths[p].name}」太弱：${bad.join('、')}`);
  }
  // 終極
  out.push(`  終極（分數 = 速度 ÷ √掉血）　難度 ${tiers.join('／')}　｜整局：升滿／通關／局數（升滿多寡主要看活多久，只參考）`);
  for (const p of Object.keys(W.paths)) W.paths[p].next.forEach((n, f) => {
    const k = p + f, sc = tiers.map(L => score(at(L, k))), g = gmean(finalT.map(L => score(at(L, k))).filter(isFinite));
    const r = R && R.routes && R.routes[k], bad = [];
    if (+f2(g) < FINAL_LO) bad.push(`分數 ${f2(g)} 低於 ${FINAL_LO}`);
    if (+f2(g) > FINAL_HI) bad.push(`分數 ${f2(g)} 高於 ${FINAL_HI}`);
    out.push(`    ${(W.paths[p].name + '→' + n.name).padEnd(10, '　')} ${sc.map(f2).join('／')}　｜${r ? `${r[2]}／${r[0]}／${r[1]}` : '—'}${bad.length ? '　⚠ ' + bad.join('、') : ''}`);
    if (bad.length) warn(`終極「${W.paths[p].name}→${n.name}」${bad.join('、')}`);
  });
}
if (!BRIEF) console.log(out.join('\n') + '\n');
console.log(warns.length ? `升級健檢：${warns.length} 個警告\n` + warns.map(([w, s]) => `  ${w}｜${s}`).join('\n') : '升級健檢：沒有警告');
