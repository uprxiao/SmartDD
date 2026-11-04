# M12-P045 合同与层级

只读权威用例文档：`/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/测试用例.md`

读取时 SHA256：`94da60a6be89b01ee4531404ef465609df21c028f542875543bc90b342bb4c3e`。这是读取时快照标识，公共结果后续归账会变化。

| F-COOKIE | 合成 Chrome／Edge 用户目录：已知口令加密的 Cookie 库，含 `qa.example.test`、`google.com`、`youtube.com` 三类 Cookie，以及一个不可解密的条目 |

| M12-T082 | R06.4 | I | F-COOKIE | 对同一 profile 并发发起两次导入 | 第二次被拒或排队，不会并发写入；最终 Cookie 与单次导入一致 | — | 待执行 | — |

本组按原 T082 完整 I：同一 profile 的两个真实宿主受信用户导入重叠，第二拒绝或排队；不并发写，最终等于夹具规定的单次导入。导入接口为用户专用，CLI 仅用于真实浏览器状态读回，不新增 Agent 导入入口。

成功选择 Default（X/W qa、Google 排除、YouTube 导入）；另 Profile 1 仅含不可解密条目作为完整合成来源资料，未执行，不声称 T081 失败矩阵通过。合成 keyProvider 与 AES 日志 cipher 注入属于技术 I 前置，不是系统钥匙串或 UI A。
