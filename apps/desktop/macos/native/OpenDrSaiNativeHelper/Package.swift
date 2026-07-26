// swift-tools-version:5.5
import PackageDescription

let package = Package(
  name: "OpenDrSaiNativeHelper",
  platforms: [.macOS(.v11)],
  products: [
    .library(name: "OpenDrSaiNativeProtocol", targets: ["OpenDrSaiNativeProtocol"]),
    .executable(name: "OpenDrSaiNativeHelper", targets: ["OpenDrSaiNativeHelper"]),
  ],
  targets: [
    .target(name: "OpenDrSaiNativeProtocol", linkerSettings: [.linkedFramework("Security"), .linkedFramework("AVFoundation"), .linkedFramework("ApplicationServices"), .linkedFramework("CoreGraphics"), .linkedFramework("AppKit")]),
    .executableTarget(name: "OpenDrSaiNativeHelper", dependencies: ["OpenDrSaiNativeProtocol"]),
    .testTarget(name: "OpenDrSaiNativeProtocolTests", dependencies: ["OpenDrSaiNativeProtocol"]),
  ]
)
