# Foxmail 技术实验 V1

2026-10-17，依据 M10 需求 R1.2-20261017 的 M10-R05／R06／R07／R08。实验独立于业务代码；没有新增依赖，没有启动、退出或改写 Foxmail，没有连接邮件服务器或实际发信。

| 文件 | 作用与实际结果 | 证据边界 |
| --- | --- | --- |
| `rea-plist-evidence.json` | REA 对本机 Foxmail Info.plist 的静态证据 | 不证明运行行为；Evidence `ev_5d7cedb12c743b9125f8cae0934b1a84705cd2521585f40fcee04c72557ff5bc` |
| `rea-macho-summary.json` | 单 x86_64 Mach-O、包内可执行文件 SHA-256 | 静态摘要，不是深度反编译；原始导入／导出清单可能不完备 |
| `private_layout_probe.py` / `private-format-report.json` | 只读五张索引表的列名／类型；3 个 `.mail` 各读至多 64 KiB，仅保存布局统计 | 没有查询业务数据行或解析头值／正文／附件；未保存原始样本、账号目录或邮件 ID |
| `private_mime_structure_probe.py` / `private-mime-structure-report.json` | 沿用原确定性选样顺序，3 个完整文件≤2 MiB，MIME 结构解析均无 reported defects | 仅匿名 part／类型／缺陷／解码大小；不保存任何真实值、内容、文件名、ID或内容哈希；不是客户端保真验收 |
| `standard-client-interfaces.json` | 本机 Foxmail、Apple Mail 的静态接口声明与 Outlook 默认路径存在性 | 未查询任何客户端的账号或邮件；未向 App 发 AppleEvent |
| `synthetic_mail_probe.py` / `synthetic-parser-report.json` | 标准库合成 EML／MBOX，12 项实验通过 | 全部是假数据，不代表真实 Foxmail 邮件、增量同步或发信通过 |
| `environment.json` | macOS／架构／Python 版本及本轮边界 | CLI 可读数据不代表打包 WillYou 已具备相同系统权限 |
| `evidence-manifest.json` | 本目录证据和脚本哈希 | 不包含私有邮件原文或其内容哈希 |

## 可复现命令

合成实验可直接运行，不读取 Foxmail：

```sh
python3 docs/里程碑/M10_三方应用接入/技研/实验/foxmail/synthetic_mail_probe.py
```

私有布局／结构脚本只适用于本次明确授权的数据根，运行会再次读取最小样本，并覆盖对应统计报告；未来执行前应先确认授权范围仍适用。结构脚本先核对选样文件大小与原布局统计一致，超 2 MiB 则 skip，不使用截断数据误判完整解析。二者不应作为应用测试或常驻同步程序。

## 合成实验检查范围

S01 UTF-8／multipart、S02 不渲染 HTML／不抓远程资源、S03 稳定引用、S04 内容修订、S05 跨来源及重复头 ID 隔离、S06 缺失 Message-ID、S07 坏 MIME 缺陷、S08 附件路径与重名隔离、S09 本地产物权限、S10 配额先于写入、S11 MBOX 消息边界、S12 容器与邮件字节身份分开。

S02 只证明此解析实验没有渲染／联网；没有验证任何 HTML 清洗器或生产预览组件。S03–S06 的 source/native ID 是合成值，没有验证 Foxmail `mailid` 与文件路径的对应关系。MBOX 实验不证明 Foxmail 导出的全部变体保真。

真实结构补充结果：样本 1／2 各为 multipart/alternative、3 part；样本 3 为 multipart/related、7 part，含 3 个附件或带文件名叶项，附件解码大小 308,944 字节。三个文件 stat 均稳定，未触及结构／解码预算，没有 reported defects。此结果仍未核对客户端内容、附件保真、ID 映射或全部邮箱。

完整结论见[Foxmail 接入可行性调研 V1](../../../调研/Foxmail接入可行性调研V1.md)。
