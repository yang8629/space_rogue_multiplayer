// 旋風斬（8 段）、追蹤飛刃的畫面截圖（2026-10-13）：旋風斬四周放 6 隻不會動的靶；追蹤飛刃的靶放在準心偏 30° 的地方，看刃片有沒有彎過去
//   用法：node perf/cycloneshot.mjs <輸出資料夾>
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = process.env.GAME_URL || GAME + 'index.html';  // GAME_URL：試改版
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
const start = (path, final, tg) => p.evaluate((path, final, tg) => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'blade');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'blade', path, final }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = tg.map(([dx, dy]) => { const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.hp = e.maxHp = 1e5; return e; });
  Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 200; Input.my = innerHeight / 2;
}, path, final, tg);
await start('A', 0, [[70, 0], [-70, 0], [0, 70], [0, -70], [50, 50], [-50, -50]]);
await wait(700);
for (let i = 1; i <= 2; i++) { await p.screenshot({ path: `${dir}/相刃_旋風斬${i}.png`, clip: { x: 340, y: 160, width: 600, height: 400 } }); await wait(130); }
console.log('旋風斬', await p.evaluate(() => `刃片 ${Game.bullets.length} 道、被砍到的靶 ${Game.enemies.filter(e => e.hp < e.maxHp).length}/6`));
const a = 30 * Math.PI / 180;
await start('B', 0, [[Math.cos(a) * 260, Math.sin(a) * 260]]);
await wait(700);
for (let i = 1; i <= 2; i++) { await p.screenshot({ path: `${dir}/相刃_追蹤飛刃${i}.png` }); await wait(90); }
console.log('追蹤飛刃', await p.evaluate(() => { const e = Game.enemies[0]; return `偏 30° 的靶${e.hp < e.maxHp ? '被打中' : '沒被打中'}（掉 ${Math.round(e.maxHp - e.hp)}）`; }));
await b.close();
