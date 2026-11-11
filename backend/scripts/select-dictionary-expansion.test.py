import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('selection', Path(__file__).with_name('select-dictionary-expansion.py'))
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)


def row(word, tag='', frq='0', **kwargs):
    return dict(word=word, tag=tag, frq=frq, translation='测试参考', **kwargs)


class SelectionTests(unittest.TestCase):
    def test_disjoint_deterministic_exam_then_frequency_priority(self):
        rows = [row('old', 'cet4', '1'), row('reading', frq='2'), row('exam', 'cet6', '100'), row('broad', 'ielts', '9000'), row('tail', frq='10000')]
        words, _ = selection.choose(rows, {'old'}, {'reading': [], 'tail': []}, 4)
        self.assertEqual(words, ['exam', 'reading', 'broad', 'tail'])
        self.assertEqual(selection.choose(list(reversed(rows)), {'old'}, {'reading': [], 'tail': []}, 4)[0], words)

    def test_filters_names_invalid_keys_and_unreferenced_words(self):
        rows = [row('London'), row('no space', 'cet4'), row('unknown'), row('good', frq='10')]
        self.assertEqual(selection.choose(rows, set(), {'london': [], 'good': []}, 1)[0], ['good'])
        with self.assertRaisesRegex(ValueError, 'Not enough'):
            selection.choose(rows, set(), {'good': []}, 2)

    def test_lowercase_homograph_wins_over_acronym(self):
        rows = [row('US', 'cet4', '1'), row('us', 'cet4', '10')]
        self.assertEqual(selection.choose(rows, set(), {}, 1)[1]['us']['word'], 'us')

    def test_reference_bounds_and_ordinary_forms_only(self):
        ref = selection.reference('try', row('try', definition='line\\nline two', exchange='p:tried/i:trying/0:trial/s:tries/s:tries'), {})
        self.assertEqual(ref['forms'], ['tried', 'trying', 'tries'])
        self.assertEqual(ref['english'], ['line', 'line two'])
        long = selection.reference('try', row('try', definition='x' * 1000, exchange=''), {})
        self.assertEqual(len(long['english'][0]), 320)


if __name__ == '__main__':
    unittest.main()
