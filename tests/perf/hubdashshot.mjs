// 基地衝刺效果截圖：每艘船在基地衝刺一次（先鋒號瞬移、幻影號殘影、星門號星門、哨兵號砲台打標靶機），另外檢查換船留在原地
//   → art_lab/screenshots/基地衝刺_<船>.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
await p.evaluate(() => { CFG.UNLOCK_ALL = true; Input.mouseMoved = false; });
for (const [id, wait] of [['vanguard', 120], ['wraith', 300], ['gate', 400], ['sentry', 1500], ['bulwark', 120]]) {
  const r = await p.evaluate((id) => {
    Hub.dfx = []; Hub.puffs = []; Hub.setShip(id); Hub.ship.dashCd = 0;
    const T = HUB.targets[0], s = Hub.ship;  // 站在標靶機左邊 260，朝右衝
    s.x = T.x - 260; s.y = T.y; s.vx = s.vy = 0; s.aim = 0; Hub.follow();
    Input.keys.add('d'); Input.dash = true;
    return { x0: Math.round(s.x) };
  }, id);
  await new Promise(res => setTimeout(res, wait));
  const after = await p.evaluate(() => { Input.keys.delete('d'); return { x: Math.round(Hub.ship.x), fx: Hub.dfx.map(f => f.k).join(','), puffs: Hub.puffs.length, shots: Hub.shots.length }; });
  console.log(`${id}：起點 x=${r.x0} → 現在 x=${after.x}｜效果 ${after.fx || '無'}｜粒子 ${after.puffs}｜子彈 ${after.shots}`);
  await p.screenshot({ path: SHOTS + `基地衝刺_${id}.png` });
}
// 換船：站在別艘船的停機位旁邊（不在正中）按 E 換，位置不變
const sw = await p.evaluate(() => {
  Hub.setShip('vanguard'); const z = Hub.zone('pad:wraith'), s = Hub.ship;
  s.x = z.x + 20; s.y = z.y + 15; const before = [s.x, s.y];
  const ok = Hub.pick('wraith');
  return { ok, same: s.x === before[0] && s.y === before[1], ship: Hub.shipId };
});
console.log(`換船：換成功 ${sw.ok}、${sw.ship}、位置沒動 ${sw.same}`);
await b.close();
