// 精英詞綴截圖：三隻精英並排（左：護盾＋統帥，旁邊有被加成的小兵；中：磁場＋狂暴；右：佈雷，地上幾顆地雷），
//   出場橫幅（3 個詞綴）＋下方的精英血條。另一張：閃現的落點紅圈。
//   用法：node perf/eliteshot.mjs   → art_lab/screenshots/精英詞綴.png、精英詞綴_閃現.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
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
  const put = (type, dx, dy) => { const e = new Enemy(type, P.x + dx, P.y + dy, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; Game.enemies.push(e); return e; };
  const A = put('elite', -330, -150), B = put('elite', 0, -190), C = put('elite', 330, -150);
  A.setAffixes(['shield', 'command'], P.x, P.y); B.setAffixes(['field', 'rage'], P.x, P.y); C.setAffixes(['mine'], P.x, P.y);
  B.enraged = true;
  const kids = [[-420, -60], [-250, -40], [-330, -300]].map(([x, y]) => put('swarmer', x, y));
  const mines = [[260, -60], [330, -40], [400, -80], [300, 10]];
  window.__hold = setInterval(() => {
    A.shieldA = Math.atan2(P.y - A.y, P.x - A.x);
    for (const k of kids) k.ledT = 1;
    B.hp = B.maxHp * 0.4; A.hp = A.maxHp * 0.7;
    Game.eBullets = Game.eBullets.filter(x => !x.mine).concat(mines.map(([x, y], i) => ({ x: P.x + x, y: P.y + y, vx: 0, vy: 0, r: AFFIX.mine.size, dmg: 20, life: i === 0 ? 1.5 : 6, mine: true })));
    P.x = Arena.start.x; P.y = Arena.start.y + 120;
  }, 16);
  const R = ['split', 'rage', 'blink'];
  bannerFx(`⚠ ${eliteName({ affixes: R, t: ENEMY_TYPES.elite })}`, R.map(id => `${AFFIX[id].name}：${AFFIX[id].desc}`).join('　'), 30);
});
await new Promise(r => setTimeout(r, 1200));
await p.screenshot({ path: SHOTS + '精英詞綴.png' });
console.log('存好 精英詞綴.png');
// 閃現：落點紅圈（往內縮）
await p.evaluate(() => {
  clearInterval(window.__hold);
  const P = Game.player; Game.enemies = []; Game.eBullets = [];
  const e = new Enemy('elite', P.x - 200, P.y - 150, 1); e.spawnT = 0; e.hx = e.x; e.hy = e.y;
  e.setAffixes(['blink'], P.x, P.y); e.skillCd = 1e9; e.t = { ...e.t, speed: 0 };
  Game.enemies.push(e);
  e.hurt(e.maxHp * 0.25, 0, 0);
});
await new Promise(r => setTimeout(r, 120));
await p.screenshot({ path: SHOTS + '精英詞綴_閃現.png' });
console.log('存好 精英詞綴_閃現.png');
await b.close();
