// 把整局模擬現在在用的兩張表整理成遊戲「數值圖表」用的資料檔 multiplayer/js/data/simvalue.js（2026-10-13，取代舊的晶片價值落點圖）
//   武器升級價值表 upgradevalue_<武器>.json（botsim --upval）：每條路線 vs 沒升級，難度 3／6／10 → [分數, 速度, 掉血]
//   路線價值表 routevalue_<武器>.json（botsim --routeval）：每條路線 × 每樣東西（晶片、零件 +1／+2／+4 層、模組）→ [分數, 速度, 掉血, 組數]
//     分數算法跟電腦挑東西一樣（bot/value.js rvScore：每組各自算倍數再取對數平均；掉血加底數 20，用同一樣東西所有路線合併的掉血）
//     每條路線只取一個難度：沒升級 6、只升第一段 6、終極 8（量的時候就是這樣）
//   重量表之後跑一次：node exportvalue.js（botsim --upval／--routeval 存檔後也會自動跑）
'use strict';
const fs = require('fs'), path = require('path');
const D = process.env.TABLE_DIR || __dirname, OUT = path.join(__dirname, '..', 'js', 'data', 'simvalue.js');
const WPN = ['laser', 'scatter', 'plasma', 'railgun', 'blade'];
const json = f => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (e) { return null; } };
const r2 = v => Math.round(v * 100) / 100;
const RV_F = 20, RV_OWN = 24;
const lgMean = (s, f) => s.reduce((a, g) => a + f(g), 0) / s.length;
const speedLg = s => lgMean(s, g => Math.log(g[2] / g[0]));
const bloodLg = s => lgMean(s, g => Math.log((g[1] + RV_F) / (g[3] + RV_F)));

function exportValue() {
  const out = { date: new Date().toLocaleDateString('sv'), upval: {}, route: {}, when: {} };  // when[武器] = [武器升級價值表的日期, 路線價值表的日期]
  const day = f => { try { return fs.statSync(path.join(D, f)).mtime.toLocaleDateString('sv'); } catch (e) { return null; } };
  for (const w of WPN) {
    out.when[w] = [day(`upgradevalue_${w}.json`), day(`routevalue_${w}.json`)];
    const U = json(`upgradevalue_${w}.json`);
    if (U) { out.upval[w] = {}; for (const L in U) { out.upval[w][L] = {}; for (const k in U[L]) { const x = U[L][k]; out.upval[w][L][k] = [r2(x.speed / Math.sqrt(Math.max(0.2, x.dmg))), r2(x.speed), r2(x.dmg)]; } } }
    const T = json(`routevalue_${w}.json`);
    if (!T) continue;
    const pool = {};  // 同一樣東西所有路線、難度合併的掉血
    for (const rk in T) for (const L in T[rk]) for (const it in T[rk][L]) { const x = T[rk][L][it]; if (x.s) (pool[it] = pool[it] || []).push(...x.s); }
    out.route[w] = {};
    for (const rk in T) {
      const Ls = Object.keys(T[rk]).map(Number), L = Math.max(...Ls);
      const C = T[rk][L]; if (!C) continue;
      out.route[w][rk] = { L, items: {} };
      for (const it in C) {
        const x = C[it]; if (!x.s || !x.s.length) continue;
        const sp = Math.exp(speedLg(x.s)), bl = Math.exp(x.s.length >= RV_OWN ? bloodLg(x.s) : bloodLg(pool[it]));
        out.route[w][rk].items[it] = [r2(sp / Math.sqrt(bl)), r2(sp), r2(bl), x.s.length];
      }
    }
  }
  fs.writeFileSync(OUT, `// 模擬數值（數值圖表用）：tests 的 exportvalue.js 產生，不要手改\n//   upval[武器][難度][路線] = [分數, 速度, 掉血]（武器升級價值表）；route[武器][路線] = { L: 難度, items: { 東西: [分數, 速度, 掉血, 組數] } }（路線價值表）\nconst SIM_VALUE = ${JSON.stringify(out)};\n`);
  return OUT;
}
module.exports = { exportValue };
if (require.main === module) console.log('已更新', exportValue());
