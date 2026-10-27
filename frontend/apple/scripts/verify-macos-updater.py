"""Exercise Sparkle's real check/download/install with disposable app identities.

Never launches Remember Me, accesses real vocabulary, or targets its bundle ID.
"""
import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from importlib.machinery import SourceFileLoader
from pathlib import Path
import plistlib
import shutil
import sqlite3
import subprocess
import tempfile
from threading import Thread
import uuid

package = SourceFileLoader("mac_package", str(Path(__file__).with_name("package-macos-update.py"))).load_module()


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sparkle-cli", type=Path, required=True, help="Official sparkle-cli app built from the pinned source")
    parser.add_argument("--sparkle-tools", type=Path, required=True)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="rememberme-updater-test-") as temporary:
        root = Path(temporary)
        runner = root / "runner/sparkle.app"
        shutil.copytree(args.sparkle_cli, runner, symlinks=True)
        framework = runner / "Contents/Frameworks/Sparkle.framework"
        shutil.rmtree(framework)
        shutil.copytree(args.sparkle_tools.parent / "Sparkle.framework", framework, symlinks=True)
        runner_info = package.read_plist(runner)
        runner_info["CFBundleIdentifier"] = "com.rememberme.tests.updater-runner." + uuid.uuid4().hex
        with (runner / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(runner_info, stream)
        package.run("codesign", "--force", "--sign", "-", runner)
        package.run("codesign", "--verify", "--deep", "--strict", runner)
        site = root / "site"
        site.mkdir()
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(site)))
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        origin = f"http://127.0.0.1:{server.server_port}"
        identity = "com.rememberme.tests.update." + uuid.uuid4().hex
        public_key = package.run(args.sparkle_tools / "generate_keys", "--account", package.KEY_ACCOUNT, "-p", capture=True).strip()
        info = {"CFBundleIdentifier": identity, "CFBundleName": "SyntheticUpdater", "CFBundleExecutable": "fixture",
                "CFBundlePackageType": "APPL", "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0.0",
                "LSMinimumSystemVersion": "14.0", "SUFeedURL": origin + "/appcast.xml", "SUPublicEDKey": public_key,
                "SURequireSignedFeed": True, "SUVerifyUpdateBeforeExtraction": True, "SUSignedFeedFailureExpirationInterval": 0,
                "SUEnableAutomaticChecks": False, "SUEnableInstallerLauncherService": False}
        installed = root / "installed/SyntheticUpdater.app"
        (installed / "Contents/MacOS").mkdir(parents=True)
        source = root / "fixture.c"
        source.write_text("int main(void) { return 0; }\n")
        package.run("clang", source, "-o", installed / "Contents/MacOS/fixture")
        with (installed / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(info, stream)
        package.run("codesign", "--force", "--sign", "-", installed)
        candidate = root / "candidate/SyntheticUpdater.app"
        shutil.copytree(installed, candidate, symlinks=True)
        info.update(CFBundleVersion="2", CFBundleShortVersionString="1.1.0")
        with (candidate / "Contents/Info.plist").open("wb") as stream:
            plistlib.dump(info, stream)
        package.run("codesign", "--force", "--sign", "-", candidate)
        archive = site / "update.zip"
        package.run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", candidate, archive)
        signature = package.run(args.sparkle_tools / "sign_update", "--account", package.KEY_ACCOUNT, "-p", archive, capture=True).strip()
        feed = site / "appcast.xml"
        package.make_appcast(info, archive, signature, origin + "/update.zip", "Synthetic update only").write(feed, encoding="utf-8", xml_declaration=True)
        package.run(args.sparkle_tools / "sign_update", "--account", package.KEY_ACCOUNT, feed)
        original_feed, original_archive = feed.read_bytes(), archive.read_bytes()
        data_file = root / "Application Support/vocabulary.sqlite"
        data_file.parent.mkdir()
        with sqlite3.connect(data_file) as database:
            database.execute("CREATE TABLE words(word TEXT, count INTEGER)")
            database.execute("INSERT INTO words VALUES('synthetic', 3)")
        data_digest = hashlib.sha256(data_file.read_bytes()).hexdigest()
        command = [str(runner / "Contents/MacOS/sparkle"), str(installed),
                   "--feed-url", origin + "/appcast.xml", "--user-agent-name", "RememberMeDisposableUpdateVerification", "--verbose"]

        def check(expected, probe=False, label="", expected_code=None):
            result = subprocess.run(command + (["--probe"] if probe else ["--check-immediately"]), capture_output=True, text=True, timeout=60)
            if (result.returncode == 0) != expected:
                raise AssertionError(f"{label}: exit {result.returncode}\n{result.stdout}\n{result.stderr}")
            if expected_code is not None:
                assert result.returncode == expected_code, result.stderr
            assert hashlib.sha256(data_file.read_bytes()).hexdigest() == data_digest
            print(f"Passed: {label}", flush=True)

        try:
            check(True, probe=True, label="signed update discovery")
            assert package.read_plist(installed)["CFBundleVersion"] == "1"
            feed.write_bytes(original_feed.replace(b"Synthetic update only", b"Tampered update text"))
            check(False, probe=True, label="tampered signed feed rejected")
            feed.write_bytes(original_feed)
            archive.write_bytes(original_archive + b"tampered")
            check(False, label="tampered archive rejected before replacing the app")
            assert package.read_plist(installed)["CFBundleVersion"] == "1"
            archive.write_bytes(original_archive)
            feed.rename(site / "offline.xml")
            check(False, probe=True, label="unavailable feed leaves installed version intact")
            (site / "offline.xml").rename(feed)
            check(True, label="real signed download and installation")
            assert package.read_plist(installed)["CFBundleVersion"] == "2"
            package.run("codesign", "--verify", "--deep", "--strict", installed)
            check(False, probe=True, label="current version does not reinstall", expected_code=4)
            print("All updater checks passed; the separate SQLite fixture remained byte-identical.")
        finally:
            server.shutdown()
            server.server_close()
            # Only the randomly generated test preference domains are removed.
            subprocess.run(["defaults", "delete", identity], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["defaults", "delete", runner_info["CFBundleIdentifier"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
