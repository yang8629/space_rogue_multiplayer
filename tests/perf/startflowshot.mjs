// 新玩家開局會看到的畫面（不按 Shift）→ art_lab/screenshots/開局_*.png
//   標題、選飛船（＋按 Shift 的詳細說明）、選武器、起始晶片、第一次的航圖、第一場戰鬥
//   新手引導：第一次開遊戲自動進（假裝不是自動化瀏覽器）、每一段、按住 Esc、大廳的終端機
//   用法：node perf/startflowshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.clear(); localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); });
const shot = async name => { await wait(500); await p.screenshot({ path: SHOTS + `開局_${name}.png` }); };
await shot('1標題');
await p.evaluate(() => Screen.title()); await shot('2選飛船');
await p.evaluate(() => document.body.classList.add('detail')); await shot('2選飛船_詳細');
await p.evaluate(() => document.body.classList.remove('detail'));
await p.evaluate(() => Screen.chipPick('run', 'vanguard', 'laser')); await shot('4起始晶片');
await p.evaluate(() => Game.newRun('run', 'vanguard', 'laser', NORMAL_IDS[0])); await shot('5航圖');
await p.evaluate(() => { const n = Game.reachable()[0]; Game.enterNode(n); }); await wait(1500); await shot('6第一場戰鬥');
// 新手引導：自動化瀏覽器（navigator.webdriver）平常不自動進，這裡假裝是一般瀏覽器、清掉存檔，看第一次開遊戲是不是直接進引導
const p2 = await b.newPage();
p2.on('pageerror', e => console.log('頁面錯誤', e.message));
await p2.evaluateOnNewDocument(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
await p2.goto(GAME + 'index.html');
await p2.evaluate(() => { try { localStorage.clear(); localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p2.reload(); await wait(1800);
const shot2 = async name => { await wait(500); await p2.screenshot({ path: SHOTS + `開局_${name}.png` }); };
console.log('第一次開遊戲：', await p2.evaluate(() => `${Game.mode} / ${Game.state}`));
await p2.evaluate(() => SFX.setMuted && SFX.setMuted(true));
await shot2('7引導1移動');
await p2.evaluate(() => Tutorial.go(1)); await wait(800); await shot2('7引導2射擊');
await p2.evaluate(() => { Tutorial.go(2); Input.down = true; }); await wait(1500); await p2.evaluate(() => { Input.down = false; }); await shot2('7引導3排熱');
// 三選一：泡泡框依序（點畫面換下一個），最後指定選晶片
await p2.evaluate(() => Tutorial.go(3)); await wait(1500); await shot2('7引導4三選一_1晶片');
for (const [k, name] of [[2, '插件'], [3, '零件'], [4, '選這張']]) { await p2.click('.bb-cover'); await shot2(`7引導4三選一_${k}${name}`); }
await p2.evaluate(() => Game.takeReward(Game.reward.only)); await wait(1200);
await wait(300); await p2.evaluate(() => { const d = Game.enemies[0]; Input.mx = (d.x - Game.cam.x) * ZOOM; Input.my = (d.y - Game.cam.y) * ZOOM; Input.down = true; });  // 瞄準第一個標靶
await wait(2500); await shot2('7引導5晶片觸發');  // 邊射邊拍
console.log('晶片傷害：', await p2.evaluate(() => JSON.stringify(Game.runStats.chips)));
await p2.evaluate(() => { Input.down = false; });
await wait(800); await p2.evaluate(() => Game.toggleEditor()); await shot2('7引導6插件_電路');
await p2.click('.bb-cover'); await shot2('7引導6插件_電路_收起');
await p2.evaluate(() => { Game.toggleEditor(); Tutorial.go(6); }); await wait(2500); await shot2('7引導7實戰');
await p2.evaluate(() => { Tutorial.go(7); }); await wait(1500); await shot2('7引導8精英');
await p2.evaluate(() => Tutorial.escDown()); await wait(400); await p2.screenshot({ path: SHOTS + '開局_7引導9按住Esc.png' });
await wait(1200); console.log('按住 Esc 之後：', await p2.evaluate(() => `${Game.mode} / ${Game.state}、看過 ${Save.flag('tutorial', false)}`));
await p2.evaluate(() => { const z = HUB.zones.find(q => q.id === 'tutorial'); Hub.build(z.x + 50, z.y, Math.PI); }); await wait(800); await shot2('8大廳_新手引導終端機');
await b.close();
console.log('done');
