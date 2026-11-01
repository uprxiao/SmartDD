// Native quit performer for M11 T14 A-layer.
// Locates the acceptance window by owner PID (CGWindowList), verifies it carries the
// run marker in its title, then invokes the real application menu item "Quit" through
// the Accessibility API. Writes a JSON receipt; never signals the process.
//
// Usage:
//   swift native-quit-performer.swift --title-marker "A · M11 NORMAL QUIT ·" [--timeout-ms 120000] [--dry-run] [--out path]
// Exit codes: 0 quit was invoked, 3 marker window not found, 4 accessibility failure, 5 dry-run listing.
import Foundation
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

func writeReceipt(_ payload: [String: Any], code: Int32) -> Never {
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

final class WindowHit {
    let pid: pid_t
    let title: String
    let bounds: [String: Any]
    init(pid: pid_t, title: String, bounds: [String: Any]) {
        self.pid = pid
        self.title = title
        self.bounds = bounds
    }
}

func matchingWindows(marker: String) -> [WindowHit] {
    onscreenWindows().compactMap { window in
        let title = (window[kCGWindowName as String] as? String) ?? ""
        let pidValue = window[kCGWindowOwnerPID as String] as? Int ?? -1
        let layer = window[kCGWindowLayer as String] as? Int ?? -1
        guard layer == 0, pidValue > 0, !title.isEmpty else { return nil }
        guard marker.isEmpty || title.contains(marker) else { return nil }
        let bounds = (window[kCGWindowBounds as String] as? [String: Any]) ?? [:]
        return WindowHit(pid: pid_t(pidValue), title: title, bounds: bounds)
    }
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return error == .success ? value : nil
}

func element(_ source: AnyObject?) -> AXUIElement? {
    guard let source else { return nil }
    guard CFGetTypeID(source) == AXUIElementGetTypeID() else { return nil }
    return unsafeDowncast(source, to: AXUIElement.self)
}

func children(_ element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute) as? [AXUIElement]) ?? []
}

func title(_ element: AXUIElement) -> String {
    (attribute(element, kAXTitleAttribute) as? String) ?? ""
}

func menuSnapshot(pid: pid_t) -> (barTitles: [String], itemTitles: [String]) {
    guard let appElement = element(AXUIElementCreateApplication(pid) as AnyObject),
          let bar = element(attribute(appElement, kAXMenuBarAttribute)) else { return ([], []) }
    var barTitles: [String] = []
    var itemTitles: [String] = []
    for barItem in children(bar) {
        barTitles.append(title(barItem))
        for menu in children(barItem) {
            for item in children(menu) { itemTitles.append(title(item)) }
        }
    }
    return (barTitles, itemTitles)
}


func descendants(_ root: AXUIElement, limit: Int = 400) -> [AXUIElement] {
    var queue: [AXUIElement] = [root]
    var seen = 0
    var collected: [AXUIElement] = []
    while !queue.isEmpty && seen < limit {
        let current = queue.removeFirst()
        seen += 1
        collected.append(current)
        queue.append(contentsOf: children(current))
    }
    return collected
}

func role(_ element: AXUIElement) -> String {
    (attribute(element, kAXRoleAttribute) as? String) ?? ""
}

struct QuitConfirmation {
    var appeared = false
    var dialogText: String?
    var button: String?
    var buttons: [String] = []
}

func pressQuitConfirmation(pid: pid_t, waitMs: Int) -> QuitConfirmation {
    let deadline = Date().addingTimeInterval(Double(waitMs) / 1000.0)
    var buttons: [String] = []
    repeat {
        guard let appElement = element(AXUIElementCreateApplication(pid) as AnyObject) else { break }
        let tree = descendants(appElement)
        var dialogs = tree.filter { role($0) == "AXSheet" || role($0) == "AXDialog" }
        if dialogs.isEmpty {
            // Some Electron builds present the quit prompt as a separate AXWindow.
            dialogs = tree.filter { element in
                guard role(element) == "AXWindow" else { return false }
                return descendants(element, limit: 60).contains { child in
                    let text = title(child)
                    return text.contains("个任务正在运行") || text.contains("尚未保存")
                }
            }
        }
        let scopes = dialogs.isEmpty ? [AXUIElement]() : dialogs
        let buttonElements = dialogs.isEmpty ? [] : scopes.flatMap { descendants($0, limit: 120) }.filter { role($0) == "AXButton" }
        buttons = buttonElements.map { title($0) }.filter { !$0.isEmpty }
        let affirmative = buttonElements.first { element in
            let text = title(element)
            return text == "退出" || text == "Quit" || text == "Quit WillYou"
        }
        if affirmative != nil || !dialogs.isEmpty {
            let dialogText = dialogs.first.map { title($0) }.flatMap { $0.isEmpty ? nil : $0 }
                ?? tree.filter { role($0) == "AXStaticText" }.map { title($0) }.first { $0.contains("运行") || $0.contains("退出") }
            if let affirmative, AXUIElementPerformAction(affirmative, kAXPressAction as CFString) == .success {
                return QuitConfirmation(appeared: true, dialogText: dialogText, button: title(affirmative), buttons: buttons)
            }
            return QuitConfirmation(appeared: !dialogs.isEmpty, dialogText: dialogText, button: nil, buttons: buttons)
        }
        usleep(250_000)
    } while Date() < deadline
    return QuitConfirmation(appeared: false, dialogText: nil, button: nil, buttons: buttons)
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
        "schema": "m11-native-quit-receipt-v1",
        "at": timestamp(),
        "ok": false,
        "reason": "marker-window-not-found",
        "marker": marker,
        "accessibilityTrusted": trust,
        "onscreenWindows": onscreenWindows().count,
    ], code: 3)
}

let snapshot = menuSnapshot(pid: window.pid)

if dryRun {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1",
        "at": timestamp(),
        "ok": true,
        "dryRun": true,
        "pid": Int(window.pid),
        "windowTitle": window.title,
        "windowBounds": window.bounds,
        "accessibilityTrusted": trust,
        "menuBarTitles": snapshot.barTitles,
        "menuItemCount": snapshot.itemTitles.count,
        "quitCandidates": snapshot.itemTitles.filter { $0.contains("Quit") || $0.contains("退出") },
    ], code: 5)
}

guard trust,
      let appElement = element(AXUIElementCreateApplication(window.pid) as AnyObject),
      let bar = element(attribute(appElement, kAXMenuBarAttribute)),
      let appMenuItem = children(bar).first else {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": false,
        "reason": "accessibility-unavailable", "pid": Int(window.pid),
        "windowTitle": window.title, "accessibilityTrusted": trust,
    ], code: 4)
}

let openError = AXUIElementPerformAction(appMenuItem, kAXPressAction as CFString)
usleep(400_000)

guard let menu = children(appMenuItem).first else {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": false,
        "reason": "application-menu-unavailable", "pid": Int(window.pid),
        "windowTitle": window.title, "openMenuError": Int(openError.rawValue),
        "menuBarTitles": snapshot.barTitles,
    ], code: 4)
}

var pressedTitle: String?
var quitEnabled: Bool?
for item in children(menu) {
    let itemTitle = title(item)
    guard itemTitle.hasPrefix("Quit") || itemTitle.hasPrefix("退出") else { continue }
    var enabledValue: AnyObject?
    AXUIElementCopyAttributeValue(item, kAXEnabledAttribute as CFString, &enabledValue)
    quitEnabled = (enabledValue as? Bool) ?? true
    let pressError = AXUIElementPerformAction(item, kAXPressAction as CFString)
    if pressError == .success { pressedTitle = itemTitle }
    break
}

guard let pressed = pressedTitle else {
    writeReceipt([
        "schema": "m11-native-quit-receipt-v1", "at": timestamp(), "ok": false,
        "reason": "quit-item-not-pressed", "pid": Int(window.pid),
        "windowTitle": window.title, "menuItems": children(menu).map { title($0) },
    ], code: 4)
}

let confirmation = pressQuitConfirmation(pid: window.pid, waitMs: 15000)

writeReceipt([
    "schema": "m11-native-quit-receipt-v1",
    "at": timestamp(),
    "ok": true,
    "pid": Int(window.pid),
    "confirmationDialogAppeared": confirmation.appeared,
    "confirmationDialogText": confirmation.dialogText ?? "",
    "confirmationButtonPressed": confirmation.button ?? "",
    "confirmationButtons": confirmation.buttons,
    "windowTitle": window.title,
    "windowBounds": window.bounds,
    "accessibilityTrusted": trust,
    "path": "AX menu bar -> application menu -> Quit item (kAXPressAction)",
    "openMenuError": Int(openError.rawValue),
    "quitItemTitle": pressed,
    "quitItemEnabled": quitEnabled ?? true,
    "menuBarTitles": snapshot.barTitles,
    "menuItemCount": children(menu).count,
    "syntheticPointerEvents": false,
    "signalsSent": false,
], code: 0)
