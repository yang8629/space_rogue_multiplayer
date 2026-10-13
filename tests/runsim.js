// 整局模擬：電腦從第一星區打到第三星區（照真實規則：航圖、獎勵、補給站、維修站、改裝廠、軍械台、旗艦；HP 一路帶下去）
// 量整局通關率、死在哪裡。電腦的戰鬥操作跟 botsim.js 一樣（手機自動瞄準、自動攻擊、搖桿走位、危險時衝刺），照熟練玩家打
// 用法：node runsim.js --n=20 [--w=laser,blade] [--ship=vanguard]
'use strict';
const T_ = require('./load_game').loadGame();
const G = T_.Game, CH = T_.CHIPS;
G.simFast = true;  // 模擬：不等給人看的時間（區域肅清 1.6 秒）
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const WN = { laser: '雷射', scatter: '散彈', plasma: '電漿', railgun: '軌道', blade: '相刃' };
const WPN = arg('w') ? arg('w').split(',') : Object.keys(WN);
const N = +(arg('n') || 20), dt = 1 / 60;
const SHIP = arg('ship') || null;
const ENDLESS = process.argv.includes('--endless');
const BUILDS = process.argv.includes('--builds');  // 每局印最後的配裝（武器升級｜零件｜背包模組｜電路）
// 每局指定一個終極升級（6 個照局號輪流），電腦在軍械台照著升、零件和模組也照這條路線挑 → 每種路線都有一樣多的局數（2026-10-09）
//   --best：改回挑武器升級價值表分數最高的（每把武器幾乎都走同一條）
const BEST = process.argv.includes('--best');
//   --route=B1：每局都指定這一個終極升級（只驗證某幾條路線用）
const ONLY = arg('route') || null;
//   --game=56：只跑第 56 局（亂數照局號，跟整批裡那一局一樣；查卡住、死因用，--n 要比它大）
const GAME = arg('game') != null ? +arg('game') : null;
//   --from=60 --n=120：只跑第 60～119 局（另一批亂數，看雜訊用）
const FROM = +(arg('from') || 0), RUNS = GAME != null ? 1 : N - FROM;  // 實際跑幾局（算通關率用）
// --tweak="ENEMY_TYPES.boss.hp=2000;CFG.X=1"：先改數值再跑（試調整用，不改遊戲檔案）
if (arg('tweak')) require('vm').runInThisContext(process.argv.find(a => a.startsWith('--tweak=')).slice(8));
// 電腦一律是熟練玩家（閃衝撞的敵人、環繞保持距離、電路有空格先拿晶片、照組合方向挑晶片和模組、有架設就找空檔停下來打）
//   2026-10-09 拿掉 --style（中等玩家、各種比較用的打法），打法寫死

const { seed, splitEnemyRng, noFx, resetRun } = require('./rng');  // 敵人用另一串亂數、不產生粒子（見 rng.js）
splitEnemyRng(T_); noFx();

// 電腦（戰鬥操作、做選擇）在 bot/：跟雙人整局模擬、自動對戰模擬、QA 共用
const B = require('./bot/load').loadBot(code => require('vm').runInThisContext(code));
const { bot, resetBot, equip, sortChain, chooseNode, handle, bOf } = B;
// --probe：每局印新終極升級的觸發次數（probe.js；證明電腦在實戰中真的用到）
const PROBE = process.argv.includes('--probe') ? require('./probe')(G) : null;
// --bossdiag：第一星區旗艦（1-7）那一場的紀錄（2026-10-13，查相刃死在 1-7）：進場 HP、打多久、死了沒、死時旗艦剩多少血、被什麼打掉多少血
//   照武器和當時的第一段分組，全部跑完印一張表
const BOSSD = process.argv.includes('--bossdiag') ? (() => {
  let cur = null; const all = {};
  // 離旗艦的距離（飛船中心到旗艦中心）分段：每段待了多久、在那段被旗艦打掉多少血 → 看站多遠比較好躲（2026-10-13）
  const DB = [100, 150, 200, 300, 400, 600, Infinity], dist = {};
  const bin = () => { const b = G.enemies.find(e => e.t.boss && !e.dead), p = G.player; if (!b) return -1; const d = Math.hypot(b.x - p.x, b.y - p.y); return DB.findIndex(x => d < x); };
  const ou = G.update.bind(G);
  G.update = function (dt) { if (cur) { const k = bin(); if (k >= 0) { const D = dist[cur.dk] = dist[cur.dk] || DB.map(() => ({ t: 0, hp: 0 })); D[k].t += dt; } } return ou(dt); };
  const oh = G.hurtPlayer.bind(G);
  G.hurtPlayer = function (dmg, cause = '', p = G.player, ...a) {
    const h0 = p.hp, r = oh(dmg, cause, p, ...a);
    if (cur && p === G.player) { const k = String(cause).replace(/（.*/, '') === cur.bossName ? '旗艦' + (String(cause).match(/（.*）/) || [''])[0] : '小怪' + (String(cause).match(/（.*）/) || [''])[0]; cur.by[k] = (cur.by[k] || 0) + Math.max(0, h0 - p.hp); if (k.startsWith('旗艦')) { const j = bin(); if (j >= 0) { const D = dist[cur.dk] = dist[cur.dk] || DB.map(() => ({ t: 0, hp: 0 })); D[j].hp += Math.max(0, h0 - p.hp) / p.maxHp * 100; } } }
    return r;
  };
  // 打在旗艦身上的傷害照來源分（直接命中、燃燒…）：旗艦的 hurt／update（燃燒在 update 裡扣）期間經過 recordDamage 的都算
  let onBoss = false;
  const wrapE = k => { const o = T_.Enemy.prototype[k]; T_.Enemy.prototype[k] = function (...a) { if (!cur || !this.t.boss) return o.apply(this, a); const was = onBoss; onBoss = true; try { return o.apply(this, a); } finally { onBoss = was; } }; };
  wrapE('hurt'); wrapE('update');
  const rd = G.recordDamage.bind(G);
  G.recordDamage = function (source, amount, att) { if (cur && onBoss && amount > 0) cur.dmg[source] = (cur.dmg[source] || 0) + amount; return rd(source, amount, att); };
  return {
    start(w) {
      if (!G.node || G.node.type !== 'boss' || G.sector !== 1) return null;
      const b = G.enemies.find(e => e.t.boss) || { t: { name: ENEMY_TYPES[CFG.BOSS_ORDER[0]].name } };
      return cur = { hp0: G.player.hp / G.player.maxHp, maxHp: G.player.maxHp, w, dk: w + ' ' + (G.weapon.path ? WEAPONS[w].paths[G.weapon.path].name : '沒升級'), bossName: b.t.name, by: {}, dmg: {}, path: G.weapon.path || '沒升級' };
    },
    end(c, w, t) {
      cur = null;
      const boss = G.enemies.find(e => e.t.boss);
      c.t = t; c.died = G.state === 'dead'; c.bossMax = boss ? boss.maxHp : null; c.bossLeft = c.died && boss ? boss.hp / boss.maxHp : 0;
      (all[w + ' ' + (c.path === '沒升級' ? c.path : WEAPONS[w].paths[c.path].name)] = all[w + ' ' + (c.path === '沒升級' ? c.path : WEAPONS[w].paths[c.path].name)] || []).push(c);
    },
    report() {
      console.log('');
      console.log('離旗艦多遠（中心到中心）：待的時間占比｜在那個距離每秒被旗艦打掉的血（最大 HP 的 %／秒）');
      const lab = DB.map((x, i) => (i ? DB[i - 1] : 0) + (x === Infinity ? '+' : '～' + x));
      const tot = DB.map(() => ({ t: 0, hp: 0 }));
      const line = (nm, D) => { const T = D.reduce((s, x) => s + x.t, 0); console.log('  ' + nm.padEnd(9, '　') + D.map((x, i) => lab[i] + ' ' + Math.round(x.t / T * 100) + '%｜' + (x.t > 5 ? (x.hp / x.t).toFixed(2) : '—')).join('　')); };
      for (const [k, D] of Object.entries(dist)) { line(WN[k.split(' ')[0]] + ' ' + k.split(' ')[1], D); D.forEach((x, i) => { tot[i].t += x.t; tot[i].hp += x.hp; }); }
      if (Object.keys(dist).length > 1) line('全部', tot);
      console.log('第一星區旗艦（1-7）：場數｜陣亡｜進場 HP（最大 HP 的 %）｜最大 HP｜打多久（活下來的）｜死時旗艦剩血｜每場被打掉的血（最大 HP 的 %，前 5）｜打旗艦每秒傷害（照來源）');
      for (const [k, L] of Object.entries(all)) {
        const n = L.length, d = L.filter(c => c.died), sv = L.filter(c => !c.died), avg = (a, f) => a.length ? a.reduce((s, c) => s + f(c), 0) / a.length : NaN;
        const by = {}; for (const c of L) for (const [q, v] of Object.entries(c.by)) by[q] = (by[q] || 0) + v / c.maxHp * 100 / n;
        const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, v]) => q + ' ' + Math.round(v) + '%').join('、');
        console.log(`  ${(WN[k.split(' ')[0]] + ' ' + k.split(' ')[1]).padEnd(10, '　')} ${n} 場｜陣亡 ${d.length}（${Math.round(d.length / n * 100)}%）｜進場 ${Math.round(avg(L, c => c.hp0) * 100)}%｜${Math.round(avg(L, c => c.maxHp))}｜${Math.round(avg(sv, c => c.t))} 秒｜${d.length ? Math.round(avg(d, c => c.bossLeft) * 100) + '%' : '—'}｜${top}｜${(() => { const tt = L.reduce((s, c) => s + c.t, 0), D = {}; for (const c of L) for (const [q, v] of Object.entries(c.dmg)) D[q] = (D[q] || 0) + v; const tot = Object.values(D).reduce((a, b) => a + b, 0); return '合計 ' + Math.round(tot / tt) + '（' + Object.entries(D).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q, v]) => q + ' ' + Math.round(v / tt)).join('、') + '）'; })()}`);
      }
    } };
})() : null;

function oneRun(w, s) {
  seed(9000 + s * 97 + Object.keys(WN).indexOf(w)); resetRun(T_); resetBot(); if (PROBE) PROBE.reset();
  const routes = Object.keys(WEAPONS[w].paths).flatMap(p => [0, 1].map(f => ({ path: p, final: f })));
  const route = BEST ? null : ONLY ? { path: ONLY[0], final: +ONLY[1] } : routes[s % routes.length];
  B.setRoute(route);
  const ship = SHIP || pick(Object.keys(SHIPS));
  G.newRun('run', ship, w, pick(pickN(NORMAL_IDS, 3)));
  const log = { fights: 0, sector: 1, layer: 0, won: false };
  for (let guard = 0; guard < 200; guard++) {
    const st = G.state;
    if (st === 'map') {
      if (globalThis.__REPLAY) applyReplay(log);
      const n = chooseNode(); if (!n) break;
      log.layer = n.L + 1; log.enteredS = G.sector; G.enterNode(n);
    } else if (st === 'play') {
      const p = G.player; let t = 0; log.fights++; const bd = BOSSD && BOSSD.start(w);
      while (G.state === 'play' && (t < 300 || (t < 900 && B.stallSecs() < 60))) {  /* 300 秒後還在打掉血（最近 60 秒內）就繼續，最多 900 秒 */ if (process.env.RS_TRACE && t > (+process.env.RS_TRACE_FROM || 150) && Math.round(t * 60) % 60 === 0) { const e0 = G.enemies.find(e => !e.dead); if (!e0) { const AR = Arena, g = AR.gates[p.zone]; console.error(`t${t.toFixed(0)} 沒敵人 飛船 ${Math.round(p.x)},${Math.round(p.y)} 區${p.zone} 波${G.combat.wave} exit ${JSON.stringify(G.exit)} 閘門 ${g ? Math.round(g.x) + ',' + Math.round(g.y) + ' open' + g.open : '-'} 方向 ${JSON.stringify(AR.exitDir(p.x, p.y, p.zone))} 搖桿 ${Input.joy ? Math.round(Input.joy.x) + ',' + Math.round(Input.joy.y) : '-'} f${AR.f(p.x, p.y).toFixed(0)}`); } if (e0) console.error(`t${t.toFixed(0)} 飛船 ${Math.round(p.x)},${Math.round(p.y)} 敵 ${Math.round(e0.x)},${Math.round(e0.y)} ${e0.mode} v${Math.round(e0.vx)},${Math.round(e0.vy)} 搖桿 ${Input.joy ? Math.round(Input.joy.x) + ',' + Math.round(Input.joy.y) : '-'} 子彈 ${G.bullets.length}`); } bot(p); const t0 = process.env.RS_WATCH ? Date.now() : 0; G.update(dt); t += dt; if (t0 && Date.now() - t0 > 200) console.error(`慢幀 ${Date.now() - t0}ms 子彈 ${G.bullets.length} 觸發 ${G.triggerQueue.length} 電路 ${G.chain.join(",")} 來源 ${JSON.stringify(G.bullets.reduce((h, b) => (h[b.att.src + ":" + b.depth + ":" + b.mode] = (h[b.att.src + ":" + b.depth + ":" + b.mode] || 0) + 1, h), {}))} 敵彈 ${G.eBullets.length}`); }
      if (bd) BOSSD.end(bd, w, t);
      if (G.state === 'play') {
        log.timeout = true;
        // 卡住的原因（自動判斷，2026-10-09）：敵人在牆裡、敵人速度異常、只剩隱形的、敵人在黑洞範圍邊上、多久沒打掉血
        const alive = G.enemies.filter(e => !e.dead), why = [];
        if (!Arena.rect && alive.some(e => Arena.f(e.x, e.y) < -20)) why.push('敵人在牆裡');
        if (alive.some(e => Math.hypot(e.vx, e.vy) > 1500)) why.push('敵人速度異常');
        if (alive.length && alive.every(e => e.cloak > 0.5)) why.push('只剩隱形的敵人');
        if (alive.some(e => G.objs.some(o => o.type === 'hole' && Math.abs(Math.hypot(e.x - o.x, e.y - o.y) - (o.R + 30)) < 15))) why.push('敵人在黑洞範圍邊上');
        why.push(`${Math.round(B.stallSecs())} 秒沒打掉血`);
        log.cause = why.join('、');
        log.why = `波次 ${G.combat.wave}/${G.combat.wavesTotal} 待生 ${G.combat.pending.length}；敵人 ` + G.enemies.map(e => `${e.t.name}@${Math.round(e.x)},${Math.round(e.y)} HP${Math.round(e.hp)} spawnT${e.spawnT.toFixed(1)}`).join(' ') + '；物件 ' + G.objs.map(o => { const e1 = G.enemies.find(e => !e.dead), d = e1 ? Math.round(Math.hypot(o.x - e1.x, o.y - e1.y) - (o.r || 0)) : null; return o.type + (d != null && d < 150 ? `@${Math.round(o.x)},${Math.round(o.y)} r${Math.round(o.r || 0)}（離第一隻敵人 ${d}）` : ''); }).join(',') + `；飛船 ${Math.round(p.x)},${Math.round(p.y)}`;
        const AR = T_.Arena, e0 = G.enemies.find(e => !e.dead);  // 大地圖：牆、視線、繞路方向、黑洞距離
        if (!AR.rect && e0) log.why += `；場地值 飛船 ${AR.f(p.x, p.y).toFixed(0)} 敵人 ${AR.f(e0.x, e0.y).toFixed(0)}；牆擋視線 ${AR.losBlocked(p.x, p.y, e0.x, e0.y, 12)} 物件擋 ${!!(G.objs.length && T_.Objects.losBlocked(p.x, p.y, e0.x, e0.y, 12))}；繞路 ${JSON.stringify(AR.navTo(p, e0.x, e0.y))}；黑洞距離 ${G.objs.filter(o => o.type === 'hole').map(o => Math.round(Math.hypot(o.x - e0.x, o.y - e0.y))).join('/')}；區 飛船${p.zone} 敵人${AR.zoneOf(e0.x, e0.y)}`;
        break;
      }
    } else if (st === 'victory') {
      const done = G.chapterDone();  // 這章打完了沒（遊戲判斷；在獎勵畫面處理完之前先問）
      handle();  // 旗艦二選一、裝上旗艦模組（bot/pick.js）
      if (done) log.won = true;
      if (ENDLESS ? G.sector >= 12 : done) break;  // --endless：通關後繼續打無盡，最多到星區 12
      G.nextSector(); log.sector = G.sector; equip();  // 旗艦送的插槽馬上補上
    } else if (st === 'dead') {
      if (process.env.RS_WATCH) console.error(`死 ${G.sector}-${G.node ? G.node.L + 1 : 0} DPS估 ${Math.round(G.stats.dpsEst)} 電路 ${G.chain.map((id, i) => (id || '空') + (G.stats.info && G.stats.info[i].idle ? '(✗)' : '') + ((G.socks || [])[i] && G.socks[i].length ? '[' + G.socks[i].join('+') + ']' : '')).join(',')} 倉庫 ${G.inventory.filter(Boolean).join(',')} 武器 ${G.weapon.path || '-'}${G.weapon.final ?? ''} 受傷 ${JSON.stringify(Object.fromEntries(Object.entries(G.runStats.taken || {}).map(([k, v]) => [k, Math.round(v)])))}`);
      break;
    }
    else if (!handle()) { log.stuck = st; break; }  // 獎勵、補給站、改裝廠、軍械台、維修站、編輯器（bot/pick.js）
  }
  log.sector = G.sector;
  // 最後的配裝：武器升級（第一段、第二段的名稱）、零件、電路（分組、--builds 用）
  const WP = WEAPONS[G.weapon.id], P1 = G.weapon.path && WP.paths[G.weapon.path];
  log.build = { code: route ? route.path + route.final : null, route: route ? WP.paths[route.path].name + '→' + WP.paths[route.path].next[route.final].name : null, done: G.weapon.final != null, path: P1 ? P1.name : '沒升級', final: P1 && G.weapon.final != null ? P1.next[G.weapon.final].name : null,
    parts: Object.entries(G.parts).filter(([, n]) => n > 0).map(([k, n]) => PARTS[k].name + n).join(' ') || '沒有零件',
    chain: G.chain.slice(1).filter(Boolean).map(id => CH[id].short || CH[id].name).join(' ') + (G.energyCap ? ` ⚡${G.stats.heat}/${G.energyCap()}` : '') };  // 能量／容量（2026-10-10）
  return log;
}

// ---- --replay=紀錄檔：照玩家遊玩紀錄的「取得」那行拿東西，電腦只負責打（分出差距在配裝還是操作）----
//   晶片（名稱後面的數字 = 等級）、零件（數字 = 層數）、背包模組、武器升級、插槽；每打完一層就把配裝設成「紀錄在這一層拿完之後」
//   進化預設照電腦自己的成長；--replay-evo：進化也照紀錄的時間。飛船、武器、起始晶片照紀錄
function parseReplay(txt) {
  const L = txt.split(/\r?\n/), get = k => L.find(l => l.startsWith(k)) || '';
  const ship = Object.keys(SHIPS).find(id => L[0] && L[0].includes(SHIPS[id].name)) || 'vanguard';
  const wl = get('武器 ').slice(3), weapon = Object.keys(WEAPONS).find(id => wl.startsWith(WEAPONS[id].name)) || 'laser';
  const steps = []; let at = [1, 0];
  for (let t of get('取得').slice(2).replace(/（插座 \d+）/g, '§').replace(/奇異點 投入\S+ → 第 \d+ 格\S+/g, '奇異點').trim().split(/\s+/)) {  // 「（插座 2）」換成記號 §（= 晶片）；奇異點的說明拿掉（奇異點強化的格子不重現）
    const m = t.match(/^(\d+)-(\d+)(.*)$/); if (m) { at = [+m[1], +m[2]]; t = m[3]; } if (t) steps.push({ s: at[0], L: at[1], t }); }
  const inv = (get('電路 ').match(/倉庫 (.*)$/) || [, ''])[1].split(/\s+/).map(n => NORMAL_IDS.find(id => CH[id].short === n.replace(/\d+$/, '') || CH[id].name === n.replace(/\d+$/, ''))).filter(Boolean);
  return { ship, weapon, steps, inv };  // inv：最後放在倉庫的晶片（電路滿了時優先放倉庫）
}
function replayState(R, s, L) {  // 打完 s-L 之後應該有的東西
  const st = { order: [], lv: {}, parts: {}, path: null, final: null, extra: 0 };
  const W = WEAPONS[R.weapon];
  for (const q of R.steps) {
    if (q.s > s || (q.s === s && q.L > L)) break;
    const mk = q.t.endsWith('§'), m = q.t.replace(/§$/, '').match(/^(.*?)(\d*)$/), name = m[1].replace(/\(.*\)$/, ''), k = +(m[2] || 1);
    let chip = NORMAL_IDS.find(id => CH[id].short === name || CH[id].name === name); const evo = NORMAL_IDS.find(id => CH[id].evo === name);
    const part = Object.keys(PARTS).find(id => PARTS[id].name.startsWith(name));
    const path = Object.keys(W.paths).find(p => W.paths[p].name === name), fin = st.path ? W.paths[st.path].next.findIndex(n => n.name === name) : -1;
    if (chip && part && !mk) chip = null;  // 同名（加速＝晶片／加速器零件）：沒有「（插座 N）」的算零件
    if (chip) {  // 已經有的晶片再拿到一次、又沒寫數字 = 合成升一級（例如 3-6 的「倍增」→ 倍增2）
      if (!st.order.includes(chip)) { st.order.push(chip); st.lv[chip] = k; }
      else st.lv[chip] = m[2] ? Math.max(st.lv[chip] || 1, k) : Math.min(3, (st.lv[chip] || 1) + 1);
    }
    else if (evo) { if (!st.order.includes(evo)) st.order.push(evo); if (process.argv.includes('--replay-evo')) st.lv[evo] = 3; }
    else if (part) st.parts[part] = k;
    else if (path) st.path = path;
    else if (fin >= 0) st.final = fin;
    else if (name === '插槽') st.extra++;
  }
  return st;
}
function applyReplay(log) {
  const R = globalThis.__REPLAY, st = replayState(R, G.sector, log.enteredS === G.sector ? log.layer : 0);
  const cur = {}; for (const id of [...G.chain.slice(1), ...G.inventory]) if (id && CH[id]) cur[bOf(id)] = Math.max(cur[bOf(id)] || 1, T_.levelOf(id));
  const ord = [...st.order.filter(id => !R.inv.includes(id)), ...st.order.filter(id => R.inv.includes(id))];  // 紀錄裡放倉庫的排最後（電路滿了就是它們進倉庫）
  const ids = ord.map(id => CH[id].comp ? id : T_.leveledId(id, Math.max(st.lv[id] || 1, cur[id] || 1)));  // 電腦自己長到的等級（進化）保留
  const slots = Math.min(CFG.MAX_SLOTS - 1, CFG.START_SLOTS - 1 + (G.sector - 1) + st.extra);
  G.chain = ['weapon', ...ids.slice(0, slots), ...Array(Math.max(0, slots - ids.length)).fill(null)];
  G.inventory = [...ids.slice(slots), ...Array(Math.max(0, CFG.INV_SLOTS - Math.max(0, ids.length - slots))).fill(null)].slice(0, CFG.INV_SLOTS);
  G.parts = st.parts; G.socks = [];
  G.weapon = { id: R.weapon, path: st.path, final: st.path ? st.final : null }; G.refreshWeapon();
  sortChain(); G.recalc();
}
if (arg('replay')) {
  globalThis.__REPLAY = parseReplay(require('fs').readFileSync(arg('replay'), 'utf8'));
  const R = globalThis.__REPLAY, first = R.steps.find(q => q.s === 1 && q.L === 1);
  WPN.length = 0; WPN.push(R.weapon);
  console.log(`照紀錄拿東西：${SHIPS[R.ship].name}・${WEAPONS[R.weapon].name}，${R.steps.length} 項${process.argv.includes('--replay-evo') ? '（進化也照紀錄）' : '（進化照電腦自己的成長）'}`);
  const origNew = G.newRun.bind(G);  // 飛船、起始晶片照紀錄（紀錄的第一項 = 1-1 拿到的，當成起始晶片）
  G.newRun = (mode, ship, w, start) => origNew(mode, R.ship, R.weapon, first ? NORMAL_IDS.find(id => CH[id].short === first.t.replace(/\d+$/, '') || CH[id].name === first.t.replace(/\d+$/, '')) || start : start);
}

console.log(`整局模擬：${N} 局 × 每把武器（飛船隨機、起始晶片隨機）。電腦是熟練玩家`);
const all = { runs: 0, won: 0, dieAt: {} };
for (const w of WPN) {
  let won = 0, stuck = 0; const dieAt = {}; const reach = []; const byPath = {}, byCode = {};  // byPath：武器升級路線 → [通關, 局數, 升滿局數]；byCode 同樣、用代號（A0）存檔，多一格「死在第一星區的局數」
  for (let s = 0; s < N; s++) {
    if (GAME != null && s !== GAME) continue;
    if (s < FROM) continue;
    const r = oneRun(w, s);
    if (PROBE) console.log(`  ${WN[w]} 第 ${s} 局 ${r.build ? r.build.route || '' : ''}${r.build && r.build.done ? '（升滿）' : '（沒升滿）'} ${r.won ? '通關' : '死在 ' + r.sector + '-' + r.layer}｜${PROBE.text()}`);
    if (BUILDS && r.build) { const b = r.build; console.log(`  第 ${s} 局 ${r.won ? '通關' : '死在 ' + r.sector + '-' + r.layer}｜${b.path}${b.final ? '→' + b.final : ''}｜${b.parts}｜${b.chain}`); }
    if (r.stuck || r.timeout) console.log(`  ${WN[w]} 第 ${s} 局卡住：${r.stuck || '戰鬥超過 300 秒、最近 60 秒沒打掉血（最多打到 900 秒）'}（星區 ${r.sector} 第 ${r.layer} 層）${r.cause ? '｜原因：' + r.cause : ''}${r.why ? '\n    ' + r.why : ''}`);
    if (r.stuck || r.timeout) { stuck++; continue; }
    reach.push(r.won ? 22 : (r.sector - 1) * 7 + r.layer);  // 打到第幾個節點（1～21；通關 = 22）
    if (r.build) { const k = r.build.route || (r.build.path + (r.build.final ? '→' + r.build.final : '')), g = byPath[k] = byPath[k] || [0, 0, 0]; g[1]++; if (r.won) g[0]++; if (r.build.done) g[2]++; if (r.build.code) { const c = byCode[r.build.code] = byCode[r.build.code] || [0, 0, 0]; c[1]++; if (r.won) c[0]++; if (r.build.done) c[2]++; c[3] = (c[3] || 0) + (!r.won && r.sector === 1 ? 1 : 0); } }
    if (r.won) { won++; (all.endlessReach = all.endlessReach || []).push(r.sector); } else { const k = `${r.sector}-${r.layer}`; dieAt[k] = (dieAt[k] || 0) + 1; all.dieAt[k] = (all.dieAt[k] || 0) + 1; }
  }
  all.runs += RUNS - stuck; all.won += won;
  (all.surv = all.surv || {})[WN[w]] = Array.from({ length: 22 }, (_, k) => Math.round(reach.filter(v => v > k).length / Math.max(1, reach.length) * 100));
  const top = Object.entries(dieAt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join('、');
  console.log(`${WN[w].padEnd(4)} 通關 ${String(Math.round(won / Math.max(1, RUNS - stuck) * 100)).padStart(3)}%${stuck ? `（${stuck} 局卡住不算）` : ''}　死在（星區-層）：${top || '—'}`);
  // 按武器升級路線分組（最後的升級；局數少的組別參考就好）
  console.log(BEST ? '    升級路線：' + Object.entries(byPath).sort((a, b) => b[1][1] - a[1][1]).map(([k, [a, n]]) => `${k} ${a}/${n} 局通關`).join('、')
    : '    指定路線（通關／局數，括號 = 真的升滿的局數）：' + Object.entries(byPath).map(([k, [a, n, d]]) => `${k} ${a}/${n}（${d}）`).join('、'));
  // 標準的整局（每局輪流指定路線、沒有 --route／--best／--game／--from／--tweak／--replay、至少 30 局）存 runsim_routes_<武器>.json：升級健檢（upcheck.js）看「第一段死在第一星區」用
  //   試改版（GAME_DIR）只在有 TABLE_DIR 時存、存到 TABLE_DIR（不蓋掉正式的）
  if (!BEST && !ONLY && GAME == null && !FROM && !arg('tweak') && !arg('replay') && !ENDLESS && RUNS >= 30 && (!process.env.GAME_DIR || process.env.TABLE_DIR))  // 至少 30 局（每條路線 5 局）才蓋掉
    require('fs').writeFileSync((process.env.TABLE_DIR || __dirname) + '/runsim_routes_' + w + '.json', JSON.stringify({ date: new Date().toLocaleString(), fp: require('./upfp').weaponFp(w), runs: RUNS - stuck, won, stuck, routes: byCode }, null, 1));
}
if (BOSSD) BOSSD.report();
const bySector = [1, 2, 3].map(sec => Object.entries(all.dieAt).filter(([k]) => k.startsWith(sec + '-')).reduce((a, [, v]) => a + v, 0));
if (ENDLESS) console.log(`無盡：通關的局裡，平均打到星區 ${(all.endlessReach || []).length ? (all.endlessReach.reduce((a, b) => a + b, 0) / all.endlessReach.length).toFixed(1) : '—'}（分布 ${JSON.stringify((all.endlessReach || []).reduce((h, v) => (h[v] = (h[v] || 0) + 1, h), {}))}）`);
console.log(`全部 通關 ${Math.round(all.won / all.runs * 100)}%　死在第 1／2／3 星區：${bySector.join('／')} 局（第 7 層 = 旗艦）`);
if (arg('json')) require('fs').writeFileSync(arg('json'), JSON.stringify(all.surv));
