import Foundation
import OpenDrSaiNativeProtocol

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
var shouldStop = false
while !shouldStop, let line = readLine(strippingNewline: true) {
  let data = Data(line.utf8)
  let fallbackId: String = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["requestId"] as? String ?? "invalid"
  let output: NativeResponse
  do {
    let request = try decodeNativeRequest(data)
    output = try response(for: request)
    shouldStop = request.operation == .shutdown
  } catch let failure as NativeProtocolFailure { output = .failure(fallbackId, failure: failure) }
  catch { output = .failure(fallbackId, failure: NativeProtocolFailure("internal_error", "The helper could not process the request.")) }
  if let encoded = try? encoder.encode(output) { FileHandle.standardOutput.write(encoded); FileHandle.standardOutput.write(Data([0x0A])) }
}
