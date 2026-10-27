import base64
from importlib.machinery import SourceFileLoader
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

package = SourceFileLoader("mac_package", str(Path(__file__).with_name("package-macos-update.py"))).load_module()


class UpdatePolicyTests(unittest.TestCase):
    def setUp(self):
        self.info = {"CFBundleIdentifier": "com.rememberme.app.mac", "CFBundleVersion": "2",
                     "CFBundleShortVersionString": "0.2.0", "SUFeedURL": package.FEED_URL,
                     "SUPublicEDKey": base64.b64encode(bytes(32)).decode(),
                     "SURequireSignedFeed": True, "SUVerifyUpdateBeforeExtraction": True,
                     "SUSignedFeedFailureExpirationInterval": 0}

    def test_valid_personal_update_configuration(self):
        package.validate(self.info)

    def test_other_bundle_or_feed_is_rejected(self):
        for key, value in [("CFBundleIdentifier", "com.other.app"), ("SUFeedURL", "https://example.test/update.xml")]:
            info = {**self.info, key: value}
            with self.assertRaises(ValueError):
                package.validate(info)

    def test_unsigned_or_expiring_feed_policy_is_rejected(self):
        for key, value in [("SURequireSignedFeed", False), ("SUVerifyUpdateBeforeExtraction", False),
                           ("SUSignedFeedFailureExpirationInterval", 1)]:
            with self.assertRaises(ValueError):
                package.validate({**self.info, key: value})

    def test_missing_or_malformed_public_key_is_rejected(self):
        for value in ["", "invalid!", base64.b64encode(bytes(31)).decode()]:
            with self.assertRaises(ValueError):
                package.validate({**self.info, "SUPublicEDKey": value})

    def test_invalid_build_identifiers_are_rejected(self):
        for value in ["0", "-1", "1.2", "deadbeef", "02"]:
            with self.assertRaises(ValueError):
                package.validate({**self.info, "CFBundleVersion": value})

    def test_appcast_keeps_version_size_and_literal_notes(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "fixture.zip"
            archive.write_bytes(b"fixture")
            notes = "Literal <script> & release note"
            tree = package.make_appcast(self.info, archive, "synthetic-signature", "https://example.test/update.zip", notes)
            item = ET.fromstring(ET.tostring(tree.getroot())).find("channel/item")
            self.assertEqual(item.findtext(f"{{{package.SPARKLE}}}version"), "2")
            self.assertEqual(item.findtext("description"), notes)
            self.assertEqual(item.find("enclosure").get("length"), "7")


if __name__ == "__main__":
    unittest.main()
