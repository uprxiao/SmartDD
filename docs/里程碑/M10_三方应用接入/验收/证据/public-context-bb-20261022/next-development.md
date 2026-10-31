# BB 后接续：完整目标仍 active

当前只完成受支持Codex现代H占用的实际生产修复及原Python公共context的5场景软件验证；没有关闭整个REVIEW-01，也没有新的真实App／Agent验收。先看current-handoff中的原测试会话和报告，禁止未检查原进程就重启或改冻结源码。

1. BB整轮：174项launcher＋65相关文件1205项预计总1379，只有报告及进程exit0后才记录最终通过。类型candidate已exit0；2011份输入及9文件overlay冻结。保留h-red3项、followup1的14断言错误＋1实际standardH缺陷、全部复验，不相加过滤/重复用例。两个新增consumer/zero-App场景尚依赖整轮结果。
2. 普通native guard＋坏现代H：现有旧默认verifyNativeStaticRoots/verifyNativeIsolation仍要求完整H物理树。不要直接过滤原schema1 catalog或让旧guard跳过hash以假报可继续。若实现显式新guard模式，仍需在真实C run和完整H consumer建立后验证省略依据，保持原全部C来源元数据/依赖闭包占用，区分不被执行的来源和实际adapter根；普通guard绝不获得App桥/业务/input授权。实际旧格式和未知归属保留。
3. maintenance waiting：reserveRun当前拒绝pending；publish会等待全H消费者。需把可复用健康来源和真正修改目录分开，并核对pending阶段、原base完整清单和H/C原操作。不能为普通Agent继续清除未知owner、抛弃pending或越过相关消费者改目录。保持已有原操作连续中断恢复及取消语义。
4. 逐项可见公共诊断仍需核对P09等；特别补实际测试区分marker已失去原归属的用户占用与仍有原marker但字节损坏的H，不能把所有HASH失败都当成同名用户配置问题。本批仅修了Codex逐应用资源检查不误报无关标准H故障，没有renderer/原型源码增量。全87编号继续逐项核对，不凭文件存在或软件数宣布开发完成。
5. R08-01现有mail-user-authorizations只寻找相邻同run/项目/PTY/选择/连接/政策的已认证前一用户turn，native-mail-intent只支持精确草稿引用/显式邮箱。更早唯一上下文或张三仍缺。须从NativeUserMessages保留的真实host input receipts和原行形成有限有序上下文链，逐行异步复验，并在同步claim/execute边界核对同连接/政策及当前latest。不能把模型消息、邮件正文或未认证地址簿当用户姓名映射，不可猜姓名对应邮箱；最终目标、草稿修订、内容、附件、sender仍唯一且当前。
6. R09当前7项不是T39/T40全过。生产连接app/provider/config和Data API descriptor仅两App命名空间。后续可建立有明确父hash/overlay的隔离候选实验，以两真正不同fake App IDs/连接/项目跑现有真实schema、registry、连接生命周期、broker、权限及调用账；只修改必要候选注册/类型入口，保留原核心调用流程及同库表/原权限，不复制生命周期或分库掩盖隔离。用受信本地完整包及无害处理器，不引入用户路径/任意第三方加载或产品目录，也不声称当前生产支持任意app。覆盖合法发现、无效声明、跨项目、参数、当前撤销、取消/超时、read重试和write unknown不重放，更新指南说明候选与当前生产边界。
7. 已完成delivery backup/abandoned stage GC需实际ownership/hash/无reader依据，不能按age/PID缺失删除。旧AF未知bridge始终不动。

开发和必要软件测试全部收口后才冻结新包，两实际Agent、全部72条及系统/人工层级分别验收，再修复复验、交付；M9焦点竞争时串行让出。无合并main、推送、tag或Release授权。
