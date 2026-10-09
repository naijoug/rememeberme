// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RememberMeCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "RememberMeCore", targets: ["RememberMeCore"]),
               .executable(name: "RememberMeProbe", targets: ["RememberMeProbe"])],
    targets: [
        .target(name: "RememberMeCore"),
        .executableTarget(name: "RememberMeProbe", dependencies: ["RememberMeCore"]),
        .testTarget(name: "RememberMeCoreTests", dependencies: ["RememberMeCore"])
    ]
)
