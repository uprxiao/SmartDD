// ../../../../../private/tmp/willyou-m12-p070-dialog-software-006/source/src/preload/browser-prompt.ts
var import_electron = require("electron");
var worldId = 1007;
import_electron.webFrame.setIsolatedWorldInfo(worldId, { name: "WillYou native prompt" });
import_electron.contextBridge.exposeInMainWorld("__willyouNativePrompt", (message, initial) => {
  if (typeof message !== "string" || typeof initial !== "string") throw new TypeError("Prompt arguments must be strings");
  let completed = false, value = null, failure;
  const evaluation = import_electron.webFrame.executeJavaScriptInIsolatedWorld(worldId, [{
    code: '(()=>{if(typeof process!=="undefined"||typeof require!=="undefined")throw Error("Unexpected Node in prompt world");return window.prompt(' + JSON.stringify(message) + "," + JSON.stringify(initial) + ");})()"
  }], false, (result, error) => {
    completed = true;
    value = result;
    failure = error;
  });
  void evaluation.catch(() => {
  });
  if (failure) throw failure;
  if (!completed) throw new Error("Native prompt did not settle synchronously");
  if (value !== null && typeof value !== "string") throw new TypeError("Invalid native prompt result");
  return value;
});
import_electron.contextBridge.executeInMainWorld({ func: () => {
  const bridge = window.__willyouNativePrompt;
  window.prompt = function(message = "", initial = "") {
    return bridge(String(message), String(initial));
  };
} });
