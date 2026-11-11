"""Select a reproducible, disjoint expansion. Never reads user vocabulary."""
import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = json.loads((ROOT / 'dictionary/sources/ecdict.json').read_text())
WORD = re.compile(r"[a-z](?:[a-z'-]*[a-z])?\Z")
EXAMS = {'cet4', 'cet6', 'ielts', 'toefl'}


def rank(row):
    def positive(key):
        try:
            value = int(row.get(key) or 0)
            return value if value > 0 else None
        except (ValueError, TypeError):
            return None
    return positive('frq') or positive('bnc') or 1_000_000


def choose(rows, existing, wordnet, count):
    eligible = {}
    for row in rows:
        raw = row.get('word') or ''
        word = raw.strip().lower()
        tags = set((row.get('tag') or '').split())
        if not WORD.fullmatch(word) or len(word) > 80 or word in existing:
            continue
        if not re.search('[\u3400-\u9fff]', row.get('translation') or ''):
            continue
        if raw != word and not tags & EXAMS:
            continue
        if word not in wordnet and not tags & EXAMS:
            continue
        # Prefer a real lowercase entry to a capitalization-only homograph.
        previous = eligible.get(word)
        if previous is None or (raw == word and previous['word'] != word):
            eligible[word] = row
    ordered = sorted(eligible, key=lambda word: (rank(eligible[word]), word))
    selected = []
    seen = set()
    # Secure the core college lists, then frequent reading words, then broader exams.
    predicates = [
        lambda r: bool(set((r.get('tag') or '').split()) & {'cet4', 'cet6'}),
        lambda r: rank(r) <= 6000,
        lambda r: bool(set((r.get('tag') or '').split()) & {'ielts', 'toefl'}),
        lambda r: True,
    ]
    for predicate in predicates:
        for word in ordered:
            if len(selected) >= count:
                break
            if word not in seen and predicate(eligible[word]):
                selected.append(word)
                seen.add(word)
    if len(selected) != count:
        raise ValueError('Not enough eligible unique words')
    return selected, eligible


def clean(value):
    return (value or '').replace('\\\\n', '\n').replace('\\n', '\n').replace('\r', '').strip()


def reference(word, row, wn):
    english = []
    for part, definitions in wn.get(word, [])[:4]:
        for definition in definitions[:2]:
            english.append((part + ': ' + definition[0])[:320])
    if not english:
        english = [line[:320] for line in clean(row.get('definition')).splitlines() if line.strip()][:6]
    forms = []
    for item in (row.get('exchange') or '').split('/'):
        kind, _, value = item.partition(':')
        if kind in {'p', 'd', 'i', '3', 'r', 't', 's'}:
            for form in value.lower().split(','):
                if WORD.fullmatch(form) and form != word and form not in forms and len(form) <= 80:
                    forms.append(form)
    return {'source': 'ecdict-wordnet-v1', 'originalSpelling': row['word'],
            'english': english[:6], 'chinese': clean(row.get('translation'))[:1600], 'forms': forms[:12]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('csv')
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--target', type=int, required=True)
    parser.add_argument('--batch-size', type=int, default=1000)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    source = Path(args.csv)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != SOURCE['csvSha256']:
        raise ValueError('Pinned ECDICT SHA-256 mismatch; partial downloads are not usable')
    baseline = json.loads(Path(args.baseline).read_text())
    existing = set(baseline['words'])
    if len(existing) != baseline['entries'] or args.target <= len(existing) or not 1 <= args.batch_size <= 1000:
        raise ValueError('Invalid expansion bounds')
    out = Path(args.output)
    if out.exists():
        raise ValueError('Selection output must be a new directory')
    wn = {}
    for path in (ROOT.parent / 'frontend/browser-extension/public/dictionary/wordnet').glob('??.json'):
        wn.update(json.loads(path.read_text()))
    with source.open(newline='') as stream:
        selected, eligible = choose(csv.DictReader(stream), existing, wn, args.target - len(existing))
    out.mkdir(parents=True)
    source_meta = {key: value for key, value in SOURCE.items() if key != 'licenseText'}
    batches = []
    for start in range(0, len(selected), args.batch_size):
        words = selected[start:start + args.batch_size]
        number = start // args.batch_size + 1
        prefix = f'expansion-{args.target}-part-{number:02}'
        refs = {word: reference(word, eligible[word], wn) for word in words}
        reference_text = json.dumps(refs, ensure_ascii=False, separators=(',', ':')) + '\n'
        reference_hash = hashlib.sha256(reference_text.encode()).hexdigest()
        dataset = {'id': prefix + '-v1', 'metadata': {
            'title': f'Remember Me expansion toward {args.target} words: part {number}',
            'baseEdition': baseline['version'], 'source': source_meta, 'count': len(words),
            'referenceSha256': reference_hash,
            'selection': 'CET4/CET6 source-tagged words, then source frequency rank <=6000, then IELTS/TOEFL source tags, then remaining frequency-ranked candidates; exact lowercase spellings, case-sensitive source preference, ASCII selection alphabet, no baseline duplicates. Not an official exam list or a claim of unique lemmas.',
            'wordsSha256': hashlib.sha256(('\n'.join(words) + '\n').encode()).hexdigest(),
        }, 'words': [{'word': word, 'tags': ['expansion', *['ecdict:' + tag for tag in (eligible[word].get('tag') or '').split() if tag in EXAMS]]} for word in words]}
        (out / (prefix + '.json')).write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + '\n')
        (out / (prefix + '.references.json')).write_text(reference_text)
        batches.append({'dataset': prefix + '.json', 'references': prefix + '.references.json', 'count': len(words), 'referenceSha256': reference_hash})
    tags = Counter(tag for word in selected for tag in (eligible[word].get('tag') or '').split() if tag in EXAMS)
    report = {'baseEdition': baseline['version'], 'baseCount': len(existing), 'newCount': len(selected), 'target': args.target,
              'source': source_meta, 'sourceTagCountsInNewWords': dict(tags), 'batches': batches,
              'overlap': len(existing & set(selected)), 'newWordsSha256': hashlib.sha256(('\n'.join(selected) + '\n').encode()).hexdigest()}
    (out / 'selection.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['baseCount', 'newCount', 'target', 'overlap', 'sourceTagCountsInNewWords']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
