// 星環電路 雙人版 · pipeline.js：電路執行器：compileChain / runOps / runComps / hostFire / analyzeChain、倉庫被動
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// PIPELINE — 線性電路執行器（與畫面無關的純邏輯）
//   compileChain: 插槽 → ops：每個宿主（武器、玩法晶片、觸發器）一個 op，插在它上面的組件放在 op.comps
//                 另外附上每一格的狀態 ops.info（宿主／組件、插在誰身上、有沒有作用、原因、在第幾層觸發）
//   runOps      : 執行 ops，產生子彈清單
//   runComps    : 一組組件依序作用在子彈清單上
//   hostFire    : 玩法晶片的產物出現時（迴旋折返、環繞放出…），把插在它上面的組件套用到那顆子彈
// =====================================================================
// 玩法晶片（彈道／發射／命中／機體）
const PLAY_TYPES = ['path', 'launch', 'impact', 'body'];
// 不能放在觸發器右邊（回響那一段）的玩法晶片：回響不會進環繞的圈、沒有停火蓄力、不是衝刺那一槍
const NO_ECHO = ['orbit', 'charge', 'dashfire'];
// 組件在開火當下就套用（其餘的插在黏著上的組件等爆炸時才套用）
const STICKY_NOW = ['pierce', 'ov_pierce', 'ov_seek'];

function compileChain(chain, attrs = Game.slotAttr || []) {
  const info = chain.map(() => ({ role: null, host: -1, idle: false, why: '', seg: 0, trig: false }));
  const ops = [];
  const idle = (I, why) => Object.assign(I, { idle: true, why });
  let seg = 0, dead = false, g = null;  // g：目前的宿主（右邊的組件插在它上面）
  chain.forEach((id, i) => {
    const I = info[i];
    I.seg = seg;
    if (!id || !CHIPS[id]) return;
    const def = CHIPS[id], at = attrs[i], am = at === 'eff' ? 1.5 : at === 'weak' ? 0.7 : 1, flaky = at === 'flaky';
    const ov = OVERLOADS.includes(at) ? { id: at, m: 1, slot: i, key: at, hidden: true, flaky } : null;  // 黑洞的超載：當成多插一個組件（不佔插座）
    if (!def.comp) {  // 宿主
      I.role = 'host';
      g = { slot: i, id, base: baseOf(id), n: 0, cap: socketsOf(id), o: null };
      if (dead) return idle(I, '前面的觸發器超過層數上限，這格不會執行');
      if (seg > 0 && NO_ECHO.includes(baseOf(id))) return idle(I, `${CHIPS[baseOf(id)].name}不能放在觸發器右邊（回響不會進圈、沒有蓄力、不是衝刺那一槍）`);
      if (def.type === 'trigger' && seg >= CFG.MAX_TRIGGER_DEPTH) { dead = true; return idle(I, `已達觸發層數上限（${CFG.MAX_TRIGGER_DEPTH} 層）`); }
      g.o = { id, pw: def.lvMul || 1, lv: levelOf(id), slot: i, key: baseOf(id), comps: [], am, flaky,
        wlike: id === 'weapon' || def.type === 'trigger' };  // wlike：武器、觸發器（回響）的插座 → 武器層
      if (ov) g.o.comps.push(ov);
      ops.push(g.o);
      if (def.type === 'trigger') { I.trig = true; seg++; }
      return;
    }
    // 組件：插在左邊最近的宿主上（中間的空格不影響）
    I.role = 'comp';
    I.host = g ? g.slot : -1;
    if (!g) return idle(I, '左邊沒有可以插的晶片');
    if (!g.o) return idle(I, `它插的「${CHIPS[g.id].name}」沒有作用`);
    if (g.n >= g.cap) return idle(I, `插座已滿：${CHIPS[g.id].name}只有 ${g.cap} 個插座`);
    g.n++;
    const base = baseOf(id), real = g.o.comps.filter(c => !c.hidden);
    if (base === 'overclock' && g.base !== 'weapon') return idle(I, '超頻是整條電路的射速，只能插在武器上');
    let cid = id;
    if (base === 'mirror') {
      const prev = real[real.length - 1];
      if (g.o.wlike && (!prev || prev.copySrc)) {  // 武器（或觸發器）前面還沒有其他組件：複製武器 = 多射一次（回響也一樣；兩個鏡像 = 射 3 次）
        (g.o.extra = g.o.extra || []).push({ slot: i, key: 'mirror', flaky });
        g.o.comps.push({ id: 'mirror', m: 1, slot: i, key: 'mirror', copySrc: true, flaky });  // 佔一個插座；鏡像本身沒有 apply，runComps 會跳過
        return;
      }
      if (!prev) return idle(I, '前一個插座沒有可以複製的組件');
      if (baseOf(prev.id) === 'overclock') return idle(I, '鏡像不能複製超頻');
      cid = prev.id;
    }
    if (g.base === 'pull' && baseOf(cid) !== 'bigshot') return idle(I, '吸引的產物是拉力，只能插巨彈（範圍 ×1.5）');
    const m = am * g.o.am;
    g.o.comps.push({ id: cid, m, slot: i, key: base, flaky });
    if (ov) g.o.comps.push(ov);
  });
  ops.info = info;
  return ops;
}

// 一組組件依序作用在 list 上；layer：'w' 武器層（武器、回響的插座）／'h' 宿主層（玩法晶片的插座）
function runComps(list, comps, layer) {
  for (const c of comps) {
    if (!list.length) break;
    if (c.flaky && flakyOff()) continue;
    const def = CHIPS[c.id];
    if (!def.apply) continue;
    let before = 0, after = 0;
    for (const b of list) before += b.damage;
    list = def.apply(list, c.m, { ...c, layer });
    for (const b of list) after += b.damage;
    if (before > 0) creditFactor(list, c.key, after / before);
  }
  return list;
}

// 插在玩法晶片上的組件：產物在開火當下就出現的（反向、蓄力、衝刺射擊、攔截、疾射、吸引）直接套用；
// 其他的記在子彈身上（hm[晶片]），等產物出現時由 hostFire 套用
function attachHost(list, o, n0) {
  const comps = o.comps, base = o.key;
  if (!comps.length) return list;
  switch (base) {
    case 'rear': return [...list.slice(0, n0), ...runComps(list.slice(n0), comps, 'h')];  // 只有多射出來（往後）的那一份
    case 'charge': return Game.chargeC >= 0.999 ? runComps(list, comps, 'h') : list;
    case 'dashfire': return Game.fireMode === 'dashfire' ? runComps(list, comps, 'h') : list;
    case 'intercept': return Game.fireMode === 'intercept' ? runComps(list, comps, 'h') : list;
    case 'quick': {  // 高速段：出手就套用，傷害加成記在 qhb，速度掉到 1.5 倍以下時拿掉（見 Bullet.setMul）
      const hb0 = list.map(b => b.hb || 0), out = runComps(list.map((b, k) => ({ ...b, k })), comps, 'h');
      return out.map(b => ({ ...b, qhb: (b.qhb || 0) + (b.hb || 0) - hb0[b.k] }));
    }
    case 'pull': {
      const add = comps.filter(c => baseOf(c.id) === 'bigshot' && !(c.flaky && flakyOff())).reduce((a, c) => a + 0.5 * c.m, 0);
      return list.map(b => ({ ...b, pullMul: (b.pullMul || 1) + add }));
    }
    case 'sticky': {  // 穿甲類（黏住前多穿幾隻）現在套用，其他的等爆炸
      list = runComps(list, comps.filter(c => STICKY_NOW.includes(c.id)), 'h');
      const later = comps.filter(c => !STICKY_NOW.includes(c.id));
      return later.length ? list.map(b => ({ ...b, hm: { ...b.hm, sticky: later } })) : list;
    }
    default: return list.map(b => ({ ...b, hm: { ...b.hm, [base]: comps } }));
  }
}

function runOps(ops, depth) {
  let list = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], def = CHIPS[o.id];
    if (o.flaky && flakyOff()) continue;  // 黑洞：間歇失效
    if (def.type === 'source') {
      const src = o.key || 'weapon';
      list.push(...def.emit(o.pw).map(b => Object.assign(b, { src, cr: null })));
      for (const x of o.extra || []) if (!(x.flaky && flakyOff()))  // 鏡像插在第一個插座：武器多射一次（基礎傷害算鏡像的）
        list.push(...def.emit(o.pw).map(b => Object.assign(b, { src: 'mirror', cr: null })));
      list = runComps(list, o.comps || [], 'w');  // 武器、回響的插座
    } else if (def.type === 'trigger') {
      if (list.length && depth < CFG.MAX_TRIGGER_DEPTH) {
        // 子電路 = 武器回響（50% 傷害，插在觸發器上的組件作用在回響上）＋ 觸發器右側的晶片；回響的基礎傷害算在觸發器上
        const payload = [{ id: 'echo', pw: o.pw, slot: o.slot, key: o.key, comps: o.comps, extra: o.extra, trig: def.trig }, ...ops.slice(i + 1)];
        for (const s of list) s.payload = payload;
      }
      break;  // 觸發器之後的晶片不在這一層執行
    } else if (list.length) {
      let before = 0, after = 0;
      const n0 = list.length;
      for (const b of list) before += b.damage;
      list = def.apply(list, o.pw, o);
      for (const b of list) after += b.damage;
      if (before > 0 && !def.copyCredit) creditFactor(list, o.key, after / before);  // copyCredit：多射出來的子彈自己記在晶片上（反向）
      list = attachHost(list, o, n0);
    }
  }
  return list;
}

// 玩法晶片的產物出現了（迴旋折返、環繞放出、地雷衝出去、加速到 1.5 倍、第一次反彈）：把插在那個晶片上的組件套用到這顆子彈
//   分裂出來的子彈直接放進場上的子彈清單
function hostFire(b, base) {
  const comps = b.hm && b.hm[base];
  if (!comps) return;
  const hm = { ...b.hm };
  delete hm[base];
  b.hm = hm;
  const res = runComps([{ ...b, radius: b.r, cr: b.att.cr }], comps, 'h');
  if (!res.length) return;
  const put = (t, r) => { Object.assign(t, r); t.r = r.radius; t.att = { ...b.att, cr: r.cr }; };
  for (let k = 1; k < res.length; k++) {
    const c = Object.create(Bullet.prototype);
    put(c, { ...b, ...res[k], hitSet: new Set(b.hitSet) });
    Game.bullets.push(c);
  }
  put(b, res[0]);
}

// 能量負載 → 射速倍率（1 = 不變；5 點能量 = 0.75，也就是射速 -25%）
const heatRateMul = heat => Math.max(CFG.HEAT_RATE_FLOOR, 1 - heat * CFG.HEAT_RATE);
// 一格的能量負載（黑洞：能量歸零 → 0、能量 +2）
const slotHeat = (id, at) => !id ? 0 : at === 'free' ? 0 : CHIPS[id].cost + (at === 'heavy' ? 2 : 0);

function analyzeChain(chain) {
  const attrs = Game.slotAttr || [];
  let heat = 0, rate = 1;
  chain.forEach((id, i) => { heat += slotHeat(id, attrs[i]); });
  const ops = compileChain(chain, attrs);
  // 射速類組件（超頻模組、超載・頻率）：整條電路的射速
  const rateCr = {};
  for (const o of ops) for (const c of o.comps) {
    const r = CHIPS[c.id].rate;
    if (!r) continue;
    rate *= r;
    rateCr[c.key] = (rateCr[c.key] || 0) - Math.log(r);  // 傷害統計：射速讓每秒傷害變成幾倍，記成 ln 倍率（見 splitDamage）
  }
  const wp = Game.wp;  // 武器決定基礎射擊間隔
  // 電路上的特殊晶片：蓄力（改成按住蓄力）、超頻模組（會過熱）、衝刺射擊／攔截（另外的發射時機）
  const lvOf = b => { const o = ops.find(o => baseOf(o.id) === b); return o ? o.lv || 1 : 0; };
  const charge = lvOf('charge'), oc = ops.some(o => o.comps.some(c => c.id === 'overclock'));
  const chargeTime = charge ? (charge >= 2 ? 1.5 : 2) : 0;
  const heatLimit = oc ? CHIPS.overclock.heatLimit[0] : 0;
  const interval = Math.max(CFG.MIN_INTERVAL, wp.interval / heatRateMul(heat) * rate * wp.rate);
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
    layers.push({ count: sub.length, dmg: sum(sub), trig: carrier.payload[0].trig });
    carrier = sub.find(s => s.payload);
  }
  return { ops, info: ops.info, heat, interval, rps: 1 / interval, count: top.length, dmg: sum(top), dpsEst: est / interval + burnDps, layers, rateCr,
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
