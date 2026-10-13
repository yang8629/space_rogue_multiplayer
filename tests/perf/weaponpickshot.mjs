// 選武器畫面截圖（2026-10-12 相刃格擋改成要攔截）：一張平常的、一張按住 Shift 展開完整說明
//   用法：node perf/weaponpickshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.weaponSelect('run', 'vanguard'); });
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: `${dir}/選武器_相刃格擋.png` });
await p.keyboard.down('Shift'); await new Promise(r => setTimeout(r, 300));
await p.screenshot({ path: `${dir}/選武器_相刃格擋_詳細.png` });
console.log(await p.evaluate(() => [...document.querySelectorAll('.card')].filter(c => c.textContent.includes('相位刃')).map(c => c.querySelector('.brief').textContent + '｜' + c.querySelector('.ty').textContent).join('\n')));
await b.close();
