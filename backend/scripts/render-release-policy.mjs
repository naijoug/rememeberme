import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve('../frontend/browser-extension/docs/release/privacy-policy.md');
const destination = resolve('lookup-gateway/public/privacy.html');
const markdown = await readFile(source, 'utf8');
if (/\[.*(?:required before publication|PUBLICATION DATE|DEVELOPER NAME|PUBLIC EMAIL).*\]/i.test(markdown)) throw new Error('Privacy policy still contains publisher placeholders');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = text => escape(text).replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
let list = false, paragraph = [], elements = [];
const flush = () => { if (paragraph.length) { elements.push('<p>' + inline(paragraph.join(' ')) + '</p>'); paragraph = []; } };
const closeList = () => { if (list) { elements.push('</ul>'); list = false; } };
for (const line of markdown.split('\n')) {
  const heading = /^(#{1,3}) (.+)$/.exec(line);
  if (heading) { flush(); closeList(); const level = heading[1].length; elements.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
  else if (line.startsWith('- ')) { flush(); if (!list) { elements.push('<ul>'); list = true; } elements.push('<li>' + inline(line.slice(2)) + '</li>'); }
  else if (!line.trim()) { flush(); closeList(); }
  else { closeList(); paragraph.push(line); }
}
flush(); closeList();
await mkdir(resolve('lookup-gateway/public'), { recursive: true });
await writeFile(destination, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remember Me Privacy Policy</title><style>body{margin:0;background:#f7f6f2;color:#25352e;font:17px/1.7 system-ui,sans-serif}main{max-width:780px;margin:auto;padding:48px 24px}h1{font-size:34px;line-height:1.2}h2{font-size:23px;margin-top:34px}a{color:#386b51}li{margin:8px 0}@media(prefers-color-scheme:dark){body{background:#1c231f;color:#e7eee9}a{color:#9ed0b0}}</style></head><body><main>${elements.join('\n')}</main></body></html>\n`);
console.info('Published-policy HTML rendered from the reviewed Markdown source.');
