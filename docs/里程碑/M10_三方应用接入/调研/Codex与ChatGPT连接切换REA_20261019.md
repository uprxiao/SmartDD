# Codex／ChatGPT 连接切换与已有会话

核对日期：2026-10-19。依据M10需求R1.6及[M10-R02-01](../需求.md#121-a02a03禅道每项目单一生效连接)。本轮回答项目从禅道A切换至B时，已有会话是否必须新建；研究与候选建议不代替用户决定，不授权正式开发。

## 1. 结论

**不能把“切换连接必须新建会话”作为Codex／ChatGPT的通用规则。** ChatGPT官方已明确支持部分应用在同一会话使用多个账号；本机Codex的MCP App调用则明确带应用和连接身份，校验工具目标与原资源来源一致。二者支持将“会话内容”“应用包版本”“本次调用的连接目标”分开设计。

同样不能据此声称“所有历史会话都会自动跟随新连接”。本轮没有观察真实切换／resume过程；Codex完整Agent工具调用、ChatGPT服务端授权与刷新算法仍有证据缺口。

## 2. 目标、方法与证据边界

- 使用`reverse-engineer-anything` Skill及REA 6.5.0；只读静态分析本机安装包，独立核对OpenAI官方公开资料。未改变账号、连接、聊天、授权或全局CLI配置，未运行目标代码／业务操作。
- `/Applications/ChatGPT.app`的Bundle ID实际为`com.openai.codex`，版本`26.1013.40934`，build`20770`。不能把同一包同时计为独立Codex与传统ChatGPT客户端证据。
- ASAR：`/Applications/ChatGPT.app/Contents/Resources/app.asar`；SHA-256为`5ddc4e48259aa6f979e04529b1a5a4ae54b0f5c4ad6db5c6e004924c10916ddb`。
- REA选取8个模块，读取79,052字节，解析8个JS文件／24,495个AST节点，无解析失败；应用与语义图均为partial。另用Babel惰性解析当前`app-initial`，定位确切导出绑定与函数；后者为静态人工补查，不伪称已由REA完成整个调用图。
- REA记录7项未纳入结论的解包原生文件完整性矛盾。选中packed JS与本机ASAR头hash一致；这不代表签名有效或整个安装包可信。16,315个未选文件及188,353个语义未知仍保留。
- 字符串trace无匹配，不作不存在的证据；模块trace完成但完整返回超过传输预算，已导出，未据未读图提出结论。原始源码与1,266,522,248字节REA包仅存本机忽略目录`release/m10-research/connection-switch-20261019/`；入库清单仅含身份、位置、哈希、限制与结论。

机器记录见[连接切换证据清单](证据/connection-switch-rea-20261019.json)。

## 3. Codex当前版本的静态事实

| 编号 | 位置／已观察逻辑 | 能说明什么与不能说明什么 |
| --- | --- | --- |
| CS01 | `hosted-mcp-app-adapter-63d2ffc1873a.js`，`g`：工具的`connectorId/targetId`必须与资源上下文一致，否则返回连接不可用；`_`把`targetId`写入`originMetadata.link_id` | 此MCP App路径不会把一个来源的旧资源调用任意改投另一连接。不是整个Codex会话永久固定账号的证据 |
| CS02 | `app-initial-90eb42395b7d.js`，导出`Kyt → D7o`，UTF-16位置`8019193–8023081`：解析目标；把连接ID带到工具元数据、资源读取参数或显式`link_id`；调用保留thread／conversation来源 | 调用有明确目标，不能只靠应用名或数组第一项决定账号；私有服务端怎样执行授权未由静态客户端证明 |
| CS03 | 同模块`$ii`，`4791552–4792973`：资源身份包含host、OpenAI用户／账号、connector及target；`dI`判定current／changed／unavailable。`D7o`监听OpenAI身份变化并abort | 账户隔离与当前性检查存在。但connector分支的target取自该资源context，**不能把`current`误说成已实时证明该第三方连接仍获授权**；OpenAI主身份abort也不等于三方连接热切换 |
| CS04 | 同模块`C7o`，`8017149–8018957`：处理工具后续输入，认证结果携带`connector_id/link_id`；`load-mcp-app-tool`在加载前后检查来源可用与current | 认证／交互围绕具体来源继续；不能证明切换时所有已排队请求或批准自动作废 |
| CS05 | `chatgpt-mcp-extension-view-page`，`ut`的键包含OpenAI账号、用户、plugin、app、link、tool、resource URI | 该hosted MCP扩展视图按连接等身份区分复用；此内部hosted conversation不等同用户原始聊天，不能据此要求用户换会话 |
| CS06 | `use-plugin-detail-apps`有显式列表刷新与缓存失效；`connector-settings-redirect`处理`linkId`和新增连接入口 | 连接可作为独立对象管理；未证明CLI resume后的默认选择策略或全部工具自动热刷新 |

函数位置是原文件UTF-16偏移、右端不含；完整文件hash及选中函数hash见证据清单。没有提交专有源码。

## 4. ChatGPT官方产品行为

| 编号 | 已确证行为 | 官方依据 |
| --- | --- | --- |
| CP01 | 部分应用支持连接多个三方账号；支持时可在请求中明确指定账号 | [连接与管理应用账号](https://help.openai.com/en/articles/20001494-connecting-and-managing-app-accounts-in-chatgpt)，Review or connect another account |
| CP02 | 重连一个账号不会同时更新其他账号；断开停止该账号的后续访问，但本身不删除已有或归档聊天 | 同上，Reconnect an app／Disconnect an app account |
| CP03 | 2026-09-17说明多账号支持扩展到更多插件，并明确个人／工作账号可以用于同一会话 | [ChatGPT发布说明](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)，September 17, 2026 → Connect multiple accounts to plugins in ChatGPT |
| CP04 | Connected不保证当前聊天、模型或界面可用；已连接仍不能使用时，新建聊天是排查步骤之一 | [应用故障排查](https://help.openai.com/en/articles/20001497-troubleshooting-plugins-and-apps-in-chatgpt)，An app is connected, but ChatGPT cannot use it |
| CP05 | OpenAI主账号切换与三方应用账号切换不同；主账号之间的聊天等保持独立 | [主账号切换](https://help.openai.com/en/articles/20001068-use-multiple-accounts-with-account-switching)及CP01 FAQ |
| CP06 | 不同应用仍有差异，例如Notion专项说明要求换账号或工作区时断开旧连接再授权 | [Notion接入说明](https://help.openai.com/en/articles/12532955-notion-app-and-setup-in-chatgpt) |

以上页面均实际打开核对正文。官方资料没有交代任意旧聊天在A断开、B接入后的统一刷新时点、在途请求取消、审批失效、资源ID隔离或会话Skill版本锁定算法。公开产品行为与客户端静态机制互相参考，不能拼成已经动态验证的完整实现。

## 5. 对WillYou的候选建议，待逐项讨论

此前“切换后旧会话停止使用该应用，新建会话使用B”是我们提出的策略，不是逆向发现的产品强制要求。结合本轮证据，**建议改为允许保留旧会话，在明确切换后更新后续调用目标**；不自动修改已经确认的需求。

| 场景 | 推荐候选 |
| --- | --- |
| 项目选中A | 该项目仅A生效；全局其他项目的选择不变 |
| 在项目页切换至B | 展示A→B及影响会话；进入切换边界后不再接受新的A调用，连接绑定单独更新，与应用包版本无关 |
| 当前会话继续 | 在可验证的下一轮边界告知Agent和用户连接已变；未来新查询使用B，旧聊天保留。无法可靠更新的Agent可停止后恢复同一个native session，须实测；首版也可要求先停止该项目所有相关运行，再切换 |
| 旧结果／引用 | A的Bug #812仍属于A，绝不能按B的#812解释。访问旧来源被阻止时提示原连接不再生效，可由用户在项目页切回；已有文本可保留，但不得作为B的最新数据 |
| 在途调用／待审操作 | 不把A操作重发到B；尚未执行且面向A的批准失效。已发送的外部操作不能保证可撤销，保留A来源与已知／未知结果。首版是否只允许停止后切换需用户选择 |
| 恢复历史会话 | 保留历史固定应用包，明确提示连接已改为B；核对当前授权、旧包与B配置兼容后才允许使用。不能把“不兼容”静默修成换新版包 |
| 新建会话 | 使用当前默认应用包＋项目当前连接B；这与旧会话继续使用旧包并不冲突 |

这是WillYou独立方案，具体Agent注入／恢复、并发切换与权限检查尚未验证；不得据此宣称五种Agent均支持热切换。若采纳，需同步R10-08、项目绑定／会话快照／运行授权模型、P04/P09与相关用例。当前[M10-R02-01](../需求.md#121-a02a03禅道每项目单一生效连接)只确认单一生效连接，切换语义仍待用户决定。

## 6. 交接

已完成：当前安装包8模块REA、当前导出绑定静态补查、官方账号／会话规则核对、证据归档。未完成：真实切换与resume回放、服务端行为证明、WillYou新规则确认和原型／生产实现。下一步讨论“首版先停相关运行再切换，还是允许下一轮生效”，之后同步已确认的设计，不直接推进A04。
