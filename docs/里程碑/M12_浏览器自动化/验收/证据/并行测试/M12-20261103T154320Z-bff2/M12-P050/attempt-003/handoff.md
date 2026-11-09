# M12-P050 attempt003：T098 完整 I、T097 I 复验通过

原 `judge.mjs` 从原始结果独立判定45/45全绿、passed=true，没有修改判据或原始JSON。建议原T098完整I通过；T097本轮I通过，原用例的U层由协调者已有软件证据另外复核合并，执行者不冒称本轮新增U。公共账由协调者归账。

## 原判据与实际结果

保留原六个敏感命令与六个exec负例，另补合法exec cookies get与真实cookies set --curl导入语法。一次实际18条CLI，原stdout/stderr/退出码全部留在driver.raw/host.raw，未自动重发未知写。

- 实际snapshot产生Audit Password的宿主引用，再通过真实CLI fill及stdin填入；只读原生DOM确认密码值/type=password，未使用selector/eval输入替代。storage值同样原生读回匹配。
- set credentials、cookie set、storage local set、fill密码框、set headers（Authorization，保持同一 `--stdin headers`）、cookie get全部成功。真实服务后续请求收到匹配Authorization。M12-S5-STDIN-HEADERS的原红在这里仍为绿。
- 六条命令真实审计和活动详情各自存在，带本轮task/page、成功状态；敏感参数/返回值显示“已脱敏”和长度，五类canary在完整最终活动详情、browser_operations和生产诊断中均不存在；passwordFill=true、M11历史无重复。没有把本应完整的CLI输出当作生产日志泄露。
- 普通cookie get实际CLI返回仍含完整Cookie；新增合法 `exec cookies get` 也返回完整live Cookie，但该兼容命令的持久活动详情/receipt同样不再含canary。它直接补验attempt002的exec结果脱敏缺口，未通过禁止所有exec回避原能力。
- 真正 `--list` 返回82条、21read/61write，无Cookie导入/证书放行/站点权限授予能力。
- 六个原负例现在全部在宿主前置返回 INVALID_INPUT/config/not-started/exit2：cookies import、state load、set ignore-https-errors、set permissions、permissions grant、Browser.grantPermissions。不再让cookies import成功退化为Cookie读取，也不再把两个set未知子命令发送到Helper后才unknown。
- 新增真实原生导入语法 `cookies set --curl /private/tmp/p050-does-not-exist.json` 被“exec包含未允许的参数”前置拒绝，INVALID_INPUT/config/not-started/exit2。来源keyCalls0，站点权限/信任前后不变。

原T097写“拒绝或无效”，本轮有更直接的实际前置拒绝证据，未改成只看退出码。`result.json`逐层归纳，原`adjudication.json`保留全部45项。

## 冻结输入及边界

实际新冻结 `/private/tmp/willyou-m12-p049-browser-audit-011/source`，源清单SHA `3ddc9708d9ce91be982152a97209c3049f30306ac93f570da1642c03aedb18fe`；本次组合source-inputs.json SHA `67de9889032807d4b3896a5231e43fe9f435c20d321da18f952612a83fa58b60`，3451源/静态输入结束后逐SHA全匹配。276实际编译源码、228依赖、246运行资源留在prepared/source-snapshot。没有读取活动源码/out或重打App。

- host.cjs：`7fba0febde40e3684d083fdaedf8c72b2f193758ace0817893aa3cc891562a22`
- static-preflight.json：`95bf3388b3e0197456df85fd082af11878da84916f1bee44b4617eccb79328eb`
- 实际browser bundle：`542e6826d1b9a3aa70ff71057e90deaa24e5275988286a4cc4113b8e05c27658`

原生CLI/Helper二进制与stdin文本语义不变。真实M11 Resource/Session/Run/Gateway/kernel peer/BrowserService/SQLite/history，受管根为实际Python调用方，不是真实模型Agent R或打包App A。token仅经私有内存/stdio，未落盘/argv/日志。

保留P045合成Chrome源/cipher/seed只是未被验收前置，本轮keyCalls0，没有导入、真实OS Keychain或NativeStore计数hook；不能重复计T082。app prohibited、生产park透明nonfocus/showInactive、mock-keychain、私有home/userData/cache/project与loopback服务器，无桌面输入/PTY/剪贴板、日常实例或真实凭据。

attempt001的headers契约红和attempt002的exec持久泄露红及各自manifest保持冻结。原driver本轮只按协调者已提供的新attempt运行，执行者未改生产、驱动步骤或公共结果账。

## 实际运行及精确清场

分开核验固定host/preflight哈希成功后才运行：

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p050-audit-native-003/cache node /private/tmp/willyou-m12-p050-audit-native-003/run.mjs --execute
```

原session82013已exit0。业务/原始清场2026-11-04 10:56:42.297Z至10:57:00.131Z，约18秒；driver80095、host80103、受管根80112。run `d327a843-136e-4b2e-9192-4a07e5989f5c`，task `a6e98128-838b-4395-a21d-bd01b075fb70`，page `f5557edb-2948-474e-92f8-c545f039437c`。

真实Gateway关闭、根实际退出后cli.exited、run停止、Browser/Helper/代理/park销毁、applications/runs关闭、所有WC/debugger收尾，7项全部fulfilled。真实will-quit，App正常exit0/signal=null，无强制终止。2个WC全部destroyed/debugger未附着，windows0、allRemaining空，HTTP服务关闭。

独立ps/lsof核26个精确PID全部absent：

`80095,80103,80105,80106,80112,80128,80139,80137,80138,80156,80163,80169,80187,80194,80203,80213,80230,80238,80243,80251,80265,80278,80285,80299,80314,80154`

63245/63260两个数字端口全closed；Helper `/private/tmp/wy-ab-05a4ab014a45af31478d9fce` 无pid/sock/stream；私有TMP无M11 gateway目录或Unix socket。见cleanup/unix-socket-final；3451源哈希见source-hash-final。资源已明确交还，交付整理不占native，未启动下一组。
