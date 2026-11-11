"""Freeze complete drafts and pinned public references; does not approve content."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def prepare(database, build, references):
    reference_text = Path(references).read_bytes()
    refs = json.loads(reference_text)
    with sqlite3.connect(Path(database).resolve().as_uri() + '?mode=ro', uri=True) as db:
        if db.execute('PRAGMA application_id').fetchone()[0] != 1380795459:
            raise ValueError('Not a dictionary database')
        config = db.execute('SELECT config FROM builds WHERE id=?', (build,)).fetchone()
        if config is None:
            raise ValueError('Unknown build')
        if json.loads(config[0]).get('referenceHash') != hashlib.sha256(reference_text).hexdigest():
            raise ValueError('Reference checksum mismatch')
        rows = db.execute('SELECT word,state,entry,content_hash FROM jobs WHERE build_id=? ORDER BY rank', (build,)).fetchall()
    if not rows or len(rows) > 1000 or any(state not in {'draft', 'approved', 'rejected'} or not entry for _, state, entry, _ in rows):
        raise ValueError('All batch words must have complete drafts')
    result = []
    for word, _, entry, digest in rows:
        if hashlib.sha256(entry.encode()).hexdigest() != digest or word not in refs:
            raise ValueError('Draft checksum/reference mismatch')
        result.append(dict(word=word, inputHash=digest, entry=json.loads(entry), reference=refs[word]))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--db', required=True)
    parser.add_argument('--build', required=True)
    parser.add_argument('--references', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    result = prepare(args.db, args.build, args.references)
    with Path(args.out).open('x') as stream:
        json.dump(result, stream, ensure_ascii=False, separators=(',', ':'))
        stream.write('\n')
    print(json.dumps({'frozen': len(result), 'build': args.build}))


if __name__ == '__main__':
    main()
