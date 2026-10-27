"""Publish a reviewed signed release, then advance the personal macOS feed."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import xml.etree.ElementTree as ET

from importlib.machinery import SourceFileLoader
package = SourceFileLoader("mac_package", str(Path(__file__).with_name("package-macos-update.py"))).load_module()


def gh(*args):
    return subprocess.check_output(["gh", *map(str, args)], text=True).strip()


def release(tag):
    result = subprocess.run(["gh", "api", f"repos/{package.REPOSITORY}/releases/tags/{tag}"], capture_output=True, text=True)
    if result.returncode:
        if "HTTP 404" in result.stderr:
            return None
        raise RuntimeError("Could not read GitHub release state; no publishing attempted")
    return json.loads(result.stdout)


def download_digest(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        digest = hashlib.sha256()
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
        return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--sparkle-tools", type=Path, required=True)
    parser.add_argument("--initialize-channel", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((args.directory / "release.json").read_text())
    if gh("api", "user", "--jq", ".login") != "naijoug":
        raise ValueError("Publish with the personal naijoug GitHub account")
    repo = json.loads(gh("repo", "view", package.REPOSITORY, "--json", "nameWithOwner,visibility"))
    if repo != {"nameWithOwner": package.REPOSITORY, "visibility": "PUBLIC"}:
        raise ValueError("Unexpected update repository or visibility")
    info = package.read_plist(args.directory / "stage/Remember Me.app")
    package.validate(info)
    if manifest["version"] != info["CFBundleShortVersionString"] or manifest["build"] != info["CFBundleVersion"]:
        raise ValueError("Release manifest does not match the packaged application")
    version = manifest["version"]
    tag = f"macos-v{version}"
    archive = args.directory / f"RememberMe-{version}-macOS.zip"
    expected_url = f"https://github.com/{package.REPOSITORY}/releases/download/{tag}/{archive.name}"
    if manifest["downloadURL"] != expected_url or manifest["feedURL"] != package.FEED_URL:
        raise ValueError("Unexpected release destination")
    feed = args.directory / "appcast.xml"
    for path in (archive, feed):
        if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["files"][path.name]:
            raise ValueError("Release content changed after signing")
    package.run(args.sparkle_tools / "sign_update", "--account", package.KEY_ACCOUNT, "--verify", feed)
    item = ET.parse(feed).find("channel/item")
    enclosure = item.find("enclosure")
    if enclosure.get("url") != expected_url or item.findtext(f"{{{package.SPARKLE}}}version") != manifest["build"]:
        raise ValueError("Signed feed does not match the release")
    package.run(args.sparkle_tools / "sign_update", "--account", package.KEY_ACCOUNT, "--verify", archive,
                enclosure.get(f"{{{package.SPARKLE}}}edSignature"))
    previous_bytes = None
    stable = release("macos-stable")
    if stable is None and not args.initialize_channel:
        raise ValueError("First publication requires --initialize-channel")
    if stable:
        with tempfile.TemporaryDirectory(prefix="rememberme-old-feed-") as temporary:
            gh("release", "download", "macos-stable", "--repo", package.REPOSITORY, "--pattern", "appcast.xml", "--dir", temporary)
            previous = Path(temporary) / "appcast.xml"
            package.run(args.sparkle_tools / "sign_update", "--account", package.KEY_ACCOUNT, "--verify", previous)
            previous_bytes = previous.read_bytes()
            previous_build = int(ET.parse(previous).findtext(f"channel/item/{{{package.SPARKLE}}}version"))
            if previous_build >= int(manifest["build"]):
                if previous_build == int(manifest["build"]) and previous.read_bytes() == feed.read_bytes():
                    print("This exact signed feed is already published.")
                    return
                raise ValueError("Refusing to overwrite the channel with the same or an older build")
    # Commit application sources before publishing artifacts built from them.
    subprocess.run(["git", "diff", "--exit-code", "HEAD", "--", "frontend/apple"], cwd=package.ROOT.parents[1], check=True)
    if subprocess.check_output(["git", "ls-files", "--others", "--exclude-standard", "frontend/apple"], cwd=package.ROOT.parents[1], text=True).strip():
        raise ValueError("Commit new Apple source files before publishing")
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=package.ROOT.parents[1], text=True).strip()
    existing = release(tag)
    if existing is None:
        gh("release", "create", tag, archive, args.directory / "release.json", feed,
           "--repo", package.REPOSITORY, "--target", commit, "--draft",
           "--title", f"Remember Me for macOS {version}", "--notes-file", args.directory / "release-notes.md")
        gh("release", "edit", tag, "--repo", package.REPOSITORY, "--draft=false")
    elif existing["draft"]:
        raise ValueError("An existing draft needs review before publication")
    # Never advance discovery until the immutable public download is confirmed.
    if download_digest(expected_url) != manifest["files"][archive.name]:
        raise ValueError("Public archive digest differs; update feed was not advanced")
    if stable is None:
        notes = args.directory / "channel-notes.md"
        notes.write_text("Signed macOS update feed for Remember Me. Install an application release to get started.\n")
        gh("release", "create", "macos-stable", feed, "--repo", package.REPOSITORY, "--target", commit,
           "--title", "macOS stable update feed", "--notes-file", notes, "--prerelease", "--latest=false")
    else:
        try:
            gh("release", "upload", "macos-stable", feed, "--repo", package.REPOSITORY, "--clobber")
            if download_digest(package.FEED_URL) != manifest["files"][feed.name]:
                raise ValueError("Published feed verification failed")
        except Exception:
            with tempfile.TemporaryDirectory(prefix="rememberme-feed-rollback-") as temporary:
                previous = Path(temporary) / "appcast.xml"
                previous.write_bytes(previous_bytes)
                gh("release", "upload", "macos-stable", previous, "--repo", package.REPOSITORY, "--clobber")
            raise
    if download_digest(package.FEED_URL) != manifest["files"][feed.name]:
        raise ValueError("Published feed verification failed")
    print(f"Published https://github.com/{package.REPOSITORY}/releases/tag/{tag}")


if __name__ == "__main__":
    main()
