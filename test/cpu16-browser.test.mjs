import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const zeroOtherRegisters = { cx: 0, dx: 0, bx: 0, sp: 0, bp: 0, si: 0, di: 0 };

function serve() {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
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
    const memory = new Uint8Array(0x10000);
    memory.set(bytes);
    const result = new ByteBusMachine(chip, memory).run(256);
    return { ...result, memory: [...memory] };
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

    await page.goto(`${baseUrl}/`);
    await page.waitForFunction(() => window.css386cpu?.run);
    const publicDemo = await page.evaluate(() => ({ result: window.css386cpu.run(), rendered: {
      ip: document.querySelector('[data-state="ip"]').textContent,
      ax: document.querySelector('[data-state="ax"]').textContent,
      cycles: document.querySelector('#cycles').textContent,
      trace: document.querySelector('#trace').textContent,
    } }));
    assert.equal(publicDemo.result.state.ip, 43);
    assert.equal(publicDemo.result.state.ax, 0x12c8);
    assert.equal(publicDemo.rendered.ip, '002b');
    assert.equal(publicDemo.rendered.ax, '12c8');
    assert.equal(publicDemo.rendered.cycles, '42');
    assert.match(publicDemo.rendered.trace, /^00  read  \[0000\] → e9/m);
    assert.match(publicDemo.rendered.trace, /^03  read  \[0006\] → b8/m);
    assert.match(publicDemo.rendered.trace, /09  write \[2000\] ← 34/m);
    assert.match(publicDemo.rendered.trace, /10  write \[2001\] ← 12/m);
    assert.match(publicDemo.rendered.trace, /41  read  \[002a\] → f4$/m);
    assert.deepEqual(publicDemo.result.trace.slice(0, 4).map(({ address }) => address), [0, 1, 2, 6]);
    assert.equal(publicDemo.result.trace.some(({ address }) => [3, 4, 5].includes(address)), false);
    assert.deepEqual(
      Object.fromEntries(['cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, publicDemo.result.state[name]])),
      { cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 },
    );

    const rom = [0xb8, 0x34, 0x12, 0x05, 0x02, 0x00, 0x35, 0xff, 0x00, 0x2d, 0x01, 0x00, 0xf4];
    const normal = await execute(page, baseUrl, rom);
    assert.deepEqual(normal.trace, rom.map((data, address) => ({ cycle: address, kind: 'read', address, data })));
    assert.deepEqual(normal.state, {
      ip: 13, ax: 0x12c8, ...zeroOtherRegisters, ir: 0xf4, immLow: 1, immHigh: 0, phase: 0, halted: 1, faulted: 0,
      cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0,
    });

    const overflow = await execute(page, baseUrl, [0xb8, 0x00, 0x80, 0x05, 0x00, 0x80, 0xf4]);
    assert.deepEqual(overflow.state, {
      ip: 7, ax: 0, ...zeroOtherRegisters, ir: 0xf4, immLow: 0, immHigh: 0x80, phase: 0, halted: 1, faulted: 0,
      cf: 1, pf: 1, af: 0, zf: 1, sf: 0, of: 1,
    });

    const borrow = await execute(page, baseUrl, [0xb8, 0x00, 0x00, 0x2d, 0x01, 0x00, 0xf4]);
    assert.deepEqual(borrow.state, {
      ip: 7, ax: 0xffff, ...zeroOtherRegisters, ir: 0xf4, immLow: 1, immHigh: 0, phase: 0, halted: 1, faulted: 0,
      cf: 1, pf: 1, af: 1, zf: 0, sf: 1, of: 0,
    });

    const invalid = await execute(page, baseUrl, [0x90]);
    assert.deepEqual(invalid.trace, [{ cycle: 0, kind: 'read', address: 0, data: 0x90 }]);
    assert.equal(invalid.state.ip, 1);
    assert.equal(invalid.state.halted, 1);
    assert.equal(invalid.state.faulted, 1);

    const jumped = await execute(page, baseUrl, [0xe9, 0x03, 0x00, 0x90, 0x90, 0x90, 0xb8, 0x34, 0x12, 0xf4]);
    assert.deepEqual(jumped.trace.map(({ address }) => address), [0, 1, 2, 6, 7, 8, 9]);
    assert.equal(jumped.state.ax, 0x1234);
    assert.equal(jumped.state.ip, 10);
    assert.equal(jumped.state.halted, 1);
    assert.equal(jumped.state.faulted, 0);

    const store = await execute(page, baseUrl, [0xb8, 0x34, 0x12, 0xa3, 0x00, 0x20, 0xf4]);
    assert.equal(store.memory[0x2000], 0x34);
    assert.equal(store.memory[0x2001], 0x12);
    assert.deepEqual(store.trace.slice(6, 8), [
      { cycle: 6, kind: 'write', address: 0x2000, data: 0x34 },
      { cycle: 7, kind: 'write', address: 0x2001, data: 0x12 },
    ]);
    assert.deepEqual(store.trace[8], { cycle: 8, kind: 'read', address: 6, data: 0xf4 });
    assert.equal(store.state.ip, 7);
    assert.equal(store.state.ax, 0x1234);

    const registerProgram = [
      0xb8, 0x11, 0x11, 0xb9, 0x22, 0x22, 0xba, 0x33, 0x33, 0xbb, 0x44, 0x44,
      0xbc, 0x55, 0x55, 0xbd, 0x66, 0x66, 0xbe, 0x77, 0x77, 0xbf, 0x88, 0x88, 0xf4,
    ];
    const registerFile = await execute(page, baseUrl, registerProgram);
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, registerFile.state[name]])),
      { ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 },
    );
    assert.equal(registerFile.state.ip, 25);
    assert.equal(registerFile.state.halted, 1);
    const manifest = await page.evaluate(() => fetch('/generated/cpu16.manifest.json').then((response) => response.json()));
    assert.deepEqual(Object.keys(manifest.aliases), ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh']);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
