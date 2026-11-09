# T131 first subgroup: original M11 T08 I-only, attempt 002

Ready for coordinator review, not executed. Supersedes 001 preparation only because 001 worker/node_modules linked the entire shared directory. Original 001 is frozen and unexecuted. New worker/node_modules is an actual private directory with 106 exact per-package/bin links; scope/.bin/.vite-temp/.vite directories are private. No shared .pnpm or whole node_modules symlink. Original 3726 input files were SHA-verified on clone.

Original three scenarios, 32 direct assertions, six native calls and app calls are AST-identical. Original/adapted test bytes are unchanged from 001. Only pre-run dependency/cache isolation changes; no business assertion changes. Source025 staged3462 files and App021 prebuilt244 resources; no compile.

After coordinator grants Native/Electron/SQLite resource lease:
```sh
WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 WILLYOU_TEST_CACHE_DIR=/private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/cache NODE_COMPILE_CACHE=/private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/cache/node node /private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/run.mjs --execute
WILLYOU_M12_NATIVE_LEASE_CONFIRMED=1 node /private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/verify-cleanup.mjs --verify
node /private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/judge.mjs
```

Pure cache preflight checked actual private realpaths and the pinned Vite/Vitest resolver implementations. Vite bundled-config temp=/private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/worker/node_modules/.vite-temp; configured cache=/private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/cache; Vitest results=/private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/cache/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json. Runtime temp will be freshly created at /private/tmp/willyou-m12-m11-regression-static-001/t08-first-002/runtime-001/tmp. No tests collected or Native/SQLite loaded in preparation. Original46 external input pins retained plus2 exact cache-resolver source pins.

The original I runner uses separately pinned project Electron Node; its Framework SHA differs from signed App021 and both identities remain explicit. This is I-layer evidence, not GUI A or a whole T131 pass. No model/login/daily data/OS Keychain required; original fake SecretCipher. Original stdio upstreams and Unix gateway only, no TCP service. Independent cleanup reads recorded PIDs/paths and sends no signal/deletion. Keep raw failures, verify cleanup before next native group, then offline judge all original channels/three cases. Formal新增0; remaining eight original cases and required A/R layers stay pending.
