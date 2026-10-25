import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLaunchAgentState, checkFeedbackAssets, checkFeedbackFiles, serviceStartAction, toolchainFingerprint, bootstrapWithRetry } from './local-feedback-health.mjs';

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
function getState() {
  return readLaunchAgentState(launchctl('print', `${domain}/${label}`));
}
function runtimeDigest() {
  return toolchainFingerprint(readFileSync(join(root, 'package.json'), 'utf8'), readFileSync(join(root, 'package-lock.json'), 'utf8'), process.version);
}
async function showStatus() {
  const current = getState();
  let healthy = false;
  if (!current.registered) {
    console.log('Local feedback service is stopped. Start it with npm run local:start.');
  } else if (!current.running) {
    console.log(`Local feedback service is registered but ${current.state}. Run npm run local:start to recover it.`);
  } else {
    try {
      await checkFeedbackAssets();
      await checkFeedbackFiles();
      if (!existsSync(agentFile) || !readFileSync(agentFile, 'utf8').includes(`<key>REMEMBERME_TOOLCHAIN_DIGEST</key><string>${runtimeDigest()}</string>`)) {
        throw new Error('The toolchain changed. Run npm run local:start to restart this watcher with the current dependencies.');
      }
      healthy = true;
      console.log('Local feedback service is running; Chrome development assets are reachable.');
    } catch (error) {
      console.log(`Local feedback process is running but not ready: ${error.message}`);
    }
  }
  console.log(`Extension directory: ${join(root, '.output', 'chrome-mv3-feedback')}`);
  console.log(`Log: ${logFile}`);
  return healthy;
}

async function waitUntilReady() {
  const deadline = Date.now() + 20000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (!getState().running) throw new Error('The watcher process is not running');
      await checkFeedbackAssets();
      await checkFeedbackFiles();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Local feedback did not become ready: ${lastError?.message}. Check ${logFile}`);
}

try {
  if (command === 'status') {
    if (!await showStatus()) process.exitCode = 1;
  } else if (command === 'stop') {
    if (getState().registered) check(launchctl('bootout', `${domain}/${label}`));
    rmSync(agentFile, { force: true });
    console.log('Stopped local feedback and removed its login startup entry. Browser vocabulary was not changed.');
  } else {
    const binary = join(root, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
    if (!existsSync(binary)) throw new Error('Run npm ci before starting local feedback.');
    const current = getState();
    if (existsSync(agentFile) && !readFileSync(agentFile, 'utf8').includes(xml(root))) {
      throw new Error(`Existing startup entry belongs to a different checkout: ${agentFile}`);
    }
    mkdirSync(dirname(agentFile), { recursive: true });
    mkdirSync(dirname(logFile), { recursive: true });
    const args = [process.execPath, binary, '--config', 'wxt.feedback.config.ts', '--mode', 'feedback'];
    const toolchain = runtimeDigest();
    const configuration = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(dirname(process.execPath))}:/usr/bin:/bin:/usr/sbin:/sbin</string><key>REMEMBERME_TOOLCHAIN_DIGEST</key><string>${toolchain}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(logFile)}</string>
<key>StandardErrorPath</key><string>${xml(logFile)}</string>
</dict></plist>\n`;
    const configChanged = !existsSync(agentFile) || readFileSync(agentFile, 'utf8') !== configuration;
    if (configChanged) writeFileSync(agentFile, configuration, { mode: 0o600 });
    check(spawnSync('/usr/bin/plutil', ['-lint', agentFile], { encoding: 'utf8' }));
    const action = serviceStartAction(current, configChanged);
    if (action === 'replace') check(launchctl('bootout', `${domain}/${label}`));
    if (action === 'replace' || action === 'bootstrap') check(await bootstrapWithRetry(() => launchctl('bootstrap', domain, agentFile)));
    if (action === 'kickstart') check(launchctl('kickstart', `${domain}/${label}`));
    await waitUntilReady();
    await showStatus();
    console.log('It will also start at login. Use npm run local:stop to disable it.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
