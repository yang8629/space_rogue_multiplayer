#!/bin/sh
# 依序重跑：晶片價值表（單晶片）→ 兩兩組合 → 整局模擬（每把武器 60 局）。同時最多 4 個程序（CPU 溫度）
# 跑的時候不要改遊戲檔案（程序啟動時才載入程式碼，中途改了會出錯）
cd "$(dirname "$0")"
date > rerun_all.log
node chipvalue.js --n=20 --save --jobs=4 > value_single.log 2>&1; echo "single exit $?" >> rerun_all.log; date >> rerun_all.log
node chipvalue.js --pairs --n=10 --save --jobs=4 > value_pairs.log 2>&1; echo "pairs exit $?" >> rerun_all.log; date >> rerun_all.log
for w in laser scatter plasma railgun; do node runsim.js --n=60 --w=$w > runsim_$w.log 2>&1 & done
wait
node runsim.js --n=60 --w=blade > runsim_blade.log 2>&1
echo "runsim done" >> rerun_all.log; date >> rerun_all.log
