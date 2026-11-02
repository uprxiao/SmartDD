// Reuses the M4 CDP approach against our own Electron application.
// Each caller supplies a private userData directory. No global app state is edited.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openElectron({
  userData,
  env: extraEnv = {},
  executable,
  cwd = process.cwd(),
  inspectMain = false,
  startupMainHook,
  nodeModeNegative = false,
  nodeModeArguments = [],
}) {
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const env = { ...process.env, SMARTDD_USER_DATA: userData, ...extraEnv };
  if (nodeModeNegative) {
    assert(
      executable?.startsWith("/private/tmp/willyou-m10-") &&
        userData.startsWith("/private/tmp/willyou-m10-") &&
        extraEnv.ELECTRON_RUN_AS_NODE === "1",
      "Node-mode negative requires an explicit private App/data root and intent",
    );
    assert(
      nodeModeArguments.length === 3 &&
        nodeModeArguments[0].startsWith("/private/tmp/willyou-m10-") &&
        nodeModeArguments[1] === "--bootstrap" &&
        nodeModeArguments[2].startsWith("/private/tmp/willyou-m10-"),
      "Negative uses only the explicit private CJS/bootstrap invocation",
    );
  } else
    assert(
      nodeModeArguments.length === 0,
      "Node-mode arguments require the explicit negative path",
    );
  for (const name of Object.keys(env))
    if (
      /^(ELECTRON_RUN_AS_NODE|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_)/.test(
        name,
      ) &&
      !(nodeModeNegative && name === "ELECTRON_RUN_AS_NODE")
    )
      delete env[name];
  assert(
    !startupMainHook ||
      (inspectMain &&
        (executable?.startsWith("/private/tmp/willyou-m10-") ||
          executable?.startsWith("/private/tmp/willyou-m11-s7/"))),
    "Pre-entry hook requires this explicit private inspected App",
  );
  const child = spawn(
    executable ? resolve(executable) : require("electron"),
    [
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${port}`,
      ...(inspectMain
        ? [
            startupMainHook
              ? "--inspect-brk=127.0.0.1:0"
              : "--inspect=127.0.0.1:0",
          ]
        : []),
      ...(executable ? [] : ["."]),
      ...nodeModeArguments,
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  child.stdout.on("data", (b) => {
    logs += b;
  });
  child.stderr.on("data", (b) => {
    logs += b;
  });
  let ws, mainSession;
  const closeMainInspection = () => {
    mainSession?.then(
      (session) => session.close(),
      () => {},
    );
  };
  try {
    if (startupMainHook)
      await startupMainHook({
        processId: child.pid,
        logs: () => logs,
        isRunning: () => child.exitCode === null && child.signalCode === null,
      });
    let page;
    const startupDeadline = Date.now() + 15_000;
    while (Date.now() < startupDeadline) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Electron exited before opening its test window");
      try {
        page = (
          await (
            await fetch(`http://127.0.0.1:${port}/json/list`, {
              signal: AbortSignal.timeout(
                Math.max(1, Math.min(1000, startupDeadline - Date.now())),
              ),
            })
          ).json()
        ).find((p) => p.type === "page");
      } catch {
        /* starting; each request is bounded too */
      }
      if (page) break;
      await pause(100);
    }
    assert(page, "Electron debugging target not ready");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    let seq = 0;
    const pending = new Map();
    const cdpListeners = new Map();
    const rendererErrors = [];
    const navigationWaits = [];
    let targetCrashed = false;
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(message.id);
        message.error
          ? request.reject(
              Object.assign(new Error(message.error.message), {
                cdpMethod: request.method,
                cdpCode: message.error.code,
              }),
            )
          : request.resolve(message.result);
      }
      if (message.method === "Inspector.targetCrashed") targetCrashed = true;
      if (message.method === "Runtime.exceptionThrown")
        rendererErrors.push(message.params.exceptionDetails.text);
      for (const listener of cdpListeners.get(message.method) ?? [])
        listener(message.params);
    });
    ws.addEventListener("close", () => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Isolated Electron target closed"));
      }
      pending.clear();
    });
    const cdp = (method, params = {}, timeoutMs = 25_000) =>
      new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error("Isolated Electron target is closed"));
          return;
        }
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Electron ${method} timed out`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        ws.send(JSON.stringify({ id, method, params }));
      });
    await cdp("Runtime.enable");
    await cdp("Inspector.enable");
    const evaluate = async (expression, timeoutMs) => {
      const result = await cdp(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
        timeoutMs,
      );
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description ??
            result.exceptionDetails.text,
        );
      return result.result.value;
    };
    // Navigation retries are opt-in for read-only DOM conditions. Never replay
    // inputs, invoke calls or arbitrary evaluate expressions after navigation.
    const waitFor = async (
      expression,
      ms = 10_000,
      { navigation = false } = {},
    ) => {
      const deadline = Date.now() + ms;
      const alive = () =>
        child.exitCode === null &&
        child.signalCode === null &&
        ws.readyState === WebSocket.OPEN &&
        !targetCrashed;
      while (Date.now() < deadline) {
        if (!alive())
          throw new Error(
            "Isolated Electron target stopped during condition wait",
          );
        try {
          if (await evaluate(expression, Math.max(1, deadline - Date.now())))
            return;
        } catch (error) {
          const contextChanged =
            error.cdpMethod === "Runtime.evaluate" &&
            /^(Inspected target navigated or closed|Execution context was destroyed.*|Cannot find context with specified id.*)$/.test(
              error.message,
            );
          if (
            !navigation ||
            !contextChanged ||
            !alive() ||
            Date.now() >= deadline
          )
            throw error;
          // Confirm the original page still belongs to our original process/port.
          // A closed/crashed/replaced target is a failure, never a reattachment.
          let targets;
          try {
            targets = await (
              await fetch(`http://127.0.0.1:${port}/json/list`, {
                signal: AbortSignal.timeout(
                  Math.max(1, Math.min(1000, deadline - Date.now())),
                ),
              })
            ).json();
          } catch {
            throw error;
          }
          if (
            !alive() ||
            !targets.some(
              (target) =>
                target.id === page.id &&
                target.type === "page" &&
                target.webSocketDebuggerUrl === page.webSocketDebuggerUrl,
            )
          )
            throw error;
          navigationWaits.push({
            at: new Date().toISOString(),
            pageId: page.id,
            code: error.cdpCode,
            message: error.message,
          });
        }
        if (Date.now() < deadline)
          await pause(Math.min(100, deadline - Date.now()));
      }
      // Expressions may contain test parameters; never echo them on failure.
      throw new Error("Electron test condition timed out");
    };
    await waitFor(
      'Boolean(window.electronAPI && document.querySelector("[data-testid=nav-settings]"))',
      10_000,
      { navigation: true },
    );
    // Collectors live on the page, so a driver that reloads must call arm() again.
    const arm = () =>
      evaluate(`window.__m5 = { output: {}, exits: {} };
      window.electronAPI.eventOn('pty:data', e => { window.__m5.output[e.ptyId] = (window.__m5.output[e.ptyId] || '') + e.data; });
      window.electronAPI.eventOn('pty:exit', e => { window.__m5.exits[e.ptyId] = e.code; }); true`);
    await arm();
    const invoke = (channel, ...args) =>
      evaluate(
        `window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`,
        70_000,
      );
    // Test-only main-process evaluation. Enabled solely by the local launch flag above.
    // Used to compare decrypted credentials with artifacts without returning the credentials.
    const mainFailure = (response, label) => {
      const exceptionClass =
        response.result?.exceptionDetails?.exception?.className;
      const kind =
        typeof exceptionClass === "string" &&
        /^[A-Za-z][A-Za-z0-9]*$/.test(exceptionClass)
          ? exceptionClass
          : "unknown";
      const code =
        typeof response.error?.code === "number" ? response.error.code : null;
      const known = {
        "Cannot find context with specified id": "missing-context",
        "Cannot find default execution context": "missing-default-context",
        "Execution was terminated": "terminated",
        "Inspected target navigated or closed": "closed-target",
        "Runtime agent is not enabled": "runtime-disabled",
        "Internal error": "internal",
        "Promise was collected": "promise-collected",
      };
      const message = response.error?.message;
      const reason =
        typeof message === "string"
          ? (known[message] ??
            "hash-" + createHash("sha256").update(message).digest("hex"))
          : "exception";
      return new Error(
        label
          ? `Main inspection failed [${label};code=${code};class=${kind};reason=${reason}]`
          : "Credential audit could not complete inside the main process",
      );
    };
    const connectMainInspection = async () => {
      const url = /Debugger listening on (ws:\/\/127\.0\.0\.1:[^\s]+)/.exec(
        logs,
      )?.[1];
      assert(url, "Main inspector unavailable");
      const socket = new WebSocket(url),
        requests = new Map();
      let sequence = 0,
        closed = false,
        groups = 0;
      const stop = () => {
        closed = true;
        for (const request of requests.values()) {
          clearTimeout(request.timer);
          request.reject(new Error("Main inspection connection closed"));
        }
        requests.clear();
      };
      socket.addEventListener("close", stop);
      socket.addEventListener("error", stop);
      socket.addEventListener("message", ({ data }) => {
        const response = JSON.parse(data),
          request = requests.get(response.id);
        if (!request) return;
        clearTimeout(request.timer);
        requests.delete(response.id);
        request.resolve(response);
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Main inspection connection timed out")),
          5000,
        );
        socket.addEventListener(
          "open",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            clearTimeout(timer);
            reject(new Error("Main inspection connection failed"));
          },
          { once: true },
        );
      });
      const call = (method, params = {}, timeoutMs = 25000) =>
        new Promise((resolve, reject) => {
          if (closed || socket.readyState !== WebSocket.OPEN)
            return reject(new Error("Main inspection connection closed"));
          const id = ++sequence,
            timer = setTimeout(() => {
              requests.delete(id);
              reject(new Error("Main inspection timed out"));
            }, timeoutMs);
          requests.set(id, { resolve, reject, timer });
          socket.send(JSON.stringify({ id, method, params }));
        });
      const enabled = await call("Runtime.enable");
      if (enabled.error) {
        socket.close();
        throw mainFailure(enabled, "main-runtime-enable");
      }
      return {
        call,
        nextGroup: () => `main-eval-${++groups}`,
        close: () => {
          stop();
          socket.close();
        },
      };
    };
    const mainEvaluate = async (
      expression,
      { label, timeoutMs, synchronous = false } = {},
    ) => {
      assert(
        typeof synchronous === "boolean",
        "Main inspection mode must be explicit",
      );
      assert(
        timeoutMs === undefined ||
          (Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000),
        "Explicit main inspection timeout must be bounded to300s",
      );
      const deadline =
        timeoutMs === undefined ? undefined : Date.now() + timeoutMs;
      assert(
        label === undefined || /^[a-z0-9-]{1,64}$/.test(label),
        "Inspection label must be a fixed safe operation name",
      );
      assert(
        inspectMain,
        "Main inspection was not enabled for this test instance",
      );
      assert(
        child.exitCode === null && child.signalCode === null,
        "Isolated main process already stopped",
      );
      // One session belongs to this exact App. A failed/closed session is never
      // reconnected and arbitrary evaluations are never replayed.
      mainSession ??= connectMainInspection();
      const session = await mainSession;
      const objectGroup = session.nextGroup();
      let failed = false;
      const request = (method, params) =>
        session.call(
          method,
          params,
          deadline === undefined ? 25000 : Math.max(1, deadline - Date.now()),
        );
      // Root async evaluations in this owned main until their response is read.
      // M9 synchronous observers must never start or await an async operation.
      const rootedExpression = synchronous
        ? expression
        : `(() => { const key=Symbol.for('willyou.test.main-evaluation'),pending=globalThis[key]??=new Map(),promise=Promise.resolve((0,eval)(${JSON.stringify(expression)}));pending.set(${JSON.stringify(objectGroup)},promise);return promise; })()`;
      try {
        // Retain the original remote result while converting/awaiting it. The
        // implicit awaitPromise path can lose an otherwise unreferenced promise.
        let response = await request("Runtime.evaluate", {
          expression: rootedExpression,
          awaitPromise: false,
          returnByValue: false,
          objectGroup,
        });
        if (response.error || response.result.exceptionDetails)
          throw mainFailure(response, label);
        const remote = response.result.result;
        if (synchronous && remote.subtype === "promise")
          throw new Error("Synchronous main inspection returned a promise");
        if (remote.subtype === "promise")
          response = await request("Runtime.awaitPromise", {
            promiseObjectId: remote.objectId,
            returnByValue: true,
          });
        else if (remote.objectId)
          response = await request("Runtime.callFunctionOn", {
            objectId: remote.objectId,
            functionDeclaration: "function(){return this}",
            returnByValue: true,
            objectGroup,
          });
        if (response.error || response.result.exceptionDetails)
          throw mainFailure(response, label);
        return response.result.result.value;
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        try {
          if (!synchronous) {
            const cleared = await session.call(
              "Runtime.evaluate",
              {
                expression: `(() => { const key=Symbol.for('willyou.test.main-evaluation'),pending=globalThis[key];pending?.delete(${JSON.stringify(objectGroup)});if(pending?.size===0)delete globalThis[key];return true; })()`,
                returnByValue: true,
              },
              1000,
            );
            if (cleared.error || cleared.result.exceptionDetails)
              throw mainFailure(cleared, label);
          }
        } catch (error) {
          if (!failed) throw error;
        } finally {
          try {
            const released = await session.call("Runtime.releaseObjectGroup", {
              objectGroup,
            });
            if (released.error) throw mainFailure(released, label);
          } catch (error) {
            if (!failed) throw error;
          }
        }
      }
    };
    return {
      cdp,
      evaluate,
      mainEvaluate,
      waitFor,
      invoke,
      rendererErrors,
      navigationWaits,
      onCDP: (method, listener) => {
        const listeners = cdpListeners.get(method) ?? new Set();
        listeners.add(listener);
        cdpListeners.set(method, listeners);
        return () => {
          listeners.delete(listener);
          if (!listeners.size) cdpListeners.delete(method);
        };
      },
      processId: child.pid,
      waitForExit: (timeoutMs = 15_000) => {
        closeMainInspection();
        return new Promise((resolve, reject) => {
          const result = () => ({
            pid: child.pid,
            code: child.exitCode,
            signal: child.signalCode,
          });
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve(result());
            return;
          }
          const onExit = () => {
            clearTimeout(timer);
            resolve(result());
          };
          const timer = setTimeout(() => {
            child.off("exit", onExit);
            reject(new Error("Isolated App did not finish its normal exit"));
          }, timeoutMs);
          child.once("exit", onExit);
        });
      },
      crash: async () => {
        closeMainInspection();
        assert(
          child.exitCode === null && child.signalCode === null,
          "Test App is already stopped",
        );
        const exited = new Promise((resolve) =>
          child.once("exit", (code, signal) =>
            resolve({ pid: child.pid, code, signal }),
          ),
        );
        assert(child.kill("SIGKILL"), "Could not stop this isolated test App");
        return await Promise.race([
          exited,
          pause(3000).then(() => {
            throw new Error("Test App crash did not finish");
          }),
        ]);
      },
      arm,
      output: (ptyId) =>
        evaluate(`window.__m5?.output[${JSON.stringify(ptyId)}] ?? ''`),
      input: (ptyId, data) =>
        evaluate(
          `window.electronAPI.eventSend('pty:input', ${JSON.stringify({ ptyId, data })})`,
        ),
      screenshot: async (path) => {
        const { data } = await cdp("Page.captureScreenshot", { format: "png" });
        await writeFile(path, Buffer.from(data, "base64"), { mode: 0o600 });
      },
      logs: () => logs,
      close: async () => {
        closeMainInspection();
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(new Error("Electron test closed"));
        }
        pending.clear();
        ws.close();
        cdpListeners.clear();
        if (child.exitCode === null && child.signalCode === null) {
          const done = new Promise((r) => child.once("exit", r));
          child.kill("SIGTERM");
          await Promise.race([done, pause(3000)]);
          if (child.exitCode === null && child.signalCode === null)
            child.kill("SIGKILL");
        }
      },
    };
  } catch (error) {
    closeMainInspection();
    ws?.close();
    child.kill("SIGKILL");
    if (error && typeof error === "object") {
      error.electronStartupLogs = logs;
      error.electronStartupProcess = {
        pid: child.pid,
        code: child.exitCode,
        signal: child.signalCode,
      };
    }
    throw error;
  }
}
