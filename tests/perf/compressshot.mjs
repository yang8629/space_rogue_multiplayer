// 電漿補強的畫面截圖（2026-10-12）：壓縮（往內收的吸入光圈、被吸過去的軌跡）、增殖（追蹤的小電漿）
//   右邊擺一群不會動的靶（散在 150 內外），瞄著打；壓縮連拍 6 張抓 0.3 秒的光圈
//   用法：node perf/compressshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
const setup = (path, final, list) => p.evaluate((path, final, list) => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'plasma');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'plasma', path, final }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = list.map(([dx, dy]) => {
    const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; return e;
  });
  Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 260; Input.my = innerHeight / 2;
}, path, final, list);
// 壓縮：一隻在正前方，其他散在牠周圍 90～140（會被吸過去）
await setup('C', 1, [[260, 0], [260, -130], [260, 130], [380, -90], [380, 90], [150, -110], [150, 110]]);
const shrink = () => p.evaluate(() => FX.rings.filter(r => r.shrink).map(r => (r.life / r.max).toFixed(2)).join(','));
let saved = 0;
for (let i = 0; i < 40 && saved < 3; i++) {
  await wait(30);
  const s = await shrink();
  if (s && +s.split(',')[0] > 0.3 && +s.split(',')[0] < 0.8) { saved++; await p.screenshot({ path: `${dir}/電漿_壓縮${saved}.png` }); console.log('壓縮', saved, '收縮光圈剩', s); await wait(400); }
}
if (!saved) console.log('壓縮：沒抓到收縮光圈');
// 增殖：前方一隻，後面兩側散開（小電漿要轉彎追過去）
await setup('A', 0, [[220, 0], [330, -150], [330, 150], [420, -60], [420, 60], [500, -200], [500, 200]]);
await wait(900);
await p.screenshot({ path: `${dir}/電漿_增殖.png` });
console.log('增殖', await p.evaluate(() => `小電漿 ${Game.bullets.filter(b => b.shard).length} 顆、追蹤 ${Game.bullets.filter(b => b.shard && b.homing > 0).length} 顆`));
await b.close();
