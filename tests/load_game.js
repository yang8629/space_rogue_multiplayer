// 在 Node 裡載入雙人版的遊戲程式碼（以假 DOM 執行），回傳遊戲內部物件供測試使用
//   index.html 依序載入 js/*.js（不是單一 <script>），這裡也照同樣順序「一個檔案一個 script」執行，
//   和瀏覽器一樣：頂層的 const/let 彼此共用，但 function 宣告只在自己的檔案內提前（hoist）
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

// 環境變數 GAME_DIR：改載入別份遊戲（例如舊版本的 git worktree，拿來跟玩家舊版的紀錄比）
const GAME_DIR = process.env.GAME_DIR || path.join(__dirname, '..');
const HTML_PATH = path.join(GAME_DIR, 'index.html');

function readGame() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const files = [...html.matchAll(/<script src="(js\/[^"?]+)(?:\?v=[^"]*)?"><\/script>/g)].map(m => ({
    name: m[1], code: fs.readFileSync(path.join(GAME_DIR, m[1]), 'utf8') }));
  if (!files.length) throw new Error('index.html 裡找不到 js/*.js');
  return { html, files, js: files.map(f => f.code).join('\n') };
}

// 假 DOM：任何屬性、任何呼叫都回傳同一個物件；innerHTML 等寫入的值會被記下來
// --locked：照局外成長上鎖（新玩家的晶片池）；沒給 = 全部開放（模擬測的是解鎖完的遊戲）
const LOCKED = process.argv.includes('--locked');
const STUB = `
const __mk = () => { const store = {}; const f = function () { return p; }; const p = new Proxy(f, {
  get(t, k) {
    if (k in store) return store[k];
    if (k === Symbol.toPrimitive) return () => 0;
    if (k === 'matches') return false;
    if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => true };
    return p;
  },
  set(t, k, v) { store[k] = v; return true; }, apply() { return p; } }); return p; };
globalThis.document = __mk(); globalThis.window = globalThis; globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false }); globalThis.requestAnimationFrame = () => {};
globalThis.innerWidth = 1280; globalThis.innerHeight = 720; globalThis.devicePixelRatio = 1;
// 存檔放在記憶體裡（章節進度等要讀得回來，機制檢查「章節進度」會測）；遊玩紀錄不存：模擬一跑幾百局，越存越大會拖慢
//   --locked：解鎖進度、章節進度也不存，每一局都是新玩家的晶片池
globalThis.localStorage = (() => { const m = new Map(), drop = ['v2_runRecords', ...(${LOCKED} ? ['v2_unlocks', 'v2_chapters'] : [])]; return {
  getItem: k => (m.has(k) ? m.get(k) : null),
  setItem(k, v) { if (!drop.includes(k)) m.set(k, String(v)); },
  removeItem(k) { m.delete(k); } }; })();
globalThis.location = { hash: '' };
`;

// 從遊戲腳本內部匯出的名稱（都是遊戲的頂層宣告）
const EXPORTS = `Game, CHIPS, WEAPONS, NORMAL_IDS, COMPOSITE_IDS, OVERLOADS, CFG, SHIPS, Enemy, Screen, Editor, Codex,
  TYPE_META, NODE_META, PASSIVE_LABEL, LV_INFO, ENEMY_TYPES, lvMulOf,
  chipId, fullChip, newChip, socketsOf, isComp, isHost, parseChipId, splitChain, flatChain, sockCount, analyzeChain, compileLine, weaponParams, weaponTitle, genMap,
  hasLv, slotLv, lvName, startChipPicks, isUnlocked, openChips, lvOf, rareOf, mergedChip, baseOf, MechCheck, Net, NetView, Player, render, Objects, Arena, WEAPON_PLAY, Hub, HUB, Input`;

// 在某個 vm context 裡依序執行每個遊戲檔案（run = vm.runInThisContext 或 (code, opt) => vm.runInContext(code, ctx, opt)）
function runFiles(run, pre = '') {
  run(STUB + pre, { filename: 'stub' });
  for (const f of readGame().files) run(f.code, { filename: f.name });
  run(`CFG.UNLOCK_ALL = ${!LOCKED};`, { filename: 'unlock' });
}

let cached = null;
function loadGame() {
  if (cached) return cached;
  runFiles((code, opt) => vm.runInThisContext(code, opt));
  // 沒有的名稱（舊版遊戲）給 undefined，不讓整個載入失敗
  const names = EXPORTS.split(',').map(x => x.trim()).filter(Boolean);
  vm.runInThisContext(`globalThis.__T = { ${names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`);
  cached = globalThis.__T;
  return cached;
}

module.exports = { loadGame, readGame, runFiles, HTML_PATH, STUB };
