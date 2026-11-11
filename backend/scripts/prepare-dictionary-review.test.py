import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('review', Path(__file__).with_name('prepare-dictionary-review.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FrozenReviewTests(unittest.TestCase):
    def test_refuses_incomplete_or_stale_inputs_without_mutating_the_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            refs = root / 'refs.json'
            refs.write_text(json.dumps({'fixture': {'source': 'synthetic'}}))
            reference_hash = hashlib.sha256(refs.read_bytes()).hexdigest()
            path = root / 'dictionary.sqlite'
            db = sqlite3.connect(path)
            db.executescript('PRAGMA application_id=1380795459; CREATE TABLE builds(id TEXT,config TEXT); CREATE TABLE jobs(build_id TEXT,word TEXT,state TEXT,entry TEXT,content_hash TEXT,rank INTEGER);')
            db.execute('INSERT INTO builds VALUES(?,?)', ('build', json.dumps({'referenceHash': reference_hash})))
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?)', ('build', 'fixture', 'pending', None, None, 1))
            db.commit()
            with self.assertRaisesRegex(ValueError, 'complete drafts'):
                module.prepare(path, 'build', refs)
            entry = json.dumps({'word': 'fixture', 'forms': [], 'senses': []})
            digest = hashlib.sha256(entry.encode()).hexdigest()
            db.execute("UPDATE jobs SET state='draft',entry=?,content_hash=?", (entry, digest))
            db.commit()
            before = path.read_bytes()
            self.assertEqual(module.prepare(path, 'build', refs)[0]['inputHash'], digest)
            self.assertEqual(path.read_bytes(), before)
            db.execute("UPDATE jobs SET content_hash='stale'")
            db.commit()
            with self.assertRaisesRegex(ValueError, 'Draft checksum'):
                module.prepare(path, 'build', refs)
            refs.write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Reference checksum'):
                module.prepare(path, 'build', refs)
            db.close()


if __name__ == '__main__':
    unittest.main()
