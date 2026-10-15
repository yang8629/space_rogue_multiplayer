// 星環電路 雙人版 · rares.js：稀有晶片的詞條 RARE（名稱、數值、什麼時候觸發、效果）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 稀有晶片 = 玩法晶片＋1 個詞條（詞條 Lv1～3）。詞條是「照這個晶片的玩法打出成果時」的獎勵：不是多一種用法、不跟組件重疊
//   on：什麼時候觸發 —— act 晶片發動時（見 Game.rareAct）、kill 玩法擊殺、charge 發動時充能、hurt 受傷時
//   cd：冷卻（秒，每個人、每個晶片各算）；v：Lv1／Lv2／Lv3 的數值；vt(v)：v 顯示成什麼（沒寫就照原樣）；desc(x)：說明，x = 顯示用的數值（總覽一次列三級：80／100／120）
//   fx(p, st, v, x, y, base, owner)：效果，只在房主跑（p = 那個人的飛船，st = 這個晶片的詞條狀態，owner = 那個人的配裝 L，房主自己 null）
const RARE = {
  aftershock: { name: '餘波', on: 'act', cd: 0.5, v: [80, 100, 120], dmg: 0.5,
    desc: v => `發動時在發動的位置炸一圈震波：推開敵人，造成武器 ${Math.round(RARE.aftershock.dmg * 100)}% 的傷害（半徑 ${v}）`,
    fx: (p, st, v, x, y, base, owner) => Game.explode(x, y, v, Game.wpOf(p).damage * RARE.aftershock.dmg, '#ffd166', null, { src: base, cr: null, owner }) },
  purge: { name: '淨空', on: 'act', cd: 0.5, v: [60, 90, 120],
    desc: v => `發動時清掉發動位置周圍的敵彈（半徑 ${v}）`,
    fx: (p, st, v, x, y) => { Game.eBullets = Game.eBullets.filter(b => dist2(b.x, b.y, x, y) > v * v); ringFx(x, y, v, '#bfefff'); } },
  swift: { name: '迅捷', on: 'act', cd: 0.5, v: [0.15, 0.25, 0.35],
    desc: v => `發動時衝刺冷卻 −${v} 秒`,
    fx: (p, st, v) => { p.dashCd = Math.max(0, p.dashCd - v); } },
  frenzy: { name: '狂熱', on: 'kill', v: [0.06, 0.09, 0.12], vt: v => Math.round(v * 100), t: 3, max: 5,
    desc: x => `玩法擊殺後 ${RARE.frenzy.t} 秒內射速 +${x}%（最多 ${RARE.frenzy.max} 層）`,
    fx: (p, st, v) => { st.v = v; st.k = [...(st.k || []).filter(t => t > Game.time), Game.time + RARE.frenzy.t].slice(-RARE.frenzy.max); } },
  burst: { name: '爆發', on: 'charge', v: [10, 8, 6], dirs: 8,
    desc: v => `發動時充能，照常使用約 ${v} 秒充滿：用整條電路朝四周 ${RARE.burst.dirs} 個方向開槍`,
    fx: (p, st, v, x, y, base, owner) => Game.withLoadout(owner, () => {
      const list = runOps(Game.stats.ops, 0).map(s => ({ ...s, orbit: 0, src: base }));  // 環繞的子彈不進圈，直接射出去
      const n0 = Game.bullets.length;
      for (let i = 0; i < RARE.burst.dirs; i++) spawnShots(list, p.x, p.y, i / RARE.burst.dirs * TAU, 0, null);
      Game.markRareFx(n0);  // 射出去的子彈之後不再觸發詞條（加速、反彈、折返…）
      ringFx(p.x, p.y, 60, '#ffd166');
    }) },
  retort: { name: '反擊', on: 'hurt', cd: 2,
    desc: () => `受傷時這個晶片強制發動一次（冷卻 ${RARE.retort.cd} 秒）`,
    fx: (p, st, v, x, y, base, owner) => CHIPS[base].force(p, owner) },
  crystal: { name: '結晶', on: 'kill', v: [10, 8, 6],
    desc: v => `每 ${v} 次玩法擊殺得 1 層護盾（擋下一次傷害，最多 1 層）`,
    fx: (p, st, v) => { if ((st.n = (st.n || 0) + 1) < v) return; st.n = 0; if (!(p.shield > 0)) { p.shield = 1; floatText(p.x, p.y - 26, '結晶護盾', '#4cc9f0'); } } },
  reap: { name: '收割', on: 'kill', v: [0.5, 0.75, 1], cap: 3,
    desc: v => `玩法擊殺回 ${v} HP（每秒最多 ${RARE.reap.cap}）`,
    fx: (p, st, v) => {
      if (p.dead) return;
      if (Game.time - (st.w || 0) > 1) { st.w = Game.time; st.h = 0; }
      const add = Math.min(v, RARE.reap.cap - st.h);
      if (add > 0) { st.h += add; p.hp = Math.min(p.maxHp, p.hp + add); }
    } },
};
const RARE_IDS = Object.keys(RARE);
const RARE_MAX_LV = 3;
// 詞條的說明（卡片、編輯器）：「餘波 Lv2：……」
const rareShow = (k, v) => (RARE[k].vt || (x => x))(v);
const rareTxt = r => r ? `${RARE[r.k].name} Lv${r.lv}：${RARE[r.k].desc(RARE[r.k].v ? rareShow(r.k, RARE[r.k].v[r.lv - 1]) : null)}` : '';
// 三級一起列（總覽、README 用）：「半徑 80／100／120」
const rareAllTxt = k => RARE[k].desc(RARE[k].v ? RARE[k].v.map(v => rareShow(k, v)).join('／') : null);
// 狂熱：這個人身上所有狂熱詞條的射速加成（開火時加進射速，見 Player.tickFire）
function rareRateAdd(p) {
  const R = p.rare;
  if (!R) return 0;
  let k = 0;
  for (const b in R) { const st = R[b]; if (st.k && st.v) k += st.k.filter(t => t > Game.time).length * st.v; }
  return k;
}
// 抽一個詞條：種類平均，等級照 CFG.RARE.lv 的機率
function rollRare() {
  const W = CFG.RARE.lv, r = Math.random();
  let lv = 1, acc = W[0];
  while (lv < W.length && r >= acc) acc += W[lv++];
  return { k: pick(RARE_IDS), lv };
}
// 拿到稀有版本時，身上那個晶片的詞條變成什麼：沒有詞條 → 卡片的詞條；同一個詞條 → 增強（+1 級）；
//   不同詞條 → 玩家選 replace 替換（新詞條從 1 級）或 boost 增強（原本的 +1 級，預設）
function mergeRare(old, card, mode = 'boost') {
  if (!old) return { ...card };
  if (old.k === card.k || mode !== 'replace') return { k: old.k, lv: Math.min(RARE_MAX_LV, old.lv + 1) };
  return { k: card.k, lv: 1 };
}
