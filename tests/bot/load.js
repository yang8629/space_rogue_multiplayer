// 載入整局模擬的電腦（bot/fight.js 戰鬥操作、bot/value.js 整套配裝評分、bot/pick.js 做選擇）到一份遊戲的全域範圍
//   loadBot(run, { tables })：run = 執行程式碼的函式（vm.runInThisContext，或 coopsim 的 code => vm.runInContext(code, ctx)）
//   tables：把價值表一起放進那份遊戲（另一個 vm context 用；同一個 context 直接放進 globalThis）
//     晶片價值表 chipvalue_base.json／chipvalue_pairs.json（botsim --value）、武器升級價值表 upgradevalue_<武器>.json（botsim --upval）、
//     路線價值表 routevalue_<武器>.json（botsim --routeval）
//   回傳電腦的函式（包在一個函式範圍裡，名稱不會跟遊戲的全域撞到）
//   環境變數 TABLE_DIR：價值表改讀這個資料夾（試改版用另一份表，不蓋掉正式的；botsim 的 --routeval／--upval、runsim 的路線結果也存到這裡）
'use strict';
const fs = require('fs'), DIR = process.env.TABLE_DIR ? require('path').resolve(process.env.TABLE_DIR) + '/' : __dirname + '/../';
const read = f => fs.readFileSync(__dirname + '/' + f, 'utf8');
const json = f => { try { return JSON.parse(fs.readFileSync(DIR + f, 'utf8')); } catch (e) { return null; } };
// 武器升級價值表：每把武器一個檔，合成 { 武器: { 難度: { 'A0': { speed, dmg } } } }
function upgradeTable() {
  const out = {};
  for (const f of fs.readdirSync(DIR)) { const m = f.match(/^upgradevalue_(\w+)\.json$/); if (m) { const t = json(f); if (t) out[m[1]] = t; } }
  return out;
}
// 路線價值表：每把武器一個檔 routevalue_<武器>.json（botsim --routeval），合成 { 武器: { 路線: { 難度: { 東西: {...} } } } }
function routeTable() {
  const out = {};
  for (const f of fs.readdirSync(DIR)) { const m = f.match(/^routevalue_(\w+)\.json$/); if (m) { const t = json(f); if (t) out[m[1]] = t; } }
  return out;
}
// 兩兩組合表（chipvalue_pairs.json）10-09 拿掉：過時（回響減半前、10 萬血量），組合的效果雜訊太大量不準；電腦挑晶片只用路線價值表，組件插哪裡照 pick.js 的 BIG 名單
const tables = () => ({ __CV: json('chipvalue_base.json'), __CP: null, __UPV: upgradeTable(), __RV: routeTable() });

function botSource(withTables) {
  const T = withTables ? tables() : null;
  return `(() => {
const G = Game, CH = CHIPS;
${T ? Object.entries(T).map(([k, v]) => `globalThis.${k} = ${JSON.stringify(v)};`).join('\n') : ''}
${read('fight.js')}
${read('value.js')}
${read('pick.js')}
return { rvItem, rvScore, partScore, stallSecs: () => G.time - stall.t, setRoute, bot, baseBot, resetBot, hasChip, bOf, equip, sortChain, chipScore, rewardScore, pickReward, shopBuy, chooseNode, bossPick, handle, closeEditor, buildScore, trial, partGain, pickUpgrade, upgradeScore };
})()`;
}

function loadBot(run, opt = {}) {
  if (!opt.tables) Object.assign(globalThis, tables());
  return run(botSource(opt.tables), { filename: 'bot.js' });
}

module.exports = { loadBot, botSource };
