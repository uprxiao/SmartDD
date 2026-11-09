# P070 Helper6 scope adjudication — original judge retained

Original `result.json` remains **7 passed / 1 failed**, unchanged. The failed assertion was added by this supplemental driver: every chord `mouseup` DOM `detail` must equal1. Root requested this separate adjudication against the original contract; there was no Native replay and no change to actual detail0.

Original T062 (captured authoritative-tests.md row) requires mouse move, left/right/middle down/up and wheel; page coordinates/buttons/deltas must agree. Fixed Orca adds tracked wheel target/buttons and unqualified up resolves heldbutton. Neither original T062 nor the fixed reference guarantees DOM detail1 for each release of a multi-button chord. Only that unsupported **DOM chord-detail-constant** assertion is withdrawn for the original-contract assessment. No new rule that detail must be0 is introduced.

Raw chord phases at the unchanged canvas coordinate280/425:

| Phase | DOM type | button | buttons | detail |
|---|---|---|---|---|
| left press | mousedown |0|1|1|
| right press | mousedown |2|3|1|
| omitted up resolves right | mouseup |2|1|1|
| omitted up resolves left | mouseup |0|0|0|

Both up CLI argv truly omitted `--button`; both actual operation receipts completed/attempt_count1. Right release also emitted auxclick/detail1; final left release emitted pointerup/detail0 and mouseup/detail0. These observed event types are not rewritten. Final held mask0 is correct. Native behavior causation is not generalized: no separate unmodifiedOrca Native chord replay was performed, and this evidence does not establish a universal Chromium detail rule.

Fixed-source confirmation goes beyond patch excerpts: `helper-source-proof.json` reconstructs **all80 CLI files** from hashed fixed upstream archive plus full patch979bc1..., with patch fuzz0, and matches them byte-for-byte to the immutable actual .6 source. Full Rust files are retained. In `cli/src/native/actions.rs:8311-8331`, click count uses the same button/2px/500ms/1→2→3→1 reference rule as Orca cdp-pointer-input.ts:47-58. `build_mouse_event_params:8336-8410` preserves tracked coordinates/mask and chooses heldbutton on omitted release; press saves the tracked click count, release sends that count and clears the matching held bit. `handle_mouseup:8605-8629` passes optionalbutton with no fallbackleft and commits temporary state only after successful dispatch. FixedOrca pointer-commands.ts:155-180 likewise sends tracked `clickCount` and updates mask/heldbutton. Both input models therefore send clickCount1 for these separated/changedbutton steps; that field and the observed DOM MouseEvent.detail are kept distinct. No timing/clock was manipulated and real rapid multi-click windows are not claimed tested (Rust deterministic coverage is separately recorded by root).

`original-contract-adjudication.json` independently rechecks all required coordinates/button/mask/target/exact delta/actual scroll/other-zone isolation and unique SQL receipts. Its seven T062 closures meet the original I criteria; root alone decides the authoritative ledger. The explicit-down modal regression also passes the original strict criterion: actual completed CLI before answering, actual opening/closed/return, SQL attempt1, no auto-up/click, subsequent real explicitup. All84 actual CLI invocations match their current run/operation/request and attempt_count1; no retry or historical receipt reuse.

Two-zone actual scroll quantization remains explicit: left requested dx-2.5/dy120.25 yields scrollLeft100→97.5 and scrollTop200→320.5; right requested dx1.25/dy-90.5 yields100→101.5 and200→109.5. WheelEvent deltas and nonorigin coordinates are exact, the other zone stays unchanged. The pre-execution floor/ceil CSSpixel bound is retained; actual fractional scroll is not rewritten as identical to requested delta. Held-right wheel records buttons2, and its omitted up records rightbutton/buttons0.

Prior .5 five-green evidence is preserved in its original version scope. This run directly rechecks .6 explicit decimal geometry and integer target moves plus finite fractional wheel; it does not relabel prior synthetic onclick/mousedown prompt tests as newly executed on .6 or claim all unrelated Helper behavior unchanged. Node source011 changes to the prior277-source closure are explicitly tracked; source/runtime identities and actual build gates are preserved. Crossframe/reset/navigation/detach/fastmulti-click and packaged UI remain separate boundaries. No formal count is changed by this file.
