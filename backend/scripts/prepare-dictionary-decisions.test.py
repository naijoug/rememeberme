import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('decisions', Path(__file__).with_name('prepare-dictionary-decisions.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DecisionsTests(unittest.TestCase):
    def fixture(self):
        entry = dict(schemaVersion=1, word='fixture', forms=[], senses=[dict(id='fixture:id', partOfSpeech='noun',
                     en='A test object.', zh='测试对象', example=dict(en='This is a test object.', zh='这是一个测试对象。'), collocations=[])])
        digest = module.digest(json.dumps(entry, ensure_ascii=False, separators=(',', ':')))
        inputs = [dict(word='fixture', inputHash=digest, entry=entry)]
        result = dict(word='fixture', inputHash=digest, verdict='accept', issues=[], entry=None, reason='Checked synthetic fixture.',
                      checks=[dict(sense=0, example='This is a test object.', verdict='ok', reason='Definition and example agree.')])
        return inputs, dict(results=[result])

    def test_accepted_evidence_is_hash_bound(self):
        inputs, audit = self.fixture()
        text, decisions, report = module.prepare(inputs, audit, {}, 'synthetic-editor')
        self.assertEqual(decisions['evidenceHash'], module.digest(text))
        self.assertEqual(report, dict(entries=1, revised=0, independent=1, direct=0))

    def test_revision_and_missing_reviews_need_explicit_editorial_content(self):
        inputs, audit = self.fixture()
        audit['results'][0]['verdict'] = 'revise'
        with self.assertRaisesRegex(ValueError, 'resolution required'):
            module.prepare(inputs, audit, {}, 'editor')
        resolution = {'fixture': dict(inputHash=inputs[0]['inputHash'], entry=module.raw_entry(inputs[0]['entry']), note='Direct fixture review.')}
        self.assertEqual(module.prepare(inputs, dict(results=[]), resolution, 'editor')[2]['direct'], 1)
        resolution['fixture']['pending'] = True
        with self.assertRaisesRegex(ValueError, 'still pending'):
            module.prepare(inputs, audit, resolution, 'editor')

    def test_stale_hashes_and_missing_sense_checks_fail_closed(self):
        inputs, audit = self.fixture()
        audit['results'][0]['checks'] = []
        with self.assertRaisesRegex(ValueError, 'per-sense'):
            module.prepare(inputs, audit, {}, 'editor')
        inputs[0]['entry']['forms'] = ['fixtures']
        with self.assertRaisesRegex(ValueError, 'checksum'):
            module.prepare(inputs, audit, {}, 'editor')

    def test_a_known_reference_error_cannot_pass_only_on_a_model_acceptance(self):
        inputs, audit = self.fixture()
        inputs[0]['word'] = inputs[0]['entry']['word'] = 'voltage'
        inputs[0]['inputHash'] = module.digest(json.dumps(inputs[0]['entry'], ensure_ascii=False, separators=(',', ':')))
        audit['results'][0]['word'] = 'voltage'
        audit['results'][0]['inputHash'] = inputs[0]['inputHash']
        with self.assertRaisesRegex(ValueError, 'direct editorial resolution'):
            module.prepare(inputs, audit, {}, 'editor')


if __name__ == '__main__':
    unittest.main()
