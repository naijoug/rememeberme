#!/usr/bin/env python3
"""Build packaged English lookup shards from the pinned WordNet data archive.

Download the data archive (no package scripts are executed):
https://registry.npmjs.org/wordnet-db/-/wordnet-db-3.1.14.tgz
Then: python3 scripts/build-wordnet.py /path/to/wordnet-db-3.1.14.tgz
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import tarfile

INTEGRITY = 'zVyFsvE+mq9MCmwXUWHIcpfbrHHClZWZiVOzKSxNJruIcFn2RbY55zkhiAMMxM8zCVSmtNiViq8FsAZSFpMYag=='
WORD = re.compile(r"^[a-z](?:[a-z'-]*[a-z])?$")


def shard(word):
    value = 2166136261
    for char in word:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return f'{value & 255:02x}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/dictionary/wordnet')
    args = parser.parse_args()
    digest = base64.b64encode(hashlib.sha512(args.archive.read_bytes()).digest()).decode()
    if digest != INTEGRITY:
        raise SystemExit('Archive integrity does not match pinned wordnet-db 3.1.14')

    entries = {}
    with tarfile.open(args.archive) as archive:
        def read(name):
            # Read only known members. Never extract or run package contents.
            return archive.extractfile('package/' + name).read().decode('utf-8').replace('\r\n', '\n')

        for suffix, pos in [('noun', 'noun'), ('verb', 'verb'), ('adj', 'adjective'), ('adv', 'adverb')]:
            senses = {}
            for line in read('dict/data.' + suffix).splitlines():
                if not line or not line[0].isdigit():
                    continue
                fields, gloss = line.split('|', 1)
                gloss = gloss.strip()
                definition, separator, examples = gloss.partition('; "')
                item = [definition.strip()]
                if separator:
                    quoted = re.findall(r'"([^\"]+)"', '"' + examples)
                    if quoted:
                        item.append('; '.join(quoted))
                senses[fields.split()[0]] = item
            for line in read('dict/index.' + suffix).splitlines():
                if not line or line.startswith(' '):
                    continue
                fields = line.split()
                word = fields[0]
                if not WORD.fullmatch(word):
                    continue
                offsets = fields[6 + int(fields[3]):]
                if len(offsets) != int(fields[2]):
                    raise ValueError('Invalid WordNet index: ' + word)
                definitions = [senses[offset] for offset in offsets]
                entries.setdefault(word, []).append([pos, definitions])

        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / 'LICENSE.txt').write_text('\n'.join(line.rstrip() for line in read('LICENSE').splitlines()) + '\n', encoding='utf-8')
        # Preserve the newer copyright notice carried in the 3.1 data files too.
        header = '\n'.join(re.sub(r'^\s*\d+\s?', '', line).rstrip() for line in read('dict/data.noun').splitlines() if line.startswith(' '))
        (args.output / 'DATA-LICENSE.txt').write_text(header + '\n', encoding='utf-8')

    buckets = {f'{index:02x}': {} for index in range(256)}
    for word, meanings in sorted(entries.items()):
        buckets[shard(word)][word] = meanings
    total = 0
    for key, data in buckets.items():
        encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
        (args.output / (key + '.json')).write_text(encoded, encoding='utf-8')
        total += len(encoded.encode('utf-8'))
    metadata = {
        'source': 'WordNet 3.1', 'package': 'wordnet-db@3.1.14',
        'archive': 'https://registry.npmjs.org/wordnet-db/-/wordnet-db-3.1.14.tgz',
        'integrity': 'sha512-' + INTEGRITY, 'entries': len(entries), 'shards': 256,
        'jsonBytes': total, 'format': 'word -> [partOfSpeech, [[definition, optionalExample], ...]][]',
        'filter': 'Single English words matching the extension selection alphabet; sense order retained.',
        'limitations': 'English definitions; no phonetics/audio, function words or morphological exception lists. Multiword entries excluded.',
    }
    (args.output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    (args.output / 'NOTICE.txt').write_text(
        'WordNet 3.1 lexical data, redistributed in compact lookup shards.\n'
        'Source: https://wordnet.princeton.edu/\n'
        'George A. Miller (1995). WordNet: A Lexical Database for English.\n'
        'Communications of the ACM Vol. 38, No. 11: 39-41.\n'
        'See LICENSE.txt and DATA-LICENSE.txt for the original notices and disclaimer.\n'
        'Modified for Remember Me: single-word selection filter, indexed JSON shards,\n'
        'definition/example separation; lexical sense order preserved.\n'
        'No endorsement by the original data provider is implied.\n', encoding='utf-8')
    print(json.dumps({'entries': len(entries), 'shards': 256, 'jsonBytes': total}))


if __name__ == '__main__':
    main()
