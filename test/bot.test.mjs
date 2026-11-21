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

test('one HTTP 500 retries once and exports every row in both formats', async (t) => {
  const dir = await outputDir(t);
  const report = await runPortalBot({ outDir: dir, failFirstPosts: 1, retryBaseMs: 1 });
  assert.equal(report.ok, true, report.error ?? report.log.join('\n'));
  assert.equal(report.retries, 1);
  assert.equal(report.entered[0].attempts, 2);
  assert.equal(report.entered.length, 6);
  assert.equal(report.pages, 3);
  assert.equal(report.exported, 24);
  assert.deepEqual(report.checks, {
    allOrdersEntered: true,
    exportMatchesSite: true,
    newOrdersInExport: true,
    csvAndJsonMatch: true,
  });

  const [header, ...rows] = parseCsv(await readFile(join(dir, 'export.csv'), 'utf8'));
  const json = await readJson(dir, 'export.json');
  assert.deepEqual(header, ['id', 'customer', 'email', 'product', 'qty']);
  assert.deepEqual(rows, json.map((order) => header.map((field) => String(order[field]))));
  assert.equal(json.length, 24);
  assert.equal(json.at(-1).customer, 'Fixture Customer 06, "Receiving"');
  assert.deepEqual(await readJson(dir, 'report.json'), report);
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /Result: \*\*PASS\*\*/);
  const screenshot = report.screenshots.find((path) => path.endsWith('-server-error.png'));
  assert.ok(screenshot);
  assert.ok((await stat(join(dir, screenshot))).size > 0);
});

test('five early HTTP 500s exhaust one order and the CLI exits 1 with partial evidence', async (t) => {
  const dir = await outputDir(t);
  const result = runCli(dir, { FAIL_FIRST: '5' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /FAIL\s*$/);
  const report = await readJson(dir, 'report.json');
  assert.equal(report.ok, false);
  assert.equal(report.failed.length, 1);
  assert.equal(report.failed[0].status, 500);
  assert.equal(report.failed[0].attempts, 3);
  assert.equal(report.entered.length, 5);
  assert.equal(report.exported, report.seeded + report.entered.length);
  assert.equal(report.checks.allOrdersEntered, false);
  assert.equal(report.checks.newOrdersInExport, false);
  assert.equal(report.checks.exportMatchesSite, true);
  assert.equal(report.checks.csvAndJsonMatch, true);
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /Result: \*\*FAIL\*\*/);
});

test('wrong credentials produce an error screenshot, a failure report and exit 1', async (t) => {
  const dir = await outputDir(t);
  const result = runCli(dir, { DEMO_PASS: 'wrong' });
  assert.equal(result.status, 1, result.stderr);
  const report = await readJson(dir, 'report.json');
  assert.equal(report.ok, false);
  assert.equal(report.error, 'Sign-in failed (HTTP 401)');
  assert.equal(report.retries, 0);
  assert.deepEqual(report.entered, []);
  const screenshot = report.screenshots.find((path) => path.endsWith('-error.png'));
  assert.ok(screenshot);
  const png = await readFile(join(dir, screenshot));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  await assert.rejects(stat(join(dir, 'export.csv')), { code: 'ENOENT' });
  assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /Result: \*\*FAIL\*\*/);
});
