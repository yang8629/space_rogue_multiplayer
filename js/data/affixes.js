// 星環電路 雙人版 · affixes.js：精英詞綴（名稱、說明、數值、不能一起出現的組合）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 精英出生時隨機抽詞綴：第 1 星區 1 個、第 2 星區 2 個、第 3 星區以後 3 個（沙盒照波次）。名字照詞綴改：「分裂・狂暴的虛空獵手」
//   詞綴改的是打法（剋不同的配裝），不是單純加血加攻擊；不放回血、越拖越強、無敵階段（慢慢打也要能打）
//   行為寫在 entities.js（Enemy.setAffixes／affixTick、環形彈）、game.js（受傷、子彈、敵彈、出怪）
const AFFIX = {
  shield:  { name: '護盾', desc: '正面有盾，打到盾的子彈反彈；盾慢慢轉向你，繞到背後打', turn: Math.PI / 3 },  // 盾每秒最多轉 60°
  split:   { name: '分裂', desc: '血量剩一半時分成兩隻（每隻 35% 血、小一號）', at: 0.5, hp: 0.35, size: 0.7 },
  summon:  { name: '召喚', desc: '每 5 秒叫出 3 隻蟲群（不掉晶體）', cd: 5, n: 3, max: 6 },
  rage:    { name: '狂暴', desc: '血量低於一半：移動 +40%、出招變快', at: 0.5, speed: 1.4, cd: 0.6 },
  blink:   { name: '閃現', desc: '每掉 20% 血就瞬移到遠處（落點先閃紅圈）', step: 0.2, warn: 0.4, dist: [300, 400] },
  command: { name: '統帥', desc: '身邊的小兵移動 +25%、受到的傷害 −20%', r: 300, speed: 1.25, taken: 0.8 },
  homing:  { name: '追蹤彈', desc: '環形彈射出後會微微轉向你', t: 1.5, turn: Math.PI * 40 / 180 },
  mine:    { name: '佈雷', desc: '移動時留下地雷（碰到爆炸）', every: 1.2, life: 8, r: 60, dmg: 20, size: 9 },
  field:   { name: '磁場', desc: '身邊的子彈變慢', r: 140, slow: 0.5 },
  cloak:   { name: '隱形', desc: '平常幾乎看不見、自動瞄準和追蹤鎖不到；靠近或衝鋒時現形', near: 200 },
};
const AFFIX_IDS = Object.keys(AFFIX);
// 不會一起出現：閃現＋隱形（太難找）、召喚＋統帥（小兵海太強）
const AFFIX_BAN = [['blink', 'cloak'], ['summon', 'command']];
// 幾個詞綴：第 1 星區 1 個、第 2 星區 2 個、第 3 星區以後（含無盡）3 個
const affixCount = sector => clamp(Math.floor(sector), 1, 3);
// 抽 n 個不重複、沒有互斥組合的詞綴
function rollAffixes(n) {
  const out = [];
  for (const id of pickN(AFFIX_IDS, AFFIX_IDS.length)) {  // 打亂順序
    if (out.length >= n) break;
    if (AFFIX_BAN.some(([a, b]) => (id === a && out.includes(b)) || (id === b && out.includes(a)))) continue;
    out.push(id);
  }
  return out;
}
// 顯示用的名字：「分裂・狂暴的虛空獵手」（沒有詞綴就是原本的名字）
const eliteName = e => (e.affixes && e.affixes.length ? `${e.affixes.map(id => AFFIX[id].name).join('・')}的${e.t.name}` : e.t.name);
