# 待用户确认方便后执行；本文件不是已执行日志

必须先收到用户“现在方便”答复，再启动。P/A串行，各自等待用户置前；中途失焦不重试。两个命令都沿现有有界输入保护。先P成功再A；读取result/退出状态，不只读程序日志末行。

```sh
WILLYOU_ACCEPTANCE_APP=/private/tmp/willyou-m10-qe-package-20261028/mac-arm64/WillYou.app/Contents/MacOS/WillYou WILLYOU_ACCEPTANCE_ASAR_SHA=c976f813353813c9e79f48ab1f31c8e47876c80d3c812cabb12daa3c2482e105 WILLYOU_PACKAGE_UI=1 WILLYOU_DETAIL_VISUAL_COMPARE=1 WILLYOU_PACKAGE_DECLARATIONS_UI=1 WILLYOU_ACCEPTANCE_WAIT_FOR_FOCUS=1 node scripts/applications/prototype-detail-ui.mjs
```

```sh
WILLYOU_ACCEPTANCE_APP=/private/tmp/willyou-m10-qe-package-20261028/mac-arm64/WillYou.app/Contents/MacOS/WillYou WILLYOU_ACCEPTANCE_ASAR_SHA=c976f813353813c9e79f48ab1f31c8e47876c80d3c812cabb12daa3c2482e105 WILLYOU_PACKAGE_UI=1 WILLYOU_DETAIL_VISUAL_COMPARE=1 WILLYOU_PACKAGE_DECLARATIONS_UI=1 WILLYOU_ACCEPTANCE_WAIT_FOR_FOCUS=1 node scripts/applications/detail-ui.mjs
```

需本次隔离App/127.0.0.1运行权限；默认沙箱已知会EPERM，按现有授权提交例行自动审批。不新增外部网络业务或钥匙串，不用日常配置。实际包及P静态hash先核，不因此重新构建。新断言只对公开枚举与效果/主题/无工具操作检查，连接仍原驱动明确受控数据，不证明真实认证。
