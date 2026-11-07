# F01 AppKit receiver v2 — preparation only

No command below was executed. This is a new versioned synthetic fixture, not recovered M9 bytes or current F01 A evidence. Root must review and grant Native/compiler/OS/LS/UI resources after App036. Do not launch WillYou or the receiver in this preparation task.

## Exact private inputs and shape

`ROOT=/private/tmp/willyou-m12-F01-appkit-opener-v2-001`. The source assumes this exact root (0700); clone/retarget requires a separately frozen source. `runtime-001` is deliberately absent now. Before future binding, Root prepares only synthetic `runtime-001/fixtures/route.md`, `route.html`, `route.pdf` and uses the fixture directory itself as the fourth directory target. runtime/fixtures both0700, UID=current user, canonical/non-symlink. Source files must be genuine original agreed synthetic fixtures, nonempty ≤8MiB; this fixture does not generate/replace the PDF or add product UI. No daily project or authentication source is consumed.

`python3 "$ROOT/bind-inputs.py"` (future file-only setup) pins all four exactpaths/dev/inode/size/mode/mtime/ctime and three full hashes; generates a new non-secret nonce and unique bundleID/display name, binding0600 and Info.plist from the template. It creates only this future private App skeleton/receipt directory, never compiles/registers/launches. It refuses an existing App/config/receipts, preventing old queue/state reuse. No binding helper was run here.

## Future exact compile/sign commands — Root resource lease required

```sh
F01_ROOT=/private/tmp/willyou-m12-F01-appkit-opener-v2-001
F01_APP="$F01_ROOT/runtime-001/test-opener.app"
F01_EXE="$F01_APP/Contents/MacOS/F01ReceiverV2"
F01_LS=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
F01_SDK=/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk
mkdir -m 700 "$F01_ROOT/runtime-001/home" "$F01_ROOT/runtime-001/tmp" "$F01_ROOT/runtime-001/compiler-cache"
env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin HOME="$F01_ROOT/runtime-001/home" TMPDIR="$F01_ROOT/runtime-001/tmp" LANG=en_US.UTF-8 CLANG_MODULE_CACHE_PATH="$F01_ROOT/runtime-001/compiler-cache" /usr/bin/xcrun --sdk macosx clang++ -std=c++17 -fobjc-arc -O2 -Wno-deprecated-declarations -Werror=implicit-function-declaration -Werror=return-type -mmacosx-version-min=12.0 -arch arm64 -isysroot "$F01_SDK" -framework Foundation -framework AppKit "$F01_ROOT/receiver.mm" -o "$F01_EXE"
/usr/bin/codesign --force --sign - --timestamp=none "$F01_APP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$F01_APP"
```

Stop on compilation/signing error. Capture source/plist/config/executable/CodeResources SHA+mode and real compiler exit in the actual Root group; no success is implied by this document. No global cache, entitlements, default setter or startup service is installed.

## Read-only baseline, Alternate registration and true UI dispatch

All four current defaults must already be nonempty and not our receiver. Snapshot queries `NSWorkspace URLForApplicationToOpenURL` for the exact three files+directory; also reports only own bundle/path candidates from `URLsForApplicationsToOpenURL`. It does not set defaults, read file bytes or dispatch a document. Before registration, ownCandidates must be empty; if invoking the native snapshot itself makes the app discoverable, preserve that fact, do not assume the initial state is clean.

```sh
"$F01_EXE" --snapshot > "$F01_ROOT/runtime-001/defaults-before.json"
"$F01_LS" -f "$F01_APP"
"$F01_EXE" --snapshot > "$F01_ROOT/runtime-001/defaults-registered.json"
python3 "$F01_ROOT/check-defaults.py" "$F01_ROOT/runtime-001/defaults-before.json" "$F01_ROOT/runtime-001/defaults-registered.json" registered
```

Info.plist has only four `Viewer`/`LSHandlerRank=Alternate` document claims, LSBackgroundOnly=true, no URL scheme/imported type/default assignment. Native setActivationPolicy=Prohibited must actually succeed. A unique display name identifies this bundle in the **existing WillYou real file menu / root breadcrumb Open With**. Only real UI choosing that discovered app may dispatch the four items. Do not call `open -a`, direct NSWorkspace from a test caller, `app.invoke(openExternal)` or a swizzled opener as a replacement for that accepted UI. WillYou must send its current real file-reference NSURL to this exact app.

The event delegate only opens exact allowlisted paths after resolving the file-reference URL. It rejects any other path/multiple URL event; does not interpret argv as filenames; uses readonly O_NOFOLLOW descriptors, full byte hashes for files, fd/path identity before/after, no directory enumeration. One real event writes an exclusive0600 receipt with PID/exe/bundle/session/URL/dev/inode/hash/actual activation state and exits0. It exits2 without a receipt on timeout/rejection. It constructs no windows and requests no activation/network/child process. Real event delivery and nonactivation remain unverified until actual execution.

## Exact unregister/finally — always, including partial registration/failure

```sh
"$F01_LS" -u "$F01_APP"
"$F01_EXE" --snapshot > "$F01_ROOT/runtime-001/defaults-after-unregister.json"
python3 "$F01_ROOT/check-defaults.py" "$F01_ROOT/runtime-001/defaults-before.json" "$F01_ROOT/runtime-001/defaults-after-unregister.json" unregistered
```

Only the exact own bundle path is passed to -u. Never -kill/-r/global reset, LSSetDefault*, or restore defaults by writing them. Root separately verifies exact receiver PIDs/exe/birth from actual receipt/observations are absent, normal WillYou exit, own ports/socket/hooks clear. Do not infer process exit code solely from receipt content or issue signals based on a recycled PID. Preserve signed bytes privately until cleanup/default absence reviewed; no App enters safe archive.

## Known pending conditions, not promised guarantees

1. No Native/clang/LS operation has run; compilation, private app discovery for `.md` UTI and all4 types, true AppKit event delivery, nonactivation and exact -u disappearance remain pending. Alternate is a declared rank, not proof the OS will retain defaults. Compare all4 defaults after registration **before** any UI business; any change stops the group and retains failure.
2. A selected app can be launched/activated by LS despite source intent; runtime `isActive=false`, windows0, Prohibited, and the original WillYou guard must remain satisfied. Reject/stop on failure; no focus recovery workaround.
3. Current receiver deliberately requires the full original baseline fingerprint before reading. Historical genuine LS dispatch sometimes added `com.apple.lastuseddate#PS` with ctime; this strict v2 may reject such metadata changes. Save exact pre/event/post stat+xattr and retain the red; only Root may apply a separately reviewed finite preservation contract. Do not silently drop ctime, claim all stat unchanged, or rerun to hide it.
4. Query failure/default-empty/self-default/own-candidate duplication/registration residue are explicit missing prerequisites, not permission to set a default, use daily TextEdit/Finder, enumerate directories, or bypass genuine product UI.
