import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSbom } from './collect-sboms.mjs';

const fixture = () => ({
  lock: { packages: {
    '': { name: 'fixture', dependencies: { '@scope/shared': '^1.0.0' } },
    'node_modules/@scope/shared': { version: '1.0.0' },
    'node_modules/build-tool': { version: '2.0.0', dev: true },
    'node_modules/build-tool/node_modules/@scope/shared': { version: '1.0.0', dev: true },
  } },
  sbom: {
    bomFormat: 'CycloneDX', metadata: { component: { 'bom-ref': 'fixture@1.0.0' } },
    components: [
      { name: '@scope/shared', version: '1.0.0', 'bom-ref': '@scope/shared@1.0.0' },
      { name: 'build-tool', version: '2.0.0', 'bom-ref': 'build-tool@2.0.0' },
    ],
    dependencies: [
      { ref: 'fixture@1.0.0', dependsOn: ['@scope/shared@1.0.0', 'build-tool@2.0.0'] },
      { ref: 'build-tool@2.0.0', dependsOn: ['@scope/shared@1.0.0'] },
    ],
  },
});

test('accepts a complete graph, scoped names and deduplicated identical lock records', () => {
  const { lock, sbom } = fixture();
  assert.deepEqual(validateSbom(sbom, lock), { components: 2, lockRecords: 3 });
});

test('rejects an omitted shared production dependency even if npm exited successfully', () => {
  const { lock, sbom } = fixture();
  sbom.components.shift();
  assert.throws(() => validateSbom(sbom, lock), /omits locked packages: @scope\/shared@1\.0\.0/);
});

test('rejects a version mismatch instead of accepting a name-only inventory', () => {
  const { lock, sbom } = fixture();
  sbom.components[0].version = '0.9.0';
  assert.throws(() => validateSbom(sbom, lock), /omits locked packages/);
});

test('rejects a dependency edge whose target is absent', () => {
  const { lock, sbom } = fixture();
  sbom.dependencies[0].dependsOn.push('unknown@1.0.0');
  assert.throws(() => validateSbom(sbom, lock), /absent component/);
});
