# A51 independent QA public macOS notification authorization probe

Scope: C22 unchanged exact signed QA bundle, private data; no App launch, system authorization, registration, notification/history access, or user setting change during preparation.

## Findings and evidence

- Actual preceding C22 independent QA normal LaunchServices startup succeeded with clean env and original foreground restored. A real synthetic completed schedule hit native failed "Notifications are not allowed for this application" in 5ms, no show, no delivered_at. Current system status (notDetermined vs denied) is not established.
- Local Electron 42 d.ts/project search exposes no public notification authorization request. Apple documents public `UNUserNotificationCenter.getNotificationSettingsWithCompletionHandler:` and `requestAuthorizationWithOptions:completionHandler:`. The first request can display the real system prompt; subsequent calls do not prompt again. No provisional/silent authorization is used. Source: [Apple official requestAuthorization](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter/requestauthorization%28options%3Acompletionhandler%3A%29/).
- Native QA candidate's actual entitlements include `com.apple.security.cs.disable-library-validation=true`. The private compiled addon is an ordinary arm64 Mach-O N-API v4 bundle with linker ad-hoc signature. Only system Foundation/UserNotifications frameworks plus standard runtimes. No Electron bundle changes or resigning.
- Compilation passed; normal Node v22.23.1 arm64 N-API 10 loaded the private addon. Actual negative guard returned bundle=false, exe=false, privateScope=false, nativeMain=true, allowed=false. Settings/request with correct readiness token both fail A51_QA_SCOPE; wrong token fails A51_QA_USER_READY. No UNUserNotificationCenter API reached. Actual Electron-load ABI remains to be verified with isolated signed QA; no claim of real system permission.

## Actual future execution

Exact command (requires the coordinator's unique real App resource and actual person readiness if OS status is notDetermined):

```shell
node /private/tmp/willyou-m16-f36-qa/a51-c22-qa-ls-notification-authorization-and-remainder.mjs /private/tmp/willyou-m16-c22-build.lzva5qim/qa/mac-arm64/WillYou.app/Contents/MacOS/WillYou --coordinator-authorized-a51-c22-qa-ls-auth-probe --candidate-asar-sha 26485f7f4eeaaa3167da5499170f7f59cf81a0f2f3d5aebe3274c63edb00e533 --candidate-native-sha 5958e696d973ee8e304333442dc4c55d58402f22a8714af164c6b182fb3d3080 --qa-display-name 'WillYou QA M16 Notifications' --authorization-probe-only --authorization-read-status-only
```

To avoid a second launch when the coordinator wants full real acceptance, replace last two flags with `--continue-actual-a51-on-granted`. This invokes no request before actual OS state notDetermined and one user readiness receipt. For technical permission request only, omit `--authorization-read-status-only` while retaining `--authorization-probe-only`. Readiness receipt is NOT authorization; system UI grant is established by request callback true and independently read fresh authorized status. Denied/unknown does not request/repeat, create notification or modify system settings.

Exact handoff action `qa-notification-authorization-ready`, true user ready only; receipt fields `handoffId,pid,action,userConfirmed:true,bundleId:'com.smartdd.desktop.qa.m16-notifications',ready:true`. Driver then emits a51QaNativePermissionRequestStarting and polls actual API completion up to 10min; it does not click, accept, or simulate prompt. The person must inspect genuine macOS exact QA dialog and choose permission. If the dialog is not clearly scoped to independent QA, do not approve it, preserve blocked. On actual grant + fresh authorized, full mode continues isolated synthetic setup and remaining notification routing under the existing actual user handoff contract; no formal A51 pass without its original requirements.

## Native source and private files

- a51-c22-qa-un-notification-auth.mm SHA 367a6a2f895ee18527f4762a9392dfb943761ac96858acd723617f15475b8d82
- a51-c22-qa-un-notification-auth.node SHA 978df252693f71cc1ac80d5794a4c716fc4606979496922281d5666274379ba9
- a51-c22-qa-ls-notification-authorization-and-remainder.mjs SHA 536b2d32ab6b1d6d2f21e2a76bf5f1f40f7ae6c264c82f1763427dc5f973e018
- Same validated LaunchServices harness, owned ports, prior-front restoration, isolated clean env and normal owned termination.
- System history API not called by the addon and not called by standard 90s fallback.
