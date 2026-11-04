# 原T115合同

只读权威用例：`/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/测试用例.md`，读取时SHA `bae06ca825fc005fe9a147cc9b846762b2347f2c947413268398596aac540347`。

| M12-T115 | R07.8 | A | 用户正在看 T2 | T1 的 Agent 执行 `tab create`、`tab switch --page <id>`、`tab switch --page <id> --focus true` | 前两条不把用户从 T2 拉走，`tab create` 的新标签在 T1 中不被激活（E3 第 7 项）；`--focus true` 才切换右侧工作区 | — | 待执行 | — |

真实App014 A；T1通过真实终端UI输入RUN后先在合成Agent等待，用户真实UI选T2后放开各gate。前两步T2不变、T1新标签用户activeId保持旧页；第三步必须经实际host shortcut切T1/新页，不由驱动代切。三个真实CLI不重发。

已静态发现App014 show路由忽略其他任务，保持原合同实际留证；不把主进程T1activeId变化当成用户已切换。截图的宿主UI与独立native URL/WC/doc/表单/呈现状态组合判定，不宣称原生整页像素一致。T106不重复，T114不在本组。
