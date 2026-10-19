// 產生「敵人與物件畫風」預覽頁（art_lab/敵人與物件畫風.html）：preview_page.html 裡兩個位置換成遊戲的東西
//   /*ART_WORLD*/      ← tools/art/art_world.js 整份（敵人、地圖物件）
//   /*SHIPS_WEAPONS*/  ← 飛船、武器的資料（node 載入遊戲取 SHIPS、WEAPONS、WEAPON_MODEL）＋ render.js 畫飛船的那幾個函式（原樣抽出來）
//   遊戲美術改了就重跑，再發布到 claude.ai 的預覽頁（使用者給的連結）
//   用法：node tools/art/build_preview.js   （在 multiplayer 資料夾跑）
'use strict';
const fs = require('fs'), path = require('path');
const MP = path.join(__dirname, '..', '..'), read = f => fs.readFileSync(path.join(MP, f), 'utf8');
const cut = (src, from, to, name) => {  // 從 from 那段開始、到 to 之前（to 找不到就報錯，不默默少一段）
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`抽不到 ${name}（找不到「${a < 0 ? from : to}」）`);
  return src.slice(a, b);
};
// 遊戲資料：照 tests/load_game 的方法在 node 載入整個遊戲
const T = require(path.join(MP, 'tests', 'load_game')).loadGame(), vm = require('vm');
const ships = Object.fromEntries(Object.entries(T.SHIPS).map(([id, S]) => [id, { name: S.name, en: S.en, color: S.color, hull: S.hull, abilityName: S.abilityName }]));
const weapons = Object.fromEntries(Object.entries(T.WEAPONS).map(([id, W]) => [id, { name: W.name, color: W.color }]));
const model = vm.runInThisContext('WEAPON_MODEL');
const cfg = read('js/core/config.js'), render = read('js/ui/render.js');
const code = [
  `const SHIPS = ${JSON.stringify(ships)};`,
  `const WEAPONS = ${JSON.stringify(weapons)};`,
  `const WEAPON_MODEL = ${JSON.stringify(model)};`,
  cut(cfg, 'function mixWhite', 'function mixBlack', 'mixWhite'),
  cut(cfg, 'function mixBlack', '\n}\n', 'mixBlack') + '\n}\n',
  cut(render, 'const SHIP_ART = new Map', '// 靶場數據面板', '飛船畫法（render.js）'),
].join('\n');
const art = read('tools/art/art_world.js').replace(/^'use strict';\s*$/m, '');
let page = read('tools/art/preview_page.html');
for (const k of ['/*ART_WORLD*/', '/*SHIPS_WEAPONS*/']) if (!page.includes(k)) throw new Error(`preview_page.html 沒有 ${k}`);
page = page.replace('/*ART_WORLD*/', () => art).replace('/*SHIPS_WEAPONS*/', () => code);
const out = path.join(MP, '..', 'art_lab', '敵人與物件畫風.html');
fs.writeFileSync(out, page);
console.log(`存好 ${out}（${Math.round(fs.statSync(out).size / 1024)}KB；飛船 ${Object.keys(ships).length}、武器 ${Object.keys(weapons).length}）`);
