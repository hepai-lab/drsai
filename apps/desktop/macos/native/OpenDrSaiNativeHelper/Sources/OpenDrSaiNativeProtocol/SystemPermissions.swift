import AppKit
import ApplicationServices
import AVFoundation
import CoreGraphics
import CoreServices
import Foundation

private let permissionKinds: Set<String> = ["microphone", "notifications", "files", "automation", "accessibility", "screen-recording"]
private let settings: [String: String] = [
  "microphone": "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  "notifications": "x-apple.systempreferences:com.apple.preference.notifications",
  "files": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  "automation": "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation",
  "accessibility": "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "screen-recording": "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
]
private func kind(_ parameters: [String: String]) throws -> String { guard let value = parameters["kind"], permissionKinds.contains(value) else { throw NativeProtocolFailure("unsupported_permission", "Permission kind is not allowed.") }; return value }
private func result(_ kind: String, _ state: String, _ canRequest: Bool) -> [String: JSONValue] { ["kind": .string(kind), "state": .string(state), "canRequest": .boolean(canRequest), "canOpenSettings": .boolean(true), "source": .string("native-helper")] }
private func automationPermission(askUserIfNeeded: Bool) -> (state: String, canRequest: Bool) {
  var target = AEAddressDesc()
  let bundleIdentifier = Array("com.apple.finder".utf8)
  let creation = bundleIdentifier.withUnsafeBytes { bytes in
    AECreateDesc(DescType(typeApplicationBundleID), bytes.baseAddress, bytes.count, &target)
  }
  guard creation == noErr else { return ("unknown", false) }
  defer { AEDisposeDesc(&target) }
  let permission = AEDeterminePermissionToAutomateTarget(&target, AEEventClass(typeWildCard), AEEventID(typeWildCard), askUserIfNeeded)
  if permission == noErr { return ("granted", false) }
  if permission == errAEEventWouldRequireUserConsent { return ("not-determined", true) }
  if permission == errAEEventNotPermitted { return ("denied", false) }
  return ("unknown", false)
}

public func permissionStatus(_ parameters: [String: String]) throws -> [String: JSONValue] {
  let value = try kind(parameters)
  switch value {
  case "microphone":
    switch AVCaptureDevice.authorizationStatus(for: .audio) { case .authorized: return result(value, "granted", false); case .denied: return result(value, "denied", false); case .restricted: return result(value, "restricted", false); case .notDetermined: return result(value, "not-determined", true); @unknown default: return result(value, "unknown", false) }
  case "accessibility": return result(value, AXIsProcessTrusted() ? "granted" : "denied", !AXIsProcessTrusted())
  case "screen-recording": if #available(macOS 10.15, *) { return result(value, CGPreflightScreenCaptureAccess() ? "granted" : "denied", !CGPreflightScreenCaptureAccess()) }; return result(value, "unknown", false)
  case "notifications": return result(value, "unknown", true)
  case "automation": let permission = automationPermission(askUserIfNeeded: false); return result(value, permission.state, permission.canRequest)
  default: return result(value, "unknown", false)
  }
}

public func requestPermission(_ parameters: [String: String]) throws -> [String: JSONValue] {
  guard parameters["userInitiated"] == "true" else { throw NativeProtocolFailure("user_gesture_required", "Permission requests require an explicit user action.") }
  let value = try kind(parameters)
  switch value {
  case "microphone":
    let semaphore = DispatchSemaphore(value: 0); AVCaptureDevice.requestAccess(for: .audio) { _ in semaphore.signal() }; if semaphore.wait(timeout: .now() + 30) == .timedOut { throw NativeProtocolFailure("permission_timeout", "The permission request timed out.") }
  case "accessibility": _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
  case "screen-recording": if #available(macOS 10.15, *) { _ = CGRequestScreenCaptureAccess() }
  case "automation":
    let permission = automationPermission(askUserIfNeeded: true); return result(value, permission.state, permission.canRequest)
  default: throw NativeProtocolFailure("settings_only", "This permission can only be changed in System Settings.")
  }
  return try permissionStatus(["kind": value])
}

public func openPermissionSettings(_ parameters: [String: String]) throws -> [String: JSONValue] {
  let value = try kind(parameters); guard let raw = settings[value], let url = URL(string: raw), NSWorkspace.shared.open(url) else { throw NativeProtocolFailure("settings_unavailable", "The System Settings pane could not be opened.") }; return ["opened": .boolean(true), "kind": .string(value)]
}
