import Foundation
import AppKit
import PDFKit

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let document = PDFDocument(url: input) else { fatalError("PDF parse failed") }
var pages: [[String: Any]] = []
for i in 0..<document.pageCount {
    guard let page = document.page(at: i) else { fatalError("Missing page") }
    pages.append(["index": i, "text": page.string ?? "", "width": page.bounds(for: .mediaBox).width, "height": page.bounds(for: .mediaBox).height])
    if i == 0 {
        let image = page.thumbnail(of: NSSize(width: 900, height: 1200), for: .mediaBox)
        let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
        try rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathExtension("png"))
    }
}
let result: [String: Any] = ["reader": "macOS PDFKit", "pages": pages, "count": document.pageCount]
try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathExtension("json"))
