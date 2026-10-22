// 新精英截圖：砲艦（蓄力）、拖曳艦（牽引光束連到飛船）、三艦編隊（交叉齊射的預警線）、虛空獵手並排；
//   另一張：砲艦真的開打（砲擊的落點紅圈）＋拖曳艦鎖定的預警線
//   用法：node perf/newelitesshot.mjs   → art_lab/screenshots/新精英.png、新精英_放大.png、新精英_開打.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2000));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9;
  Input.autoFire = false;
  Game.combat.pending = []; Game.enemies = [];
  P.x = Arena.start.x; P.y = Arena.start.y + 120;
  const put = (type, dx, dy) => { const e = new Enemy(type, P.x + dx, P.y + dy, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; Game.enemies.push(e); return e; };
  const A = put('artillery', -440, -170), T = put('tractor', -170, -240), H = put('elite', 440, -170);
  const W0 = put('wing', 190, -300); Game.makeFleet(W0);
  const F = W0.fleet;
  F.members.forEach((m, i) => { const a = i / 3 * Math.PI * 2 - Math.PI / 2; m.x = m.hx = W0.hx + Math.cos(a) * 75; m.y = m.hy = W0.hy + 75 + Math.sin(a) * 75; m.spawnT = 0; m.frozen = true; });
  A.setAffixes(['rage'], P.x, P.y); T.setAffixes(['shield'], P.x, P.y);
  window.__hold = setInterval(() => {
    P.x = Arena.start.x; P.y = Arena.start.y + 120;
    A.mode = 'windup'; A.modeT = 0.15; A.chargeA = Math.atan2(P.y - A.y, P.x - A.x);
    T.mode = 'pull'; T.tgt = 1; T.chargeA = Math.atan2(P.y - T.y, P.x - T.x); T.shieldA = T.chargeA; T.hp = T.maxHp * 0.6;
    for (const m of F.members) { m.mode = 'windup'; m.modeT = 0.3; m.chargeA = Math.atan2(P.y - m.y, P.x - m.x); }
    F.members[2].hp = F.members[2].maxHp * 0.4;
  }, 16);
  const R = ['shield', 'mine'];
  bannerFx(`⚠ ${eliteName({ affixes: R, t: ENEMY_TYPES.wing })}`, affixBrief(R), 30);
});
await new Promise(r => setTimeout(r, 1200));
await p.screenshot({ path: SHOTS + '新精英.png' });
console.log('存好 新精英.png');
// 放大看美術：畫面放大 3 倍，只截精英那一排
await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 3 }); await new Promise(r => setTimeout(r, 600));
await p.screenshot({ path: SHOTS + '新精英_放大.png', clip: { x: 140, y: 30, width: 800, height: 220 } });
await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
console.log('存好 新精英_放大.png');
// 開打：砲艦砲擊（落點紅圈）、拖曳艦鎖定（紅色預警線）
await p.evaluate(() => {
  clearInterval(window.__hold);
  const P = Game.player; Game.enemies = []; Game.eBullets = []; Game.zones = [];
  P.x = Arena.start.x; P.y = Arena.start.y + 120;
  const a = new Enemy('artillery', P.x - 380, P.y - 260, 1); a.spawnT = 0; a.skillCd = 0; a.shotCd = 1e9;
  const t = new Enemy('tractor', P.x + 320, P.y - 120, 1); t.spawnT = 0; t.skillCd = 0.9; t.shotCd = 1e9;
  Game.enemies.push(a, t);
});
await new Promise(r => setTimeout(r, 1450));
await p.screenshot({ path: SHOTS + '新精英_開打.png' });
console.log('存好 新精英_開打.png');
await b.close();
