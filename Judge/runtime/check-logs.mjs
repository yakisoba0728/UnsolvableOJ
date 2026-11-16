import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Never include the supplied token or captured logs in an assertion/error: even
// a failing regression must not echo credentials into CI or a developer's shell.
export function checkSandboxStartupLogs(logs, token) {
  if (typeof token !== 'string' || token.length < 16) {
    throw new Error('A configured sandbox test token of at least 16 characters is required');
  }
  if (typeof logs !== 'string' || !logs.trim()) {
    throw new Error('Sandbox startup logs are missing');
  }
  if (logs.includes(token) || logs.includes(JSON.stringify(token).slice(1, -1))) {
    throw new Error('Sandbox startup logs exposed the configured authentication token');
  }
  for (const marker of ['Config loaded', 'Attach token auth', 'AuthToken:[redacted]']) {
    if (!logs.includes(marker)) {
      throw new Error('Sandbox startup logs do not prove authenticated, redacted startup');
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    let logs;
    try {
      logs = execFileSync('docker', ['compose', 'logs', '--no-color', 'go-judge'], {
        encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error('Could not capture sandbox startup logs');
    }
    checkSandboxStartupLogs(logs, process.env.GO_JUDGE_TOKEN);
    console.log('Sandbox authentication token is absent from startup logs');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
