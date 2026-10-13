import puppeteer from 'puppeteer-core';
const [url, out, w = '1200', h = '1400'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: +w, height: +h } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: out, fullPage: true });
await b.close();
