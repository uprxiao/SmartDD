# P063005：直接原生用户回调技术验证

不调用Page.handleJavaScriptDialog，直接答复真实Electron原生callback。alert接受／关闭、confirm接受／取消、prompt中文／空字符串／取消，以及srcdoc和localhost→127.0.0.1跨站iframe，共9个实际返回与9个真实CDP closed事件；独立20判据绿。主页／子框无Node，sandbox/contextIsolation保持；原handler恢复，正常退出0无fallback，5PID／1TCP清场。

取消时网页结果为null，但CDP closed会带传入的userInput；生产取消必须传空字符串，避免无意义敏感载荷。handler源hash仍是固定Electron42.11.14原值。只证明用户答复技术通路，不是生产功能、实际Helper／CLI、打包App界面、x64或原T068通过；生产UI、生命周期失效、页队列响应通路仍待实现／验收。
