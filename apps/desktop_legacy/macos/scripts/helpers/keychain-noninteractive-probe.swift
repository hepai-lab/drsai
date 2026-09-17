import Foundation
import LocalAuthentication
import Security

struct ProbeInput: Decodable {
  let password: String
  let secret: String
}

func emit(_ value: [String: Any]) -> Never {
  let output = try! JSONSerialization.data(withJSONObject: value)
  FileHandle.standardOutput.write(output)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
}

let arguments = CommandLine.arguments
guard arguments.count == 4 else {
  FileHandle.standardError.write(Data("usage: keychain-probe <keychain> <account> <service>\n".utf8))
  exit(64)
}

let input = try JSONDecoder().decode(ProbeInput.self, from: FileHandle.standardInput.readDataToEndOfFile())
let password = Data(input.password.utf8)
let secret = Data(input.secret.utf8)

// A file-based macOS Keychain can ask the legacy SecKeychain layer to unlock
// before a SecItem query evaluates its authentication context. Disable both
// interaction paths for this whole release-gate process.
let interactionStatus = SecKeychainSetUserInteractionAllowed(false)
guard interactionStatus == errSecSuccess else {
  emit(["passed": false, "phase": "disable-interaction", "status": Int(interactionStatus)])
}

var createdKeychain: SecKeychain?
let createStatus = arguments[1].withCString { path in
  password.withUnsafeBytes { bytes in
    SecKeychainCreate(path, UInt32(bytes.count), bytes.baseAddress, false, nil, &createdKeychain)
  }
}
guard createStatus == errSecSuccess, let keychain = createdKeychain else {
  emit(["passed": false, "phase": "create", "status": Int(createStatus)])
}
var keychainDeleted = false
defer { if !keychainDeleted { SecKeychainDelete(keychain) } }

let addStatus = SecItemAdd([
  kSecClass: kSecClassGenericPassword,
  kSecAttrAccount: arguments[2],
  kSecAttrService: arguments[3],
  kSecValueData: secret,
  kSecUseKeychain: keychain,
] as CFDictionary, nil)

let authenticationContext = LAContext()
authenticationContext.interactionNotAllowed = true
func readSecret() -> (status: OSStatus, matched: Bool) {
  var result: CFTypeRef?
  let status = SecItemCopyMatching([
    kSecClass: kSecClassGenericPassword,
    kSecAttrAccount: arguments[2],
    kSecAttrService: arguments[3],
    kSecMatchSearchList: [keychain],
    kSecMatchLimit: kSecMatchLimitOne,
    kSecReturnData: true,
    kSecUseAuthenticationContext: authenticationContext,
  ] as CFDictionary, &result)
  return (status, status == errSecSuccess && (result as? Data) == secret)
}

let initial = readSecret()
let lockStatus = SecKeychainLock(keychain)
let locked = readSecret()
let unlockStatus = password.withUnsafeBytes { bytes in
  SecKeychainUnlock(keychain, UInt32(bytes.count), bytes.baseAddress, true)
}
let recovered = readSecret()
let deleteItemStatus = SecItemDelete([
  kSecClass: kSecClassGenericPassword,
  kSecAttrAccount: arguments[2],
  kSecAttrService: arguments[3],
  kSecMatchSearchList: [keychain],
] as CFDictionary)
let deleted = readSecret()
let deleteKeychainStatus = SecKeychainDelete(keychain)
keychainDeleted = deleteKeychainStatus == errSecSuccess

let passed = addStatus == errSecSuccess
  && initial.status == errSecSuccess && initial.matched
  && lockStatus == errSecSuccess
  && locked.status != errSecSuccess && !locked.matched
  && unlockStatus == errSecSuccess
  && recovered.status == errSecSuccess && recovered.matched
  && deleteItemStatus == errSecSuccess
  && deleted.status == errSecItemNotFound && !deleted.matched
  && deleteKeychainStatus == errSecSuccess

emit([
  "passed": passed,
  "interactionStatus": Int(interactionStatus),
  "createStatus": Int(createStatus),
  "addStatus": Int(addStatus),
  "initialReadStatus": Int(initial.status),
  "initialMatched": initial.matched,
  "lockStatus": Int(lockStatus),
  "lockedReadStatus": Int(locked.status),
  "lockedMatched": locked.matched,
  "unlockStatus": Int(unlockStatus),
  "recoveredReadStatus": Int(recovered.status),
  "recoveredMatched": recovered.matched,
  "deleteItemStatus": Int(deleteItemStatus),
  "deletedReadStatus": Int(deleted.status),
  "deletedMatched": deleted.matched,
  "deleteKeychainStatus": Int(deleteKeychainStatus),
])
