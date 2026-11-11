"""Build provenance-pinned word lists and a disjoint missing-word generation plan."""
import argparse
import csv
import hashlib
import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('selection', Path(__file__).with_name('select-dictionary-expansion.py'))
selection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selection)
SOURCES = json.loads((ROOT / 'dictionary/sources/wordlists.json').read_text())
LABELS = {'ket': 'KET', 'cet4': '四级', 'cet6': '六级', 'tem8': '专八', 'toefl': '托福', 'ielts': '雅思'}


def verify(path, digest):
    data = Path(path).read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Source checksum mismatch: ' + str(path))
    return data


def ket_headwords(text):
    result = []
    # pdftotext -raw preserves the two columns in reading order. Exclude examples.
    for page in text.split('\f')[3:]:
        if 'Appendix 1' in page:
            break
        for line in page.splitlines():
            if line.lstrip().startswith('•'):
                continue
            match = re.match(r'^(.+?)\s+\((?:n|v|adj|adv|pron|det|prep|conj|exclam|av|mv|phr v|sing|pl|abbrev)(?:[\s,&;–-]|\))', line)
            if match:
                result.append(match[1].strip())
                result.extend(re.findall(r'\((?:Am|Br) Eng:\s*([^()]+)\)', line))
    return result


def ket_variants(head):
    special = {
        'blond(e)': ['blond', 'blonde'], 'gram(me)': ['gram', 'gramme'],
        'grand(d)ad': ['grandad', 'granddad'], 'kid(s)': ['kid', 'kids'],
        'photo(graph)': ['photo', 'photograph'], 'yog(h)urt': ['yogurt', 'yoghurt'],
        'laptop (computer)': ['laptop', 'laptop computer'], 'mobile (phone)': ['mobile', 'mobile phone'],
        'railway (station)': ['railway', 'railway station'], 'listen (to)': ['listen', 'listen to'],
        'as well (as)': ['as well', 'as well as'], 'of course (not)': ['of course', 'of course not'],
        'make sure (that)': ['make sure', 'make sure that'], "will ('ll)": ['will', "'ll"],
        'driving/driver’s licence': ['driving licence', "driver's licence"],
        'give somebody a call/ring': ['give somebody a call', 'give somebody a ring'],
        'poor thing/you': ['poor thing', 'poor you'],
        'centimetre/centimeter (cm)': ['centimetre', 'centimeter', 'cm'],
        'kilogramme (kg)': ['kilogramme', 'kg'], 'kilometre (km)': ['kilometre', 'km'],
        'television (TV)': ['television', 'TV'], 'PC (personal computer)': ['PC', 'personal computer'],
    }
    if head in special:
        return special[head]
    # Parenthetical labels describe senses, not additional headwords.
    head = re.sub(r' \([^()]*\)$', '', head).rstrip('!?').replace('’', "'")
    return [part.strip() for part in head.split('/')]


def make_list(category, raw, source):
    words, excluded = set(), {}
    for value in raw:
        word = value.strip().lower()
        if selection.WORD.fullmatch(word) and len(word) <= 80:
            words.add(word)
        else:
            excluded[value] = 'phrase' if ' ' in word else 'unsupported-spelling-or-abbreviation'
    return dict(id=source['id'], category=category, title=LABELS[category], version=source['version'],
                source={k: source[k] for k in ['url', 'revision', 'sha256', 'license', 'note']}, words=sorted(words),
                excluded=[dict(text=text, reason=reason) for text, reason in sorted(excluded.items())])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', required=True, help='Directory containing pinned CSV/PDF/text/TEM8 JSON')
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--existing-selection', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source_dir, out = Path(args.sources), Path(args.out)
    if out.exists():
        raise ValueError('Output must be a new directory')
    verify(source_dir / 'ecdict-pinned.csv', selection.SOURCE['csvSha256'])
    verify(source_dir / 'ket-2025.pdf', SOURCES['ket']['sha256'])
    ket_text = verify(source_dir / 'ket-2025-raw.txt', SOURCES['ket']['textSha256']).decode()
    tem8 = json.loads(verify(source_dir / 'tem8-lslab.json', SOURCES['tem8']['sha256']))
    rows, exam_words = {}, {key: [] for key in ['cet4', 'cet6', 'toefl', 'ielts']}
    with (source_dir / 'ecdict-pinned.csv').open(newline='') as stream:
        for row in csv.DictReader(stream):
            raw = row['word'].strip(); word = raw.lower()
            if selection.WORD.fullmatch(word):
                if word not in rows or raw == word:
                    rows[word] = {**row, 'word': raw}
            for tag in row['tag'].split():
                if tag in exam_words:
                    exam_words[tag].append(raw)
    lists = [make_list('ket', [v for h in ket_headwords(ket_text) for v in ket_variants(h)], SOURCES['ket'])]
    for key in ['cet4', 'cet6']:
        lists.append(make_list(key, exam_words[key], SOURCES[key]))
    lists.append(make_list('tem8', [SOURCES['tem8'].get('normalizations', {}).get(r['name'], {}).get('word', r['name']) for r in tem8], SOURCES['tem8']))
    for key in ['toefl', 'ielts']:
        lists.append(make_list(key, exam_words[key], SOURCES[key]))
    baseline = json.loads(Path(args.baseline).read_text())
    existing = set(baseline['words'])
    for path in Path(args.existing_selection).glob('expansion-10000-part-??.json'):
        existing.update(r['word'] for r in json.loads(path.read_text())['words'])
    memberships = {}
    for item in lists:
        for word in item['words']:
            memberships.setdefault(word, []).append(item['category'])
    missing = sorted(set(memberships) - existing, key=lambda w: (selection.rank(rows.get(w, {})), w))
    wn = {}
    for path in (ROOT.parent / 'frontend/browser-extension/public/dictionary/wordnet').glob('??.json'):
        wn.update(json.loads(path.read_text()))
    out.mkdir(parents=True)
    (out / 'wordlists.json').write_text(json.dumps(dict(schemaVersion=1, lists=lists), ensure_ascii=False, indent=2) + '\n')
    batches = []
    for start in range(0, len(missing), 1000):
        words = missing[start:start + 1000]; prefix = f'category-expansion-part-{start // 1000 + 1:02}'
        refs = {w: selection.reference(w, rows.get(w, {'word': w}), wn) for w in words}
        reference_text = json.dumps(refs, ensure_ascii=False, separators=(',', ':')) + '\n'
        reference_hash = hashlib.sha256(reference_text.encode()).hexdigest()
        dataset = dict(id=prefix+'-v2', metadata=dict(title='Category coverage expansion', source={k:v for k,v in selection.SOURCE.items() if k != 'licenseText'},
                       wordlistIds=[x['id'] for x in lists], referenceSha256=reference_hash, count=len(words),
                       wordsSha256=hashlib.sha256(('\n'.join(words)+'\n').encode()).hexdigest(),
                       selection='Union of pinned category single-word spellings minus approved pilot and the existing 9,000-word expansion; no level inference.'),
                       words=[dict(word=w,tags=['category-expansion',*['wordlist:'+tag for tag in memberships[w]]]) for w in words])
        (out/(prefix+'.json')).write_text(json.dumps(dataset,ensure_ascii=False,indent=2)+'\n')
        (out/(prefix+'.references.json')).write_text(reference_text)
        batches.append(dict(dataset=prefix+'.json',references=prefix+'.references.json',count=len(words),referenceSha256=reference_hash))
    report = dict(existingSelected=len(existing), categoryUnion=len(memberships), additional=len(missing), targetUnion=len(existing | set(memberships)),
                  lists=[dict(id=x['id'],category=x['category'],target=len(x['words']),alreadySelected=len(set(x['words'])&existing),
                              missingFromSelection=len(set(x['words'])-existing),excluded=len(x['excluded'])) for x in lists],batches=batches)
    (out/'selection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k!='batches'},ensure_ascii=False))


if __name__ == '__main__':
    main()
