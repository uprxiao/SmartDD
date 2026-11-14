# M14 全局兼容验证证据（2026-11-14）

本目录记录独立研究探针，结果及适用范围统一见[全局验证账](../../全局设计验证账.md)。不作为 M14 功能验收通过记录。

- `native-a2`：本机 CLI 显式路径的真实程序＋模拟模型端点。
- `native-managed-a1`、`native-managed-a3`：排除全局 CLI 的 PATH，SDK 平台程序／受管 Codex；a3 补 unsubscribe/resume 与原生输入 ID。中间 a2 的错误协议方法及原始失败保留。
- `claude-extra-a2`：UUID／原文、恢复、空根拒绝、MCP 环境过滤、原生拒绝、项目指令／配置与 Skill。中断未通过该批，补验见 a8；a1、a3–a7 保留驱动失败、自定义模型失败及终态判读过程。
- `storage-a1`：真实 SQLite、无覆盖文件发布、本地 SVN 和稀疏大文件夹具；candidate.sql 是独立实验模型，不是生产 migration。
- `component-result.json`：直接转换现有目录检测／BrowserAccess 源码实跑；仅将 ApplicationError 替换为错误类外壳，源码 hash 在记录中；不是完整 Electron 联调。
- `managed-binaries.json`：实际运行程序版本、大小及 hash；未将程序／node_modules 纳入证据。
- `process-cleanup-audit.json`：由捕获的 spawn／exit 记录逐项核对；没有按名称搜索或终止日常进程。

原始 JSONL／stderr 使用 gzip 无损保存；可解压检查。所有账号／模型端点数据为合成值。安装包、执行器缓存、完整临时 HOME、数据库和 11GiB 稀疏夹具未纳入本目录。驱动固定了本次原始路径，复跑应创建新隔离目录并记录替换路径，不覆盖历史结果。依赖锁供精确复现；不要求把实验依赖装入 SmartDD。

SDK／模型返回的 usage／cost 为本机模拟响应下的程序计数，不代表真实模型账单。Native 探针成功不证明产品安装、所有平台、真实供应商、WillYou 业务授权桥或完整委派已经通过。
