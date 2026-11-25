  let quitConfirmed = false, quitPending = false;
  app.on('before-quit', (event) => {
    if (quitConfirmed) return;
    event.preventDefault();
    if (quitPending) return;
    // 新任务区正在工作或等待处理的任务也计入（复核 CR05）。
    const agentBusy = agentWorkspace.tasks.list().filter(t => t.status === 'working' || t.status === 'waiting').length;
    if (ptys.count > 0 || agentBusy > 0) {
      const running = [agentBusy && `${agentBusy} 个 Agent 任务`, ptys.count && `${ptys.count} 个手动终端`].filter(Boolean).join('和');
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['退出', '取消'],
        defaultId: 1,
        cancelId: 1,
        message: `有 ${running}正在运行`,
        detail: '退出 WillYou 会结束这些运行。重新打开后可在侧栏中查看任务和历史。',
      });
      if (choice !== 0) {
        return;
      }
    }
    quitPending = true;
    void (async () => {
      const win = getMainWindow(), contents = getMainWindowContents();
      if (win && contents) {
        const frame = contents.mainFrame;
        const owner = `${contents.id}:${frame.processId}:${frame.routingId}`;
        const send = (request: FileCloseRequest) => {
          if (contents.isDestroyed() || contents.mainFrame !== frame) throw new Error('原文件界面已经关闭');
          contents.send(fileCloseEvent.name, request);
        };
        const resume = () => { try { send({ id: '', action: 'resume' }); } catch { /* Original renderer is gone. */ } };
        let reply = await files.closer.request(owner, 'save', send);
        if (!reply.ready) {
          const choice = await dialog.showMessageBox(win, {
            type: 'warning', buttons: ['继续查看', '放弃修改并退出'], defaultId: 0, cancelId: 0,
            message: '部分文件尚未保存',
            detail: `${reply.failures.slice(0, 8).map((failure) => `${failure.name}\n${failure.message}`).join('\n\n')}\n\n放弃只结束当前编辑；存在版本冲突的恢复材料会保留。`,
          });
          if (choice.response !== 1) { resume(); return; }
          reply = await files.closer.request(owner, 'discard', send);
          if (!reply.ready) {
            await dialog.showMessageBox(win, { type: 'warning', buttons: ['继续查看'], message: '未能确认放弃修改', detail: reply.failures.slice(0, 8).map((failure) => failure.message).join('\n') });
            resume(); return;
          }
        }
        // Await the renderer's unload permission, too. Sending without an ack
        // can race Chromium's beforeunload and strand a confirmed quit.
        const commit = await files.closer.request(owner, 'commit', send);
        if (!commit.ready) { resume(); return; }
      }
      // 退出已确认（含未保存文件的选择）后，才关闭新任务的 Agent 运行与手动终端，并等其收口再关数据库（复核 CR05）。
      await agentWorkspace.closeAll().catch(() => {});
      ptys.killAll();
      // Keep read-only native evidence and storage available until owned run
      // shutdown has drained. Revocation itself still happens immediately.
      try { await managedTasks?.dispose(); } finally { await applications?.dispose(); }
      // Wait for native subscription jobs before Electron tears down their N-API environment.
      await files.watcher.dispose({ shutdown: true });
      quitConfirmed = true; markAppQuitting(); app.quit();
    })().catch((error) => {
      getMainWindowContents()?.send(fileCloseEvent.name, { id: '', action: 'resume' });
      dialog.showErrorBox('文件保存确认未完成', rpcErrorMessage(error));
    }).finally(() => { quitPending = false; });
  });
