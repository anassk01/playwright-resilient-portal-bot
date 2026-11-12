export async function loadPlaywright() {
  let entry;
  try {
    entry = import.meta.resolve('playwright-core');
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('Playwright is missing. Run npm install in the project directory.', { cause: error });
  }
  return import(entry);
}
