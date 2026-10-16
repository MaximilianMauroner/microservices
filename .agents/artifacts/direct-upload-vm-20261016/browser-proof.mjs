import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire('/home/codex/.bun/install/global/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/home/codex/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: false,
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' } });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const viewer = await page.evaluate(() => navigator.pdfViewerEnabled);
  if (process.argv.includes('--capabilities')) { console.log(JSON.stringify({ pdfViewerEnabled: viewer, browser: browser.version() })); }
  else {
    assert(viewer, 'This full browser has no PDF viewer');
    const fixture = path.resolve(process.argv[2]);
    const run = (await readFile(path.join(fixture, 'latest-cli-run'), 'utf8')).trim();
    const results = JSON.parse(await readFile(path.join(run, 'results.json')));
    const captures = path.join(run, 'browser');
    await mkdir(captures, { recursive: true, mode: 0o700 });
    const report = { pdfViewerEnabled: viewer, browser: browser.version() };
    for (const kind of ['pdf', 'binaryPdf']) {
      const response = await page.goto(results[kind].url);
      assert(response?.ok());
      await page.waitForTimeout(1500);
      const sessions = await context.newCDPSession(page);
      const targets = await sessions.send('Target.getTargets');
      assert(targets.targetInfos.some(target => target.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai')), 'Browser PDF viewer extension did not open');
      const frames = page.frames();
      let loaded = false;
      for (const frame of frames) {
        try {
          const value = await frame.evaluate(() => {
            const viewer = document.querySelector('pdf-viewer');
            if (!viewer) return null;
            return { loaded: viewer.shadowRoot?.querySelector('#plugin')?.tagName,
              title: document.title, text: viewer.shadowRoot?.textContent?.slice(0, 2000) };
          });
          if (value?.loaded) loaded = true;
        } catch {}
      }
      assert(loaded, 'PDF viewer did not create its document plugin');
      await page.bringToFront();
      await page.screenshot({ path: path.join(captures, kind + '-viewer.png'), timeout: 10000, animations: 'disabled' });
      await page.goto('http://127.0.0.1:43171/live');
      await page.evaluate(url => { const link = document.createElement('a'); link.href = url; link.textContent = 'Download owned PDF'; document.body.append(link); }, results[kind].downloadUrl);
      const pending = page.waitForEvent('download');
      await page.getByRole('link', { name: 'Download owned PDF' }).click();
      const download = await pending;
      const file = path.join(captures, kind + '-download.pdf');
      await download.saveAs(file);
      assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), results[kind].sha256);
      report[kind] = { inlineViewer: 'passed', explicitCapabilityDownload: 'passed' };
    }
    await writeFile(path.join(captures, 'result.json'), JSON.stringify(report, null, 2));
    await writeFile('.agents/artifacts/direct-upload-vm-20261016/browser-result.json', JSON.stringify({ ...report,
      libraryDownloadControl: 'blocked without authorized local OAuth', htmlReplaceControl: 'blocked without authorized local OAuth' }, null, 2) + '\n');
    console.log(JSON.stringify(report));
  }
  await context.close();
} finally { await browser.close(); }
