# P022焦点前置后置与独立核查

App010已经启动，但首次业务点击前guard记录document focus=true而native window focus=false，未发浏览器创建/导航/认证操作。T016/T026均未执行，不计产品红/正式通过；原33文件SHA核对且无修改。root独立核7PID/3端口全部清场。

初始focus帮助函数原只核DOM，现补native window focus检查，仍只允许一次steal:false初始请求；4项Node软件检查通过，字面量CDP表达式预检通过。该修正未重新启动App，未重arm已yield实例，不冒称A通过；未来需用户/系统焦点可用后使用新实例补验。

当前继续不依赖UI的Cookie导入工程，正式51/121通过、70待收口，42.15%。
