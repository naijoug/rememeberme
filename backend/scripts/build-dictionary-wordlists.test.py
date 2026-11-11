import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('wordlists', Path(__file__).with_name('build-dictionary-wordlists.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class WordlistTests(unittest.TestCase):
    def test_ket_only_reads_alphabetical_heads_not_examples_or_appendices(self):
        text = 'cover\fintro\fnotes\fapple (n)\n• an apple (n)\nbook (n)\fAppendix 1\nextra (n)'
        self.assertEqual(module.ket_headwords(text), ['apple', 'book'])

    def test_expands_spelling_variants_without_inventing_words_from_phrases(self):
        self.assertEqual(module.ket_variants('blond(e)'), ['blond', 'blonde'])
        self.assertEqual(module.ket_variants('driving/driver’s licence'), ['driving licence', "driver's licence"])
        self.assertEqual(module.ket_variants('design (PLANNING)'), ['design'])

    def test_membership_is_deduplicated_and_exclusions_are_explicit(self):
        data = module.make_list('ket', ['Book', 'book', 'take off', 'a.m.'], module.SOURCES['ket'])
        self.assertEqual(data['words'], ['book'])
        self.assertEqual([x['reason'] for x in data['excluded']], ['unsupported-spelling-or-abbreviation', 'phrase'])

if __name__ == '__main__':
    unittest.main()
