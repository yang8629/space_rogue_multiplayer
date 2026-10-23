// 小行星的視野陰影：飛船周圍放幾顆小行星，截一張 → art_lab/screenshots/新畫面_視野陰影.png
//   用法：node perf/shadowshot.mjs [belt|wall]（wall：第 1 星區大地圖、岩石洞壁）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const BELT = process.argv[2] === 'belt' ? true : process.argv[2] === 'wall' ? 'wall' : false;  // belt：一排小行星（小行星帶），飛船站在一端、旁邊有黑洞
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const imgs = [];
for (const mode of ['gl']) {  // 舊畫面（2D）10-09 拿掉了
  await p.goto(url);
  await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, mode);
  await p.reload(); await wait(2500);
  const info = await p.evaluate((process_belt) => {
    SFX.setMuted && SFX.setMuted(true);
    if (process_belt === 'wall') {  // 大地圖（第 1 星區的牆）
      for (let seed = 0; seed < 20; seed++) { Game.newRun('run', 'vanguard', 'laser'); Game.sector = 1; Game.node = { type: 'combat', L: 3, id: 'w' }; Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 }); if (GLWorld.styleOf() === 'rock') break; }
      GLWorld.builtLoops = null;
    } else Game.newRun('sandbox', 'vanguard', 'laser');
    const q = Game.player; q.hp = q.maxHp = 1e9; q.invuln = true; Game.enemies = []; Game.eBullets = []; if (Game.combat) { Game.combat.spawnT = 1e9; Game.combat.pending = []; }
    const rock = (dx, dy, r) => ({ type: 'rock', x: q.x + dx, y: q.y + dy, r, hp: 60, maxHp: 60 });
    Game.objs = process_belt ? Array.from({ length: 9 }, (_, i) => rock(-90 - i * 70, -60 - i * 45, 22 + (i % 3) * 5)) : [rock(40, 220, 26), rock(70, 270, 22), rock(-250, -60, 34), rock(200, -150, 30)];
    Game.objs.push({ type: 'hole', x: q.x - 420, y: q.y + 60, r: 30, R: 220, tick: 0 });
    if (Objects.buildGrid) Objects.buildGrid();
    window.__hold = setInterval(() => { Game.player.x = q.x; Game.player.y = q.y; }, 5);
    return { px: Math.round(q.x), py: Math.round(q.y), rocks: Game.objs.map(o => [Math.round(o.x), Math.round(o.y), o.r]) };
  }, BELT);
  await wait(800);
  console.log(mode, JSON.stringify(info));
  imgs.push([mode === 'gl' ? '新畫面' : '舊畫面', await p.screenshot({ encoding: 'base64' })]);
}
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;flex-direction:column;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:960px;height:540px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 976, height: 8 + imgs.length * 580 });
await p.screenshot({ path: `${OUT}新畫面_視野陰影.png` });
await b.close();
console.log('done');
