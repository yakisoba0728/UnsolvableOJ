import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** A successful npm invocation alone is insufficient: omitted shared dependencies
 * have produced incomplete inventories with npm's --omit=dev selector. Check
 * the complete pre-build graph against every locked package before publishing.
 */
export function validateSbom(sbom, lock) {
  if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components))
    throw new Error('Expected a CycloneDX component inventory');
  const rootRef = sbom.metadata?.component?.['bom-ref'];
  if (!rootRef || !lock.packages?.['']) throw new Error('Missing root component');
  const components = new Set(sbom.components.map(({ name, version }) => `${name}@${version}`));
  const missing = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 13);
    if (!components.has(`${name}@${entry.version}`)) missing.push(`${name}@${entry.version}`);
  }
  if (missing.length) throw new Error(`SBOM omits locked packages: ${[...new Set(missing)].join(', ')}`);
  const refs = new Set([rootRef, ...sbom.components.map((component) => component['bom-ref'])]);
  if (!Array.isArray(sbom.dependencies) || !sbom.dependencies.some(({ ref }) => ref === rootRef))
    throw new Error('Missing dependency graph');
  for (const { ref, dependsOn = [] } of sbom.dependencies) {
    if (!refs.has(ref) || dependsOn.some((dependency) => !refs.has(dependency)))
      throw new Error('SBOM dependency graph refers to an absent component');
  }
  return { components: sbom.components.length, lockRecords: Object.keys(lock.packages).length - 1 };
}

export function collectSboms() {
  const directory = join(root, 'reports', 'sbom');
  mkdirSync(directory, { recursive: true });
  const summary = {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    scope: 'Complete npm lockfile graph, including runtime, build and optional packages; not an installed image or browser-bundle inventory.',
    packages: {},
  };
  for (const component of ['Back', 'Front', 'Judge']) {
    const cwd = join(root, component);
    const lockBytes = readFileSync(join(cwd, 'package-lock.json'));
    const output = execFileSync('npm', [
      'sbom', '--package-lock-only', '--include=dev', '--include=optional', '--include=peer',
      '--sbom-format=cyclonedx',
    ], { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
    const sbom = JSON.parse(output);
    const counts = validateSbom(sbom, JSON.parse(lockBytes));
    writeFileSync(join(directory, `${component}.cdx.json`), output);
    summary.packages[component] = {
      ...counts,
      lockSha256: createHash('sha256').update(lockBytes).digest('hex'),
    };
  }
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) collectSboms();
