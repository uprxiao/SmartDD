// Native quit performer for M11 T14 A-layer.
//
// Flow (all through the real macOS UI surfaces, no signals, no synthetic pointer events):
//   1. locate the acceptance window by owner PID + title marker (CGWindowList);
//   2. activate the app so the application menu and the quit prompt are live;
//   3. press the application menu item "Quit <App>" through the Accessibility API;
//   4. find the running-task confirmation, which is a separate AXWindow with
//      subrole AXDialog (it is NOT a child of the app element), and press "退出";
//   5. wait until the owning process actually terminates and record it.
//
// Usage:
//   swift native-quit-performer.swift --title-marker "A · M11 NORMAL QUIT ·" [--timeout-ms 120000] [--out path] [--dry-run]
// Exit codes: 0 quit completed, 3 marker window not found, 4 accessibility failure,
//             5 dry-run listing, 6 quit pressed but process still alive.
import Foundation
import AppKit
import CoreGraphics
import ApplicationServices

func argumentValue(_ name: String) -> String? {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

func timestamp() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date())
}

func writeReceipt(_ payload: [String: Any], _ code: Int32) -> Never {
    let outputPath = argumentValue("--out") ?? "/dev/stdout"
    do {
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: URL(fileURLWithPath: outputPath))
        FileHandle.standardOutput.write(data)
    } catch {
        FileHandle.standardError.write(Data("receipt-write-failed: \(error)\n".utf8))
    }
    exit(code)
}

func onscreenWindows() -> [[String: Any]] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func element(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let raw = attribute(element, name) else { return nil }
    guard CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(raw, to: AXUIElement.self)
}

func role(_ element: AXUIElement) -> String { (attribute(element, kAXRoleAttribute) as? String) ?? "" }
func title(_ element: AXUIElement) -> String { (attribute(element, kAXTitleAttribute) as? String) ?? "" }
func subrole(_ element: AXUIElement) -> String { (attribute(element, kAXSubroleAttribute) as? String) ?? "" }
func children(_ element: AXUIElement) -> [AXUIElement] { (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func windows(of app: AXUIElement) -> [AXUIElement] { (attribute(app, kAXWindowsAttribute) as? [AXUIElement]) ?? [] }

func descendants(_ root: AXUIElement, limit: Int = 400) -> [AXUIElement] {
    var result: [AXUIElement] = []
    var queue = children(root)
    while !queue.isEmpty && result.count < limit {
        let current = queue.removeFirst()
        result.append(current)
        queue.append(contentsOf: children(current))
    }
    return result
}

func isRunning(_ pid: pid_t) -> Bool {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
    return !app.isTerminated
}

final class WindowHit {
    let pid: pid_t
    let title: String
    let owner: String
    let bounds: [String: Any]
    init(pid: pid_t, title: String, owner: String, bounds: [String: Any]) {
        self.pid = pid
        self.title = title
        self.owner = owner
        self.bounds = bounds
    }
}

func matchingWindows(marker: String) -> [WindowHit] {
    onscreenWindows().compactMap { window in
        let windowTitle = (window[kCGWindowName as String] as? String) ?? ""
        let pidValue = window[kCGWindowOwnerPID as String] as? Int ?? -1
        let layer = window[kCGWindowLayer as String] as? Int ?? -1
        guard layer == 0, pidValue > 0, !windowTitle.isEmpty else { return nil }
        guard marker.isEmpty || windowTitle.contains(marker) else { return nil }
        let owner = (window[kCGWindowOwnerName as String] as? String) ?? ""
        return WindowHit(pid: pid_t(pidValue), title: windowTitle, owner: owner,
                         bounds: (window[kCGWindowBounds as String] as? [String: Any]) ?? [:])
    }
}

/// The application menu is the menu bar item whose title is the application name;
/// index 0 is always the Apple menu.
func applicationMenuItem(bar: AXUIElement, owner: String) -> AXUIElement? {
    let items = children(bar)
    if let exact = items.first(where: { !title($0).isEmpty && title($0) == owner }) { return exact }
    if let partial = items.first(where: { let value = title($0); return !value.isEmpty && value.contains(owner) }) { return partial }
    return items.count > 1 ? items[1] : nil
}

/// The running-task confirmation is its own window with subrole AXDialog.
func quitDialog(of app: AXUIElement) -> AXUIElement? {
    if let dialog = windows(of: app).first(where: { subrole($0) == "AXDialog" }) { return dialog }
    return descendants(app).first { role($0) == "AXSheet" || subrole($0) == "AXDialog" }
}

func dialogText(_ dialog: AXUIElement) -> String {
    descendants(dialog, limit: 60)
        .compactMap { attribute($0, kAXValueAttribute) as? String }
        .filter { !$0.isEmpty }
        .joined(separator: " | ")
}

let marker = argumentValue("--title-marker") ?? ""
let timeoutMs = Int(argumentValue("--timeout-ms") ?? "120000") ?? 120000
let dryRun = CommandLine.arguments.contains("--dry-run")
let trust = AXIsProcessTrusted()

var hit: WindowHit?
let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
repeat {
    if let first = matchingWindows(marker: marker).first { hit = first; break }
    usleep(300_000)
} while Date() < deadline

guard let window = hit else {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": false,
        "reason": "marker-window-not-found", "marker": marker,
        "accessibilityTrusted": trust, "onscreenWindows": onscreenWindows().count,
    ], 3)
}

func appElement(_ pid: pid_t) -> AXUIElement { AXUIElementCreateApplication(pid) }

let activated: Bool = {
    guard let running = NSRunningApplication(processIdentifier: window.pid) else { return false }
    return running.activate(options: [.activateAllWindows])
}()
usleep(700_000)

let app = appElement(window.pid)
let menuBar = element(app, kAXMenuBarAttribute)
let barTitles = menuBar.map { element in children(element).map { title($0) } } ?? []

if dryRun {
    let dialog = quitDialog(of: app)
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": true, "dryRun": true,
        "pid": Int(window.pid), "windowTitle": window.title, "windowBounds": window.bounds,
        "accessibilityTrusted": trust, "activated": activated,
        "menuBarTitles": barTitles, "axWindows": windows(of: app).count,
        "dialogSubrole": dialog.map { subrole($0) } as Any,
        "dialogText": dialog.map { dialogText($0) } as Any,
        "dialogButtons": dialog.map { element in
            descendants(element, limit: 60).filter { role($0) == "AXButton" }.map { title($0) }
        } as Any,
    ], 5)
}

guard trust, activated, let bar = menuBar, let appMenuItem = applicationMenuItem(bar: bar, owner: window.owner) else {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": false,
        "reason": "accessibility-or-activation-unavailable", "pid": Int(window.pid),
        "windowTitle": window.title, "accessibilityTrusted": trust, "activated": activated,
        "menuBarTitles": barTitles,
    ], 4)
}

let openError = AXUIElementPerformAction(appMenuItem, kAXPressAction as CFString)
usleep(500_000)

var pressedTitle: String?
var quitEnabled: Bool?
if let menu = children(appMenuItem).first {
    for item in children(menu) {
        let itemTitle = title(item)
        let isQuit = (itemTitle.hasPrefix("Quit") || itemTitle.hasPrefix("退出"))
            && !itemTitle.contains("Force") && !itemTitle.contains("强制")
        guard isQuit else { continue }
        var enabledValue: AnyObject?
        AXUIElementCopyAttributeValue(item, kAXEnabledAttribute as CFString, &enabledValue)
        quitEnabled = (enabledValue as? Bool) ?? true
        if AXUIElementPerformAction(item, kAXPressAction as CFString) == .success { pressedTitle = itemTitle }
        break
    }
}

guard let pressed = pressedTitle else {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": false,
        "reason": "quit-item-not-pressed", "pid": Int(window.pid), "windowTitle": window.title,
        "openMenuError": Int(openError.rawValue), "menuBarTitles": barTitles,
        "menuItems": children(children(appMenuItem).first ?? appMenuItem).map { title($0) },
    ], 4)
}

// Poll for the confirmation window, then for the real process exit.
var dialogSeen = false
var seenText = ""
var confirmationTitle: String?
var confirmationResult: Int32?
let dialogDeadline = Date().addingTimeInterval(20)
repeat {
    if let dialog = quitDialog(of: app) {
        dialogSeen = true
        seenText = dialogText(dialog)
        if let button = descendants(dialog, limit: 60).first(where: { role($0) == "AXButton" && title($0) == "退出" }) {
            confirmationTitle = "退出"
            confirmationResult = AXUIElementPerformAction(button, kAXPressAction as CFString).rawValue
            break
        }
    }
    usleep(300_000)
} while Date() < dialogDeadline

var exited = false
let exitDeadline = Date().addingTimeInterval(30)
repeat {
    if !isRunning(window.pid) { exited = true; break }
    usleep(200_000)
} while Date() < exitDeadline

let exitCode: Int32 = exited ? 0 : 6
writeReceipt([
    "schema": "m11-native-quit-receipt-v1",
    "at": timestamp(),
    "ok": exited,
    "reason": exited ? NSNull() : "process-still-running",
    "pid": Int(window.pid),
    "owner": window.owner,
    "windowTitle": window.title,
    "windowBounds": window.bounds,
    "accessibilityTrusted": trust,
    "activated": activated,
    "path": "AX menu bar -> application menu -> Quit item (kAXPressAction) -> AXDialog -> 退出",
    "quitItemTitle": pressed,
    "quitItemEnabled": quitEnabled ?? true,
    "confirmationDialogAppeared": dialogSeen,
    "confirmationDialogText": seenText,
    "confirmationButton": confirmationTitle as Any,
    "confirmationPressResult": confirmationResult.map { Int($0) } as Any,
    "processExited": exited,
    "processExitedAt": exited ? timestamp() : NSNull(),
    "syntheticPointerEvents": false,
    "signalsSent": false,
], exitCode)
