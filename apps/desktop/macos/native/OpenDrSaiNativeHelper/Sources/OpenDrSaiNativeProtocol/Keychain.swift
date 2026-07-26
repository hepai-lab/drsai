import Foundation
import Security

private let allowedService = "ai.drsai.desktop"
private func validated(_ parameters: [String: String], includeValue: Bool) throws -> (String, String, Data?) {
  guard let account = parameters["account"], account.range(of: "^[0-9a-fA-F-]{36}$", options: .regularExpression) != nil else { throw NativeProtocolFailure("invalid_account", "Keychain account is invalid.") }
  guard parameters["service"] == allowedService else { throw NativeProtocolFailure("invalid_service", "Keychain service is not allowed.") }
  if !includeValue { return (account, allowedService, nil) }
  guard let value = parameters["value"], !value.isEmpty, let data = value.data(using: .utf8), data.count <= nativeProtocolMaximumLineBytes else { throw NativeProtocolFailure("invalid_secret", "Keychain value is empty or exceeds its limit.") }
  return (account, allowedService, data)
}
private func query(_ account: String, _ service: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account, kSecAttrService as String: service] }
private func failure(_ status: OSStatus) -> NativeProtocolFailure {
  switch status {
  case errSecUserCanceled: return NativeProtocolFailure("user_cancelled", "The Keychain operation was cancelled by the user.")
  case errSecInteractionNotAllowed: return NativeProtocolFailure("interaction_not_allowed", "Keychain interaction is not allowed while the session is locked or unavailable.")
  case errSecItemNotFound: return NativeProtocolFailure("not_found", "The Keychain item was not found.")
  case errSecAuthFailed: return NativeProtocolFailure("authentication_failed", "Keychain authentication failed.")
  default: return NativeProtocolFailure("keychain_unavailable", "The Keychain operation failed.")
  }
}
public func putGenericPassword(_ parameters: [String: String]) throws {
  let (account, service, data) = try validated(parameters, includeValue: true); let base = query(account, service)
  let updated = SecItemUpdate(base as CFDictionary, [kSecValueData as String: data!] as CFDictionary)
  if updated == errSecSuccess { return }
  if updated != errSecItemNotFound { throw failure(updated) }
  var item = base; item[kSecValueData as String] = data!; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
  let added = SecItemAdd(item as CFDictionary, nil); if added != errSecSuccess { throw failure(added) }
}
public func getGenericPassword(_ parameters: [String: String]) throws -> String {
  let (account, service, _) = try validated(parameters, includeValue: false); var item = query(account, service)
  item[kSecReturnData as String] = true; item[kSecMatchLimit as String] = kSecMatchLimitOne
  var result: CFTypeRef?; let status = SecItemCopyMatching(item as CFDictionary, &result); if status != errSecSuccess { throw failure(status) }
  guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw NativeProtocolFailure("invalid_secret", "The Keychain value is not valid UTF-8.") }; return value
}
public func deleteGenericPassword(_ parameters: [String: String]) throws -> Bool {
  let (account, service, _) = try validated(parameters, includeValue: false); let status = SecItemDelete(query(account, service) as CFDictionary)
  if status == errSecItemNotFound { return false }; if status != errSecSuccess { throw failure(status) }; return true
}
