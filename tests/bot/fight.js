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
  // 星環守門者的砲塔（2026-10-19）：熟練玩家會先拆砲塔（召喚砲塔最優先，不然蟲群打不完、一直打不到核心）。
  //   身邊 150 內沒有其他敵人時瞄準最近的砲塔（召喚的先），走位也以它為準；以前一直打召喚出來的蟲群，400 秒核心只掉 5%
  const tur = E.filter(e => e.t.turret).sort((a, b) => (b.type === 'wt_call') - (a.type === 'wt_call') || Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
  if (tur && !E.some(e => !e.t.turret && !e.t.boss && Math.hypot(e.x - p.x, e.y - p.y) < 150)) {
    const td = Math.hypot(tur.x - p.x, tur.y - p.y) || 1;
    if (td < CFG.AUTO_RANGE) I.aimStick = { bx: 0, by: 0, x: (tur.x - p.x) / td * 60, y: (tur.y - p.y) / td * 60 };
    near = tur; nd = td;
  }
  // 警報艇響著（被打到過，CFG.ALARM）：真人會先集火打掉（它邊逃邊叫醒附近的敵人）。瞄準它；身邊 150 內沒有其他敵人時走位也以它為準
  const alm = E.find(e => e.t.alarm && e.ringT != null);
  if (alm) {
    const ad = Math.hypot(alm.x - p.x, alm.y - p.y) || 1;
    if (ad < CFG.AUTO_RANGE) I.aimStick = { bx: 0, by: 0, x: (alm.x - p.x) / ad * 60, y: (alm.y - p.y) / ad * 60 };
    if (!E.some(e => e !== alm && Math.hypot(e.x - p.x, e.y - p.y) < 150)) { near = alm; nd = ad; }
  }
  // 寶藏無人機會逃、15 秒後躍遷離開：真人看到會去追。身邊 150 內沒有其他敵人時，瞄準和走位都以它為準
  const tre = E.find(e => e.t.treasure);
  if (tre && !E.some(e => e !== tre && Math.hypot(e.x - p.x, e.y - p.y) < 150)) {
    const td = Math.hypot(tre.x - p.x, tre.y - p.y) || 1;
    if (td < CFG.AUTO_RANGE) I.aimStick = { bx: 0, by: 0, x: (tre.x - p.x) / td * 60, y: (tre.y - p.y) / td * 60 };
    near = tre; nd = td;
  }
  // 蜂群打旗艦（使用者 10-23：無人機打附近的，玩家要自己把無人機擺到王旁邊）：旗艦在無人機飛得到的距離內（牽繩＋射程）、沒有要先拆的砲塔
  //   → 準星放在旗艦上（滑鼠模式才指得到距離；自動攻擊的準星距離 = 最近的敵人，無人機會飛去打身邊的護衛）
  const bossD = E.find(e => e.t.boss);
  if (G.weapon.id === 'drone' && bossD && !tur && Math.hypot(bossD.x - p.x, bossD.y - p.y) < DRONE.leash + DRONE.range) {
    I.touch = false; I.mx = (bossD.x - G.cam.x) * ZOOM; I.my = (bossD.y - G.cam.y) * ZOOM; I.down = true;
  }
  // 保持在射程七成的距離（最多 360）；佈雷：站在地雷停住的距離（射程一半），地雷才會落在敵人附近
  const wp = G.wp, R = wp.speed * wp.life;
  let want = Math.max(70, Math.min(360, R * 0.7));
  if (hasChip('stasis')) want = Math.max(70, R * 0.5);
  // 站的距離不超過自動攻擊的索敵距離（最多 560）：以前裝加速（已拿掉的晶片）要站 700 外，自動攻擊鎖不到、六成時間沒開火
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
  // 偶數段的扇形（相刃 2 段、雷射連發）正中間沒有子彈：越遠兩段之間的空隙越寬，會從小目標兩邊擦過（2026-10-16）
  //   飛刃（射程 515、2 段夾角 0.35）站 400 打母巢（半徑 30）：兩段各偏開瞄準線約 70，900 秒 0 次命中，整局模擬卡住
  //   站到空隙蓋得住目標的距離（最近 110：小隻的蟲群不貼上去）；以前只對母巢、旗艦，盾衛（半徑 20）也一樣：飛刃站 320、刃片偏開 50，
  //   相刃整局模擬一區打 400 秒（2026-10-16，警戒之後敵人一群一群來，常常只剩一隻慢慢走的）
  if (near && wp.count > 1 && wp.count % 2 === 0 && wp.spread > 0) {
    const half = wp.spread / (wp.count - 1) / 2;
    want = Math.min(want, Math.max(110, (near.r + wp.radius) * 0.85 / Math.sin(half)));
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
  // 十字彈流（裂界獵艦）不另外寫走位：交給預測式閃避（dodgeDir）。10-17 寫過「靠近到 190、待在兩條彈流中間」（當時閃避是推力加總），
  //   換成預測式閃避後反而拖後腿：bossfight.js boss2 24 場總掉血 3002 → 拿掉後 1807（10-23）
  if (G.time < (unstick.until || 0) && near) { const ux = (near.x - p.x) / nd, uy = (near.y - p.y) / nd; mx = -uy * unstick.side + ux * 0.3; my = ux * unstick.side + uy * 0.3; navOn = true; }
  if (AR.rect) {  // 別貼牆（離中心 500 以上往回拉）；但最近的敵人縮在牆邊（150 內）時要追過去，不然打不到角落的彈幕艇
    const cx = W / 2 - p.x, cy = H / 2 - p.y, cd = Math.hypot(cx, cy);
    const nearWall = near && Math.min(near.x, near.y, W - near.x, H - near.y) < 150;
    if (cd > 500 && !nearWall) { mx += cx / cd; my += cy / cd; }
  } else if (!nav) {  // 大地圖：離牆 110 內往空地推（越近越用力）
    const v = AR.f(p.x, p.y);
    if (v < 110) { const [gx, gy] = AR.grad(p.x, p.y), w = (110 - v) / 110 * 1.5; mx += gx * w; my += gy * w; }
  }
  // 閃子彈（熟練玩家，2026-10-22 改成預測式）：照原本想走的方向往前推 0.6 秒，會被打到就改走 16 個方向（＋原地）裡最安全、最接近原本方向的那個
  //   以前是每顆子彈往側邊推、推力加總：兩邊都有子彈時互相抵銷，打裂界獵艦跟完全不閃只差約兩成（bossfight.js boss2，每把 2 場）
  // 逆襲（散彈升級）：爆發沒開、HP 一半以上 → 不閃子彈，故意吃一發換爆發（衝撞照樣閃：太痛）
  const bait = G.wpOf(p).revenge && !(p.revengeT > 0) && p.hp > p.maxHp * 0.5;
  threat = 0;
  for (const b of G.eBullets) {  // 精英「佈雷」的地雷（不會動）：靠近 110 內就往外繞（越近越急）
    if (!b.mine) continue;
    const rx = p.x - b.x, ry = p.y - b.y, d = Math.hypot(rx, ry);
    if (d < 110) { const w = 2.5 * (1 - d / 110); mx += rx / (d || 1) * w; my += ry / (d || 1) * w; threat += w; }
  }
  const dodge = bait ? null : dodgeDir(p, mx, my);
  if (dodge) { mx = dodge.x; my = dodge.y; threat += dodge.w; }
  // 落點紅圈（終焉核心的轟炸、砲艦的砲擊，2026-10-19 加）：在圈裡（含飛船半徑＋20）就往圈外走，越快爆越急
  //   以前完全不躲：砲艦精英每 3 秒 3 個圈，電腦站著吃
  // 標記圈（王的招式，2026-10-24）：集合圈（圈外受傷）→ 往圈中心靠；分攤圈 → 被標的人躲不掉（自己一定算一份），快爆時衝刺（無敵時間）；
  //   別人往圈裡靠幫忙分（熟練玩家的打法）
  let markDash = false;
  for (const z of G.zones) {
    if (!z.kind || z.kind === 'bomb') continue;
    const me = z.slot === G.slotOf(p), dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy) || 1;
    if (z.kind === 'share' && me) { if (z.t < 0.15) markDash = true; continue; }
    if (d > z.r * 0.6) { const w = 4; mx += dx / d * w; my += dy / d * w; threat += w; }
  }
  for (const z of G.zones) {
    if (z.kind && z.kind !== 'bomb') continue;
    const rx = p.x - z.x, ry = p.y - z.y, d = Math.hypot(rx, ry) || 1, R = z.r + p.r + 20;
    if (d > R) continue;
    const w = 3 + 3 * (1 - Math.max(0, z.t) / (z.max || 1)); mx += rx / d * w; my += ry / d * w; threat += w;
  }
  // 旗艦的光束（雙子獵艦中間的、星環守門者的旋轉光束，2026-10-19 加）：離光束 80 內就往垂直方向離開（預警線也躲，越近越急）；
  //   壓在光束上、衝刺好了就衝刺（衝刺有無敵時間，直接穿過去）
  let beamHit = false;
  for (const B of G.bossBeams()) {
    const vx = B.x2 - B.x1, vy = B.y2 - B.y1, L2 = vx * vx + vy * vy || 1, u = Math.max(0, Math.min(1, ((p.x - B.x1) * vx + (p.y - B.y1) * vy) / L2));
    const cx = B.x1 + vx * u, cy = B.y1 + vy * u, rx = p.x - cx, ry = p.y - cy, d = Math.hypot(rx, ry) || 1, R = p.r + B.w / 2 + 80;
    if (d > R) continue;
    const w = (B.warn ? 2 : 4) * (1 - d / R) + 1; mx += rx / d * w; my += ry / d * w; threat += w;
    if (!B.warn && d < p.r + B.w / 2 + 12) beamHit = true;
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
  //   自己勾住的不算（暈住、被拉在身前 HOOK.hold；以前一直往外推、浪費衝刺，牽引鉤扯完才甩時整局 0%，2026-10-22）
  const held = new Set([p.hookE, ...(p.hookX || [])]);
  for (const e of all) {
    if (held.has(e)) continue;
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
  const m = 60;
  I.joy = l > 0.01 ? { bx: 0, by: 0, x: mx / l * m, y: my / l * m } : null;
  if (chase) I.dash = true;
  if (inHole && G.time - holeStuck.t > 2 && p.dashCd <= 0) I.dash = true;  // 黑洞裡被拖住：往外衝
  const danger = ramHit || beamHit || markDash || (dodge && dodge.hitT < 0.15) || nd < 40;  // 怎麼走都會在 0.15 秒內被打到（含身上的分攤圈快爆）：衝刺（有無敵時間）
  if (danger && p.dashCd <= 0) I.dash = true;
  // 拖曳艦的牽引光束拉住自己（2026-10-19）：往遠離牠的方向衝刺掙脫（熟練玩家看到光束就衝）；衝刺還沒好就先往外走
  const me = G.slotOf(p), puller = all.find(e => e.mode === 'pull' && e.tgt === me);
  if (puller) {
    const dx = p.x - puller.x, dy = p.y - puller.y, d = Math.hypot(dx, dy) || 1;
    I.joy = { bx: 0, by: 0, x: dx / d * 60, y: dy / d * 60 };
    if (p.dashCd <= 0) I.dash = true;
  }
}

// 照配裝打：電路上有這些玩法晶片時，刻意照它們的玩法打（可以同時好幾種）
//   反向：背對敵人射；衝刺射擊：安全時朝敵人衝；環繞：貼近讓繞圈的子彈磨敵人；
//   牆反彈：直接打（打偏的自然會彈回來；2026-09-30 比過：刻意瞄牆比較差）；蓄力：平常照打，血厚的敵人才停火蓄滿再放
const bOf = id => CHIPS[id] ? baseOf(id) : String(id).split(/[~^!]/)[0];  // 晶片 id：base~插座數^等級!稀有 → base
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
// 預測式閃子彈：回傳要改走的方向 { x, y, w = 急迫度, hitT = 最好的方向也會在幾秒後被打到（Infinity = 躲得掉）}；照原本方向走就安全時回傳 null
//   飛船速度照 Player.update 的加速度（每秒 12）推：v(t) = 目標 + (v0 − 目標)·e^(−12t)；子彈照直線飛、到壽命就消失
const DODGE = { T: 0.6, dt: 0.05, n: 16, pad: 4 };
function dodgeDir(p, mx, my) {
  const spd = Math.max(p.ship.speed, Math.hypot(p.vx, p.vy)), reach = spd * DODGE.T + 60;
  const near = b => Math.hypot(b.x - p.x, b.y - p.y) < reach + Math.hypot(b.vx, b.vy) * DODGE.T;
  const B = G.eBullets.filter(b => !b.mine && b.life > 0 && near(b));
  for (const e of G.enemies) if (!e.dead && !(e.spawnT > 0) && Math.hypot(e.vx || 0, e.vy || 0) >= 170 && near(e)) B.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: e.r, life: DODGE.T });  // 高速衝過來的敵人（衝鋒、滾動）也當子彈算
  if (!B.length) return null;
  const hitT = (ux, uy) => {  // 照 (ux, uy) 方向全速走（0, 0 = 停下），幾秒後第一次被打到
    for (let t = DODGE.dt; t <= DODGE.T + 1e-6; t += DODGE.dt) {
      const e = (1 - Math.exp(-12 * t)) / 12, x = p.x + ux * spd * t + (p.vx - ux * spd) * e, y = p.y + uy * spd * t + (p.vy - uy * spd) * e;
      for (const b of B) if (t <= b.life && Math.hypot(b.x + b.vx * t - x, b.y + b.vy * t - y) < p.r + b.r + DODGE.pad) return t;
    }
    return Infinity;
  };
  const l = Math.hypot(mx, my), ux = l > 0.01 ? mx / l : 0, uy = l > 0.01 ? my / l : 0;
  if (hitT(ux, uy) === Infinity) return null;
  let best = null;
  for (let i = 0; i <= DODGE.n; i++) {
    const a = i / DODGE.n * TAU, dx = i < DODGE.n ? Math.cos(a) : 0, dy = i < DODGE.n ? Math.sin(a) : 0, h = hitT(dx, dy);
    const score = Math.min(h, DODGE.T + 1) * 10 + (dx * ux + dy * uy);  // 先比安全（越晚被打到越好），一樣安全再比跟原本方向多接近
    if (!best || score > best.score) best = { x: dx, y: dy, score, hitT: h };
  }
  return { x: best.x, y: best.y, w: 3, hitT: best.hitT };
}
let threat = 0, navOn = false;  // threat：這一幀要閃的子彈有多急（0 = 沒有子彈會打到；baseBot 算）
// navOn：這一幀在繞路／脫困（各晶片的貼近走位先不蓋過去）
const unstick = {};
const holeStuck = { x: 0, y: 0, t: 0 };  // 黑洞裡被拖住多久（見 baseBot）  // 卡住偵測（見 baseBot）
// 新的一局：電腦自己的狀態也歸零（蓄力放開的時間、卡住偵測、出口脫困）
function resetBot() { threat = 0; navOn = false; stall.hp = 0; stall.t = 0; stall.n = 0; for (const k in unstick) delete unstick[k]; for (const k in exitStuck) delete exitStuck[k]; holeStuck.t = 0; }
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
  // 進度：照繞牆路線離閘門還有幾格（Arena.exitFlow），4 秒沒有更接近也算卡住（2026-10-16：貼牆的格子算不到步數，出口方向在兩格之間來回跳，
  //   飛船來回擺 40、只看位移抓不到，卡 278 秒）
  if (d) {
    const F = AR.exitFlow, C = OBJ.FLOW_CELL, st = F ? F.dist[Math.floor(p.y / C) * F.W + Math.floor(p.x / C)] : -1;
    if (S.bk !== p.zone || G.time < S.bt) { S.bk = p.zone; S.best = Infinity; S.bt = G.time; }
    if (st >= 0 && st < S.best) { S.best = st; S.bt = G.time; }
  }
  const noGain = !!d && G.time - S.bt > 4, moved = !S.t0 || G.time < S.t0 || Math.hypot(p.x - S.x, p.y - S.y) > 20;
  if (moved) { S.x = p.x; S.y = p.y; S.t0 = G.time; }
  if ((!moved && G.time - S.t0 > 1.5) || noGain) {
    S.bt = G.time;
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
  if (!goExit(p)) { fightBot(p); flankShield(p); shieldHold(p); }
  goRevive(p);
}
const shieldOff = (e, p) => angleDiff(e.shieldA, Math.atan2(p.y - e.y, p.x - e.x));  // 自己在盾中心的哪一側（0 = 正對盾）
// 往離盾中心遠的那一側繞（加在原本的走位上，繞到盾外再打）；有子彈要閃、正在衝刺時不管
function sidestep(p, e) {
  if (threat > 0 || Input.dash) return;
  const a = Math.atan2(p.y - e.y, p.x - e.x), s = shieldOff(e, p) >= 0 ? 1 : -1, tx = -Math.sin(a) * s, ty = Math.cos(a) * s, j = Input.joy || { x: 0, y: 0 };
  const mx = j.x / 60 + tx * 1.5, my = j.y / 60 + ty * 1.5, l = Math.hypot(mx, my) || 1;
  Input.joy = { bx: 0, by: 0, x: mx / l * 60, y: my / l * 60 };
}
// 精英「護盾」：盾對著自己（±70°）、在 500 內 → 往側邊繞
function flankShield(p) {
  // 只繞精英的護盾詞綴。10-23 試過連普通盾衛也繞（照最近的那隻）：能量刃整局 100 局 44% → 33%、被盾衛反彈打死 17 → 33 局（繞的時候刃片更常掃到盾），撤回
  //   普通盾衛改成近戰才管、繞的時候停火（shieldHold）
  const e = G.enemies.find(o => !o.dead && !(o.spawnT > 0) && o.t.elite && o.shieldA != null && Math.hypot(o.x - p.x, o.y - p.y) < 500);
  if (e && Math.abs(shieldOff(e, p)) <= 1.22) sidestep(p, e);
}
// 近戰（射程 250 內，能量刃）遇到盾對著自己（±70°）的盾衛：不往盾上砍（刃片打到盾反彈回來，近距離閃不掉；10-24 能量刃陣亡 64 局有 26 局是這個）
//   別隻打得到、方向離開盾衛夠遠（刃片扇形一半＋0.3，不會順便掃到盾）→ 改打那隻；沒有 → 停火、往側邊繞到盾外
//   久打不到（stalled，20 秒沒掉血）就不管（精英的盾會跟著轉，一直繞不到）
function shieldHold(p) {
  const wp = G.wp, R = wp.speed * wp.life;
  if (R >= 250 || Input.aimStick || stalled()) return;
  const reach = clamp(R + 40, 140, CFG.AUTO_RANGE), E = G.enemies.filter(e => !e.dead && !(e.spawnT > 0) && !(e.cloak > 0.5));
  const dist = e => Math.hypot(e.x - p.x, e.y - p.y) - e.r;
  const bad = E.filter(e => e.shieldA != null && dist(e) < reach && Math.abs(shieldOff(e, p)) <= 1.22);
  if (!bad.length) return;
  const dir = e => Math.atan2(e.y - p.y, e.x - p.x), gap = wp.spread / 2 + 0.3;
  const ok = E.filter(e => !bad.includes(e) && dist(e) < reach && bad.every(b => Math.abs(angleDiff(dir(b), dir(e))) > gap)).sort((a, b) => dist(a) - dist(b))[0];
  if (ok) { const a = dir(ok); Input.aimStick = { bx: 0, by: 0, x: Math.cos(a) * 60, y: Math.sin(a) * 60 }; return; }
  Input.autoFire = false;
  sidestep(p, bad.sort((a, b) => dist(a) - dist(b))[0]);
}
function fightBot(p) {
  baseBot(p);
  altBot(p);
}
// 右鍵（10-22：招牌動作會觸發電路）：照武器挑時機按（熟練玩家）
function altBot(p) {
  const id = G.weapon.id, W = WEAPON_PLAY[id];
  if (!WEAPONS[id].alt || p.altCd > 0) return;
  const near = (x, y, r) => G.enemies.filter(e => !e.dead && e.spawnT <= 0 && Math.hypot(e.x - x, e.y - y) < r).length;
  const nearB = r => G.eBullets.filter(b => b.life > 0 && Math.hypot(b.x - p.x, b.y - p.y) < r).length;
  const go = id === 'laser' ? (p.hHeat || 0) >= 0.6 && near(p.x, p.y, HEAT.r) >= 1  // 排熱：熱度夠、身邊有怪
    : id === 'scatter' ? W.count(p) >= W.max()  // 召回：飛輪都丟出去了（10-22 試過等停住快消失才收、站一個射程讓飛輪停在敵人身上：整局 5%／10%／兩個一起 0%，都比一丟滿就收的 15% 差）
    : id === 'plasma' ? W.shots(p).some(b => b.mode === 'park' && W.boomN(b) >= 3)  // 塌縮：有井算到 3 隻以上（旗艦照命中點算，跟遊戲同一套）
    : id === 'railgun' ? !!p.hookE && (p.slammed || p.hookT < 0.3)  // 甩擊：扯到重摔之後再甩（勾住快到時間也甩）
    : id === 'blade' ? nearB(PARRY.r * 1.5) > 0  // 彈反：子彈快打到
    : id === 'drone' ? nearB(150) >= 3 : false;  // 收攏：身邊子彈多
  if (go) Input.alt = true;
}

