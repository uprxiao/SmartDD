# B09.2 原证书警告状态 / C25实际视觉红

范围：仅原 B05-certificate 的4个1440几何（浅/深 × 480/900），真实本机自签合成 TLS 默认拒绝/警告本身；绝不继续访问、放行、系统证书信任或碰真实站点。B05-certificate-exception 仍为明确未测试的本人合法前置，不能推论本轮已验。C25新4原图 + 先前实际旧4原图按SHA引用，4对真实业务有效，**严格目标视觉0/4，不增加正式通过点**。

真实业务证据：两边均出现真实 ERR_CERT_AUTHORITY_INVALID，1 TLS连接/1 TLS client error/0 secure/0 HTTP；同一私有 profile 前后证书/权限均空；所有4种几何同challenge、page、WebContents，真实 warning 前台 shell无遮挡、旧 native停于透明后台根，新一根无前台native。C25实际正常闭页：`.agent-surface-tab on`中同未信任固定本机URL、failedHost、唯一真实关闭网页按钮，UI行动后原tab及WC确实不存在；未点风险按钮。旧首轮只在收尾 legacy `.fw-web-tab`测试守卫找不到真实现行tab（旧和当前冻结asar均证实原选择器错误），其4真实业务警告未受影响，旧正常0退出且所有资源已退，但不能冒称旧明确闭tab UI动作成功。该实红及原失败截图等同第四图按单独归档引用。

逐原A/P四组对照目视10副派生图（4完整、4warning panel、2controls detail）：原 warning 标题18/24/550、两段13/20、原错误码、26×26 shield及地址13×13红色shield、声明仅用户可放行均保持。C25缺陷明确在仅两动作控件：真实返回恢复原1px边框（旧实际0），但返回14/430/21和50×35，非原13/500/19.5和48×33.5；风险链接14/21和140×21，非原12/18和120×18，浅色原红192,57,43实际变secondary112，深色原红保持但字号仍大。原正常透明/无盒/下划线保持，历史hover源规范另由协调者恢复复验；本批未冒称hover实测。其他文本/图标实际几何色值通过，SVG继承字号变为M14统一默认但实际图形尺寸色值无变。历史M14 shell、separator focus、tab title/固定私有随机port和警告主体纵向布局由实际pane差异造成，不以整图像素齐同作判据；明确两动作CSS级联红是真实当前不足。

实际 C25主 PID48488 正常0，精确4已记录PID均ESRCH，3425/57679/57698/57702空，闭库无WAL、0 secrets/provider refs、0 managed invocations/browser_operations；无信任或许可修改。只存原图/实际安全报告/独立窄读证明/源和对照，未归档证书私钥、整库或完整日志。
