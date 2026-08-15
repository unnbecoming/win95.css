import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serve() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(root, `.${pathname}`);
    if (!target.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('content-type', types[path.extname(target)] ?? 'application/octet-stream');
      response.end(fs.readFileSync(target));
    } catch { response.writeHead(404).end(); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function execute(page, baseUrl, rom) {
  await page.goto(`${baseUrl}/test/cpu16.html`);
  return page.evaluate(async (bytes) => {
    const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
    const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
    const chip = new CssChip(document.querySelector('#cpu'), manifest);
    return new ByteBusMachine(chip, Uint8Array.from(bytes)).run(256);
  }, rom);
}

test('generated CSS fetches and executes a real-mode ROM byte stream', async () => {
  const server = await serve();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`${baseUrl}/cpu.html`);
    await page.waitForFunction(() => window.css386cpu?.run);
    const publicDemo = await page.evaluate(() => ({ result: window.css386cpu.run(), rendered: {
      ip: document.querySelector('[data-state="ip"]').textContent,
      ax: document.querySelector('[data-state="ax"]').textContent,
      cycles: document.querySelector('#cycles').textContent,
      trace: document.querySelector('#trace').textContent,
    } }));
    assert.equal(publicDemo.result.state.ip, 13);
    assert.equal(publicDemo.result.state.ax, 0x12c8);
    assert.equal(publicDemo.rendered.ip, '000d');
    assert.equal(publicDemo.rendered.ax, '12c8');
    assert.equal(publicDemo.rendered.cycles, '13');
    assert.match(publicDemo.rendered.trace, /^00  read  \[0000\] → b8/m);
    assert.match(publicDemo.rendered.trace, /12  read  \[000c\] → f4$/m);

    const rom = [0xb8, 0x34, 0x12, 0x05, 0x02, 0x00, 0x35, 0xff, 0x00, 0x2d, 0x01, 0x00, 0xf4];
    const normal = await execute(page, baseUrl, rom);
    assert.deepEqual(normal.trace, rom.map((data, address) => ({ cycle: address, address, data })));
    assert.deepEqual(normal.state, {
      ip: 13, ax: 0x12c8, ir: 0xf4, immLow: 1, phase: 0, halted: 1, faulted: 0,
      cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0,
    });

    const overflow = await execute(page, baseUrl, [0xb8, 0x00, 0x80, 0x05, 0x00, 0x80, 0xf4]);
    assert.deepEqual(overflow.state, {
      ip: 7, ax: 0, ir: 0xf4, immLow: 0, phase: 0, halted: 1, faulted: 0,
      cf: 1, pf: 1, af: 0, zf: 1, sf: 0, of: 1,
    });

    const borrow = await execute(page, baseUrl, [0xb8, 0x00, 0x00, 0x2d, 0x01, 0x00, 0xf4]);
    assert.deepEqual(borrow.state, {
      ip: 7, ax: 0xffff, ir: 0xf4, immLow: 1, phase: 0, halted: 1, faulted: 0,
      cf: 1, pf: 1, af: 1, zf: 0, sf: 1, of: 0,
    });

    const invalid = await execute(page, baseUrl, [0x90]);
    assert.deepEqual(invalid.trace, [{ cycle: 0, address: 0, data: 0x90 }]);
    assert.equal(invalid.state.ip, 1);
    assert.equal(invalid.state.halted, 1);
    assert.equal(invalid.state.faulted, 1);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
