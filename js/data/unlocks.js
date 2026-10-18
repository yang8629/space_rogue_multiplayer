// 星環電路 多人版 · unlocks.js：局外成長（解鎖型，設計見 docs/局外成長草稿.md）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   玩越多選項越多（飛船、武器、晶片），不加數值。進度存在瀏覽器（UNLOCK_KEY），一局結束時（Game.saveRecord）加進去
//   CFG.UNLOCK_ALL = true：全部開放（測試用）；進度照樣記。晶片池用 openChips 過濾（三選一、商店、黑市、事件、開局晶片）
'use strict';

const UNLOCK_KEY = 'v2_unlocks';
// 進度 P：runs 完成幾局、kills 擊殺、elites 打倒精英（虛空獵手）、echoK 回響擊殺、sector 到過最遠的星區、
//   boss { 旗艦 id: 打倒幾次 }、bossW { 武器 id: 用它打倒旗艦幾次 }、play { 晶片: 玩法擊殺 }、ch 已通關的章號
const UNLOCK_KINDS = [['ship', '飛船'], ['weapon', '武器'], ['play', '玩法晶片'], ['comp', '組件'], ['trigger', '觸發器']];
const playN = (P, id) => P.play[id] || 0;
const playNeed = (chip, n) => ({ need: () => `用「${CHIPS[chip].name}」打出 ${n} 次玩法擊殺（累計）`, prog: P => [playN(P, chip), n] });
// 每項 { kind, id, need（條件說明，可以是函式）, prog(P) → [現在, 目標] }；沒列在這裡的 = 一開始就開放
const UNLOCKS = [
  { kind: 'ship', id: 'wraith', need: () => `打倒${ENEMY_TYPES.boss.name}（第 1 星區旗艦）一次`, prog: P => [P.boss.boss || 0, 1] },
  { kind: 'ship', id: 'gate', need: () => `打倒${ENEMY_TYPES.boss2.name}（第 2 星區旗艦）一次`, prog: P => [P.boss.boss2 || 0, 1] },
  { kind: 'ship', id: 'sentry', need: '通關第一章', prog: P => [P.ch.includes(1) ? 1 : 0, 1] },
  { kind: 'weapon', id: 'railgun', need: '到達第 2 星區', prog: P => [P.sector >= 2 ? 1 : 0, 1] },
  { kind: 'weapon', id: 'blade', need: '到達第 3 星區', prog: P => [P.sector >= 3 ? 1 : 0, 1] },
  { kind: 'play', id: 'wallbounce', ...playNeed('boomerang', 100) },
  // 攔截跟相位刃同時開：相位刃要裝攔截才會格擋（只有升級「格擋流」不用），先拿到刀卻沒有攔截就少了主要的搭配
  { kind: 'play', id: 'intercept', need: '到達第 3 星區（跟相位刃一起）', prog: P => [P.sector >= 3 ? 1 : 0, 1] },
  { kind: 'play', id: 'pull', ...playNeed('stasis', 100) },
  { kind: 'play', id: 'accel', ...playNeed('charge', 100) },
  { kind: 'play', id: 'infect', ...playNeed('sticky', 100) },
  { kind: 'comp', id: 'mirror', need: '完成 3 局（輸贏都算）', prog: P => [P.runs, 3] },
  { kind: 'comp', id: 'overclock', ...playNeed('stand', 100) },
  { kind: 'comp', id: 'shred', need: '打倒 10 隻精英（累計）', prog: P => [P.elites, 10] },
  { kind: 'comp', id: 'focus', need: '用雷射或軌道砲打倒任一旗艦', prog: P => [(P.bossW.laser || 0) + (P.bossW.railgun || 0), 1] },
  { kind: 'comp', id: 'shock', need: '擊殺 2000 隻敵人（累計）', prog: P => [P.kills, 2000] },
  { kind: 'trigger', id: 'trigend', need: '回響（觸發器射出的子彈）擊殺 300 隻（累計）', prog: P => [P.echoK, 300] },
  { kind: 'trigger', id: 'trigtime', need: '回響擊殺 1000 隻（累計）', prog: P => [P.echoK, 1000] },
];
const unlockEntry = (kind, id) => UNLOCKS.find(u => u.kind === kind && u.id === id) || null;
const unlockNeed = u => typeof u.need === 'function' ? u.need() : u.need;
// 晶片屬於哪一類（玩法晶片 / 組件 / 觸發器）；不是可解鎖的晶片回傳 null
function unlockChipKind(id) {
  const c = CHIPS[id];
  if (!c || c.hidden || c.locked) return null;
  return c.type === 'comp' ? 'comp' : c.type === 'trigger' ? 'trigger' : c.kill ? 'play' : null;
}
// 這一類全部的 id（畫面照這個順序列）
function unlockIds(kind) {
  if (kind === 'ship') return Object.keys(SHIPS);
  if (kind === 'weapon') return Object.keys(WEAPONS);
  return Object.keys(CHIPS).filter(id => unlockChipKind(id) === kind);
}
function unlockName(kind, id) { return kind === 'ship' ? SHIPS[id].name : kind === 'weapon' ? WEAPONS[id].name : CHIPS[id].name; }

// 一局的成績 r = { sector, bossIds, weapon, kills, elites, echoK, play } 怎麼加進進度：一種成績一項
//   以後新的解鎖條件要記新的成績：在這裡加一項。舊的進度沒記過這一項（P.stats 裡沒有）→ 第一次讀進度時用遊玩紀錄補（unlockUpgrade）
const UNLOCK_STATS = {
  runs: P => { P.runs++; },
  kills: (P, r) => { P.kills += r.kills || 0; },
  elites: (P, r) => { P.elites += r.elites || 0; },
  echoK: (P, r) => { P.echoK += r.echoK || 0; },
  sector: (P, r) => { P.sector = Math.max(P.sector, r.sector || 0); },
  boss: (P, r) => { for (const id of r.bossIds || []) P.boss[id] = (P.boss[id] || 0) + 1; },
  bossW: (P, r) => { if (r.weapon && (r.bossIds || []).length) P.bossW[r.weapon] = (P.bossW[r.weapon] || 0) + r.bossIds.length; },
  play: (P, r) => { for (const [k, v] of Object.entries(r.play || {})) P.play[k] = (P.play[k] || 0) + (+v || 0); },
};
const UNLOCK_STATS_2200 = ['runs', 'kills', 'elites', 'echoK', 'sector', 'boss', 'bossW', 'play'];  // 2.20.0 開始記進度時就有的成績

function unlockLoad() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(UNLOCK_KEY) || '{}') || {}; } catch (e) { p = {}; }
  const P = unlockParse(p);
  if (!P.mig || Object.keys(UNLOCK_STATS).some(k => !P.stats.includes(k))) {
    const { recs, ch } = unlockUpgrade(P, unlockRecords());
    try { localStorage.setItem(RECORDS_KEY, JSON.stringify(recs)); if (ch) localStorage.setItem(CHAPTER_KEY, JSON.stringify({ cleared: ch })); } catch (e) {}
    unlockSave(P);
  }
  return P;
}
// 存檔 → 進度（欄位壞掉的當 0）；stats = 已經在記的成績（2.20.0 的存檔沒有這欄 = 那時就有的全部）
function unlockParse(p) {
  const obj = o => o && typeof o === 'object' && !Array.isArray(o) ? o : {}, n = v => Number.isFinite(+v) ? Math.max(0, +v) : 0;
  return { runs: n(p.runs), kills: n(p.kills), elites: n(p.elites), echoK: n(p.echoK), sector: n(p.sector),
    boss: obj(p.boss), bossW: obj(p.bossW), play: obj(p.play), ch: Array.isArray(p.ch) ? p.ch.filter(Number.isFinite) : [],
    stats: Array.isArray(p.stats) ? p.stats.filter(k => typeof k === 'string') : 'runs' in p ? UNLOCK_STATS_2200.slice() : [], mig: +p.mig || 0 };
}
function unlockSave(P) { try { localStorage.setItem(UNLOCK_KEY, JSON.stringify(P)); } catch (e) {} }
function unlockRecords() { try { const r = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); return Array.isArray(r) ? r.filter(x => x && typeof x === 'object') : []; } catch (e) { return []; } }
// 2.20.0 以前的遊玩紀錄（沒有版號的是更早的）
const UNLOCK_SINCE = [2, 20, 0];
function recordBefore(build) {
  const m = String(build || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return true;
  const v = m.slice(1).map(Number), i = v.findIndex((x, k) => x !== UNLOCK_SINCE[k]);
  return i >= 0 && v[i] < UNLOCK_SINCE[i];
}
// 遊玩紀錄 → 那一局的成績：紀錄有存 ulk 就用它；2.20.0 的紀錄還沒存，從紀錄的欄位換回來（精英、回響擊殺換不回來，當 0）
function recordRun(rec) {
  if (rec.ulk && typeof rec.ulk === 'object') return rec.ulk;
  const bossId = name => Object.keys(ENEMY_TYPES).find(k => ENEMY_TYPES[k].boss && ENEMY_TYPES[k].name === name);
  const chipByName = name => Object.keys(CHIPS).find(k => CHIPS[k].name === name);
  const play = {};
  for (const [name, v] of Object.entries((rec.mech && rec.mech.playKills) || {})) { const id = chipByName(name); if (id) play[id] = +v || 0; }
  return { sector: +rec.sector || 0, bossIds: (Array.isArray(rec.bosses) ? rec.bosses : []).map(bossId).filter(Boolean),
    weapon: Object.keys(WEAPONS).find(k => String(rec.weapon || '').split('・')[0] === WEAPONS[k].name) || null, kills: +rec.kills || 0, elites: 0, echoK: 0, play };
}
// 存檔升級（P 直接改；回傳要留下的遊玩紀錄、重來的章節進度）
//   mig 1（只做一次）：2.20.0 以前的遊玩紀錄刪掉；章節進度重來，只照留下的紀錄裡通關（或打到無盡）的章
//   沒記過的成績：用留下的紀錄（都是 2.20.0 以後的）補
function unlockUpgrade(P, recs) {
  let ch = null;
  if (!P.mig) {
    recs = recs.filter(r => !recordBefore(r.build));
    ch = [...new Set(recs.filter(r => r.result === 'cleared' || r.endless).map(r => r.chapter))].filter(id => CHAPTERS.some(c => c.id === id)).sort((a, b) => a - b);
    P.ch = ch; P.mig = 1;
  }
  for (const k of Object.keys(UNLOCK_STATS).filter(k => !P.stats.includes(k))) {
    for (const r of recs) UNLOCK_STATS[k](P, recordRun(r));
    P.stats.push(k);
  }
  return { recs, ch };
}
// 這一項的進度：{ cur, max, done }（cur 不超過 max）
function unlockState(u, P = unlockLoad()) { const [c, m] = u.prog(P); return { cur: Math.min(c, m), max: m, done: c >= m }; }
// 已達成的項目：存檔沒變就沿用（三選一、商店每次抽都要查十幾項，不要每次都重讀存檔）
let unlockMemo = { raw: undefined, done: null };
function unlockDone() {
  let raw = null;
  try { raw = localStorage.getItem(UNLOCK_KEY); } catch (e) {}
  if (raw !== unlockMemo.raw || !unlockMemo.done) {
    const P = unlockLoad();  // 第一次會升級存檔，所以存檔要重讀一次
    try { raw = localStorage.getItem(UNLOCK_KEY); } catch (e) {}
    unlockMemo = { raw, done: new Set(UNLOCKS.filter(u => unlockState(u, P).done)) };
  }
  return unlockMemo.done;
}
// 現在能不能選（UNLOCK_ALL 時一律可以；沒列在 UNLOCKS 的一開始就開放）
function isUnlocked(kind, id) {
  if (CFG.UNLOCK_ALL) return true;
  const u = unlockEntry(kind, id);
  return !u || unlockDone().has(u);
}
// 「新」標記（基地）：解鎖了、還沒在基地打開那一頁看過的；看過的存在 UNLOCK_SEEN_KEY（"種類:id" 的清單）
const UNLOCK_SEEN_KEY = 'v2_unlock_seen';
function unlockSeen() { try { const a = JSON.parse(localStorage.getItem(UNLOCK_SEEN_KEY) || '[]'); return new Set(Array.isArray(a) ? a : []); } catch (e) { return new Set(); } }
function unlockIsNew(u, seen = unlockSeen()) { return unlockDone().has(u) && !seen.has(u.kind + ':' + u.id); }
function unlockMarkSeen(list) {
  const seen = unlockSeen(), add = list.filter(u => unlockIsNew(u, seen));
  if (!add.length) return;
  for (const u of add) seen.add(u.kind + ':' + u.id);
  try { localStorage.setItem(UNLOCK_SEEN_KEY, JSON.stringify([...seen])); } catch (e) {}
}
// 晶片池（三選一、商店、黑市、事件、開局晶片）只留解鎖了的；不屬於可解鎖種類的（合成晶片）照留
const chipOpen = id => { const k = unlockChipKind(id); return !k || isUnlocked(k, id); };
const openChips = ids => CFG.UNLOCK_ALL ? ids : ids.filter(chipOpen);
const startChipPicks = () => pickN(openChips(NORMAL_IDS), 3);  // 開局三選一的起始晶片（模擬也用這個）
// 一局結束：把這一局的成績加進進度，回傳這一局新達成的項目（結算、標題畫面顯示用）
//   r 的格式見 UNLOCK_STATS
function unlockAddRun(r) {
  const P = unlockLoad(), before = new Set(UNLOCKS.filter(u => unlockState(u, P).done));
  for (const f of Object.values(UNLOCK_STATS)) f(P, r);
  P.ch = chapterProgress();
  unlockSave(P);
  return UNLOCKS.filter(u => !before.has(u) && unlockState(u, P).done);
}
