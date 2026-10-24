// 把 assets/sfx/*.ogg 包成 assets/sfx_data.js（globalThis.SFX_DATA = { 名稱: base64 }）
//   遊戲用 file:// 開的時候不能 fetch 音檔，所以跟圖集一樣直接嵌進 js；換音檔、加音檔之後在遊戲資料夾跑：node tools/audio/build_sfx.js
//   哪個聲音用哪個檔、音量多大：js/system/audio.js 的 SFX_FILE；音檔來源和授權：assets/sfx/LICENSE.txt
'use strict';
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', '..', 'assets', 'sfx');
const out = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ogg')).sort()) out[f.slice(0, -4)] = fs.readFileSync(path.join(dir, f)).toString('base64');
const js = `// 自動產生（tools/audio/build_sfx.js），不要手改；音檔在 assets/sfx/（Kenney，CC0）\nglobalThis.SFX_DATA = ${JSON.stringify(out)};\n`;
fs.writeFileSync(path.join(dir, '..', 'sfx_data.js'), js);
console.log(`assets/sfx_data.js：${Object.keys(out).length} 個音檔，${Math.round(js.length / 1024)} KB`);
