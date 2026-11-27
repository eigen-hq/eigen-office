import CoreGraphics
import Foundation
import Vision

// What a drawing says, read on the iPad itself – the web app's `window.sliderInk`
// (`apps/web/src/features/pages/lib/ink-read.ts`). Nothing leaves the device for it.

/// One point of a stroke, in the drawing's 1000-wide frame (y grows downwards).
struct InkPoint: Decodable {
  let x: Double
  let y: Double
}

/// One line of writing: its strokes as drawn, each its points.
typealias InkLine = [[InkPoint]]

/// Reads handwriting – one text per line, `""` where a line says nothing. Apple's Vision now;
/// another reader (ML Kit) could take its place behind this.
protocol HandwritingReader: Sendable {
  func read(_ lines: [InkLine], languages: [String]) async throws -> [String]
}

/// Apple's own text recognition (Vision) on each line drawn as a picture – offline, built in.
struct VisionReader: HandwritingReader {
  /// How tall a line is drawn for Vision: well above what it needs to see the strokes.
  static let lineHeight: CGFloat = 160
  static let padding: CGFloat = 40

  func read(_ lines: [InkLine], languages: [String]) async throws -> [String] {
    let tags = Self.visionLanguages(languages)
    return try await withThrowingTaskGroup(of: (Int, String).self) { group in
      for (index, line) in lines.enumerated() {
        group.addTask { (index, try Self.readLine(line, languages: tags)) }
      }
      var said = Array(repeating: "", count: lines.count)
      for try await (index, text) in group { said[index] = text }
      return said
    }
  }

  /// `de` → `de-DE`: the page's language as Vision names it, of those it reads.
  static func visionLanguages(_ languages: [String]) -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let supported = (try? request.supportedRecognitionLanguages()) ?? []
    let picked = languages.compactMap { tag -> String? in
      if supported.contains(tag) { return tag }
      let base = tag.split(separator: "-").first.map(String.init) ?? tag
      return supported.first { $0 == "\(base)-\(base.uppercased())" }
        ?? supported.first { $0.hasPrefix("\(base)-") }
    }
    return picked.isEmpty ? ["de-DE"] : picked
  }

  static func readLine(_ line: InkLine, languages: [String]) throws -> String {
    guard let image = render(line) else { return "" }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = languages
    request.usesLanguageCorrection = true
    try VNImageRequestHandler(cgImage: image).perform([request])
    return inReadingOrder(request.results ?? [])
      .compactMap { $0.topCandidates(1).first?.string }
      .joined(separator: " ")
      .trimmingCharacters(in: .whitespaces)
  }

  /// A line may come back in pieces, and as two rows where its strokes overlapped: top row
  /// first, each left to right (Vision's y grows upwards).
  static func inReadingOrder(_ pieces: [VNRecognizedTextObservation]) -> [VNRecognizedTextObservation] {
    var rows: [[VNRecognizedTextObservation]] = []
    for piece in pieces.sorted(by: { $0.boundingBox.midY > $1.boundingBox.midY }) {
      if let last = rows.last?.first,
        abs(last.boundingBox.midY - piece.boundingBox.midY)
          < min(last.boundingBox.height, piece.boundingBox.height) / 2
      {
        rows[rows.count - 1].append(piece)
      } else {
        rows.append([piece])
      }
    }
    return rows.flatMap { $0.sorted { $0.boundingBox.minX < $1.boundingBox.minX } }
  }

  /// The line's strokes, black on white, scaled to `lineHeight` with round ends.
  static func render(_ line: InkLine) -> CGImage? {
    let points = line.flatMap { $0 }
    guard let first = points.first else { return nil }
    var minX = first.x, maxX = first.x, minY = first.y, maxY = first.y
    for point in points {
      minX = min(minX, point.x); maxX = max(maxX, point.x)
      minY = min(minY, point.y); maxY = max(maxY, point.y)
    }
    let height = max(maxY - minY, 1)
    let scale = min(lineHeight / height, 4000 / max(maxX - minX, 1))
    let width = Int(((maxX - minX) * scale + padding * 2).rounded(.up))
    let tall = Int((height * scale + padding * 2).rounded(.up))
    guard
      let context = CGContext(
        data: nil, width: width, height: tall, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { return nil }
    context.setFillColor(gray: 1, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: width, height: tall))
    // The drawing's y grows downwards, the context's upwards.
    context.translateBy(x: 0, y: CGFloat(tall))
    context.scaleBy(x: 1, y: -1)
    context.setStrokeColor(gray: 0, alpha: 1)
    context.setFillColor(gray: 0, alpha: 1)
    context.setLineWidth(max(4, lineHeight / 24))
    context.setLineCap(.round)
    context.setLineJoin(.round)
    let place = { (point: InkPoint) in
      CGPoint(x: (point.x - minX) * scale + padding, y: (point.y - minY) * scale + padding)
    }
    for stroke in line {
      guard let start = stroke.first else { continue }
      if stroke.count == 1 {
        let dot = place(start)
        context.fillEllipse(in: CGRect(x: dot.x - 3, y: dot.y - 3, width: 6, height: 6))
        continue
      }
      context.beginPath()
      context.move(to: place(start))
      for point in stroke.dropFirst() { context.addLine(to: place(point)) }
      context.strokePath()
    }
    return context.makeImage()
  }
}
