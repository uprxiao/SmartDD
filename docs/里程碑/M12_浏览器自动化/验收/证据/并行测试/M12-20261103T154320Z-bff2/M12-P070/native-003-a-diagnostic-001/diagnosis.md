# P070003-A static diagnosis (no further Native execution)

Original attempt manifest c6c6bd6a7909912f02afc5bb1a97ac2e2049615ab84f27f42a193c12078eed47 stays frozen. Actual .4 Helper SHA7a009d321491f0645a3c2526639490f624a7b6af967f325add9490c0c274876f. Relevant full Rust files copied from immutable P007005 proof; every byte also compared with the actual .4 build source path. Original source-provenance.json proves all80 patched CLI inputs exactly reconstructed from fixed upstream+patch eb00b4..., and .4 build target SHA equals executed fixed binary. No reliance on mutable .2 target.

## 1. Synthesized Helper click loses its pending mouse release after host answer

`patched-4/cli/src/native/interaction.rs:9-25` explicitly defines pending_release for a *synthesized click*, where dialog opens after press before release. `dispatch_click` at1045-1075 returns PendingRelease(session,x,y,button) when prompt opens from mousedown. It never sends the release in that branch. The full release implementation at1103-1133 sends Input.dispatchMouseEvent mouseReleased/buttons0/clickCount1 to that saved session/point.

All occurrences of `pending_pointer_release` in the full .4 source:
- actions.rs:253 declaration;311 initial None.
- actions.rs:2761 click setter;2784 dblclick setter;5849 semantic-find click setter.
- actions.rs:4849 only take/read;4851 dispatch_pending_release, inside **Helper handle_dialog**.
- actions.rs:1121-1123 Page.javascriptDialogClosed only clears pending_dialog. It neither consumes pending_pointer_release nor dispatches a release.
No hidden second consumer was found in all full80 source files (original occurrence inventory retained).

Frozen006 host sends dialog replies through production JavascriptDialogs.respondFromAgent → owner.proxy Page.handleJavaScriptDialog, rather than Helper handle_dialog; this is the approved cold route and is also used by the real user callback. Therefore host/UI answers skip the only release consumer. This source inference matches actual events: onclick prompt had complete primary down/up/click; mousedown prompt had primary pointerdown/mousedown then true closed/return but **no primary pointerup/mouseup/click**, followed by a different followup full click, primary0/followup1. Both actual Helper find and answer receipts still reported completed. Followup success alone does not prove the original synthesized click was completed.

Correctness requirement: release a synthesized click's saved release once, on matching dialog resolution, regardless of genuine user or agent host answer; preserve page/session identity and original clicked coordinates/button. Explicit mouse down/up is a distinct contract: do not turn every dialog close into unconditional mouseup or auto-complete explicit down. No production/patch/expectation changed here; root owns implementation. If release is deferred to a subsequent Helper command, it must occur before that command changes pointer coordinates and must not require an extra unrelated command; a genuine user answer with no later Helper call still needs correct release.

## 2. Finite decimal coordinates accepted by contract fail in pinned parser

Actual original CLI argv: mouse move --x122.04296875 --y64 (actual measured center); one attempt, exit5 BROWSER_ERROR/unknown, message Missing arguments for: mouse move. It never reached explicit down/up.

- .4 `commands.rs:2380-2405` parses x/y with `parse::<i32>()`; malformed or decimal input is mislabeled MissingArguments. This is not missing CLI flags.
- Frozen006 `page-commands.ts:14-17` accepts any finite number, and line31 emits String(finite(x/y)) unchanged. Runtime generated schema declares x/y type number (not integer); authoritative generator FIELD_OVERRIDES line258 does the same. Original requirement R04.1 lists mouse move/down/up/wheel without introducing integer-only coordinates.
- Fixed Orca bd9455b61655b9e76504349a6c8571f74f14954f browser-advanced.ts:131-134 exposes --x<n>/--y<n>. Its actual pointer bridge at agent-browser-bridge-pointer-commands.ts:106-130 passes number x/y unchanged to Input.dispatchMouseEvent through host CDP (ensureSession:false), with assertFinitePointerValues. cdp-pointer-input.ts:62-67 only checks Number.isFinite, no rounding/integer restriction. Runtime browser-pointer-input.ts:22-28 passes the same number values through. This supports decimal pointer coordinates.

Recommendation (root decision): preserve finite-number public contract; adapt the host pointer path as Orca does, or amend fixed native parser to accept valid CDP finite f64 with proper preflight validation, rather than silently changing generated schema to integer or rounding the test center to hide original red. If adopting host pointer dispatch, retain real per-page held-button state for explicit move/down/up/wheel/chord semantics; a one-shot coordinate conversion alone is insufficient. Existing integer-only native parser and OriginalCLI error/unknown must remain recorded. Future retest needs the original decimal case plus the not-executed explicitdown/up, and samepage pause/revoke/send/receipt guards.

## Actual timing/boundaries

onclick opening1793811455101 → closed1793811465117 (10016ms); mousedown opening1793811470690 → closed1793811480713 (10023ms). Actual queue observations include pending0/1, no out-of-band answer exception. The raw actual command/event/timing evidence is preserved in original attempt. This static diagnosis does not claim an explanation of all10s latency, only records it. No additional Native/Helper/CLI/UI/listener was started. 8 compat/default/no-pending branches remain unexecuted; no formal increment.
