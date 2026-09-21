import XCTest
@testable import OpenDrSaiNativeProtocol

final class NativeProtocolTests: XCTestCase {
  private func data(_ value: String) -> Data { Data(value.utf8) }
  func testValidHandshake() throws { XCTAssertEqual(try decodeNativeRequest(data(#"{"protocolVersion":1,"requestId":"req-1","operation":"handshake","parameters":{}}"#)), NativeRequest(protocolVersion: 1, requestId: "req-1", operation: .handshake)) }
  func testRejectsUnknownField() { assertFailure(#"{"protocolVersion":1,"requestId":"req","operation":"ping","extra":true}"#, "unknown_field") }
  func testRejectsUnknownOperation() { assertFailure(#"{"protocolVersion":1,"requestId":"req","operation":"shell"}"#, "unknown_operation") }
  func testRejectsIncompatibleVersion() { assertFailure(#"{"protocolVersion":2,"requestId":"req","operation":"ping"}"#, "incompatible_version") }
  func testRejectsMalformedJson() { assertFailure("{", "malformed_json") }
  func testRejectsNonEmptyParameters() { assertFailure(#"{"protocolVersion":1,"requestId":"req","operation":"ping","parameters":{"command":"id"}}"#, "invalid_parameters") }
  func testRejectsOversizePayload() { let value = Data(repeating: 0x20, count: nativeProtocolMaximumLineBytes + 1); XCTAssertThrowsError(try decodeNativeRequest(value)) { XCTAssertEqual(($0 as? NativeProtocolFailure)?.code, "payload_too_large") } }
  private func assertFailure(_ source: String, _ code: String) { XCTAssertThrowsError(try decodeNativeRequest(data(source))) { XCTAssertEqual(($0 as? NativeProtocolFailure)?.code, code) } }
}
