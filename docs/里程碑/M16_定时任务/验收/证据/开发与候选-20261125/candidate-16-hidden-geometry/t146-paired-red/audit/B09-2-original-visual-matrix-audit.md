# B09.2 read-only original visual contract audit

Original source: M16 验收/测试用例.md:209; M12 验收/测试用例.md:209–210 (T145/T146). Original T145 accepted 456 old host scope keys, 57 × 8 combinations; original evidence explicitly not a new final-build pixel equality. Current C16 paired coverage cannot be inferred from old M12 or current source equivalence.

## Exact matrix dimensions and state keys

8 original combinations: light/dark × right pane 480/900 CSS px × real window 1440×900 and 1920×1080, original content and zoom. Current candidate/old paired proof missing across these combinations before upcoming actual run. Original source SHA256 4d932fc04297a706aca7f1dbcde40a13b433516bc2a625dac8f2c69060d9ed08.

- B01 (7): B01-02-tab-hover, B01-02-tab-keyboard, B01-02-tab-pressed, B01-02-toolbar-keyboard, B01-02-toolbar-pressed, B01-long-title-url, B01-tabs-entry
- B02 (2): B02-loading-stop, B02-toolbar-ready
- B03 (2): B03-address-edit, B03-invalid-address
- B04 (7): B04-dns, B04-not-running, B04-offline, B04-other, B04-refused, B04-reset, B04-timeout
- B05 (2): B05-certificate, B05-certificate-exception
- B06 (3): B06-basic-auth, B06-external-app, B06-permission
- B07 (3): B07-download-done, B07-download-failed, B07-download-progress
- B08 (2): B08-find-matches, B08-find-zero
- B09 (2): B09-agent-active, B09-agent-hold
- B10 (2): B10-paused, B10-resumed
- B11 (4): B11-access-control, B11-access-observe, B11-grants-empty, B11-grants-populated
- B12 (7): B12-profiles-clone, B12-profiles-default, B12-profiles-delete-confirm, B12-profiles-independent, B12-profiles-sites, B12-recovery-clear-confirm, B12-recovery-failed
- B13 (9): B13-import-confirm, B13-import-denied, B13-import-keychain-simulated, B13-import-missing-browser, B13-import-recovery-disabled, B13-import-source, B13-import-success, B13-import-timeout, B13-import-undecryptable
- B14 (3): B14-settings, B14-settings-clear-confirm, B14-settings-restart
- R01 (2): R01-11-launcher-empty, R01-11-launcher-recent

## Existing actual evidence — reuse scope only

- C03 native menu, real parked preview and dark menu paired fixes; candidate-03-browser-manual/result.json has actual ordinary browser-file/terminal transition; no exact 8-combo old-versus-C16 images.
- C13 actual-C12-red/actual-C13-green overlay race, profile-overlay-regression/index.json: 53 actual interactions, 10 native parked previews, 8 exact native same-document restores, ordinary profile/menu/settings and task/identity transfer. Covers functional and visual affected scope at reported geometry only; not old-product visual matrix.
- C14 candidate-14-hidden-viewport/placement-race/index.json: exact native front slot and same logical page owner across actual two-page placement race, not theme/layout matrix.
- C16 candidate-16-hidden-geometry/actual-C16-green/index.json and schedule hidden screenshot: native page PNG, actual hidden/restore geometry and same page. Not shell visual matrix or actual operating-system composite.
- T146 original App037 actual A003 proof result.safe.json: real mouseMoved and ≥450ms, role=tooltip exact title + newline + 1000+ char URL, title Range inside tooltip, actual native park and own page snapshot, Escape restores same page; not native OS tooltip. Current source workspace.tsx lines 95–112 uses `title` URL and passes titleTooltip=null. Real paired A must adjudicate; if old also misses, identify preexisting regression, not M16-specific.

## Reusable driver and missing boundaries

- Original T145 per-state drivers: App041-1080-A016-captured32-reviewed/driver/run.mjs and host-ui.mjs (actual task, theme, separator, native placement, shell PNG). Original 1920×1080 batch explicitly required unique extended display and actual window inner geometry; current prior hardware evidence one online display. Cannot claim 1080 from CSS emulation, scaling or screenshot resize. Other 57 states use historical scoped fixtures; full paired execution is many separate batches and some require hardware/real native permission.
- New private driver browser-driver-b09-t146-pair-c16.mjs uses known independent old-clean/new roots only to create fresh synthetic visual project/task (B07 original task IDs untouched). Fixed equal long page title and >1000char URL, two true labels, actual native shell setBounds 1440×900 as synthetic geometry setup, actual light theme and right 480 via normal UI, actual full address End, selected title overflow check, real hover role=tooltip and title Range, native park/preview, restore, shell/native PNG. Record actual DPR and zoom. Do not claim pass if exact match not achieved.
- Optional 1440-only four combos: shallow/deep and 480/900, normal selected, menu+actual native park, long unselected. These are a subset of 57 original states, not whole T145. Actual central shell PNG excludes independent native view unless product has genuinely parked and displays its own screenshot; separate native page PNG is not a genuine OS compositor screenshot. No physical user focus, security storage, real login or native/system permission.
- Estimate two launches + T146 actual pair 1–2 min; four combo subset 2–4 min if true UI geometry works. Full dual-bundle 456-state matrix is not feasible in same quick run; all unexecuted paired scopes remain explicitly pending.

No App launched during audit/preflight.
