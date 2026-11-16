import { mkdir, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseCsv, serializeCsv } from './csv.mjs';
import { loadPlaywright } from './playwright-loader.mjs';
import { DEMO_PASS, DEMO_USER, ORDER_FIELDS, PRODUCTS, TABLE_FIELDS, startSite } from './site.mjs';

const DEFAULT_INPUT = new URL('../orders.csv', import.meta.url);
const DEFAULT_OUT = fileURLToPath(new URL('../out', import.meta.url));
const ARTIFACTS = ['export.csv', 'export.json', 'report.json', 'report.md'];

async function readInput(inputFile) {
  const [header, ...rows] = parseCsv(await readFile(inputFile, 'utf8'));
  if (!isDeepStrictEqual(header, ORDER_FIELDS)) {
    throw new Error('The input CSV header must be ' + ORDER_FIELDS.join(','));
  }
  return rows.map(([customer, email, product, quantity, ...extra], index) => {
    const qty = Number(quantity);
    if (extra.length || !customer?.trim() || !email?.trim() || !PRODUCTS.includes(product)
        || !Number.isSafeInteger(qty) || qty < 1) {
      throw new Error('Invalid order in CSV record ' + (index + 2));
    }
    return { customer, email, product, qty };
  });
}

function tableOrder([id, customer, email, product, qty]) {
  return { id: Number(id), customer, email, product, qty: Number(qty) };
}

async function writeExports(outDir, orders) {
  const csvPath = join(outDir, 'export.csv');
  const jsonPath = join(outDir, 'export.json');
  await Promise.all([
    writeFile(csvPath, serializeCsv([TABLE_FIELDS, ...orders.map((row) => TABLE_FIELDS.map((field) => row[field]))])),
    writeFile(jsonPath, JSON.stringify(orders, null, 2) + '\n'),
  ]);
  const [csv, json] = await Promise.all([readFile(csvPath, 'utf8'), readFile(jsonPath, 'utf8')]);
  const [header, ...csvRows] = parseCsv(csv);
  return isDeepStrictEqual(header, TABLE_FIELDS)
    && csvRows.every((row) => row.length === TABLE_FIELDS.length)
    && isDeepStrictEqual(csvRows.map(tableOrder), JSON.parse(json));
}

async function prepareOutput(outDir, shotDir) {
  await mkdir(shotDir, { recursive: true });
  const oldShots = (await readdir(shotDir)).filter((name) =>
    /^\d{2,}-(?:login|form-filled|saved|server-error|order-rejected|table-page-\d+|error)\.png$/.test(name));
  await Promise.all([
    ...ARTIFACTS.map((name) => rm(join(outDir, name), { force: true })),
    ...oldShots.map((name) => rm(join(shotDir, name), { force: true })),
  ]);
}

export async function runPortalBot(options = {}) {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT);
  await mkdir(outDir, { recursive: true });
  const lockPath = join(outDir, '.run-lock');
  const lock = await open(lockPath, 'wx');
  try {
    return await run({ ...options, outDir });
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

async function run({
  inputFile = DEFAULT_INPUT,
  outDir,
  demoUser = DEMO_USER,
  demoPass = DEMO_PASS,
  failFirstPosts = 1,
  maxRetries = 2,
  retryBaseMs = 250,
  headless = true,
} = {}) {
  const shotDir = join(outDir, 'shots');
  await prepareOutput(outDir, shotDir);

  const report = {
    startedAt: new Date().toISOString(),
    inputCount: 0,
    seeded: 0,
    siteCount: 0,
    exported: 0,
    pages: 0,
    entered: [],
    failed: [],
    retries: 0,
    screenshots: [],
    checks: {
      allOrdersEntered: false,
      exportMatchesSite: false,
      newOrdersInExport: false,
      csvAndJsonMatch: false,
    },
    log: [],
  };
  let site;
  let browser;
  let page;
  const log = (message) => report.log.push(message);
  const shot = async (name) => {
    const number = String(report.screenshots.length + 1).padStart(2, '0');
    const filename = number + '-' + name + '.png';
    await page.screenshot({ path: join(shotDir, filename) });
    report.screenshots.push('shots/' + filename);
  };

  try {
    for (const [name, value] of Object.entries({ failFirstPosts, maxRetries, retryBaseMs })) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error(name + ' must be a nonnegative integer');
    }
    if (typeof headless !== 'boolean') throw new Error('HEADLESS must be true, false, 1, or 0');

    const input = await readInput(inputFile);
    report.inputCount = input.length;
    const { chromium } = await loadPlaywright();
    site = await startSite({ failFirstPosts });
    report.seeded = site.orders.length;
    browser = await chromium.launch({ headless });
    page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(5000);

    const ordersUrl = site.url + '/orders';
    const formUrl = site.url + '/orders/new';
    await page.goto(ordersUrl);
    await shot('login');
    await page.getByLabel('User').fill(demoUser);
    await page.getByLabel('Password').fill(demoPass);
    const [login] = await Promise.all([
      page.waitForNavigation(),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    if (!login?.ok() || page.url() !== ordersUrl) {
      throw new Error('Sign-in failed (HTTP ' + (login?.status() ?? 'unknown') + ')');
    }
    log('Signed in');

    for (const [index, row] of input.entries()) {
      for (let attempt = 1; ; attempt += 1) {
        const form = await page.goto(formUrl);
        if (!form?.ok() || page.url() !== formUrl) throw new Error('Could not load the order form');
        await page.getByLabel('Customer').fill(row.customer);
        await page.getByLabel('Email').fill(row.email);
        await page.getByLabel('Product').selectOption(row.product);
        await page.getByLabel('Quantity').fill(String(row.qty));
        if (index === 0 && attempt === 1) await shot('form-filled');

        const [resp] = await Promise.all([
          page.waitForNavigation(),
          page.getByRole('button', { name: 'Save order' }).click(),
        ]);
        const saved = page.locator('#saved');
        if (resp && resp.ok() && await saved.isVisible()) {
          const id = Number(await saved.getAttribute('data-order-id'));
          report.entered.push({ ...row, id, attempts: attempt, confirmation: await saved.textContent() });
          log('Order ' + (index + 1) + '/' + input.length + ' saved as #' + id + ' on attempt ' + attempt);
          if (report.entered.length === 1) await shot('saved');
          break;
        }

        const status = resp?.status() ?? null;
        const serverError = status >= 500 && status < 600;
        const reason = resp?.ok() ? 'Save confirmation missing' : status ? 'HTTP ' + status : 'No navigation response';
        log('Order ' + (index + 1) + ' attempt ' + attempt + ' failed. ' + reason);
        await shot(serverError ? 'server-error' : 'order-rejected');
        if (!serverError || attempt > maxRetries) {
          report.failed.push({ ...row, attempts: attempt, status, reason });
          break;
        }

        const delay = Math.min(30000, retryBaseMs * 2 ** Math.min(attempt - 1, 30));
        report.retries += 1;
        log('Retrying in ' + delay + ' ms');
        await sleep(delay);
      }
    }

    const rows = [];
    let tableUrl = ordersUrl;
    const visited = new Set();
    while (tableUrl) {
      if (visited.has(tableUrl)) throw new Error('Orders pagination returned a page twice');
      visited.add(tableUrl);
      const table = await page.goto(tableUrl);
      if (!table?.ok() || page.url() !== tableUrl) throw new Error('Could not load an orders table page');
      const body = page.locator('table tbody');
      await body.waitFor();
      const pageRows = await body.locator('tr').evaluateAll((trs) =>
        trs.map((tr) => Array.from(tr.cells, (cell) => cell.textContent)));
      rows.push(...pageRows.map(tableOrder));
      report.pages += 1;
      await shot('table-page-' + report.pages);
      log('Read table page ' + report.pages + ' (' + rows.length + ' rows so far)');
      const next = page.locator('a[rel=next]');
      const href = await next.count() ? await next.getAttribute('href') : null;
      tableUrl = href ? new URL(href, tableUrl).href : null;
    }

    report.exported = rows.length;
    report.siteCount = site.orders.length;
    report.checks.csvAndJsonMatch = await writeExports(outDir, rows);
  } catch (error) {
    report.error = error.message;
    log('Error. ' + error.message);
    if (page) {
      await shot('error').catch((captureError) => log('Could not capture error screenshot. ' + captureError.message));
    }
  } finally {
    if (site) report.siteCount = site.orders.length;
    const cleanup = await Promise.allSettled([
      browser?.close(),
      site && new Promise((resolveClose, rejectClose) => {
        site.server.close((error) => error ? rejectClose(error) : resolveClose());
      }),
    ]);
    for (const result of cleanup) {
      if (result.status === 'rejected') {
        report.error ??= result.reason.message;
        log('Cleanup error. ' + result.reason.message);
      }
    }
  }

  report.finishedAt = new Date().toISOString();
  report.ok = !report.error && Object.values(report.checks).every(Boolean);
  log(report.ok ? 'PASS' : 'FAIL');
  await writeReports(outDir, report);
  return report;
}
