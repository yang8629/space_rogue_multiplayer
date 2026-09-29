// 星環電路 雙人版 · pipeline.js：電路執行器：compileChain / runOps / analyzeChain、倉庫被動
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// PIPELINE — 線性電路執行器（與畫面無關的純邏輯）
//   compileChain: 插槽 → ops（展開複合、鏡像，計算共振倍率）
//   runOps      : 執行 ops，產生子彈清單
// =====================================================================
// 玩法晶片（彈道／發射／命中／機體）：鏡像不能複製（複製只會疊出 ×25 蓄力、雙倍迴旋懲罰，或完全沒效果）
const PLAY_TYPES = ['path', 'launch', 'impact', 'body'];

function compileChain(chain) {
  const ops = [], slotOps = [];
  // 協同處理器用：電路中「其他晶片」的數量（不含武器與廢鐵）
  const chipCount = chain.filter(id => id && id !== 'weapon' && id !== 'scrap').length;
  chain.forEach((id, i) => {
    slotOps[i] = null;
    if (!id) return;
    const def = CHIPS[id];
    let pw = 1;
    for (const j of [i - 1, i + 1])
      if (chain[j] && baseOf(chain[j]) === 'resonator') pw += CFG.RESONANCE * (CHIPS[chain[j]].lvMul || 1);
    pw *= def.lvMul || 1;  // 晶片等級
    if (id === 'mirror') {
      const src = slotOps[i - 1];
      if (src && src.every(o => !PLAY_TYPES.includes(CHIPS[o.id].type))) ops.push(...src.map(o => ({ id: o.id, pw: Math.max(pw, o.pw), lv: o.lv, slot: i, n: o.n, key: 'mirror' })));
      return;
    }
    if (def.type === 'link' || def.type === 'scrap') return;
    // key：傷害統計用的晶片（複合／奇異點的每個組成都算在那一格的晶片上）
    const mine = (def.combo || [id]).map(cid => ({ id: cid, pw, lv: levelOf(id), slot: i, n: chipCount - 1, key: baseOf(id) }));
    slotOps[i] = mine;
    ops.push(...mine);
  });
  return ops;
}

function capShots(list) {
  const n = list.length, cap = CFG.MAX_SHOTS_PER_FIRE, ratio = n / cap, out = [];
  for (let k = 0; k < cap; k++) {
    const b = list[Math.floor(k * n / cap)];
    out.push({ ...b, damage: b.damage * ratio });  // 超出的數量轉換為傷害
  }
  return out;
}

function runOps(ops, depth) {
  let list = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], def = CHIPS[o.id];
    if (def.type === 'source') {
      const src = o.key || 'weapon';
      list.push(...def.emit(o.pw).map(b => Object.assign(b, { src, cr: null })));
    } else if (def.type === 'trigger') {
      if (list.length && depth < CFG.MAX_TRIGGER_DEPTH) {
        // 子電路 = 武器回響（50% 傷害）＋ 觸發器右側的晶片；回響的基礎傷害算在觸發器上
        const payload = [{ id: 'echo', pw: o.pw, slot: o.slot, key: o.key }, ...ops.slice(i + 1)];
        for (const s of list) s.payload = payload;
      }
      break;  // 觸發器之後的晶片不在這一層執行
    } else if (list.length) {
      let before = 0, after = 0;
      for (const b of list) before += b.damage;
      list = def.apply(list, o.pw, o);
      for (const b of list) after += b.damage;
      if (before > 0 && !def.copyCredit) creditFactor(list, o.key, after / before);  // copyCredit：多射出來的子彈自己記在晶片上（反向）
    }
    if (list.length > CFG.MAX_SHOTS_PER_FIRE) list = capShots(list);
  }
  return list;
}

// 能量負載 → 射速倍率（1 = 不變；5 點能量 = 0.75，也就是射速 -25%）
const heatRateMul = heat => Math.max(CFG.HEAT_RATE_FLOOR, 1 - heat * CFG.HEAT_RATE);
// 一格晶片降低的能量負載：冷卻管線本身，或含有冷卻管線的複合晶片／奇異點
const coolOf = id => ((CHIPS[id].cool || 0) + (CHIPS[id].combo || []).reduce((a, c) => a + (CHIPS[c].cool || 0), 0)) * (CHIPS[id].lvMul || 1);

function analyzeChain(chain) {
  let heat = 0, rate = 1;
  for (const id of chain) if (id) heat += CHIPS[id].cost;
  for (const id of chain) if (id) heat -= coolOf(id);  // 冷卻管線
  heat = Math.max(0, heat);
  const ops = compileChain(chain);
  for (const o of ops) if (CHIPS[o.id].rate) rate *= Math.pow(CHIPS[o.id].rate, CHIPS[o.id].rateFixed ? 1 : o.pw);
  const wp = Game.wp;  // 武器決定基礎射擊間隔
  // 電路上的特殊晶片：蓄力（改成按住蓄力）、超頻模組（會過熱）、衝刺射擊／擦彈（另外的發射時機）
  const lvOf = b => { const o = ops.find(o => baseOf(o.id) === b); return o ? o.lv || 1 : 0; };
  const charge = lvOf('charge'), oc = lvOf('overclock');
  const chargeTime = charge ? (charge >= 2 ? 1.5 : 2) : 0;
  const heatLimit = oc ? CHIPS.overclock.heatLimit[oc - 1] : 0;
  let interval = Math.max(CFG.MIN_INTERVAL, wp.interval / heatRateMul(heat) * rate * wp.rate);
  // 傷害統計：射速類晶片讓每秒傷害變成幾倍，記成 ln 倍率（見 splitDamage）
  const rateCr = {};
  for (const o of ops) if (CHIPS[o.id].rate && o.key)
    rateCr[o.key] = (rateCr[o.key] || 0) - (CHIPS[o.id].rateFixed ? 1 : o.pw) * Math.log(CHIPS[o.id].rate);
  const coolers = chain.filter(id => id && coolOf(id) > 0);
  if (coolers.length) {
    let raw = 0;
    for (const id of chain) if (id) raw += CHIPS[id].cost;
    const noCool = Math.max(CFG.MIN_INTERVAL, wp.interval / heatRateMul(raw) * rate * wp.rate);
    const gain = Math.log(noCool / interval), total = coolers.reduce((a, id) => a + coolOf(id), 0);
    if (gain > 0) for (const id of coolers)
      rateCr[baseOf(id)] = (rateCr[baseOf(id)] || 0) + gain * coolOf(id) / total;
  }
  const cc = Game.chargeC; Game.chargeC = 0;  // 估算持續輸出：停火蓄力只影響第一發，不算進去
  const top = runOps(ops, 0);
  Game.chargeC = cc;
  const sum = l => l.reduce((a, b) => a + b.damage, 0);
  // 估算命中效果的額外傷害：爆炸假設多打到 1.5 隻、碎片命中一半
  const effect = b => b.damage +
    (b.explode ? b.damage * b.explode.ratio * 1.5 : 0) +
    (b.shards ? b.damage * b.shards.ratio * b.shards.n * 0.5 : 0) +
    (b.arcs ? b.damage * b.arcs.ratio * b.arcs.n * 0.5 : 0);  // 電弧：假設一半打到別隻、一半打回目標
  const est = top.reduce((a, b) => a + effect(b), 0);
  // 燃燒不會疊加（再次命中只會刷新時間），持續命中時等於每秒多造成「燃燒每秒傷害」
  const burnDps = Math.max(0, ...top.map(b => b.burn ? b.burn.dps : 0));
  const layers = [];
  let carrier = top.find(s => s.payload);
  while (carrier) {
    const sub = runOps(carrier.payload, layers.length + 1);
    layers.push({ count: sub.length, dmg: sum(sub) });
    carrier = sub.find(s => s.payload);
  }
  return { ops, heat, interval, rps: 1 / interval, count: top.length, dmg: sum(top), dpsEst: est / interval + burnDps, layers, rateCr,
    charge, chargeTime, heatLimit, dashfire: lvOf('dashfire'), intercept: lvOf('intercept') };
}

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
