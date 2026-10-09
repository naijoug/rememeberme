// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RememberMeUI", platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "RememberMeUI", targets: ["RememberMeUI"])],
    dependencies: [.package(path: "../RememberMeCore")],
    targets: [.target(name: "RememberMeUI", dependencies: ["RememberMeCore"]),
              .testTarget(name: "RememberMeUITests", dependencies: ["RememberMeUI", "RememberMeCore"])]
)
