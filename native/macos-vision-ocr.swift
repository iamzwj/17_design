import AppKit
import Foundation
import Vision

guard CommandLine.arguments.count > 1 else {
    fputs("缺少图片路径\n", stderr)
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: imageURL) else {
    fputs("无法读取图片\n", stderr)
    exit(3)
}

var proposedRect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    fputs("无法解析图片\n", stderr)
    exit(4)
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
request.usesLanguageCorrection = true

do {
    try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
    let lines = (request.results ?? [])
        .sorted { lhs, rhs in
            let verticalDelta = lhs.boundingBox.midY - rhs.boundingBox.midY
            if abs(verticalDelta) > 0.02 { return verticalDelta > 0 }
            return lhs.boundingBox.minX < rhs.boundingBox.minX
        }
        .compactMap { $0.topCandidates(1).first?.string }
        .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    print(lines.joined(separator: "\n"))
} catch {
    fputs("文字识别失败：\(error.localizedDescription)\n", stderr)
    exit(5)
}
