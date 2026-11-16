import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

// Immutable Phase II baseline and the completed Phase III learning + Vibe UI.
const revisions = {
  baseline: '45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4',
  final: 'f93c569cf12d219b9999612ff992a2d52863e210',
};
const [repositoryArg, installedFrontArg, outputArg] = process.argv.slice(2);
assert(repositoryArg && installedFrontArg && outputArg,
  'Usage: node phase3-final-bundles.mjs REPOSITORY INSTALLED_FRONT OUTPUT_DIRECTORY');
const repository = resolve(repositoryArg);
const installedFront = resolve(installedFrontArg);
const output = resolve(outputArg);
assert(!existsSync(output), 'Use a new output directory; never overwrite prior evidence');
mkdirSync(output, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'oj-phase3-final-bundles-'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
const paths = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? paths(join(directory, entry.name)) : [join(directory, entry.name)]).sort();
const bytesFor = file => {
  const bytes = readFileSync(file);
  return { bytes: bytes.length, sha256: sha256(bytes) };
};
const dependencyDirectory = realpathSync(join(installedFront, 'node_modules'));
const buildEnvironment = { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CI: '1', NODE_ENV: 'production' };
const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8', env: buildEnvironment }).trim();
const installedTree = spawnSync('npm', ['ls', '--all', '--json'], {
  cwd: installedFront, env: buildEnvironment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
assert.equal(installedTree.status, 0, `Installed dependency graph must validate: ${installedTree.stderr}`);
const dependencyTree = JSON.parse(installedTree.stdout);
writeFileSync(join(output, 'installed-dependencies.json'), `${JSON.stringify(dependencyTree, null, 2)}\n`);
const report = {
  schemaVersion: 1, recordedAt: new Date().toISOString(),
  supersedes: { commit: '3038961b835a4a435e12205ff022c7b1d91226bd',
    measurement: 'docs/overhaul/measurements/phase3-frontend-bundles.json',
    reason: 'Earlier frontend checkpoint precedes the final learning request-cancellation fix.' },
  toolchain: { node: process.version, npm: npmVersion, nodeExecutable: process.execPath,
    versions: process.versions, platform: process.platform, architecture: process.arch,
    installedDependencyDirectory: dependencyDirectory,
    installedDependencyLock: bytesFor(join(dependencyDirectory, '.package-lock.json')),
    installedDependencyGraph: bytesFor(join(output, 'installed-dependencies.json')) },
  protocol: { command: ['npm', 'run', 'build'], mode: 'production', buildEnvironment,
    inheritedOtherEnvironment: false, sourceMaterialization: 'Fresh git archive of Front into four separate owned directories',
    dependencies: 'Same existing lockfile-validated dependency tree, read through a symlink; no dependency install or update',
    defaultEnvironment: { VITE_SENTRY_DSN: null, VITE_API_BASE_URL: null },
    monitoringEnvironment: { VITE_SENTRY_DSN: 'https://benchmark@example.invalid/1', VITE_API_BASE_URL: null },
    envFiles: 'Committed .env.example only; no active Vite .env files allowed',
    initialDefinition: 'The single module script referenced by generated index.html, not the complete initial request graph',
    totalDefinition: 'Sum of every emitted .js file, including lazy pages, optional monitoring SDK and public theme-init.js',
    compression: 'Each file independently compressed with Node gzip level 9 / Brotli quality 11; totals sum individual files',
    repetitions: 1, applicationExecution: false, browserOrMonitoringNetworkCalls: false },
  sources: {}, builds: [],
  limitations: ['Static build artifact sizes, not transfer bytes observed through nginx or a CDN.',
    'Total emitted JavaScript is not downloaded for every route; optional monitoring remains a separate chunk.',
    'Initial module entry excludes its dependency graph, theme-init.js, CSS, fonts and HTML.',
    'No browser parse/execute/render timing, LCP/INP/CLS, CPU/RSS or real-device performance inference.',
    'One fresh build per condition; no claim of repeated-build determinism or performance significance.'],
};

for (const condition of ['default', 'monitoring-enabled']) {
  for (const [label, revision] of Object.entries(revisions)) {
    const directory = join(scratch, `${label}-${condition}`);
    mkdirSync(directory);
    const archive = join(directory, 'source.tar');
    execFileSync('git', ['-C', repository, 'archive', '--format=tar', `--output=${archive}`, revision, 'Front']);
    execFileSync('tar', ['-xf', archive, '-C', directory]);
    const front = join(directory, 'Front');
    const sourceFiles = paths(front).map(file => ({ path: relative(front, file), ...bytesFor(file) }));
    assert(sourceFiles.every(file => !/^\.env(?:$|\.local$|\.production(?:\.local)?$)/.test(file.path)), 'Active Vite env files would invalidate controlled conditions');
    for (const name of ['package.json', 'package-lock.json']) {
      assert.equal(bytesFor(join(front, name)).sha256, bytesFor(join(installedFront, name)).sha256,
        `Installed dependencies must match the immutable ${label} ${name}`);
    }
    if (!report.sources[label]) {
      report.sources[label] = { revision, tree: git('rev-parse', `${revision}^{tree}`),
        frontendTree: git('rev-parse', `${revision}:Front`),
        sourceInventorySha256: sha256(JSON.stringify(sourceFiles)), files: sourceFiles };
    } else assert.equal(sha256(JSON.stringify(sourceFiles)), report.sources[label].sourceInventorySha256);
    symlinkSync(dependencyDirectory, join(front, 'node_modules'), 'dir');
    const env = { ...buildEnvironment, ...(condition === 'monitoring-enabled' ? { VITE_SENTRY_DSN: 'https://benchmark@example.invalid/1' } : {}) };
    console.log(`Building ${label} / ${condition} from ${revision}`);
    const build = spawnSync('npm', ['run', 'build'], { cwd: front, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const logFile = `${label}-${condition}.build.log`;
    writeFileSync(join(output, logFile), `${build.stdout}\n${build.stderr}`);
    assert.equal(build.status, 0, `${label}/${condition} build failed; see ${logFile}`);
    // tsc output is outside tracked inputs; verify no source byte was altered during the build.
    for (const file of sourceFiles) assert.equal(bytesFor(join(front, file.path)).sha256, file.sha256, file.path);
    const dist = join(front, 'dist');
    const inventory = paths(dist).map(file => {
      const bytes = readFileSync(file);
      return { file: relative(dist, file), sha256: sha256(bytes), bytes: bytes.length,
        ...(file.endsWith('.js') || file.endsWith('.css') || basename(file) === 'index.html' ? {
          gzip: gzipSync(bytes, { level: 9 }).length,
          brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
        } : {}) };
    });
    const html = readFileSync(join(dist, 'index.html'), 'utf8');
    const moduleScript = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
    assert(moduleScript, 'Expected one HTML module entry');
    const initialModuleEntry = inventory.find(file => `/${file.file}` === moduleScript[1]);
    assert(initialModuleEntry);
    const javascript = inventory.filter(file => file.file.endsWith('.js'));
    const totals = files => ({ count: files.length, bytes: files.reduce((n, f) => n + f.bytes, 0),
      gzip: files.reduce((n, f) => n + f.gzip, 0), brotli: files.reduce((n, f) => n + f.brotli, 0) });
    const result = { source: label, condition, buildExitCode: build.status, buildLog: logFile,
      buildLogSha256: bytesFor(join(output, logFile)).sha256, initialModuleEntry,
      totalEmittedJavaScript: totals(javascript), totalEmittedCss: totals(inventory.filter(file => file.file.endsWith('.css'))),
      lazyLearningJavaScript: inventory.filter(file => /^assets\/LearningPage-.+\.js$/.test(file.file)),
      lazyLearningCss: inventory.filter(file => /^assets\/LearningPage-.+\.css$/.test(file.file)),
      optionalMonitoringJavaScript: inventory.filter(file => /^assets\/monitoringSdk-.+\.js$/.test(file.file)),
      outputInventorySha256: sha256(JSON.stringify(inventory)), files: inventory };
    report.builds.push(result);
    writeFileSync(join(output, 'phase3-final-frontend-bundles.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ source: label, condition, initial: initialModuleEntry, total: result.totalEmittedJavaScript,
      learningJs: result.lazyLearningJavaScript, learningCss: result.lazyLearningCss }));
  }
}
console.log(`Completed four builds. Raw evidence: ${output}. Owned build snapshots: ${scratch}`);
