#!/usr/bin/env python3
"""Build local IPA shards from the pinned, licensed ipa-dict English TSVs.

Usage: python3 scripts/build-ipa.py /path/to/source-directory
Required files: en_US.txt, en_UK.txt, ipa-dict-LICENSE.txt,
en-US-LICENSE.txt, en-UK-LICENSE.txt, cmudict-LICENSE.txt,
syllabify-LICENSE.txt. See public/dictionary/ipa/metadata.json.
"""
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys

SOURCES = {
    'en_US.txt': '2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67',
    'en_UK.txt': '221394caef0cf723b4f2df81a98ac33191293257b88aed5b1fb89466d3a0dc77',
    'ipa-dict-LICENSE.txt': '2c6a7e4c71f834a8fc0114fa4f65ca85e80bc4b4dc7ed08746963a09a7b0d177',
    'en-US-LICENSE.txt': 'a504bede5a50d1ac19c38984d9bb33371927f72e714946a963bf40bb2de21188',
    'en-UK-LICENSE.txt': '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    'cmudict-LICENSE.txt': 'bd4ce8e44170a5f9f481310ca85c51de3c4f851a65e679b40e603b143bd3542a',
    'syllabify-LICENSE.txt': '20318769d8694a14abb3b5c0f98ddd49105a22c9a38e75a2889da9f1bd08f737',
}
WORD = re.compile(r"(?:[a-zA-Z][a-zA-Z'\-]*[a-zA-Z]|[a-zA-Z])\Z")

def shard(word):
    value = 2166136261
    for char in word:
        value = ((value ^ ord(char)) * 16777619) & 0xffffffff
    return value & 63

def main():
    source = Path(sys.argv[1])
    raw = {name: (source / name).read_bytes() for name in SOURCES}
    for name, checksum in SOURCES.items():
        if hashlib.sha256(raw[name]).hexdigest() != checksum:
            raise ValueError(f'Unexpected SHA-256 for {name}')
    entries = {}
    counts = {}
    for index, name in enumerate(['en_US.txt', 'en_UK.txt']):
        count = 0
        for line in raw[name].decode('utf-8').splitlines():
            word, text = line.split('\t', 1)
            word = word.strip().lower()
            if not WORD.fullmatch(word):
                continue
            if not text.startswith('/') or not text.endswith('/') or len(text) > 2000:
                raise ValueError(f'Invalid IPA for {word}')
            entry = entries.setdefault(word, [None, None])
            if entry[index] is not None:
                raise ValueError(f'Duplicate {word} in {name}')
            entry[index] = text
            count += 1
        counts[name] = count
    output = Path(__file__).resolve().parent.parent / 'public/dictionary/ipa'
    output.mkdir(parents=True, exist_ok=True)
    shards = [{} for _ in range(64)]
    for word in sorted(entries):
        shards[shard(word)][word] = entries[word]
    byte_count = 0
    for key, data in enumerate(shards):
        contents = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
        (output / f'{key:02x}.json').write_text(contents, encoding='utf-8')
        byte_count += len(contents.encode('utf-8'))
    # Ship unmodified corresponding source, including all excluded entries.
    for name, contents in raw.items():
        if name in ['en_US.txt', 'en_UK.txt']:
            (output / (name + '.gz')).write_bytes(gzip.compress(contents, mtime=0))
        else:
            (output / name).write_bytes(contents)
    metadata = {
        'source': 'open-dict-data/ipa-dict',
        'retrieved': '2026-10-10',
        'url': 'https://github.com/open-dict-data/ipa-dict',
        'sourceHashesSha256': SOURCES, 'entries': len(entries), 'counts': counts,
        'shards': 64, 'jsonBytes': byte_count,
        'format': 'exact lowercase spelling -> [US IPA or null, UK IPA or null]',
        'licenses': {'en_US': 'MIT', 'en_UK': 'GPL-3.0 (ipacards-derived)'},
        'limitations': 'Broad phonemic transcriptions; variants retained as provided. Not a complete dictionary. No context-based heteronym choice. Speech synthesis is independent and can use a different variant.',
    }
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps({'entries': len(entries), 'counts': counts, 'jsonBytes': byte_count}))

if __name__ == '__main__':
    main()
