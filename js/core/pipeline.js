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
const NO_ECHO = ['orbit', 'charge', 'dashfire', 'stand'];
// 組件在開火當下就套用（其餘的插在黏著上的組件等爆炸時才套用）
const STICKY_NOW = ['pierce', 'ov_pierce', 'ov_seek'];

// chain：電路格（武器、玩法晶片、觸發器、空格）；socks[i]：插在第 i 格晶片上的組件（由左到右）；attrs[i]：第 i 格的黑洞屬性（只強化那一格的晶片）
//   ops.info[i]：每一格的狀態（role 'host'、seg 在第幾層觸發、idle 沒有作用、why 原因）；ops.info.socks[i][k]：第 i 格第 k 個插座的狀態
function compileChain(chain, attrs = Game.slotAttr || [], socks = Game.socks || []) {
  const info = chain.map(() => ({ role: null, idle: false, why: '', seg: 0, trig: false }));
  info.socks = chain.map(() => []);
  const ops = [];
  const idle = (I, why) => Object.assign(I, { idle: true, why });
  let seg = 0, dead = false;
  chain.forEach((id, i) => {
    const I = info[i], S = (id && socks[i]) || [];
    I.seg = seg;
    S.forEach(() => info.socks[i].push({ idle: false, why: '' }));
    if (!id || !CHIPS[id]) return;
    const def = CHIPS[id], at = attrs[i], am = at === 'eff' ? 1.5 : at === 'weak' ? 0.7 : 1, flaky = at === 'flaky';
    if (def.comp) return idle(I, '組件要插在晶片的插座上，放在電路格沒有作用');
    I.role = 'host';
    const sockIdle = why => info.socks[i].forEach(J => idle(J, why));
    if (dead) { sockIdle('它插的晶片沒有作用'); return idle(I, '前面的觸發器超過層數上限，這格不會執行'); }
    if (seg > 0 && NO_ECHO.includes(baseOf(id))) { sockIdle('它插的晶片沒有作用'); return idle(I, `${CHIPS[baseOf(id)].name}不能放在觸發器右邊（回響不會進圈、沒有蓄力、不是衝刺那一槍、不算架設）`); }
    if (def.type === 'trigger' && seg >= CFG.MAX_TRIGGER_DEPTH) { dead = true; sockIdle('它插的晶片沒有作用'); return idle(I, `已達觸發層數上限（${CFG.MAX_TRIGGER_DEPTH} 層）`); }
    const o = { id, pw: def.lvMul || 1, lv: levelOf(id), slot: i, key: baseOf(id), comps: [], am, flaky,
      wlike: id === 'weapon' || def.type === 'trigger' };  // wlike：武器、觸發器（回響）的插座 → 武器層
    if (OVERLOADS.includes(at)) o.comps.push({ id: at, m: 1, slot: i, key: at, hidden: true });  // 奇異點的超載：這格的晶片多插一個（不佔插座）
    ops.push(o);
    if (def.type === 'trigger') { I.trig = true; seg++; }
    const cap = socketsOf(id), base = baseOf(id);
    S.forEach((cid, k) => {  // 插座上的組件（強化只看晶片那一格，組件本身不吃屬性）
      const J = info.socks[i][k], cb = baseOf(cid);
      if (k >= cap) return idle(J, `插座不夠：${CHIPS[id].name}只有 ${cap} 個插座`);
      if (cb === 'overclock' && id !== 'weapon') return idle(J, '超頻是整條電路的射速，只能插在武器上');
      if (cb === 'focus' && id !== 'weapon') return idle(J, '收束看武器每次射出幾發，只能插在武器上');
      if (cb === 'mirror') {  // 鏡像 = 再來一次（插在哪個插座都一樣）
        if (o.wlike) {  // 武器（或觸發器）多射一次（回響也一樣；兩個鏡像 = 射 3 次）
          (o.extra = o.extra || []).push({ slot: i, key: 'mirror' });
          o.comps.push({ id: 'mirror', m: 1, slot: i, key: 'mirror', copySrc: true });  // 佔一個插座；runComps 會跳過
          return;
        }
        if (base === 'pull') return idle(J, '吸引的產物是拉力，只能插巨彈（範圍 ×1.5）');
        const mm = o.comps.find(c => c.key === 'mirror');  // 玩法晶片：產物多一份；兩個鏡像合成一個（n = 2 → 3 份）
        if (mm) { mm.n++; return; }
        o.comps.push({ id: cid, m: am, slot: i, key: 'mirror', n: 1 });
        return;
      }
      if (base === 'pull' && baseOf(cid) !== 'bigshot') return idle(J, '吸引的產物是拉力，只能插巨彈（範圍 ×1.5）');
      o.comps.push({ id: cid, m: am, slot: i, key: cb });  // 效果 ×1.5／×0.7：那一格晶片上的組件跟著放大
    });
  });
  ops.info = info;
  return ops;
}

// 一組組件依序作用在 list 上；layer：'w' 武器層（武器、回響的插座）／'h' 宿主層（玩法晶片的插座）
function runComps(list, comps, layer) {
  if (comps.some(c => CHIPS[c.id].atEnd)) comps = [...comps.filter(c => !CHIPS[c.id].atEnd), ...comps.filter(c => CHIPS[c.id].atEnd)];  // 收束：等其他組件（分裂…）算完才數子彈
  for (const c of comps) {
    if (!list.length) break;
    const def = CHIPS[c.id];
    if (!def.apply || c.copySrc) continue;
    let before = 0, after = 0;
    for (const b of list) before += b.damage;
    list = def.apply(list, c.m, { ...c, layer });
    for (const b of list) after += b.damage;
    if (before > 0) creditFactor(list, c.key, after / before);
  }
  return list;
}

// 插在玩法晶片上的組件：產物在開火當下就出現的（反向、蓄力、衝刺射擊、攔截、吸引）直接套用；
// 其他的記在子彈身上（hm[晶片]），等產物出現時由 hostFire 套用
function attachHost(list, o, n0) {
  const comps = o.comps, base = o.key;
  if (!comps.length) return list;
  switch (base) {
    case 'rear': return [...list.slice(0, n0), ...runComps(list.slice(n0), comps, 'h')];  // 只有多射出來（往後）的那一份
    case 'charge': return Game.chargeC >= 0.999 ? runComps(list, comps, 'h') : list;
    case 'dashfire': return Game.fireMode === 'dashfire' ? runComps(list, comps, 'h') : list;
    case 'stand': return Game.standFull ? runComps(list, comps, 'h') : list;
    case 'intercept': return Game.fireMode === 'intercept' ? runComps(list, comps, 'h') : list;
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
    if (o.flaky && flakyOff()) continue;  // 奇異點：間歇失效
    if (def.type === 'source') {
      const src = o.key || 'weapon';
      list.push(...def.emit(o.pw, depth).map(b => Object.assign(b, { src, cr: null })));
      for (const x of o.extra || []) if (!(x.flaky && flakyOff()))  // 鏡像：武器多射一次（基礎傷害算鏡像的）
        list.push(...def.emit(o.pw, depth).map(b => Object.assign(b, { src: 'mirror', cr: null })));
      list = runComps(list, o.comps || [], 'w');  // 武器、回響的插座
      for (const b of list) b.wsb = b.bonus || 0;  // 武器插座上的傷害加成：只算直擊，產物出現時拿掉（見 stripW）
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
      list = productNow(list, o, n0);
      list = attachHost(list, o, n0);
    }
  }
  return list;
}

// ---------- 武器插座的傷害加成只算直擊 ----------
// 產物出現時，拿掉子彈身上「武器插座給的傷害加成」（wsb）；傷害統計也從那幾個組件扣回來。wsbOff 記著拿掉多少（速度掉回 1.5 倍以下時加回去）
function stripW(b) {
  const w = b.wsb || 0;
  if (!(w > 0)) return b;
  const old = b.bonus || 0, f = Math.max(0.1, 1 + old - w) / Math.max(0.1, 1 + old);
  b.damage *= f; b.bonus = old - w; b.wsb = 0; b.wsbOff = (b.wsbOff || 0) + w;
  shiftCr(b, Math.log(f));
  return b;
}
function restoreW(b) {
  const w = b.wsbOff || 0;
  if (!(w > 0)) return b;
  const old = b.bonus || 0, f = Math.max(0.1, 1 + old + w) / Math.max(0.1, 1 + old);
  b.damage *= f; b.bonus = old + w; b.wsb = w; b.wsbOff = 0;
  shiftCr(b, Math.log(f));
  return b;
}
// 傷害統計：倍增、巨彈、超載・威力的 ln 倍率照比例加減
function shiftCr(b, lf) {
  const cr = b.att ? b.att.cr : b.cr, ks = ['amp', 'bigshot', 'ov_power'].filter(k => cr && cr[k] > 0);
  const tot = ks.reduce((a, k) => a + cr[k], 0);
  if (!tot) return;
  const n = { ...cr };
  for (const k of ks) n[k] = Math.max(0, cr[k] + lf * cr[k] / tot);
  if (b.att) b.att = { ...b.att, cr: n }; else b.cr = n;
}
// 開火當下就出現的產物：反向往後那份、蓄滿那發、衝刺那一槍、攔截回射 → 拿掉武器插座的傷害加成
function productNow(list, o, n0) {
  switch (o.key) {
    case 'rear': return [...list.slice(0, n0), ...list.slice(n0).map(b => stripW({ ...b }))];
    case 'charge': return Game.chargeC >= 0.999 ? list.map(b => stripW({ ...b })) : list;
    case 'dashfire': return Game.fireMode === 'dashfire' ? list.map(b => stripW({ ...b })) : list;
    case 'stand': return Game.standFull ? list.map(b => stripW({ ...b })) : list;
    case 'intercept': return Game.fireMode === 'intercept' ? list.map(b => stripW({ ...b })) : list;
    default: return list;
  }
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

// 能量 → 射速倍率（2026-10-10 改容量制）：總能量在容量以內 = 1（不扣）；超過的每 1 點 ×0.9（相乘，不會到 0）
const heatRateMul = (heat, cap) => Math.pow(CFG.OVERLOAD_RATE, Math.max(0, heat - (cap || 0)));
// 一格的能量負載（奇異點：能量歸零 → 0、能量 +2）
const slotHeat = (id, at) => !id ? 0 : at === 'free' ? 0 : CHIPS[id].cost + (at === 'heavy' ? 2 : 0);

function analyzeChain(chain) {
  const attrs = Game.slotAttr || [];
  let heat = 0, rate = 1;
  chain.forEach((id, i) => { heat += slotHeat(id, attrs[i]); });
  for (const S of Game.socks || []) for (const c of S || []) heat += CHIPS[c].cost;  // 組件照算能量（不吃奇異點屬性）
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
  const cap = Game.energyCap(), interval = Math.max(CFG.MIN_INTERVAL, wp.interval / heatRateMul(heat, cap) * rate * wp.rate);
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
  const burnDps = Math.max(0, ...top.map(b => (b.burn ? b.burn.dps : 0) + (b.burnR || 0) * b.damage));
  const layers = [];
  let carrier = top.find(s => s.payload);
  while (carrier) {
    const sub = runOps(carrier.payload, layers.length + 1);
    layers.push({ count: sub.length, dmg: sum(sub), trig: carrier.payload[0].trig });
    carrier = sub.find(s => s.payload);
  }
  return { ops, info: ops.info, heat, cap, interval, rps: 1 / interval, count: top.length, dmg: sum(top), dpsEst: est / interval + burnDps, layers, rateCr,
    charge, chargeTime, heatLimit, dashfire: lvOf('dashfire'), intercept: lvOf('intercept'), stand: lvOf('stand') };
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
