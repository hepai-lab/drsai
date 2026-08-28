import Foundation
import CoreFoundation

public let nativeProtocolVersion = 1
public let nativeProtocolMaximumLineBytes = 64 * 1024
public let nativeHelperCapabilities = ["lifecycle.handshake", "lifecycle.ping", "keychain.generic-password.v1", "permissions.tcc.v1"]

public enum NativeOperation: String, Codable, CaseIterable {
  case handshake, capabilities, ping, shutdown
  case keychainPut = "keychain.put"
  case keychainGet = "keychain.get"
  case keychainDelete = "keychain.delete"
  case permissionStatus = "permission.status"
  case permissionRequest = "permission.request"
  case permissionOpenSettings = "permission.open-settings"
}
public struct NativeRequest: Equatable {
  public let protocolVersion: Int
  public let requestId: String
  public let operation: NativeOperation
  public let parameters: [String: String]
  public init(protocolVersion: Int, requestId: String, operation: NativeOperation, parameters: [String: String] = [:]) { self.protocolVersion = protocolVersion; self.requestId = requestId; self.operation = operation; self.parameters = parameters }
}
public struct NativeProtocolFailure: Error, Equatable {
  public let code: String
  public let message: String
  public init(_ code: String, _ message: String) { self.code = code; self.message = message }
}

private let requestKeys: Set<String> = ["protocolVersion", "requestId", "operation", "parameters"]
public func decodeNativeRequest(_ data: Data) throws -> NativeRequest {
  guard data.count <= nativeProtocolMaximumLineBytes else { throw NativeProtocolFailure("payload_too_large", "Request exceeds the maximum encoded size.") }
  let raw: Any
  do { raw = try JSONSerialization.jsonObject(with: data, options: []) } catch { throw NativeProtocolFailure("malformed_json", "Request must be one JSON object.") }
  guard let object = raw as? [String: Any] else { throw NativeProtocolFailure("invalid_request", "Request must be a JSON object.") }
  let unknown = Set(object.keys).subtracting(requestKeys)
  guard unknown.isEmpty else { throw NativeProtocolFailure("unknown_field", "Request contains an unsupported field.") }
  guard let versionNumber = object["protocolVersion"] as? NSNumber, CFGetTypeID(versionNumber) != CFBooleanGetTypeID(), versionNumber.doubleValue.rounded() == versionNumber.doubleValue else { throw NativeProtocolFailure("invalid_version", "protocolVersion must be an integer.") }
  let version = versionNumber.intValue
  guard version == nativeProtocolVersion else { throw NativeProtocolFailure("incompatible_version", "protocolVersion is not supported.") }
  guard let requestId = object["requestId"] as? String, requestId.range(of: "^[A-Za-z0-9_.:-]{1,128}$", options: .regularExpression) != nil else { throw NativeProtocolFailure("invalid_request_id", "requestId is invalid.") }
  guard let operationName = object["operation"] as? String, let operation = NativeOperation(rawValue: operationName) else { throw NativeProtocolFailure("unknown_operation", "operation is not allowed.") }
  let rawParameters = object["parameters"] ?? [String: Any]()
  guard let parameterObject = rawParameters as? [String: Any] else { throw NativeProtocolFailure("invalid_parameters", "parameters must be an object.") }
  var parameters: [String: String] = [:]
  for (key, value) in parameterObject { guard let string = value as? String else { throw NativeProtocolFailure("invalid_parameters", "Parameter values must be strings.") }; parameters[key] = string }
  let allowedParameters: Set<String>
  switch operation { case .keychainPut: allowedParameters = ["account", "service", "value"]; case .keychainGet, .keychainDelete: allowedParameters = ["account", "service"]; case .permissionStatus, .permissionOpenSettings: allowedParameters = ["kind"]; case .permissionRequest: allowedParameters = ["kind", "userInitiated"]; default: allowedParameters = [] }
  guard Set(parameters.keys).isSubset(of: allowedParameters), Set(parameters.keys) == allowedParameters else { throw NativeProtocolFailure("invalid_parameters", "Required parameters are missing or unknown parameters were provided.") }
  return NativeRequest(protocolVersion: version, requestId: requestId, operation: operation, parameters: parameters)
}

public struct NativeResponse: Encodable {
  public struct Failure: Encodable { public let code: String; public let message: String }
  public let protocolVersion: Int
  public let requestId: String
  public let status: String
  public let result: [String: JSONValue]?
  public let error: Failure?
  public static func success(_ requestId: String, result: [String: JSONValue] = [:]) -> NativeResponse { NativeResponse(protocolVersion: nativeProtocolVersion, requestId: requestId, status: "ok", result: result, error: nil) }
  public static func failure(_ requestId: String, failure: NativeProtocolFailure) -> NativeResponse { NativeResponse(protocolVersion: nativeProtocolVersion, requestId: requestId, status: "error", result: nil, error: Failure(code: failure.code, message: failure.message)) }
}

public enum JSONValue: Encodable { case string(String), integer(Int), boolean(Bool), strings([String])
  public func encode(to encoder: Encoder) throws { var value = encoder.singleValueContainer(); switch self { case .string(let item): try value.encode(item); case .integer(let item): try value.encode(item); case .boolean(let item): try value.encode(item); case .strings(let item): try value.encode(item) } }
}

public func response(for request: NativeRequest) throws -> NativeResponse {
  switch request.operation {
  case .handshake, .capabilities: return .success(request.requestId, result: ["helperVersion": .string("1.0.0"), "protocolVersion": .integer(nativeProtocolVersion), "capabilities": .strings(nativeHelperCapabilities)])
  case .ping: return .success(request.requestId, result: ["pong": .boolean(true)])
  case .shutdown: return .success(request.requestId, result: ["accepted": .boolean(true)])
  case .keychainPut: try putGenericPassword(request.parameters); return .success(request.requestId, result: ["stored": .boolean(true)])
  case .keychainGet: return .success(request.requestId, result: ["value": .string(try getGenericPassword(request.parameters))])
  case .keychainDelete: return .success(request.requestId, result: ["deleted": .boolean(try deleteGenericPassword(request.parameters))])
  case .permissionStatus: return .success(request.requestId, result: try permissionStatus(request.parameters))
  case .permissionRequest: return .success(request.requestId, result: try requestPermission(request.parameters))
  case .permissionOpenSettings: return .success(request.requestId, result: try openPermissionSettings(request.parameters))
  }
}
