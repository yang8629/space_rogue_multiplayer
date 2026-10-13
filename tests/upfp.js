// 武器升級的「指紋」（2026-10-12）：weapons.js 裡那把武器的內容（基礎參數、升級樹）＋升級用到的常數（TRAIL、INFERNO…）
//   武器升級價值表（botsim --upval）、整局模擬（runsim）存檔時記下來；升級健檢（upcheck.js）比對現在的，不一樣 = 表過期要重量
//   只看 weapons.js（說明文字 desc 不算）：效果寫在 game.js／entities.js 的改動抓不到（那種要自己記得重量）；註解不算
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FILE = path.join(__dirname, '..', 'js', 'data', 'weapons.js');

function weaponFp(w, src = fs.readFileSync(FILE, 'utf8')) {
  const lines = src.split(/\r?\n/);
  // 常數：最上面「const 名稱 = …;」那幾行（後面的註解拿掉）
  const consts = {};
  for (const l of lines) { const m = l.match(/^const ([A-Z_]+) = (.*;)/); if (m) consts[m[1]] = m[2].replace(/;\s*\/\/.*$/, ';'); }
  // 這把武器的區塊：「  <武器>: {」到下一把武器（或 WEAPONS 結尾）為止，註解行不算
  const start = lines.findIndex(l => l.startsWith(`  ${w}: {`));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && (/^  [a-z]+: \{/.test(l) || /^\};/.test(l)));
  if (end < 0) end = lines.length;
  const block = lines.slice(start, end).filter(l => !/^\s*\/\//.test(l)).join('\n');
  // 說明文字（desc）不算：只改說明不用重量（2026-10-13）
  const body = block.replace(/desc: (`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')/g, 'desc: _');
  const used = Object.keys(consts).filter(k => k !== 'WEAPONS' && new RegExp(`\\b${k}\\b`).test(body)).sort();
  const text = body + '\n' + used.map(k => `${k} = ${consts[k]}`).join('\n');
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
}

module.exports = { weaponFp };
if (require.main === module) for (const w of ['laser', 'scatter', 'plasma', 'railgun', 'blade']) console.log(w, weaponFp(w));
