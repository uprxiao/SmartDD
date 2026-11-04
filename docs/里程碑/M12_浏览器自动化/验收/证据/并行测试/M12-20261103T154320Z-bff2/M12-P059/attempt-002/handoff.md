# P059 attempt002 exit-only diagnostic

Same actual App015/ASAR f4972f89…; new isolated userData/project/two actual PTYs and three actual UI-created pages. Both existing PTYs were bound via real UI without PID/run change. T1 new page was visible at the end. Neither synthetic receiver executes CLI. Both task PTY records became null and exact roots disappeared before normal app.quit().

Independent judge 7/7. Save and commit emitted by production and answered ready through the original trusted renderer/handler. Actual exit code0/signal null in 535ms from request (432ms from first before-quit); no fallback signal. All five observed WebContents destroyed, will-quit snapshot zero contents/windows, no new WC after quit request. Raw creation stacks and lifecycle/file-close events preserved. JSONL writesFailed=0.

This exit-only state lacks original T115 three native CLI calls, Agent focus event and operation activity/timer conditioning. Original P056003 anomaly remains unresolved by this passing diagnostic; no causal conclusion and no formal case increment.

Passive WC/app/window listeners, original send and exact files.answerClose handler delegates preserve event/argument/authentication/ready/Promise/throw behavior. Internal Electron handler Map observation and 100ms unref window polling are explicit; sync disk logging may affect timing. Node inspector disconnected by the original harness waitForExit behavior before waiting. Private harness only records actual child exit, inspector-close times and existing cleanup signal returns. Original ASAR untouched.

Resource lease released after exact 11 PID/6 numeric TCP/Unix/three helper directory checks. Current source 3452 hashes/modes, 151 private dependencies, 31 copied/adapted source files and five package resources reverified. Original001 driver failure frozen56-file manifest ac98cfa8…; actual monitorOptions semantic checks and negative str/dst control included here.

Executed once: WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-p059-exit-app-002/cache node /private/tmp/willyou-m12-p059-exit-app-002/run.mjs --execute
