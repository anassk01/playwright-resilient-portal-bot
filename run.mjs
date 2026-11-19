import { runPortalBot } from './src/bot.mjs';

const { DEMO_USER, DEMO_PASS, FAIL_FIRST, MAX_RETRIES, RETRY_BASE_MS, HEADLESS, OUT_DIR } = process.env;
const headlessValues = new Map([['true', true], ['1', true], ['false', false], ['0', false]]);

try {
  const report = await runPortalBot({
    demoUser: DEMO_USER,
    demoPass: DEMO_PASS,
    failFirstPosts: FAIL_FIRST === undefined ? undefined : Number(FAIL_FIRST),
    maxRetries: MAX_RETRIES === undefined ? undefined : Number(MAX_RETRIES),
    retryBaseMs: RETRY_BASE_MS === undefined ? undefined : Number(RETRY_BASE_MS),
    headless: headlessValues.get(HEADLESS?.toLowerCase()) ?? HEADLESS,
    outDir: OUT_DIR,
  });
  for (const line of report.log) console.log(line);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) {
  console.error('FAIL. ' + error.message);
  process.exitCode = 1;
}
