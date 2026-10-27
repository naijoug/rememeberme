"""Package an existing Release build for the personal, ad-hoc macOS channel.

Private signing material remains in Keychain. This script never publishes.
"""
import argparse
import base64
from datetime import datetime, timezone
from email.utils import format_datetime
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "naijoug/rememeberme"
KEY_ACCOUNT = "naijoug.rememberme"
FEED_URL = f"https://github.com/{REPOSITORY}/releases/download/macos-stable/appcast.xml"
SPARKLE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ET.register_namespace("sparkle", SPARKLE)


def run(*args, capture=False):
    return subprocess.run([str(arg) for arg in args], check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def read_plist(app):
    with (app / "Contents/Info.plist").open("rb") as stream:
        return plistlib.load(stream)


def validate(info):
    if info.get("CFBundleIdentifier") != "com.rememberme.app.mac" or info.get("SUFeedURL") != FEED_URL:
        raise ValueError("Unexpected application identity or update channel")
    if not re.fullmatch(r"[1-9][0-9]*", info.get("CFBundleVersion", "")):
        raise ValueError("Use a positive, monotonically increasing numeric build number")
    if not re.fullmatch(r"\d+\.\d+\.\d+", info.get("CFBundleShortVersionString", "")):
        raise ValueError("Use a three-part release version")
    if len(base64.b64decode(info.get("SUPublicEDKey", ""), validate=True)) != 32:
        raise ValueError("Missing Ed25519 public key")
    for key in ("SUVerifyUpdateBeforeExtraction", "SURequireSignedFeed"):
        if info.get(key) is not True:
            raise ValueError(f"{key} must remain enabled")
    if info.get("SUSignedFeedFailureExpirationInterval") != 0:
        raise ValueError("Signed feed failures must fail closed")


def make_appcast(info, archive, signature, download_url, notes):
    rss = ET.Element("rss", version="2.0")
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = "Remember Me for macOS"
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = f"Remember Me {info['CFBundleShortVersionString']}"
    ET.SubElement(item, "pubDate").text = format_datetime(datetime.now(timezone.utc))
    ET.SubElement(item, f"{{{SPARKLE}}}version").text = info["CFBundleVersion"]
    ET.SubElement(item, f"{{{SPARKLE}}}shortVersionString").text = info["CFBundleShortVersionString"]
    ET.SubElement(item, f"{{{SPARKLE}}}minimumSystemVersion").text = info.get("LSMinimumSystemVersion", "14.0")
    ET.SubElement(item, "description").text = notes
    ET.SubElement(item, "enclosure", {
        "url": download_url, "length": str(archive.stat().st_size),
        "type": "application/octet-stream", f"{{{SPARKLE}}}edSignature": signature,
    })
    return ET.ElementTree(rss)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--sparkle-tools", type=Path, required=True, help="Pinned Sparkle distribution bin directory")
    parser.add_argument("--output", type=Path, required=True, help="New, empty release directory")
    parser.add_argument("--notes", type=Path, required=True)
    args = parser.parse_args()
    info = read_plist(args.app)
    validate(info)
    public_key = run(args.sparkle_tools / "generate_keys", "--account", KEY_ACCOUNT, "-p", capture=True).strip()
    if public_key != info["SUPublicEDKey"]:
        raise ValueError("The embedded public key does not match the personal Keychain signing key")
    architectures = set(run("lipo", "-archs", args.app / "Contents/MacOS" / info["CFBundleExecutable"], capture=True).split())
    if architectures != {"arm64", "x86_64"}:
        raise ValueError("This release channel requires a universal Apple silicon/Intel app")
    args.output.mkdir(parents=True, exist_ok=False)
    staged = args.output / "stage/Remember Me.app"
    shutil.copytree(args.app, staged, symlinks=True)
    # Existing local installs are ad-hoc signed and unsandboxed. Keep their data
    # location; a future sandbox/Developer-ID migration requires a separate plan.
    info["SUEnableInstallerLauncherService"] = False
    with (staged / "Contents/Info.plist").open("wb") as stream:
        plistlib.dump(info, stream, sort_keys=False)
    framework = staged / "Contents/Frameworks/Sparkle.framework"
    for relative in ("Versions/B/XPCServices/Installer.xpc", "Versions/B/XPCServices/Downloader.xpc",
                     "Versions/B/Autoupdate", "Versions/B/Updater.app"):
        run("codesign", "--force", "--sign", "-", "--options", "runtime", framework / relative)
    run("codesign", "--force", "--sign", "-", "--options", "runtime", framework)
    run("codesign", "--force", "--sign", "-", staged)
    run("codesign", "--verify", "--deep", "--strict", staged)
    version = info["CFBundleShortVersionString"]
    archive = args.output / f"RememberMe-{version}-macOS.zip"
    run("ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", staged, archive)
    with tempfile.TemporaryDirectory(prefix="rememberme-update-archive-") as temporary:
        run("ditto", "-x", "-k", archive, temporary)
        extracted = Path(temporary) / "Remember Me.app"
        run("codesign", "--verify", "--deep", "--strict", extracted)
        if read_plist(extracted) != info:
            raise ValueError("Extracted archive metadata differs from the staged app")
        if not (extracted / "Contents/Resources/ThirdPartyNotices.txt").is_file():
            raise ValueError("Missing bundled third-party license notices")
    signature = run(args.sparkle_tools / "sign_update", "--account", KEY_ACCOUNT, "-p", archive, capture=True).strip()
    if len(base64.b64decode(signature, validate=True)) != 64:
        raise ValueError("Invalid update signature returned by Sparkle")
    run(args.sparkle_tools / "sign_update", "--account", KEY_ACCOUNT, "--verify", archive, signature)
    appcast = args.output / "appcast.xml"
    url = f"https://github.com/{REPOSITORY}/releases/download/macos-v{version}/{archive.name}"
    make_appcast(info, archive, signature, url, args.notes.read_text()).write(appcast, encoding="utf-8", xml_declaration=True)
    run(args.sparkle_tools / "sign_update", "--account", KEY_ACCOUNT, appcast)
    run(args.sparkle_tools / "sign_update", "--account", KEY_ACCOUNT, "--verify", appcast)
    manifest = {"version": version, "build": info["CFBundleVersion"], "repository": REPOSITORY,
                "publicKey": public_key, "feedURL": FEED_URL, "downloadURL": url, "architectures": sorted(architectures),
                "signing": "ad-hoc; Ed25519-signed archive and feed; not notarized",
                "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (archive, appcast)}}
    (args.output / "release.json").write_text(json.dumps(manifest, indent=2) + "\n")
    shutil.copy2(args.notes, args.output / "release-notes.md")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
