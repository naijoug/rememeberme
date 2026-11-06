import { packageEdition } from '../.build/dictionary-assets.mjs';
const [release, destination] = process.argv.slice(2);
if (!release || !destination) throw new Error('Usage: npm run dict:package -- REVIEWED_RELEASE NEW_ASSET_DIRECTORY');
const result = packageEdition(release, destination);
console.log(JSON.stringify({ version: result.version, entries: result.entries, shards: Object.keys(result.shards).length }));
