import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runPortalBot } from '../src/bot.mjs';
import { parseCsv, serializeCsv } from '../src/csv.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));

async function outputDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'order-portal-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const readJson = async (dir, file) => JSON.parse(await readFile(join(dir, file), 'utf8'));

function runCli(dir, env) {
  const result = spawnSync(process.execPath, ['run.mjs'], {
    cwd: repo,
    env: {
      ...process.env,
      DEMO_USER: 'demo',
      DEMO_PASS: 'demo-pass',
      FAIL_FIRST: '1',
      MAX_RETRIES: '2',
      RETRY_BASE_MS: '1',
      HEADLESS: 'true',
      OUT_DIR: dir,
      ...env,
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

test('CSV round trips quoted commas, escaped quotes, CRLF and empty fields', () => {
  const rows = [
    ['customer', 'notes', 'qty'],
    ['Warehouse, East', 'Use "Receiving"\r\nAfter 10', '2'],
    ['  Padded  ', 'LF\nCR\r', ''],
    ['', '', ''],
  ];
  const csv = 'customer,notes,qty\r\n"Warehouse, East","Use ""Receiving""\r\nAfter 10",2\r\n'
    + '  Padded  ,"LF\nCR\r",\r\n,,\r\n';
  assert.equal(serializeCsv(rows), csv);
  assert.deepEqual(parseCsv(csv), rows);
  assert.deepEqual(parseCsv('\uFEFFa,b\n1,'), [['a', 'b'], ['1', '']]);
  assert.deepEqual(parseCsv(''), []);
});

test('CSV rejects unclosed quotes and text after a quoted field', () => {
  assert.throws(() => parseCsv('a,"unfinished'), SyntaxError);
  assert.throws(() => parseCsv('"closed"junk,b'), SyntaxError);
  assert.throws(() => parseCsv('bad"quote,b'), SyntaxError);
});
