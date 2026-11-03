M12-P006 / M12-T039 U＋I 交付

独立判定 result.json：通过，80项检查全部通过；整条仅对应原T039，不把子项折算为多个用例。

U：直接编译并调用冻结生产browserExecArguments，33负例全部抛INVALID_INPUT，三个正例保留正确argv。包括原15条命令、8个全局flag各测前/后位置16条，以及--cdp指向真实目标端口的两条变体。未用旧exec-policy.test绿测代替本轮完整矩阵。
I：同33条负例全部经真实原生willyou-app返回INVALID_INPUT/exit2/not-started。整个负例阶段helper.command调用为0；页面CDP代理访问计数不增。第二个独立Chromium使用独立HOME/tmp/userData，后端原生CDP端口64698在任何连接前由lsof唯一核归属PID70487；透明计数代理64701先完成HTTP discovery及真实Browser.getVersion校准。校准后accepted=2、upstreamConnected=2、clientBytes=657、upstreamBytes=1037，全部负例及正例期间均不变化，即没有测试命令访问越界目标。

三个真实CLI正例均通过且helper观测计数实际增长：get title返回S3 native CLI fixture；press Enter返回pressed: Enter；network requests --filter api返回本地/api-t039的GET/200记录。专用browser eval只准备network正例的本地请求，单独留证，不代替被验收exec命令。没有自动重放写操作。

I边界：真实CLI、内核对端身份、网关、ApplicationToolService、BrowserService、固定helper、真实Electron页面；合成本地run/站点与第二个私有Chromium。不是打包App A或真实Agent R。私有host只包装helper.command及BrowserCdpProxy.start/trace来计数，逐次调用原方法，不改拒绝/执行逻辑；结束前还原prototype与每个实例trace，回执均true。透明TCP代理只转发，不改CDP数据；自有校准探测明确排除在“负例零访问”基数之外。

原始输出先写*.raw.json，再用adjudicate.mjs独立按完整原合同重新解析与判定。unit.raw.json和raw-result.json为完整原始集合，test-contract.txt保存原权威T039行。源码只来自冻结1980文件及两份补充清单；291资源、112依赖及Electron可执行文件SHA前后相同。实际私有编译宿主SHA37146b079a53d15066241e51ca496fd42f8294e2c017e09c8f3f61e48bd011ec；private-inputs.json保存八个私有驱动/宿主输入哈希。源清单及实际编译代码在source/。

前置失败保留preflight-attempt-001.json：私有wrapper入口最初缺依赖解析链接，编译在任何native前拒绝；添加只读node_modules链接指向既定冻结依赖后通过。准备中一次只读cwd失配已忽略并从冻结重读，见preparation-note.json；活动代码没有作为构建输入。

清场：cleanup.json、trace-restore.json、process-cleanup-verification.json。宿主与目标exit0，12个已知自有PID（含driver70484、目标70487、宿主70493、helper daemon70708及Electron子进程）全部消失；64698/64701/64719/64720四个已知监听关闭，另按全部自有PID核无TCP监听。helper70708为stopped，clientStopped/socketFilesRemoved=true。未知或日常进程未操作。资源租约已释放。

只归档manifest.json列出的文件＋manifest自身；resources、build依赖/二进制、unit-build、node_modules链接、cache、runtime-001均不入库。生产代码、公共用例账、共享构建及旧T004/T036交付未修改。
