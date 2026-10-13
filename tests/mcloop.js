// 偶發失敗：同一項機制檢查重複跑 N 次，印失敗率和每次失敗的內容（同樣的內容只印一次）
// 用法：node mcloop.js 黑洞 --n=200   （名稱要完全一樣）
const T_ = require('./load_game').loadGame();
const name = process.argv[2], N = +(process.argv.find(a => a.startsWith('--n=')) || '--n=100').slice(4);
const M = T_.MechCheck, c = M.CASES.find(x => x[1] === name);
if (!c) { console.log('找不到這一項：' + name); process.exit(1); }
const fails = new Map(); let bad = 0;
for (let i = 0; i < N; i++) {
  // 跟 runAll 一樣先存 Game 的欄位，跑完還原（各次之間互不影響）
  const saved = {}; for (const k of Object.keys(T_.Game)) if (typeof T_.Game[k] !== 'function') saved[k] = T_.Game[k];
  M.running = true;
  let r; try { r = c[3](M); } catch (e) { r = { ok: false, got: '執行錯誤：' + e.message }; }
  M.running = false; Object.assign(T_.Game, saved);
  if (!r.ok) { bad++; fails.set(r.got, (fails.get(r.got) || 0) + 1); }
}
console.log(`${name}：${N} 次失敗 ${bad} 次`);
for (const [g, k] of fails) console.log(`  ×${k} ${g}`);
