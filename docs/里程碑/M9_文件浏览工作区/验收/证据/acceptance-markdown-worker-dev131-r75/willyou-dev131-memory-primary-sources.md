# Memory measurement units

Checked 2026-10-19 against official primary sources:

- https://www.electronjs.org/docs/latest/api/structures/memory-info : MemoryInfo working/peak working sets are reported in kilobytes.
- https://github.com/electron/electron/blob/v42.0.0/shell/browser/api/electron_api_app.cc#L1351-L1365 : the corresponding implementation shifts the original byte counters right by10; this probe converts the reported integers back with1024, without interpreting them as JS heap bytes.

Raw process metrics and Runtime.getHeapUsage values are kept separately. Observed retained Worker heap is not continuous peak heap; main renderer peak working set is a distinct native process metric, not the sum of all App processes.

Packaged runtime observed: Electron42.11.14/Chromium148.0.7778.280/Node24.19.0. Exact42.11.14 public source fetch returned cache miss, so the42.0.0 link is an API-family implementation reference, not a falsely claimed exact-patch source verification. Runtime raw main-process memoryUsage.rss bytes and getAppMetrics workingSetSize are also retained for empirical unit comparison.
