// 星環電路 多人版 · pipeline.js：電路（一條線）：compileLine / analyzeChain / 武器的插件 / 晶片的產物、倉庫被動
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 線（設計見 chips.js 開頭、docs/設計方向.md「線」）
//   compileLine  : 電路格 → 線 = 線頭（飛船晶片）＋晶片（照順序）；每格的插件算成 plug（自己的＋同一條線上前面的，同種加總）
//                  另外附上每一格的狀態 info（線頭／晶片、在第幾條線第幾格、等級、有沒有作用、原因）
//   weaponShots  : 武器這一次出手的子彈（武器線的線頭）
//   LINE_FX      : 晶片被觸發時放出什麼（產物）；觸發、往下傳見 game_chips.js 的 lineQueue／linePass／lineFire
// =====================================================================

// info[i]：role 'head' 線頭／'chip' 晶片、k 是線上第幾個晶片、lv 晶片等級、idle 沒有作用（why 原因）
// info.socks[i][k]：第 i 格第 k 個插座的狀態
function compileLine(chain, socks = Game.socks || []) {
  const info = chain.map(() => ({ role: null, idle: false, why: '', k: -1 }));
  info.socks = chain.map(() => []);
  const line = { cells: [], plug: null };
  let run = { dmg: 0, size: 0, el: {} };
  chain.forEach((id, i) => {
    const I = info[i], S = (id && socks[i]) || [];
    S.forEach(() => info.socks[i].push({ idle: false, why: '' }));
    if (!id || !CHIPS[id]) return;
    const def = CHIPS[id];
    if (def.comp) return Object.assign(I, { idle: true, why: '插件要插在晶片的插座上，放在電路格沒有作用' });
    Object.assign(I, isHead(id) ? { role: 'head' } : { role: 'chip', k: line.cells.length });
    // 插件傳給線上後面的所有晶片：plug = 到這一格為止插的全部（同種加總）；等級寫在晶片 id（合成升級，見 mergedChip）
    const plug = { dmg: run.dmg, size: run.size, el: { ...run.el } }, nSock = socketsOf(id);
    S.forEach((cid, k) => {
      if (k >= nSock) return Object.assign(info.socks[i][k], { idle: true, why: `插座不夠：${def.name}只有 ${nSock} 個插座` });
      const C = CHIPS[cid], b = baseOf(cid);
      if (C.plug) plug[C.plug]++; else if (C.elem) plug.el[b] = (plug.el[b] || 0) + 1;
    });
    run = plug;
    if (I.role === 'chip') {
      const lv = I.lv = lvOf(id);
      line.cells.push({ id, key: baseOf(id), slot: i, lv, pw: lvMulOf(lv), plug, rare: rareOf(id) });
    } else line.plug = plug;
  });
  return { line, info };
}

// 武器的數值（升級樹）＋插在武器上的插件：物理傷害、大小；元素放在 el（weaponShots 套用）
function weaponWithPlugs(st, plug) {
  const p = weaponParams(st);
  if (!plug) return p;
  p.plugDmg = 1 + PLUG.dmg * plug.dmg; p.plugSize = 1 + PLUG.size * plug.size;  // 右鍵、升級的撞擊和爆炸也照乘（見 weapon_play.js 的 wHit）
  p.damage *= p.plugDmg;
  if (plug.size) { p.radius *= p.plugSize; p.wellR = (p.wellR || 1) * p.plugSize; }
  p.el = plug.el;
  return p;
}
// 元素（屬性傷害）：照疊的層數算好固定的傷害放在子彈上（不吃傷害插件、晶片等級；見 ELEM、Game.hitFx）；el = { 元素: 層數 }
function elemize(list, el) {
  const ref = lineRef(), n = k => (el && el[k]) || 0;
  if (!ELEM_IDS.some(n)) return list;
  return list.map(b => {
    const o = { ...b };
    if (n('blast')) o.explode = { r: Math.max(ELEM.blast.r, b.explode ? b.explode.r : 0), ratio: b.explode ? b.explode.ratio || 0 : 0, dmg: (b.explode && b.explode.dmg || 0) + ELEM.blast.k * ref * n('blast') };
    if (n('ignite')) o.burnEl = (b.burnEl || 0) + ELEM.ignite.k * ref * n('ignite');
    if (n('shock')) o.arcs = { n: n('shock'), dmg: ELEM.shock.k * ref * (1 + ELEM.shock.up * (n('shock') - 1)) };
    if (n('frost')) { o.slow = 1 - (1 - (b.slow || 0)) * Math.pow(1 - ELEM.frost.slow, n('frost')); o.slowDur = ELEM.frost.t; }
    if (n('shred')) o.shred = (b.shred || 0) + ELEM.shred.per * n('shred');
    return o;
  });
}

// 算這個人（Game.cur）的電路：線、武器數值（含插件，順便更新 Game.wp）、射速、估算的傷害
function analyzeChain(chain) {
  const { line, info } = compileLine(chain);
  Game.cur.lnAcc = null;  // 觸發的累積照新的電路重新算（舊的累積掛在舊的晶片上）
  const wp = Game.wp = weaponWithPlugs(Game.weapon, line.plug);
  const interval = Math.max(CFG.MIN_INTERVAL, wp.interval * wp.rate);
  const top = weaponEmit(wp, 1), dmg = top.reduce((a, b) => a + b.damage, 0);
  return { line, info, interval, rps: 1 / interval, count: top.length, dmg, dpsEst: dmg / interval };
}

// 武器這一次出手的子彈：元素插件加在每一顆；有武器線（後面接了晶片）就標上 ln（命中照武器的觸發係數往下傳，見 Game.linePass）
function weaponShots(pw = 1) {
  const list = elemize(weaponEmit(Game.wp, pw).map(b => Object.assign(b, { src: 'weapon', cr: null })), Game.wp.el);
  const L0 = Game.stats.line;
  if (L0.cells.length) for (const b of list) b.ln = { line: L0, k: -1 };
  return list;
}

// 晶片產物、元素的參考傷害：武器（升級樹，不含插件）每 REF_T 秒的輸出：武器升級，晶片和元素跟著變強；
//   不含插件：傷害插件已經沿線加在產物上（不重複加），元素不吃傷害插件；不照觸發那一下的傷害，打得重的武器才不會特別占便宜
const lineRef = () => { const w = weaponParams(Game.weapon); return w.damage * w.count / Math.max(CFG.MIN_INTERVAL, w.interval * (w.rate || 1)) * REF_T; };
// 一個產物的共通數值：物理傷害（晶片 mul × 參考傷害 × 等級 × 傷害插件 × 往下幾層）、大小（大小插件）、往下傳的標記 ln、傷害統計的來源；元素另外 elemize
function lineShot(cell, t, o) {
  const P = cell.plug, dmg = CHIPS[cell.key].mul * lineRef() * cell.pw * (1 + PLUG.dmg * P.dmg) * Math.pow(LINE_DECAY, t.k);
  return shot({ ...o, damage: dmg * (o.dmgK || 1), radius: o.radius * (1 + PLUG.size * P.size), src: cell.key, ln: { line: t.line, k: t.k }, prod: true, rare: cell.rare });
}
// 放出產物：元素照這一格的層數；產物預算（CFG.PROD_CAP，每人）用完了就合併成比較少顆、照比例變大變痛（總傷害不變）
function lineSpawn(cell, t, list, x, y, ang, depth = 0, ignore = null) {
  const L = Game.cur, room = Math.max(1, CFG.PROD_CAP - (L.prodN || 0));
  if (list.length > room) {
    const k = list.length / room;
    list = list.slice(0, room).map(b => ({ ...b, damage: b.damage * k, radius: b.radius * Math.sqrt(k) }));
  }
  L.prodN = (L.prodN || 0) + list.length;
  spawnShots(elemize(list, cell.plug.el), x, y, ang, depth, ignore);
}
const spread = (n, k, w) => (k - (n - 1) / 2) * w;  // n 個產物排開：第 k 個的角度偏移

// 晶片被觸發（t = { line, k, x, y, ang, ignore }）：放出產物（在那個人的 withLoadout 裡呼叫）
const LINE_FX = {
  boomerang(cell, t) {  // 迴旋刃：飛出去再飛回飛船（Bullet 的 boom）
    lineSpawn(cell, t, [lineShot(cell, t, { angle: 0, speed: 560, life: 0.42, radius: 7, pierce: 1, boom: 1, shape: 'blade', color: '#5ef2d0', knock: 0.6 })], t.x, t.y, t.ang);
  },
  stasis(cell, t) {  // 地雷：滑出去一小段停住，敵人靠近就衝過去打（Bullet 的 stasis）
    lineSpawn(cell, t, [lineShot(cell, t, { angle: rand(0, TAU), speed: 200, life: 0.3, radius: 6, stasis: 1, shape: 'orb', color: '#ffb347', knock: 1 })], t.x, t.y, 0);
  },
  infect(cell, t) {  // 孢子：往四周放，被打死的敵人再爆出孢子（Bullet 的 infect → Game.infectBurst）
    const a0 = rand(0, TAU);
    lineSpawn(cell, t, Array.from({ length: 3 }, (_, k) => lineShot(cell, t, { angle: a0 + k / 3 * TAU, speed: 420, life: 0.6, radius: 5, infect: 1, shape: 'orb', color: '#c6ff8a', knock: 0.4 })), t.x, t.y, 0, 0, t.ignore);
  },
  echo(cell, t) {  // 回響：用武器再打一次（不停在場上、不勾人），朝最近的敵人
    const p = cell.rare && Game.shipOf(t.owner);  // 稀有：改從飛船朝準星打
    if (p) { t = { ...t, x: p.x, y: p.y, ignore: null }; }
    const e = p ? null : nearestEnemy(t.x, t.y, 600, t.ignore != null ? new Set([t.ignore]) : null, true), ang = p ? p.aim : e ? Math.atan2(e.y - t.y, e.x - t.x) : t.ang;
    const k0 = CHIPS.echo.mul * cell.pw * (1 + PLUG.dmg * cell.plug.dmg) * Math.pow(LINE_DECAY, t.k);
    const list = weaponEmit(Game.wp, k0).map(b => ({ ...b, park: null, hook: false, radius: b.radius * (1 + PLUG.size * cell.plug.size), src: 'echo', cr: null, ln: { line: t.line, k: t.k }, prod: true }));
    lineSpawn(cell, t, list, t.x, t.y, ang, 1);  // depth 1：算回響（回響擊殺、傷害來源）
  },
  shard(cell, t) {  // 碎片：往四周 6 片，射程約 100；一般的不打觸發的那隻（清一群用）
    //   稀有：6 片共用一個記錄（打中誰幾片，見 Game.linePass），也打得到觸發的那隻（打單隻精英、旗艦用；使用者 10-23 同意：以前單隻時 6 片永遠打不到同一隻）
    const a0 = rand(0, TAU), grp = cell.rare ? new Map() : null;
    lineSpawn(cell, t, Array.from({ length: 6 }, (_, k) => lineShot(cell, t, { angle: a0 + k / 6 * TAU, speed: 520, life: 0.19, radius: 4, shape: 'dart', color: '#ffd6a0', knock: 0.5, grp })), t.x, t.y, 0, 0, cell.rare ? null : t.ignore);
  },
  homing(cell, t) {  // 追蹤彈：轉向最近的敵人
    lineSpawn(cell, t, [lineShot(cell, t, { angle: 0, speed: 380, life: 1.5, radius: 6, homing: 6, shape: 'dart', color: '#ff9dbd', knock: 0.8 })], t.x, t.y, t.ang, 0, t.ignore);
  },
  vortex(cell, t) {  // 漩渦：停在原地 1.5 秒把敵人吸到中心，結束時往下傳（Bullet 的 vortex）
    lineSpawn(cell, t, [lineShot(cell, t, { angle: 0, speed: 0, life: 1.5, radius: 10, vortex: 120 * (1 + PLUG.size * cell.plug.size), pierce: 99, shape: 'orb', color: '#b388ff', knock: 0 })], t.x, t.y, 0);
  },
};

function computePassives(inventory) {
  const P = { speed: 0, armor: 0, maxHp: 0, dashCd: 0, magnet: 0, greed: 0 };
  for (const id of inventory) {
    const s = id && CHIPS[id].stored;
    if (s) for (const k in s) P[k] += s[k];
  }
  P.armor = Math.min(0.6, P.armor);
  P.dashCd = Math.min(0.6, P.dashCd);
  return P;
}

// 傷害統計的來源（晶片 id、weapon、ship、comet）→ 顯示的名稱（結算、遊玩紀錄）
function dmgKeyName(key) {
  if (key === 'weapon') return '武器・' + weaponTitle(Game.weapon);
  if (key === 'ship') return '機體（零件）';
  if (key === 'comet') return '彗星（打爆的碎片）';
  const d = CHIPS[key];
  return d ? d.name : key;
}
