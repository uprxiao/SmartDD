# M12-P037 cloneBrowserSessionData 原生 I 复验

结论：**13项业务判据全部通过，P035原Session Cookie丢失红测已由真实生产入口修复。** 实际正常quit与最终清场完整；中间一条私有View关闭后检查错误保留。此结论仅是组件I，不计clone CLI/UI、manager intent或原T080/T081整条。

## 冻结输入

- `/private/tmp/willyou-m12-p037-baseline-001/baseline.json`：1536文件，SHA `65fef65556b8acb59f6b1243a6cee5214ff98c899b62220c0882b17e38848eb0`，执行后全部SHA一致。
- 实际默认生产入口：`src/main/core/browser/clone-session.ts` → `copyBrowserProfileSnapshot` + `NativeBrowserCookieStore`。没有替换open/copy依赖，也没有在测试宿主手动补Cookie来冒充修复。
- 实际编译13个生产模块、36个依赖源输入，完整源快照/哈希见prepared.json、source-snapshot。
- compiled host：`046cae6d7c318e457ca1f23142ec1175854ae7fc31beadb28f8a0193a315e1bb`；私有host源：`e88e12e0c1ffd3cc77765ae53f60731970a3cb68cb0ff16427c2e714dff2fdda`。
- Electron42.11.14 / ABI146 / macOS arm64，prohibited、零窗口、unmounted sandbox WC。显式use-mock-keychain仅为私有原生加密前置，不是OS Keychain/safeStorage验收。

## 实际结果

source/target使用真实schema合法UUID、isolated/task owner及标准 `persist:wy-browser-<id>`。实际源storagePath匹配其原生partition。

1. 用实际NativeStore建立7个Cookie：HTTP persistent、HTTP session、host-only/path/HTTPOnly/Strict/High/sourcePort8443属性、domain/None/Low属性，以及同名CHIPS的top-a/top-b与hasCrossSiteAncestor true/false三种完整身份。会话与持久、优先级、sourceScheme/sourcePort、domain/path及所有原属性均逐项核对原生读回。
2. A页面真实创建localStorage、IndexedDB、CacheStorage、HTTP cache，并保留未保存表单、原URL/WC ID/原文档身份。
3. 调用实际 `cloneBrowserSessionData` 默认依赖：源完整Cookie snapshot、flush、整分区文件复制、源Cookie稳定再核，再首次创建目标Session。target工厂现场记录只有1次调用，且调用前完整目录已存在；B实际storagePath精确匹配目标并区别于A。
4. 实际复制 **55文件 / 1,890,443 bytes**，生产入口返回cookies=7。新B的完整NativeStore snapshot与A逐属性/完整partitionKey一致；**原P035缺失的session-A已在新B，三CHIPS变体也全部保留**。
5. B真实localStorage/IDB/CacheStorage/HTTPcache均是A原值；HTTP cache-only返回200及原字节，服务器cache端点仅种子请求一次，没有回网重建缓存。
6. A未被暂停或卸载：原未保存表单、URL、WC ID、文档身份及全部原Cookie/存储值保持。
7. 修改B的persistent Cookie、localStorage、IDB、CacheStorage并清B HTTPcache后，A仍完全原值、原表单/URL/WC；B修改有实际原生读回。成功后无stage残留。

全部数据经实际原生API/renderer存储API和同一本机HTTP请求账核对，结论不来自exit0或脚本自身预填通过。原生Cookie向量和三个分区键完整保存在host.raw.json。

## 原P035证据与复用边界

P035原红与其manifest `7dd1e28652adc2fd429e9dcd3fc0a41b8f476144dfac092706960991bbb75000` 完整保留，未覆盖。

source-reuse.json记录：P035→P037的tree/hash/sync三个函数及完整copy/publish两个循环逐字节相同；NativeStore、CookieJournal、BrowserProfileSchema、ApplicationError四文件完整SHA相同。整个copy函数并非逐字节相同：增加stagingId和owned-stage清理，这部分仅按root已有软件证据看待，不假称原完整函数未变。

本次新入口耦合Cookie恢复与全分区数据，故实际重跑必要的7Cookie+5存储/源页面/隔离矩阵；未重复P035 inactive/restart/busy全矩阵。旧证据只作为已测数据复制分支的支持，不外推新manager、CLI/UI、崩溃清理、opaque原生或错Session原生结果。opaque/wrongSession等边界仍是已有软件层，不冒称本次native构造过。

## 清场改进与保留的夹具错误

所有必须的Cookie flush均在有效WC仍活着的业务步骤完成。清场逐步骤先落raw，各2.5秒上界，关闭observerStore和网页，再以缓存的实际WebContents/Debugger引用作最终确认，不再重复无界closeAllConnections。

中间 `close-source-and-target-webpages` 的私有检查在关闭View后再次读取 `view.webContents.isDestroyed()`，此时webContents getter已变undefined，抛TypeError。原错误、原通用judge结果保留于host.raw.json、result.original-judge.json；不是生产clone错误，没有因此重跑业务。

后续cached WebContents收尾步骤实际fulfilled，**六个WC全部destroyed、debugger全部未附着，windows=0/allRemaining=[]**。随后实际调用app.quit，will-quit.json同步保存真实事件；控制器收到willQuit，exit0/signal=null，没有watchdog。adjudicate-final.mjs仅分类中间夹具断言错误与已实测最终结果，不把该中间断言伪写为成功。

## 资源释放

独立ps/lsof核验以下8个实际自有PID全部absent：

`65642,65645,65650,65651,65654,65659,65676,65677`

唯一数字端口 **54154** 已关闭，Node私有HTTP服务器/连接关闭。原生租约已明确交回协调者，之后仅文件整理，无新增native。

## 实际命令与范围

```
WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p037-executor-001/cache node /private/tmp/willyou-m12-p037-executor-001/run.mjs --execute
```

runtime-001已存在，同根拒绝静默重放。需要后续验证应使用新attempt/租约和统一冻结输入。此轮没有M11真实CLI、App UI、元数据公布或durable manager恢复测试，也未改生产、公共账、Git或包。无需为修一条已明确的私有清场postcheck重跑13个业务绿测。
