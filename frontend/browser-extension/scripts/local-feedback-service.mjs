import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const label = `com.rememberme.local-feedback-${createHash('sha256').update(root).digest('hex').slice(0, 8)}`;
const domain = `gui/${process.getuid?.()}`;
const agentFile = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const logFile = join(root, '.local-feedback', 'service.log');
const command = process.argv[2];

if (process.platform !== 'darwin') {
  console.error('This background-service helper requires macOS. Use npm run dev:local in a terminal on other systems.');
  process.exit(1);
}
if (!['start', 'stop', 'status'].includes(command)) {
  console.error('Usage: node scripts/local-feedback-service.mjs <start|stop|status>');
  process.exit(1);
}

function launchctl(...args) {
  return spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
}
function check(result) {
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
}
function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
function showStatus() {
  const result = launchctl('print', `${domain}/${label}`);
  if (result.status !== 0) {
    console.log('Local feedback service is stopped. Start it with npm run local:start.');
  } else {
    console.log('Local feedback service is registered with macOS:');
    console.log(result.stdout.split('\n').filter(line => /^\s*(state|pid|last exit code) =/.test(line)).map(line => line.trim()).join('\n'));
  }
  console.log(`Extension directory: ${join(root, '.output', 'chrome-mv3-feedback')}`);
  console.log(`Log: ${logFile}`);
}

try {
  if (command === 'status') {
    showStatus();
  } else if (command === 'stop') {
    if (launchctl('print', `${domain}/${label}`).status === 0) check(launchctl('bootout', `${domain}/${label}`));
    rmSync(agentFile, { force: true });
    console.log('Stopped local feedback and removed its login startup entry. Browser vocabulary was not changed.');
  } else {
    const binary = join(root, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
    if (!existsSync(binary)) throw new Error('Run npm ci before starting local feedback.');
    if (launchctl('print', `${domain}/${label}`).status === 0) {
      showStatus();
    } else {
      if (existsSync(agentFile) && !readFileSync(agentFile, 'utf8').includes(xml(root))) {
        throw new Error(`Existing startup entry belongs to a different checkout: ${agentFile}`);
      }
      mkdirSync(dirname(agentFile), { recursive: true });
      mkdirSync(dirname(logFile), { recursive: true });
      const args = [process.execPath, binary, '--config', 'wxt.feedback.config.ts', '--mode', 'feedback'];
      writeFileSync(agentFile, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(logFile)}</string>
<key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict></plist>\n`, { mode: 0o600 });
      check(spawnSync('/usr/bin/plutil', ['-lint', agentFile], { encoding: 'utf8' }));
      check(launchctl('bootstrap', domain, agentFile));
      showStatus();
      console.log('It will also start at login. Use npm run local:stop to disable it.');
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
