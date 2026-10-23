// 戰鬥中船頭的武器：每把武器開一場戰鬥，截飛船附近（放大）→ art_lab/screenshots/戰鬥武器_<武器名>.png
//   用法：node perf/battleweapon.mjs   （武器清單和名字照遊戲的 WEAPONS，加新武器不用改這裡）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await wait(1500);
const names = await p.evaluate(() => Object.entries(WEAPONS).map(([id, W]) => [id, W.name]));
for (const [id, name] of names) {
  const box = await p.evaluate(id => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('run', 'vanguard', id);
    Game.node = { type: 'combat', L: 1, id: 'shot' };
    Game.startCombat({ level: 1, wavesTotal: 3, elites: 0 });
    Game.player.hp = Game.player.maxHp = 1e9;
    const P = Game.player, c = Game.cam;
    return { x: (P.x - c.x) * ZOOM - 90, y: (P.y - c.y) * ZOOM - 70, width: 180, height: 140 };
  }, id);
  await wait(250);
  await p.screenshot({ path: SHOTS + '戰鬥武器_' + name + '.png', clip: Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])) });
}
await b.close();
console.log('done');
