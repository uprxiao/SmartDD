// Private exact-PID/no-activation adaptation of original M11 T14 AX performer.
//
// Original actual AX menu -> confirmation -> same process exit is preserved.
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

// Exact owned process only. Never activate, enumerate other windows, or fall back by name.
let trust = AXIsProcessTrusted()
if CommandLine.arguments.contains("--preflight") {
    writeReceipt(["schema":"t131-ax-preflight-v1","at":timestamp(),"accessibilityTrusted":trust,"readOnly":true,"activated":false,"windowsRead":false,"signalsSent":false], trust ? 0 : 4)
}
guard let pidText=argumentValue("--pid"), let pidNumber=Int32(pidText), pidNumber>1,
      let expectedExe=argumentValue("--exe"), let expectedBundle=argumentValue("--bundle"),
      let marker=argumentValue("--title-marker"), !marker.isEmpty else {
    writeReceipt(["ok":false,"reason":"exact-arguments-required"],3)
}
let expectedPID=pid_t(pidNumber)
guard trust, let running=NSRunningApplication(processIdentifier:expectedPID),
      running.executableURL?.path==expectedExe, running.bundleURL?.path==expectedBundle,
      running.bundleIdentifier=="com.smartdd.desktop", !running.isTerminated,
      NSWorkspace.shared.frontmostApplication?.processIdentifier==expectedPID else {
    writeReceipt(["ok":false,"reason":"exact-owned-already-frontmost-required","pid":Int(expectedPID),"accessibilityTrusted":trust,"activated":false],4)
}
let app=AXUIElementCreateApplication(expectedPID)
let matches=windows(of:app).filter{title($0)==marker}
guard matches.count==1 else {writeReceipt(["ok":false,"reason":"unique-owned-title-required","matches":matches.count],3)}
let window=WindowHit(pid:expectedPID,title:marker,owner:"WillYou",bounds:[:])
let activated=false
func requireOwnFrontmost() {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier==expectedPID,
          let current=NSRunningApplication(processIdentifier:expectedPID),
          current.executableURL?.path==expectedExe, current.bundleURL?.path==expectedBundle else {
        writeReceipt(["ok":false,"reason":"frontmost-yield-no-refocus","pid":Int(expectedPID),"activated":false],4)
    }
}
let menuBar=element(app,kAXMenuBarAttribute)
let barTitles=menuBar.map{children($0).map{title($0)}} ?? []
guard let bar=menuBar, let appMenuItem=children(bar).first(where:{title($0)=="WillYou"}) else {
    writeReceipt(["ok":false,"reason":"exact-app-menu-unavailable","pid":Int(expectedPID),"activated":false],4)
}
requireOwnFrontmost()
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
        requireOwnFrontmost()
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
        guard seenText.contains("个任务正在运行"), seenText.contains("退出"), seenText.contains("WillYou") else {writeReceipt(["ok":false,"reason":"unexpected-owned-dialog","pid":Int(expectedPID),"activated":false],4)}
        if let button = descendants(dialog, limit: 60).first(where: { role($0) == "AXButton" && title($0) == "退出" }) {
            requireOwnFrontmost()
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
