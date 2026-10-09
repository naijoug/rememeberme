"""Build only checked-in source inputs in a disposable tree, without caches/output."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[3]
with tempfile.TemporaryDirectory(prefix="rememberme-clean-source-") as temporary:
    clean = Path(temporary) / "source"
    shutil.copytree(root / "frontend/apple", clean / "frontend/apple",
                    ignore=shutil.ignore_patterns(".build", "DerivedData", "xcuserdata", ".swiftpm", "*.xcuserstate"))
    shutil.copytree(root / "contracts", clean / "contracts", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(root / "frontend/browser-extension/public/dictionary/wordnet",
                    clean / "frontend/browser-extension/public/dictionary/wordnet")
    service = clean / "frontend/browser-extension/services"
    service.mkdir(parents=True)
    shutil.copy2(root / "frontend/browser-extension/services/definition-utils.ts", service / "definition-utils.ts")
    subprocess.run(["node", "--experimental-strip-types", "contracts/reference.ts"], cwd=clean, check=True)

    def build(scheme, destination, output):
        command = ["xcodebuild", "-quiet", "-project", "RememberMe.xcodeproj", "-scheme", scheme,
                   "-destination", destination, "-derivedDataPath", str(output), "CODE_SIGNING_ALLOWED=NO", "build"]
        result = subprocess.run(command, cwd=clean / "frontend/apple", capture_output=True, text=True)
        if result.returncode:
            print(result.stdout[-12000:] + result.stderr[-12000:], flush=True)
            raise RuntimeError(f"Clean {scheme} build failed")
        print(f"Clean source build passed: {scheme}", flush=True)
    with ThreadPoolExecutor(max_workers=2) as executor:
        mac = executor.submit(build, "RememberMeMac", "platform=macOS,arch=arm64", Path(temporary) / "mac-build")
        ios = executor.submit(build, "RememberMeiOS", "generic/platform=iOS Simulator", Path(temporary) / "ios-build")
        mac.result()
        ios.result()

    for scheme, dictionary in [("Mac", Path(temporary) / "mac-build/Build/Products/Debug/RememberMeMac.app/Contents/Resources/wordnet"),
                              ("iOS", Path(temporary) / "ios-build/Build/Products/Debug-iphonesimulator/RememberMeiOS.app/wordnet")]:
        subprocess.run(["python3", "frontend/apple/scripts/verify-dictionary-assets.py", str(dictionary)], cwd=clean, check=True)

    package = clean / "frontend/apple/Packages/RememberMeCore"
    env = {**os.environ, "CLANG_MODULE_CACHE_PATH": str(Path(temporary) / "modules"),
           "SWIFTPM_MODULECACHE_OVERRIDE": str(Path(temporary) / "modules")}
    result = subprocess.run(["swift", "test", "--disable-sandbox", "--scratch-path", str(Path(temporary) / "swift-build"),
                              "--cache-path", str(Path(temporary) / "swift-cache")], cwd=package, env=env, capture_output=True, text=True)
    if result.returncode:
        print(result.stdout[-12000:] + result.stderr[-12000:], flush=True)
        raise RuntimeError("Clean source Swift tests failed")
    print("Clean source core tests passed.", flush=True)
    subprocess.run(["python3", "frontend/apple/scripts/verify-process-recovery.py",
                    str(Path(temporary) / "swift-build/arm64-apple-macosx/debug/RememberMeProbe")], cwd=clean, check=True)
    print("Clean source verification finished; disposable snapshot removed on exit.", flush=True)
