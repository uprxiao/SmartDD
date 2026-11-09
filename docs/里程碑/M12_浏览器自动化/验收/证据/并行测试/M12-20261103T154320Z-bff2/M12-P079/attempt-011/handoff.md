probe011 一次实际技术I交付

独立judge全部14项通过（见result.json）；只证明本次最小能力，不计T111/前台焦点/模型R，也不保证未来30分钟CPU/RSS通过。sourceApp019/ASAR/主程序/Framework/固定资源PIN及原签名验证全部保持；只运行唯一COW私有副本，一次非激活NSWorkspace请求，无active变体、UI输入、模型、用户凭据或长测。

实际exec session13352，runner40440/broker40519/App40520，App metrics还包含40537/40538/40598；kernel children40532/40611/40618。端口58400/58401。Werror编译0/空log，19实际运行输入执行前后SHA一致。

强归属：真实callback唯一URL与POSIX/Node/Darwin canonical严格一致，kernel同UID501/birth/startAbstime/path及端口归属通过；main实际userData/privateHOME/CODEX_HOME、App ASAR/exe均确属本根。App及全部当前metrics的resourceCID63949，host runner/brokerCID719；真实counter读取权限/布局成功。因此本次取得与宿主不同的App资源组，仍不据此称App-exclusive membership或CPU已低于5%。

非激活实际事实：callback active=false、activationObserved=false；本组file窗口Native focused=false，DOM ready=complete/hasFocus=false（visibility=visible）。hides配置意图不等于实际hidden，callback hidden=false原样保留；不能称本次已获得真实前台。

同步读取采用现成harness模式：Runtime.evaluate awaitPromise=false、保留原remote/objectGroup，callFunctionOn取同一结果并release；一次Runtime.enable，170条CDP请求有method/seq/params/error元数据，实际无协议error，只观察到一个Runtime.executionContextCreated。没有重连失败会话或重放输入。010的原失败不改写；本次无Promise collected仅证明这套修正可行，不独占断言010唯一根因。

真实normal App.quit已发送，原始before-quit两次、will-quit、process-exit-event code0、quit code0以及NSRunningApplication terminated均保存。重复before-quit可能是App原有退出提交流程，本测试未改它。broker0/null属于broker；App kernel exitcode/signal未知null，不由这些事件伪造waitpid结果。

原cleanup逐knownNative身份ESRCH、唯一clone路径census=[]、两端口closed，无unresolved；追加ps精确9PID全部缺席，Native/build租约已释放。所有kernel helper0/null，compiler PID未单独采样但真实await编译0。没有新Native/OS诊断或重跑，之后仅文件静态归档。

产物：raw/live、完整kernel-raw/broker-events/CDP trace/App lifecycle、独立result/cleanup、源码/静态前置/旧失败file-review与compiled hash齐全。manifest排除自身、私有App/运行时目录/缓存/compiled broker/config nonce等；formalCaseCredit=0，公共账未改。
