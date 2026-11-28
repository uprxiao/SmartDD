# C12 preflight scope mismatch (read-only follow-up)

## Current actual observations

`/private/tmp/willyou-m16-f36-run-URoc7F/scope-attempts.jsonl` (SHA c875c3f78f4fc55997f459b812aa8229e949601b8024f75f42869f4d8441ba99) has three real same-cadence attempts, resource group 175514 and external controller 1567. Each attempt had no observed unbound identity/ESRCH gap. Both native starts and exits were individually unchanged within each accepted *observation interval*, but total net-live was 35/34/34 versus exactly proven member graph 33/32/32. Only one independently owned native short-lived system child differed between the first and second observations. This does not identify the remaining difference or prove its members exited.

The 32 exact known identities in the final observation comprise 29 product identities (6 candidate main/bridge executables, 2 native Electron helper, 6 actual Electron renderer, 5 native agent-browser, 5 verified Codex, 5 native Python runtime) and 3 exact test instruments (own wrapper, driver Node, sampler Python). The 5 detached browser helper daemons have parent PID1 and independently verified current exact page generation metadata/birth/CID; they are counted. The real C10 sealed private `capability_run_processes` records include 5 CLI and 5 bridge PID/birth entries, all matched prior actual native birth facts 10/10. Those same kinds of live current ledger records are included in C12 graph. There is no known current omitted ledger process to add. No all-system process iteration was performed; unknown group members have never been read.

Historical observations: C08/C09 raw known product/runtime counts were 29 with four exact independent test instruments; initial native group net counts were 35,36,34 across C08/D2/D3. C10 business-only raw known fixed subset 24 omitted five existing Python runtime descendants, which C12 exact graph now captures. C10 native net count37. Thus group-vs-enumerated difference was not a constant two across runs; subtracting 2 would be an invented correction. Historical M12 P088 `kernel-2.json` observed isolated wrapper+driver exact two and native group started3/exited1 at a different run; this supports possible one-to-one in that small shape, not all product Mach tasks. P079 actual detached child inheritance/CPU accounting is earlier support, not equivalent current full RSS.

## OS counter semantics (not an identification of those two)

Actual machine `25G76`, Darwin25.6.0, xnu-12377.161.13~4. Exact current kernel source tag not available in the verified browse. Apple's primary open-source XNU main branch documents that resource counters count active Mach tasks, not a documented direct PID list. Kernel exec creates another task representation and replaces the BSD process view; resource rollup has explicit exec-copy/exec handling. This makes a naive identity-count subtraction unreliable. Extra live Mach tasks during lifecycle, or actually unbound alive coalition members, remain plausible. Neither was demonstrated to be the precise difference on this machine.

Primary sources (analysis context, source version boundary):
- https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/coalition.c
- https://github.com/apple-oss-distributions/xnu/blob/main/doc/observability/coalitions.md
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c
- https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/thread.c

`coalitionctl` is not available via installed PATH. Current SDK `sys/proc_info.h` provides PID/parent/group selection but no direct public coalition-scoped PID listing selector. No privileged interface, broad global task inventory, or arbitrary process search was attempted.

## Adjudication

C12 does not meet prospective formal whole-live RSS closure; no approved live-count calibration happened because baseline itself did not close. No 1800s C12 run was started. Actual five warmups did pass, conservative known exact group CIDs and raw counter observations are valuable. C12 main-only profiler separately supports reduced synchronous process identity work, not whole-process threshold. Unknown count/PID semantics cannot substitute for exact live all-process RSS or complete original CPU scope. If any further timed business-only run is authorized, it remains diagnostic and cannot be called formal B11.1.

All exact recorded 33 process births and 20 helper socket paths cleared; actual App/driver exits zero, exact own endpoints refused. Full raw and source pointer index `/private/tmp/willyou-m16-f36-run-URoc7F/scope-preflight-index.json`. No additional App launched during this read-only analysis.

## 2026-11-26 follow-up: no supported scoped process-list method established

The installed macOS SDK export stubs `usr/lib/system/libsystem_kernel.tbd` and `usr/lib/libproc.tbd` list `coalition_info_pid_list` and `proc_listcoalitions`. The installed public headers checked do not declare the former. Apple’s published XNU `main` [userspace wrapper](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/libsyscall/wrappers/coalition.c) and [public coalition header](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/coalition.h) contain no supported `coalition_info_pid_list` declaration; the kernel-internal PID list is not an established user-space API. The [published resource usage struct](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/osfmk/mach/coalition.h) includes a sum of physical footprint, not the original required sum of RSS. Exact running kernel source tag could not be fetched.

The export label alone proves no callable or appropriately authorized contract; no undocumented function call, privilege change, system-wide process inspection, or resource-usage substitution was performed. Existing scoped proof is not sufficient for whole-process RSS, so this is not a reason to repeat a 30-minute run without an improved attributable sampling method. Current user is using the same Mac for daily work. Continue formal B11.1 only in an environment providing a complete attributable process scope; retain the prior failed trend and uncertainty.
