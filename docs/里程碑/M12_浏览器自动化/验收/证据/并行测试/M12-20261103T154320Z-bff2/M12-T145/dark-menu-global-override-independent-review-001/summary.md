确认Root最小修复正确：m6.css445的:root.ydark [role=menu]特异性0,3,0盖过browser .bw-menu 0,1,0；actual两dark raw均rgba(29,29,29,.96)，与#1d1d1df5吻合。P与browser原声明均为--bg #181818、--border #303030。边框raw未采，#535353为源winner和Root原图83观察，不冒称本次新computed。

建议仅:root.ydark .bw-menu[role=menu]{background:var(--bg);border-color:var(--border)}，特异性0,4,0；不会碰全局/M9菜单。实际top86/220x238/七行/disabled muted .45 default transparent和containment已记录，修复不改变这些标准。Root新包实际核dark bg24不透明+border48与原图；旧dark2不接受，light2沿Root接受。

无App/Native/Node/OS/HTTP/CLI；本次未重看图片，不造新视觉执行声明。资源0。
