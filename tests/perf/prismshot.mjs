// 稜鏡折射的畫面截圖（2026-10-12）：前方一隻靶，旁邊、後面散幾隻不會動的靶；一直開火，看碎光是不是射向旁邊的靶
//   用法：node perf/prismshot.mjs <輸出資料夾>
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
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'laser', path: 'A', final: null }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = [[220, 0], [160, -170], [330, 150], [60, 160], [420, -60]].map(([dx, dy]) => {
    const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.hp = e.maxHp = 5000; return e;
  });
  Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 200; Input.my = innerHeight / 2;
});
await wait(600);
for (let i = 1; i <= 2; i++) {
  await p.screenshot({ path: `${dir}/雷射_稜鏡折射${i}.png` });
  console.log(i, await p.evaluate(() => `碎光 ${Game.bullets.filter(q => q.shard).length} 顆`));
  await wait(170);
}
await b.close();
