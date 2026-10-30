# NP 同ID多账号与跨来源引用原件

[原范围/实测](../../NP_T14多账号同ID与跨来源引用原生隔离_20261027.md)。两个自建账号nativeId和Message-ID相同，真实Codex各自query/read/resource精确本账号正文，双向跨connection/ref/resource拒绝，普通重启/原N/S恢复后仍隔离。10专项+8基线=18唯一，默认8回归及独立核验首次通过，不计26；13登记PID退出。T14原9/3及T03原4子集，正式32/72、目标active、未发布。

18原生动作=10成功/6scope/2sourceunavailable。四跨connection query在业务分配前拒绝，两crossread和两crossresource保留失败invocation；总15业务行=基线草稿1+成功10+失败4。broker只记录6安全scope，2sourceunavailable不是securityaudit。10来源receipt/原公式sourceKey/目标/原生JSONL精确关联；容器根拒绝不等于账号枚举UI通过。原DB/HOME/nativeJSONL私有，合成结果/源码/hash入库，0秘密/SMTP/UI/真实客户端/Claude。

选定源1270→1271，MF全tar+MH..NO+NP两外部delta可恢复；NB19pin/out18352保持，沿NB73软件/类型0/6原生。全部72原要求/状态保持，不以子集绿改变整例结论。下一步原T14步骤8在途默认范围变更仅静态待验证，不预填缺陷或通过。
