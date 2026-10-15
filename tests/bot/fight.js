// 星環電路 整局模擬的電腦（戰鬥操作）
//   在遊戲的全域範圍裡執行（runsim／botsim／qasim 用 vm.runInThisContext，coopsim 每份遊戲各一份 vm context），由 bot/load.js 載入
//   用到遊戲的全域：Game（= G）、CHIPS（= CH）、CFG、Input、Arena、Objects、PARTS、WEAPONS、socketsOf、chipId、pick、randInt
//   2026-10-09 從 runsim.js 搬出來（以前 coopsim／botsim／qasim 從 runsim.js 剪文字來用）

function baseBot(p) {  // 跟 botsim.js 一樣：自動瞄準、閃子彈、危險時衝刺
  // 隱形的潛伏者：走位不看它（真人看不清楚，不會刻意跟它保持距離；讓它靠近現形再打）；
  //   場上只剩隱形的敵人時，手動朝它的位置射（真人朝殘影射）。以前會一直後退，潛伏者永遠不現形，戰鬥卡住
  const I = Input, all = G.enemies.filter(e => !e.dead && !(e.spawnT > 0)), E = all.filter(e => !(e.cloak > 0.5));
  I.touch = true; I.autoFire = true; I.aimStick = null;
  let near = null, nd = Infinity;
  for (const e of E) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < nd) { nd = d; near = e; } }
  if (!near && all.length) {
    const c = all.reduce((a, b) => Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a), cd = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    I.aimStick = { bx: 0, by: 0, x: (c.x - p.x) / cd * 60, y: (c.y - p.y) / cd * 60 };
  }
  // 母巢會一直生蟲群：看得到就先打母巢（蟲群沒有貼身時）；以前只打最近的蟲群，母巢打不完，戰鬥卡住
  //   身邊 150 內沒有其他敵人時，走位也以母巢為準（靠過去打）
  const hive = E.find(e => e.type === 'hive');
  if (hive && nd > 70) {
    const hd = Math.hypot(hive.x - p.x, hive.y - p.y) || 1;
    if (hd < CFG.AUTO_RANGE) I.aimStick = { bx: 0, by: 0, x: (hive.x - p.x) / hd * 60, y: (hive.y - p.y) / hd * 60 };
    if (!E.some(e => e !== hive && Math.hypot(e.x - p.x, e.y - p.y) < 150)) { near = hive; nd = hd; }
  }
  // 寶藏無人機會逃、15 秒後躍遷離開：真人看到會去追。身邊 150 內沒有其他敵人時，瞄準和走位都以它為準
  const tre = E.find(e => e.t.treasure);
  if (tre && !E.some(e => e !== tre && Math.hypot(e.x - p.x, e.y - p.y) < 150)) {
    const td = Math.hypot(tre.x - p.x, tre.y - p.y) || 1;
    if (td < CFG.AUTO_RANGE) I.aimStick = { bx: 0, by: 0, x: (tre.x - p.x) / td * 60, y: (tre.y - p.y) / td * 60 };
    near = tre; nd = td;
  }
  // 保持在射程七成的距離；散彈 close：四成（扇形的彈丸越遠打中越少）；
  //   加速：射程 ×1.5、越遠越痛，站遠一點（最多 700，一般最多 360）
  //   佈雷：站在地雷停住的距離（射程一半），地雷才會落在敵人附近
  const wp = G.wp, R = wp.speed * wp.life * (hasChip('accel') ? 1.5 : 1);
  let want = Math.max(70, Math.min(hasChip('accel') ? 700 : 360, R * 0.7));
  if (hasChip('stasis')) want = Math.max(70, R * 0.5);
  // 站的距離不超過自動攻擊的索敵距離（最多 560）：以前裝加速要站 700 外，自動攻擊鎖不到、六成時間沒開火（照玩家雷射＋加速配裝打王 183 秒、王每秒只掉 17）
  want = Math.min(want, Math.min(R + 40, CFG.AUTO_RANGE) - 60);
  // 收尾：只剩 1～2 隻、而且都是會一直後退的遠程小兵（彈幕艇、噴吐者）時拉近到 150 內（退到角落，站在 400 外打不死）
  //   旗艦、精英不算（貼上去會被打死：試過一律拉近，雷射通關率 18% → 5%）
  if (E.length && E.length <= 2 && E.every(e => e.type === 'gunboat' || e.type === 'spitter')) want = Math.min(want, 150);
  // 近戰打旗艦（2026-10-13）：刃片射程 250 以內、身邊 120 內沒有小怪時，以旗艦為準站在中心 105～145（旗艦外緣 55～95）
  //   量過（--bossdiag 距離分段，相刃 120 局）：中心 100～150 每秒掉 1.3～1.9% HP，150～200 掉 2.4～3.8%；以前跟最近的敵人保持距離、常被擠到 150 外
  //   相刃整局 120 局：21% → 23%、1-7 陣亡 巨刃 59% → 56%、相位灼燒 79% → 72%（差不多，但比較像真人打法）。只有相刃（射程 130）會用到
  let band = 40;
  const boss0 = E.find(e => e.t.boss);
  if (R < 250 && boss0 && !E.some(e => e !== boss0 && Math.hypot(e.x - p.x, e.y - p.y) < 120)) {
    near = boss0; nd = Math.hypot(boss0.x - p.x, boss0.y - p.y) || 1; want = boss0.r + 75; band = 20;
  }
  let mx = 0, my = 0;
  if (near) {
    const ux = (near.x - p.x) / nd, uy = (near.y - p.y) / nd, side = Math.sin(G.time * 0.7) > 0 ? 1 : -1;
    const k = nd > want + band ? 1 : nd < want - band ? -1 : 0;
    mx = ux * k - uy * side * 0.8; my = uy * k + ux * side * 0.8;
  }
  const W = CFG.WORLD_W, H = CFG.WORLD_H, AR = Arena;
  const nav = near && AR.navTo(p, near.x, near.y);  // 大地圖：敵人躲在牆後（或行星、黑洞後面），繞過去
  navOn = !!nav;
  if (nav) { mx = nav[0]; my = nav[1]; }
  // 卡住：3 秒內移動不到 30（例如頂著行星），往側邊閃 1 秒
  if (!unstick.t0 || Math.hypot(p.x - unstick.x, p.y - unstick.y) > 30) { unstick.x = p.x; unstick.y = p.y; unstick.t0 = G.time; }
  else if (G.time - unstick.t0 > 3 && E.length) { unstick.until = G.time + 1; unstick.side = Math.random() < 0.5 ? 1 : -1; unstick.t0 = G.time; }
  // 場上有旗艦、自動攻擊的索敵距離（最多 560）內一隻都沒有（停火中）：往旗艦靠到索敵距離內
  //   以前只跟最近的蟲群保持距離，長射程的雷射常離王 700 以上、自動攻擊鎖不到，三成以上的時間沒在打王
  //   （有蟲群可打時照原本的走法：一律往王拉，散彈會一直站在螺旋彈幕最密的地方）
  const boss = E.find(e => e.t.boss), reach = Math.min(R + 40, CFG.AUTO_RANGE);
  if (boss && boss !== near && nd > reach) {
    const bdx = boss.x - p.x, bdy = boss.y - p.y, bd = Math.hypot(bdx, bdy) || 1;
    if (bd > reach - 80) { const w = Math.min(2, 0.5 + (bd - reach + 80) / 100), bn = AR.navTo(p, boss.x, boss.y); mx += (bn ? bn[0] : bdx / bd) * w; my += (bn ? bn[1] : bdy / bd) * w; }
  }
  if (G.time < (unstick.until || 0) && near) { const ux = (near.x - p.x) / nd, uy = (near.y - p.y) / nd; mx = -uy * unstick.side + ux * 0.3; my = ux * unstick.side + uy * 0.3; navOn = true; }
  if (AR.rect) {  // 別貼牆（離中心 500 以上往回拉）；但最近的敵人縮在牆邊（150 內）時要追過去，不然打不到角落的彈幕艇
    const cx = W / 2 - p.x, cy = H / 2 - p.y, cd = Math.hypot(cx, cy);
    const nearWall = near && Math.min(near.x, near.y, W - near.x, H - near.y) < 150;
    if (cd > 500 && !nearWall) { mx += cx / cd; my += cy / cd; }
  } else if (!nav) {  // 大地圖：離牆 110 內往空地推（越近越用力）
    const v = AR.f(p.x, p.y);
    if (v < 110) { const [gx, gy] = AR.grad(p.x, p.y), w = (110 - v) / 110 * 1.5; mx += gx * w; my += gy * w; }
  }
  // 閃子彈：200 內朝自己飛來的敵彈，往它的側邊躲（越近越急）；中等玩家會這樣做
  // 逆襲（散彈升級）：爆發沒開、HP 一半以上 → 不閃子彈，故意吃一發換爆發（衝撞照樣閃：太痛）
  const bait = G.wpOf(p).revenge && !(p.revengeT > 0) && p.hp > p.maxHp * 0.5;
  threat = 0;
  if (!bait) for (const b of G.eBullets) {
    const rx = p.x - b.x, ry = p.y - b.y, d = Math.hypot(rx, ry), v = Math.hypot(b.vx, b.vy) || 1;
    if (b.mine) {  // 精英「佈雷」的地雷（不會動）：靠近 110 內就往外繞（越近越急）
      if (d < 110) { const w = 2.5 * (1 - d / 110); mx += rx / (d || 1) * w; my += ry / (d || 1) * w; threat += w; }
      continue;
    }
    if (d > 200 || (b.vx * rx + b.vy * ry) <= 0) continue;
    const miss = Math.abs(rx * b.vy - ry * b.vx) / v;  // 子彈照直線飛，會離飛船多近
    if (miss > p.r + b.r + 24) continue;
    let sx = -b.vy / v, sy = b.vx / v; if (sx * rx + sy * ry < 0) { sx = -sx; sy = -sy; }
    const w = 3 * (1 - d / 200); mx += sx * w; my += sy * w; threat += w;
  }
  // dodge:ram（熟練玩家）：高速衝過來的敵人（刺殼滾動、精英／潛伏者衝鋒、旗艦衝撞）也當子彈閃：照牠的速度預測路線，
  //   會撞到就往側邊躲；0.35 秒內就撞上時衝刺。一般電腦只閃子彈，撞擊是牠掉血最多的來源（用玩家配裝時佔 6 成）
  let ramHit = false;
  for (const e of all) {
    const v = Math.hypot(e.vx || 0, e.vy || 0); if (v < 170) continue;
    const rx = p.x - e.x, ry = p.y - e.y, d = Math.hypot(rx, ry);
    if (d > 300 || (e.vx * rx + e.vy * ry) <= 0) continue;
    const miss = Math.abs(rx * e.vy - ry * e.vx) / v, R = p.r + e.r + 22;
    if (miss > R) continue;
    let sx = -e.vy / v, sy = e.vx / v; if (sx * rx + sy * ry < 0) { sx = -sx; sy = -sy; }
    const w = 4 * (1 - d / 300); mx += sx * w; my += sy * w; threat += w;
    if (d / v < 0.35) ramHit = true;
  }
  // dodge:ram 也躲貼身：任何敵人靠到 50 內就往外推（盾衛、刺殼、分裂體慢慢擠過來撞）；60 內衝刺
  for (const e of all) {
    const rx = p.x - e.x, ry = p.y - e.y, d = Math.hypot(rx, ry) || 1, gap = d - p.r - e.r;
    if (gap > 50) continue;
    const w = 3 * (1 - Math.max(0, gap) / 50); mx += rx / d * w; my += ry / d * w; threat += w;
    if (gap < 20) ramHit = true;
  }
  // 久打不到（2026-10-09）：敵人的總血量 20 秒都沒減少 → 往目標（有旗艦就旗艦）壓過去，力道蓋過閃避（還是會閃、危險時照樣衝刺）
  //   以前旗艦狂暴後彈幕太密，電腦一直閃、待在射程外 800～1300，300 秒打不完
  let chase = false;
  const hidden = !near && all.length ? all.reduce((a, b) => Math.hypot(b.x - p.x, b.y - p.y) < Math.hypot(a.x - p.x, a.y - p.y) ? b : a) : null;  // 只剩隱形的：朝最近那隻（真人看殘影找）
  if (stalled() && (boss || near || hidden) && !(G.time < (unstick.until || 0))) {  // 正在脫困（往旁邊閃）時不壓，不然又被推回卡住的地方
    // 母巢會一直生蟲群：先壓母巢
    const tg = boss || hive || near || hidden, dx = tg.x - p.x, dy = tg.y - p.y, d = Math.hypot(dx, dy) || 1, bn = !AR.rect && AR.navTo(p, tg.x, tg.y);
    // 壓了 20 秒還是打不到（例如相刃＋超音的刃片飛不到估的射程，站在 150 外 60 秒沒打到母巢）：再貼近到 50
    const close = G.time - stall.t > 40 ? 50 : Math.min(want, 150);
    if (d > close) {
      const w = 2.5 + Math.hypot(mx, my); mx += (bn ? bn[0] : dx / d) * w; my += (bn ? bn[1] : dy / d) * w;
      // 衝刺追（彈幕艇會保持 420～520 的距離；以前只在危險時衝刺）：衝刺好了、還遠、這一幀沒有子彈要閃就朝目標衝
      if (p.dashCd <= 0 && d > want + 80 && threat === 0) chase = true;
    }
  }
  // 黑洞（2026-10-10）：在吸力範圍裡往外走（越靠近中心越用力）；被吸力拖住（2 秒移動不到 20）就往外衝刺
  //   以前沒有：搖桿每幀換方向，速度跟吸力抵銷，停在黑洞裡 150 秒（只剩潛伏者在外圍等，戰鬥卡死）
  let inHole = false;
  for (const o of G.objs) {
    if (o.type !== 'hole') continue;
    const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy) || 1;
    if (d > o.R) continue;
    const w = 2 + 4 * (1 - d / o.R); mx += dx / d * w; my += dy / d * w; inHole = true;
  }
  if (!inHole || Math.hypot(p.x - holeStuck.x, p.y - holeStuck.y) > 20) { holeStuck.x = p.x; holeStuck.y = p.y; holeStuck.t = G.time; }
  const l = Math.hypot(mx, my);
  I.joy = l > 0.01 ? { bx: 0, by: 0, x: mx / l * 60, y: my / l * 60 } : null;
  if (chase) I.dash = true;
  if (inHole && G.time - holeStuck.t > 2 && p.dashCd <= 0) I.dash = true;  // 黑洞裡被拖住：往外衝
  const danger = ramHit || !bait && G.eBullets.some(b => Math.hypot(b.x - p.x, b.y - p.y) < 60 && (b.vx * (p.x - b.x) + b.vy * (p.y - b.y)) > 0) || nd < 40;
  if (danger && p.dashCd <= 0) I.dash = true;
}

// 照配裝打：電路上有這些玩法晶片時，刻意照它們的玩法打（可以同時好幾種）
//   反向：背對敵人射；衝刺射擊：安全時朝敵人衝；環繞：貼近讓繞圈的子彈磨敵人；
//   牆反彈：直接打（打偏的自然會彈回來；2026-09-30 比過：刻意瞄牆比較差）；蓄力：平常照打，血厚的敵人才停火蓄滿再放
const bOf = id => String(id).split('~')[0];  // 晶片 id：base~插座數
const hasChip = b => G.chain.some(id => id && bOf(id) === b);
// 久打不到：記住敵人總血量上次減少的時間（新的一波生出來也算有進展）；有旗艦時只看旗艦（打死牠召喚的蟲群不算進展）
const stall = { hp: 0, t: 0, n: 0 };
function stalled() {
  let hp = 0, n = 0;
  // 母巢在場時也只看母巢（2026-10-10）：牠每 4 秒生蟲群，敵人數一直變 → 以前永遠不算卡住、不去打母巢（相刃打 900 秒母巢只掉 5%）
  const B = G.enemies.find(e => !e.dead && e.t.boss) || G.enemies.find(e => !e.dead && e.type === 'hive');
  for (const e of B ? [B] : G.enemies) if (!e.dead && !(e.spawnT > 0)) { hp += e.hp; n++; }
  if (G.time < stall.t || hp < stall.hp - 0.5 || n !== stall.n) stall.t = G.time;
  stall.hp = hp; stall.n = n;
  return n > 0 && G.time - stall.t > 20;
}
const chg = { t0: 0, off: 0 };  // 蓄力：開始停火的時間、照常開火到什麼時候
let relT = 0, threat = 0, navOn = false;  // threat：這一幀要閃的子彈有多急（0 = 沒有子彈會打到；baseBot 算）
// navOn：這一幀在繞路／脫困（各晶片的貼近走位先不蓋過去）
const unstick = {};
const holeStuck = { x: 0, y: 0, t: 0 };  // 黑洞裡被拖住多久（見 baseBot）  // 卡住偵測（見 baseBot）
// 新的一局：電腦自己的狀態也歸零（蓄力放開的時間、卡住偵測、出口脫困）
function resetBot() { chg.t0 = chg.off = 0; relT = 0; threat = 0; navOn = false; stall.hp = 0; stall.t = 0; stall.n = 0; for (const k in unstick) delete unstick[k]; for (const k in exitStuck) delete exitStuck[k]; holeStuck.t = 0; }
const T_A = () => (Arena);
// 區域出口：自己這一區沒有敵人、出口出現時，直接飛進去（不開火、不衝刺）
//   大地圖：看自己這一區的閘門開了沒（雙人：隊友先穿過去時 exit 已經收掉、下一區的敵人在閘門另一邊，不算擋路）
//   卡住（1.5 秒移動不到 20，例如頂著牆角）：0.6 秒往離牆的方向加側移
const exitStuck = {};
function goExit(p) {
  const AR = Arena, X = G.exit, g = !AR.rect && AR.gates[p.zone], gate = !!(g && g.open);
  if (!gate && !X) return false;
  if (G.enemies.some(e => !e.dead && (!gate || AR.zoneOf(e.x, e.y) <= p.zone))) return false;
  const d = gate ? AR.exitDir(p.x, p.y, p.zone, p.r) : null;  // 大地圖：照繞牆的路線飛到閘門（穿過去就到下一區）
  let dx = d ? d[0] : X.x - p.x, dy = d ? d[1] : X.y - p.y;
  if (d && AR.f(p.x, p.y) < 24) { const [gx, gy] = AR.grad(p.x, p.y); dx += gx; dy += gy; }  // 貼著牆（離牆不到 24 的格子算走不到，出口方向會指進牆角、沿牆來回滑；2026-10-10）：先往外退
  const S = exitStuck;
  if (!S.t0 || G.time < S.t0 || Math.hypot(p.x - S.x, p.y - S.y) > 20) { S.x = p.x; S.y = p.y; S.t0 = G.time; }
  else if (G.time - S.t0 > 1.5) {
    // 連續卡住就閃久一點（2026-10-10：出口方向指進牆角，閃 0.6 秒只離開 20 又飛回去，卡 200 秒）；離開卡住的地方 5 秒以上歸零
    S.k = G.time - (S.last || -99) < 5 ? (S.k || 0) + 1 : 0; S.last = G.time;
    S.until = G.time + Math.min(2, 0.6 * (1 + S.k)); S.side = Math.random() < 0.5 ? 1 : -1; S.t0 = G.time;
    S.ra = Math.random() * Math.PI * 2;  // 第三次起往隨機方向試（被牆和小行星圍住時，出口方向、離牆方向都被擋：2026-10-10 散彈卡 289 秒）
  }
  if (!AR.rect && G.time < (S.until || 0) && S.k >= 2) { dx = Math.cos(S.ra); dy = Math.sin(S.ra); }
  else if (!AR.rect && G.time < (S.until || 0)) {
    const near = G.objs.some(o => o.type === 'rock' && Math.hypot(o.x - p.x, o.y - p.y) - o.r < p.r + 20);
    if (near) {  // 卡在小行星中間（出口的路線從比飛船窄的縫鑽過去；2026-10-09 QA）：往後退＋往旁邊閃
      const l0 = Math.hypot(dx, dy) || 1, ux = dx / l0, uy = dy / l0; dx = -ux * 0.6 - uy * S.side; dy = -uy * 0.6 + ux * S.side;
    } else { const [gx, gy] = AR.grad(p.x, p.y), w = S.k ? 0.3 : 1; dx = gx - gy * S.side * w; dy = gy + gx * S.side * w; }  // 第二次起主要往離牆的方向
  }
  const l = Math.hypot(dx, dy) || 1;
  Object.assign(Input, { touch: true, aimStick: null, dash: false, joy: { bx: 0, by: 0, x: dx / l * 60, y: dy / l * 60 } });
  return true;
}
// 雙人：隊友倒下（在同一區）就飛過去待在旁邊救（救援範圍 70）；有子彈要閃時邊閃邊靠近；照常開火
function goRevive(p) {
  if (p.dead) return;
  const AR = Arena, m = (G.mates || []).find(o => o.dead && !o.gone && (AR.rect || o.zone === p.zone));
  if (!m) return;
  const d = Math.hypot(m.x - p.x, m.y - p.y) || 1, I = Input;
  if (d < 45) { if (threat === 0) I.joy = null; return; }
  const nav = AR.navTo(p, m.x, m.y), ux = nav ? nav[0] : (m.x - p.x) / d, uy = nav ? nav[1] : (m.y - p.y) / d, j = I.joy || { x: 0, y: 0 };
  const mx = threat > 0 ? j.x / 60 + ux * 1.5 : ux, my = threat > 0 ? j.y / 60 + uy * 1.5 : uy, l = Math.hypot(mx, my) || 1;
  I.joy = { bx: 0, by: 0, x: mx / l * 60, y: my / l * 60 };
}
function bot(p) {
  if (!goExit(p)) { fightBot(p); standBot(p); flankShield(p); }
  goRevive(p);
}
// 精英「護盾」：盾對著自己（±70°）、在 500 內 → 往側邊繞（加在原本的走位上，繞到背後再打）；有子彈要閃時不管
function flankShield(p) {
  if (threat > 0 || Input.dash) return;
  const e = G.enemies.find(o => !o.dead && !(o.spawnT > 0) && o.t.elite && o.shieldA != null && Math.hypot(o.x - p.x, o.y - p.y) < 500);
  if (!e) return;
  const a = Math.atan2(p.y - e.y, p.x - e.x), off = angleDiff(e.shieldA, a);
  if (Math.abs(off) > 1.22) return;
  const s = off >= 0 ? 1 : -1, tx = -Math.sin(a) * s, ty = Math.cos(a) * s, j = Input.joy || { x: 0, y: 0 };  // 往離盾中心遠的那一側繞
  const mx = j.x / 60 + tx * 1.5, my = j.y / 60 + ty * 1.5, l = Math.hypot(mx, my) || 1;
  Input.joy = { bx: 0, by: 0, x: mx / l * 60, y: my / l * 60 };
}
// 架設（站著不動射速越疊越高）：安全就停下來打，任何一項不成立就照原本的走位（層數歸零）
//   安全 = 沒有要閃的子彈／衝撞（threat = 0）、350 內沒有朝自己飛來、會擦到 60 內的敵彈、
//   180 內沒有敵人、450 內沒有高速衝過來的敵人；而且有敵人在射程內、不是在繞路或脫困
//   （第一版只看 threat、100 內沒敵人：站著被打，4 局全死在第 1 星區，不停的 4 局都到第 2 星區）
function standBot(p) {
  if (!hasChip('stand') || threat > 0 || navOn || Input.dash) return;
  const wp = G.wp, reach = Math.min(wp.speed * wp.life * (hasChip('accel') ? 1.5 : 1) + 40, CFG.AUTO_RANGE);
  for (const b of G.eBullets) {
    const rx = p.x - b.x, ry = p.y - b.y, d = Math.hypot(rx, ry), v = Math.hypot(b.vx, b.vy) || 1;
    if (d < 350 && b.vx * rx + b.vy * ry > 0 && Math.abs(rx * b.vy - ry * b.vx) / v < p.r + b.r + 60) return;
  }
  let nd = Infinity;
  for (const e of G.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const rx = p.x - e.x, ry = p.y - e.y, d = Math.hypot(rx, ry) - e.r;
    if (d < 180) return;
    if (d < 450 && Math.hypot(e.vx || 0, e.vy || 0) >= 170 && e.vx * rx + e.vy * ry > 0) return;
    if (!(e.cloak > 0.5)) nd = Math.min(nd, d);
  }
  if (nd > reach) return;
  Input.joy = null;
}
function fightBot(p) {
  baseBot(p);
  const ch = hasChip('charge'), df = hasChip('dashfire');
  if (!(ch || df)) return;
  let n = null, nd = Infinity;
  for (const e of G.enemies) { if (e.dead || e.spawnT > 0 || e.cloak > 0.5) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < nd) { nd = d; n = e; } }
  if (!n) return;
  const I = Input, ux = (n.x - p.x) / nd, uy = (n.y - p.y) / nd;
  // 衝刺射擊：冷卻好、沒有子彈要閃，往敵人的側面衝（衝刺就會開火，不用靠近；以前朝敵人衝，掉血是不裝的 2 倍多）
  //   左右兩邊挑落點（約 130 外）附近沒有敵人和敵彈、也沒出場地的那一邊；都不安全就不衝，衝刺留著躲危險（baseBot）
  if (df && p.dashCd <= 0 && nd < 400 && !I.dash && threat === 0) {
    for (const sd of [1, -1]) {
      const dx = -uy * sd, dy = ux * sd, lx = p.x + dx * 130, ly = p.y + dy * 130;
      const inside = lx > 60 && ly > 60 && lx < CFG.WORLD_W - 60 && ly < CFG.WORLD_H - 60;
      const safe = inside && !G.enemies.some(e => !e.dead && Math.hypot(e.x - lx, e.y - ly) < 80) && !G.eBullets.some(b => Math.hypot(b.x - lx, b.y - ly) < 90);
      if (safe) { I.joy = { bx: 0, by: 0, x: dx * 60, y: dy * 60 }; I.dash = true; break; }
    }
  }
  // 反向、牆反彈照常面對敵人打（9-30 比過：刻意背對／瞄牆比較差）
  const aim = { bx: 0, by: 0, x: ux * 60, y: uy * 60 };
  // 蓄力：只對血厚的（要 6 發以上才打得死）、而且沒有子彈要閃時才停火蓄滿再放，其他照打
  //   停火超過 4 秒還沒放（蓄力一直被閃躲打斷、充不滿）→ 照常開火 3 秒；久打不到時不蓄（2026-10-09 QA：相位刃＋蓄力對刺殼停火 300 秒）
  const tough = n.maxHp >= 6 * G.wp.damage || /boss|elite/.test(n.type);
  if (G.time < chg.t0) chg.t0 = chg.off = 0;  // 新的一場
  const holdOk = G.time >= chg.off && !(G.time - stall.t > 20);
  if (ch && (relT > 0 || (tough && threat === 0 && holdOk))) {
    I.autoFire = false;
    if (!chg.t0) chg.t0 = G.time;
    if (relT > 0) relT -= 1 / 60; else if (p.chargeC >= 1 && nd < 500) relT = 0.1;
    I.aimStick = relT > 0 ? aim : null;
    if (relT > 0) chg.t0 = 0; else if (G.time - chg.t0 > 4) { chg.off = G.time + 3; chg.t0 = 0; }
  } else chg.t0 = 0;
}

