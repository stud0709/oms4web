import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = mkdtempSync(path.join(tmpdir(), 'oms-web-test-'));
try {
  const output = path.join(directory, 'protocol.test.mjs');
  await build({ entryPoints: ['tests/protocol.test.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', alias: { '@': path.resolve('src') } });
  const result = spawnSync(process.execPath, ['--test', output], { stdio: 'inherit', env: { ...process.env, OMS_FIXTURES: path.resolve('protocol/test-vectors/fixtures.json') } });
  process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
