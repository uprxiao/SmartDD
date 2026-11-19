# M14 D06-62 隔离候选

2026-11-19，macOS arm64。冻结源码 9a6e95cdc1003c93f04555b58cd60d8300d2a25c，用 pnpm package 构建目录包，经 codesign 深度严格校验。应用版本显示 0.1.5。SQLite、PTY、语音桥、文件代理、Office 渲染、文件监听六项包内冒烟通过。验证包使用本机临时签名，留在私有目录。

[构建日志](package.log) · [包与原生程序 SHA-256](package-sha256.txt)
