"""Prepare reviewable evidence/decisions; never approves or mutates a database."""
import argparse
import hashlib
import json
import os
from pathlib import Path

ERRATA = {item['word'] for item in json.loads((Path(__file__).resolve().parents[1] / 'dictionary/sources/reference-errata.json').read_text())['items']}
ERRATA |= {item['word'] for item in json.loads((Path(__file__).resolve().parents[1] / 'dictionary/sources/review-watchlist.json').read_text())['items']}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def raw_entry(entry):
    return dict(word=entry['word'], forms=entry['forms'],
                senses=[{key: value for key, value in sense.items() if key != 'id'} for sense in entry['senses']])


def prepare(inputs, audit, adjudications, reviewer):
    originals = {item['word']: item for item in inputs}
    results = {item['word']: item for item in audit['results']}
    if not originals or len(originals) != len(inputs) or len(results) != len(audit['results']):
        raise ValueError('Duplicate or missing review inputs')
    if set(results) - set(originals) or set(adjudications) - set(originals):
        raise ValueError('Unexpected review/adjudication words')
    items, changed, direct = [], 0, 0
    for word, item in originals.items():
        if word in ERRATA and word not in adjudications:
            raise ValueError('Known review concern requires direct editorial resolution: ' + word)
        serialized = json.dumps(item['entry'], ensure_ascii=False, separators=(',', ':'))
        if item['inputHash'] != digest(serialized):
            raise ValueError('Frozen entry checksum mismatch: ' + word)
        result = results.get(word)
        if result and result['inputHash'] != item['inputHash']:
            raise ValueError('Stale audit: ' + word)
        if word in adjudications:
            resolution = adjudications[word]
            if resolution.get('pending'):
                raise ValueError('Editorial resolution still pending: ' + word)
            if resolution['inputHash'] != item['inputHash'] or resolution['entry']['word'] != word or not resolution['note'].strip():
                raise ValueError('Stale or incomplete editorial resolution: ' + word)
            entry, note = resolution['entry'], resolution['note']
            direct += result is None
        else:
            if not result or result['verdict'] != 'accept' or result.get('issues') != [] or result.get('entry') is not None:
                raise ValueError('Explicit editorial resolution required: ' + word)
            checks = result.get('checks', [])
            if len(checks) != len(item['entry']['senses']) or any(
                check.get('sense') != index or check.get('verdict') != 'ok'
                or check.get('example') != item['entry']['senses'][index]['example']['en']
                or not isinstance(check.get('reason'), str) or not check['reason'].strip()
                for index, check in enumerate(checks)
            ):
                raise ValueError('Incomplete per-sense checks: ' + word)
            entry = raw_entry(item['entry'])
            note = 'Independent per-sense review accepted meanings, examples, forms and collocations. ' + result['reason']
        changed += entry != raw_entry(item['entry'])
        items.append(dict(word=word, inputHash=item['inputHash'], decision='approved', entry=entry, note=note))
    evidence = dict(method='ai-assisted-v1', independentAudit=audit, editorialAdjudications=adjudications,
                    coverage=dict(independent=len(results), directFullEntry=direct, total=len(inputs)),
                    limitations=['AI-assisted review, not human expert certification.', 'Compact senses are not exhaustive.'])
    text = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
    decisions = dict(reviewer=reviewer, method='ai-assisted-v1', evidenceHash=digest(text), items=items)
    return text, decisions, dict(entries=len(items), revised=changed, independent=len(results), direct=direct)


def main():
    parser = argparse.ArgumentParser()
    for name in ['input', 'audit', 'adjudications', 'reviewer', 'out-prefix']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    evidence, decisions, report = prepare(json.loads(Path(args.input).read_text()), json.loads(Path(args.audit).read_text()),
                                          json.loads(Path(args.adjudications).read_text()), args.reviewer)
    paths = [Path(args.out_prefix + '-evidence.json'), Path(args.out_prefix + '-decisions.json')]
    if any(path.exists() for path in paths):
        raise ValueError('Output must be new; reviewed evidence is immutable')
    for path, text in zip(paths, [evidence, json.dumps(decisions, ensure_ascii=False, indent=2) + '\n']):
        with path.open('x') as stream:
            stream.write(text)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
