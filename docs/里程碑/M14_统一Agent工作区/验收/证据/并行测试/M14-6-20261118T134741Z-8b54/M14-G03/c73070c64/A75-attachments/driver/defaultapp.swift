import AppKit
let u = URL(fileURLWithPath: CommandLine.arguments[1])
print(NSWorkspace.shared.urlForApplication(toOpen: u)?.path ?? "none")
