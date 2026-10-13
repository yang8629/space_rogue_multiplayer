'use strict';
// 一次性工具：把 multiplayer/index.html 的單一 <script> 依區塊拆成 js/*.js，CSS 拆成 css/style.css
// 用法：node split.js（會覆寫 multiplayer/index.html、js/、css/）
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const lines = html.split('\n');
const find = (pred, from = 0) => { for (let i = from; i < lines.length; i++) if (pred(lines[i])) return i; throw new Error('not found ' + pred); };

const styleStart = find(l => l.trim() === '<style>'), styleEnd = find(l => l.trim() === '</style>');
const scriptStart = find(l => l.trim() === '<script>'), scriptEnd = find(l => l.trim() === '</script>', scriptStart);
const header = name => find(l => l.startsWith('// ' + name), scriptStart) - 1;  // 區塊從上面那條 ==== 開始

// [檔名, 起點（含）, 說明]
const cut = [
  ['config.js', header('CONFIG'), '設定值 CFG 與共用小工具（亂數、距離、角度）'],
  ['core.js', header('CHIP DATABASE'), '子彈資料格式 shot()、增幅相加 addBonus、傷害歸屬（晶片傷害統計）'],
  ['weapons.js', header('WEAPONS'), '5 把武器與兩段升級樹、weaponParams / weaponEmit'],
  ['chips.js', find(l => l.startsWith('const CHIPS = {'), scriptStart), '晶片定義 CHIPS、等級 LV_INFO、合成升級、黑洞融合、起始電路'],
  ['ships.js', header('SHIPS'), '3 艘飛船'],
  ['pipeline.js', header('PIPELINE'), '電路執行器：compileChain / runOps / analyzeChain、倉庫被動'],
  ['map.js', header('MAP'), '航圖節點與星圖產生 genMap'],
  ['input.js', header('INPUT'), '鍵盤滑鼠、觸控雙搖桿、畫面尺寸 resize'],
  ['effects.js', header('FX'), '粒子 burst、浮動數字 floatText'],
  ['audio.js', header('SFX'), '音效 SFX、背景音樂 Music（Web Audio 即時合成）'],
  ['entities.js', header('ENTITIES'), 'Player、Bullet、敵人種類 ENEMY_TYPES 與 Enemy（含旗艦技能）'],
  ['game.js', header('GAME'), 'Game：一局的流程、戰鬥、獎勵、商店、黑洞、傷害、主更新'],
  ['range.js', header('RANGE'), '🎯 靶場：標靶排列、DPS 計算、慢動作'],
  ['net.js', header('NET'), '雙人連線：大廳、選配裝、同步、投票、錢包、斷線重連、雙人紀錄'],
  ['render.js', header('RENDER'), '戰鬥畫面繪圖：世界、敵人、子彈、飛船、HUD、靶場面板'],
  ['screens.js', header('SCREENS'), 'DOM 畫面：標題、選飛船／武器／晶片、航圖、獎勵、商店、結算、紀錄'],
  ['editor.js', header('EDITOR UI'), '電路編輯器（Tab）：拖放、晶片傷害統計分頁'],
  ['codex.js', header('CODEX'), '📖 電路總覽：規則、晶片、武器、圖表'],
  ['mechcheck.js', header('MECH CHECK'), '機制觸發檢查（42 項，總覽的「機制檢查」分頁）'],
  ['main.js', header('BOOT'), '啟動：初始化、主迴圈 frame()'],
];
// 機制檢查後面那幾個小工具，分回真正用到它們的檔案
const helperStart = find(l => l.startsWith('const near1 ='), scriptStart);
const dpsTree = find(l => l.startsWith('// 一把武器所有型態'), helperStart);
const chipElAt = find(l => l.startsWith('function chipEl('), helperStart);
const bootAt = header('BOOT');

const body = {};
cut.forEach(([file, start], i) => {
  const end = i + 1 < cut.length ? cut[i + 1][1] : scriptEnd;
  body[file] = lines.slice(start, end);
});
body['mechcheck.js'] = lines.slice(header('MECH CHECK'), helperStart).concat(lines.slice(helperStart, dpsTree));  // near1
body['codex.js'] = body['codex.js'].concat([''], lines.slice(dpsTree, chipElAt));                               // weaponDpsTree、pctUp、niceStep
body['editor.js'] = body['editor.js'].concat([''], lines.slice(chipElAt, bootAt));                              // chipEl、parseDrag

// 確認每一行都分到了（'use strict' 那行除外）
const used = Object.values(body).reduce((a, b) => a + b.length, 0);
const expected = scriptEnd - (scriptStart + 1) - 1;  // 去掉 'use strict';
if (Math.abs(used - expected) > 2) throw new Error(`line count mismatch ${used} vs ${expected}`);

fs.mkdirSync(path.join(DIR, 'js'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'css'), { recursive: true });
for (const [file, , desc] of cut) {
  const text = [`// 星環電路 雙人版 · ${file}：${desc}`, `// 所有 js/*.js 共用同一個全域範圍，載入順序見 index.html`, `'use strict';`, '', ...body[file]].join('\n').replace(/\n+$/, '') + '\n';
  fs.writeFileSync(path.join(DIR, 'js', file), text);
}
fs.writeFileSync(path.join(DIR, 'css', 'style.css'), lines.slice(styleStart + 1, styleEnd).map(l => l.replace(/^  /, '')).join('\n') + '\n');

const out = [
  ...lines.slice(0, styleStart),
  '<link rel="stylesheet" href="css/style.css">',
  ...lines.slice(styleEnd + 1, scriptStart),
  '<!-- 遊戲程式：依序載入（後面的檔案會用到前面定義的東西）。每個檔案的用途寫在 README 的「檔案結構」 -->',
  ...cut.map(([file]) => `<script src="js/${file}"></script>`),
  ...lines.slice(scriptEnd + 1),
].join('\n');
fs.writeFileSync(path.join(DIR, 'index.html'), out);
console.log('split into', cut.length, 'files; lines', used);
for (const [file] of cut) console.log(file.padEnd(14), fs.readFileSync(path.join(DIR, 'js', file), 'utf8').split('\n').length);
