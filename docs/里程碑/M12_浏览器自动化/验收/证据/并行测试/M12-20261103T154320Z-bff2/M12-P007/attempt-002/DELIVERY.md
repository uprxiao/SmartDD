M12-P007 attempt-002 / 明确补丁版0.27.3-willyou.2交付

T065仍失败：原75场景全部执行，72场景效果通过，3场景失败。独立85项检查中82通过、3失败；不把子场景计作完整用例。4条原生解析反例通过。T052版本回归独立通过，内核原文为Unknown ref: e1，host映射BROWSER_STALE_REF，默认S1页零点击。

仅剩3个真实效果错误，见failure-classification.json：text-fill、literal-text-name、literal-text-exact。它们的CLI及内核都报告success/filled，但可编辑DIV旧内容未被替换，新值被插到旧内容前。分别得到VALUE_text_fillT065 text-fill、--nameT065 literal-text-name、--exactT065 literal-text-exact。独立真实CLI读回与站点input事件完全一致；原生内核stdout在*-helper-native.raw.json，业务输出及前后状态在*.case.raw.json。没有重发、改预期或把成功退出码当作通过。

旧role隐式角色、type/focus/uncheck、title fill、nth payload等问题均已实际改善。nth focus按原用例允许版本支持更新后的成功判据验证，实际焦点与focusin事件正确；iframe仍返回Element not found且子页面未改变。placeholder click在本轮明确修正为有真实placeholder的原生text input并通过，旧attempt001的错误夹具/原红保持。6个字面--name/--exact负载中role/title四项通过，text/contenteditable两项暴露上述剩余缺陷。引号/空格CSS的nth填充、role name/exact true/false/unnamed均通过。

覆盖：原64个有效locator/action组合、原6格经确认的语义不适用、3个role flag正例、1个quoted nth、6个literal负载、iframe限制，共75实际场景。由于.2修改共享execute_subaction影响全部find动作，本轮有依据地全矩阵复验；原绿与原红未覆盖。实际矩阵表见matrix-verdict.md；原始输入/输出先落盘，再由adjudicate.mjs判定。

T052独立小段使用原host ready.url的默认S1表单页，实际tab switch/current核对页面身份；snapshot取得Action宿主引用eN后缀，原有identity-empty删除表单，重新snapshot清空原生ref，再使用原有native-stale-contract调用真正内核并单独验证host映射，observe确认零点击。未用私有matrix页面替代，也未热改原IPC。见t052.raw.json、t052-native-contract.raw.json、t052-adjudication.json。

I层边界：真实原生CLI、内核身份、网关/模块/固定helper/CDP页面；私有合成run与HTML站点。不是打包App A或真实Agent R。新增execFile观测只匹配本次固定helper，保存内核原stdout/stderr及原始stdout SHA，私有CDP能力URL脱敏；原方法/callback原样转发。每个find的原生JSON及CLI/站点事件可相互核验。execFile/prototype与三个实例trace均恢复，未在业务处理中改变预期或返回值。

输入：原baseline→nth→helper2按覆盖顺序合并2440有效文件全部核验；457资源包含冻结保留的旧包目录，实际index与运行packageHash指向当前包。helper取新out/agent-browser，SHA b51f3f3b5a8cc819d3baa24602581fee177408b0ee2af9ba97fe4907c4ac1a54；patch SHA bfccebf4f5c96cdda2113da6609eafd384301f927bf20cb544b14818ec97e1b9。私有宿主SHA eb6d6847c4a9395af3420b138d08de6344cd4aee7496fc83a4c68a1f914ff1ca。112依赖、Electron与资源终检一致；源清单及实际编译代码在source/。语法、35个CDP字面量、76个HTML脚本已预检。仅准备期的两次观测静态断言错误保留在preflight-attempt-001/002.json；没有因此执行或重放业务。

原运行在2026-11-03 20:15:52 UTC已正常退出清场；stream EOF后的接续仅在23:20补取原session完成结果、只读ps/lsof、独立判定和归档，没有重启App或重放75场景。12个自有PID均已不存在；60614/60618/60622/60633/61359五个已知监听与全部自有PID监听均关闭。三个daemon均stopped、clientStopped/socketFilesRemoved=true，宿主exit0。见cleanup.json与process-cleanup-verification.json，资源租约已交还。

原attempt001的342文件及manifest逐项核对未变。只归档本attempt manifest所列文件＋manifest；resources/build依赖二进制/node_modules链接/cache/runtime-001不入库。准备阶段的pending状态属于历史输入记录，当前状态以本说明、NEXT.md及判定为准。下一轮.3仅验证受影响fill子集、空值/嵌套可编辑元素及T052；其它.2已绿动作待协调者按逐函数哈希判定复用。
