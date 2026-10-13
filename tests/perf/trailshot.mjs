// 軌道砲「殘留彈道」截圖（2026-10-09）：邊掃邊射，身前留一片電軌；敵人慢慢走過來碰到電軌
//   用法：node perf/trailshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'railgun');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'railgun', path: 'A', final: 0 }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = [[420, -160], [480, 0], [420, 160], [540, -80], [540, 80]].map(([dx, dy]) => {
    const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 25, dmg: 0, ranged: null }; return e;
  });
  Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 300; Input.my = innerHeight / 2;
});
// 準心上下掃
for (let i = 0; i < 14; i++) { await p.evaluate(i => { Input.my = innerHeight / 2 + Math.sin(i * 0.9) * 220; }, i); await wait(110); }
await p.screenshot({ path: `${dir}/軌道_殘留彈道.png` });
console.log(await p.evaluate(() => `電軌 ${Game.trails.length} 條、敵人剩血 ${Game.enemies.map(e => Math.round(e.hp)).join('/')}`));
await b.close();
