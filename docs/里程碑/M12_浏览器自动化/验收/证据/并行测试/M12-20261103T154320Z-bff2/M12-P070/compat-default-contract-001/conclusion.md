# P070 compat omitted-text contract check (static only)

The original supplementary test expected omitted `--text` to preserve Native opening.defaultPrompt. **No supporting requirement or fixed reference behavior was found for that expectation.** Keep original raw/judge7green1red unchanged; classify the omitted-text mismatch as an unsupported supplementary default-value assumption pending coordinator adjudication, not by itself a proven production defect. Do not expand original T068 or change production merely to satisfy it.

## Requirement

Current authoritative M12 `需求.md:430` R04.6 states exactly `dialog accept [--text]` and `dialog dismiss`. It does not promise that accepting without text copies the prompt's initial value. It does not mandate identical UI and Agent input handling. The exact read-only document and hash are retained, no edit.

## Fixed Orca bd9455b61655b9e76504349a6c8571f74f14954f: dedicated path

- `src/cli/specs/browser-advanced.ts:205-210` exposes optional `--text`.
- `src/cli/handlers/browser-env.ts:106-109` calls getOptionalStringFlag and passes text through. `src/cli/flags.ts:26-32` returns undefined for absent/empty optional flag; no defaultPrompt lookup.
- `src/main/runtime/browser/browser-dialogs.ts:16-24` first tries actual live-screencast settlement with `params.text`; no fallback default value. This fast path matters and was traced rather than assuming all dedicated calls go through Helper.
- `browser-screencasts.ts:253-263` → `src/main/runtime/browser-dialog-settlement.ts:12-25` → `browser-screencast-stream.ts:206-219`: actual Page.handleJavaScriptDialog receives `{accept,...(promptText===undefined?{}:{promptText})}`. Omitting text omits the field.
- If no live stream settled it, `agent-browser-bridge-utility-commands.ts:27-34` builds `['dialog','accept']`, only pushes truthy text, and calls actual execAgentBrowser; it does not read prompt default.

## Fixed Orca: exec compatibility path

- `src/cli/handlers/browser-tab.ts:83-87` forwards the command string.
- `src/main/runtime/browser/browser-element-actions.ts:231-238` forwards command to bridge.
- `agent-browser-bridge-state-commands.ts:247-253` parses actual command argv then directly execAgentBrowser, with target flags stripped; no default text injection. Thus `exec --command 'dialog accept'` reaches the same native optional-promptText parser contract (static path evidence, **not a claim we executed this omitted-text exec variant**).

## Pinned actual Helper .4

Full-source bytes match reconstructed fixed upstream+patch and immutable .4 build input; executed pinned binary SHA7a009d... is recorded by the original runtime preflight. Relevant complete sources+hashes retained.

- `cli/src/commands.rs:1363-1372`: dialog accept adds promptText only when rest.get(1) exists. Absent text stays absent.
- `cli/src/native/actions.rs:4837-4843`: prompt_text=cmd.get("promptText").and_then(as_str), passed directly to mgr.handle_dialog. pending_dialog.default_prompt is not substituted.
- `cli/src/native/browser.rs:1317-1333`: builds `{accept}`, adds promptText only for Some(text), then sends actual Page.handleJavaScriptDialog. Omitted text means no promptText wire field.

## Frozen WillYou006 and actual result

`javascript-dialogs.ts:119-121` is the **user** response API and explicitly supplies `text??request.value.defaultValue`. The Agent path at123-127 preserves supplied text/undefined and at133 omits promptText if undefined. `service.ts:328-334` dedicated and exec dialog routing both pass missing text as undefined. Therefore the Agent route matches the fixed Orca/Helper omitted-field wire; the user API intentionally selects the UI's current/default value.

Actual compatible NativeCLI run (manifest ae3c43cd...): dedicated accept omitted text, Native opening defaultPrompt compat-default, actual closed.userInput and true page HTTP/CLIeval return empty string; CLI0/completed, attempt_count1. It did not start Helper at all; this verifies the production host path's result, not a new direct Helper execution. Explicit empty text also returned empty string and was independently passed. Actual exec accept with explicit text and exec dismiss passed; no-pending four actual CLI2/not-started/attempt_count1 passed.

Recommendation for coordinator: preserve original supplementary red as an expectation/contract finding; there is no evidence here requiring a production default-injection fix. If the product later chooses “omitted text preserves default”, that is an explicit semantics decision requiring synchronized requirements/CLI/exec and tests, rather than an inferred correction. Current original six T068 basic cases remain valid within their recorded scope. No Native/Helper/CLI/UI/port execution occurred during this static check.
