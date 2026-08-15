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
const zeroSegments = { cs: 0, ds: 0, ss: 0, es: 0 };

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

async function execute(page, baseUrl, rom, options = {}) {
  await page.goto(`${baseUrl}/test/cpu16.html`);
  return page.evaluate(async ({ bytes, loadAddress, state, placements }) => {
    const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
    const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
    const chip = new CssChip(document.querySelector('#cpu'), manifest);
    chip.seedState(state);
    const memory = new Uint8Array(0x100000);
    memory.set(bytes, loadAddress);
    for (const placement of placements) memory.set(placement.bytes, placement.address);
    const result = new ByteBusMachine(chip, memory).run(256);
    const written = Object.fromEntries(result.trace.filter(({ kind }) => kind === 'write').map(({ address }) => [address, memory[address]]));
    return { ...result, memory: written };
  }, { bytes: rom, loadAddress: options.loadAddress ?? 0, state: { cs: 0, ip: 0, ...(options.state ?? {}) }, placements: options.placements ?? [] });
}

test('generated CSS fetches and executes a real-mode ROM byte stream', async () => {
  const server = await serve();
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`${baseUrl}/test/cpu16.html`);
    const seeded = await page.evaluate(async () => {
      const { CssChip } = await import('/src/chip.js');
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const chip = new CssChip(document.querySelector('#cpu'), manifest);
      const state = chip.seedState({ ip: 0x1234, ax: 0xabcd });
      let unknown;
      try { chip.seedState({ nope: 1 }); } catch (error) { unknown = error.message; }
      return { state, unknown };
    });
    assert.equal(seeded.state.ip, 0x1234);
    assert.equal(seeded.state.ax, 0xabcd);
    assert.equal(seeded.state.cx, 0);
    assert.equal(seeded.unknown, 'unknown state nope');

    await page.goto(`${baseUrl}/`);
    await page.waitForFunction(() => window.css386cpu?.run);
    const publicDemo = await page.evaluate(() => ({ result: window.css386cpu.run(), rendered: {
      ip: document.querySelector('[data-state="ip"]').textContent,
      ax: document.querySelector('[data-state="ax"]').textContent,
      cycles: document.querySelector('#cycles').textContent,
      trace: document.querySelector('#trace').textContent,
    } }));
    assert.equal(publicDemo.result.state.ip, 0x7c36);
    assert.equal(publicDemo.result.state.cs, 0);
    assert.equal(publicDemo.result.state.ax, 0x12c8);
    assert.equal(publicDemo.rendered.ip, '7c36');
    assert.equal(publicDemo.rendered.ax, '12c8');
    assert.equal(publicDemo.rendered.cycles, '76');
    assert.match(publicDemo.rendered.trace, /^00  read  \[ffff0\] → ea/m);
    assert.match(publicDemo.rendered.trace, /^04  read  \[ffff4\] → 00/m);
    assert.match(publicDemo.rendered.trace, /^05  read  \[07c00\] → e9/m);
    assert.match(publicDemo.rendered.trace, /^08  read  \[07c06\] → b8/m);
    assert.match(publicDemo.rendered.trace, /32  write \[02000\] ← 34/m);
    assert.match(publicDemo.rendered.trace, /33  write \[02001\] ← 12/m);
    assert.match(publicDemo.rendered.trace, /67  write \[05553\] ← 35/m);
    assert.match(publicDemo.rendered.trace, /68  write \[05554\] ← 7c/m);
    assert.match(publicDemo.rendered.trace, /73  read  \[05553\] → 35/m);
    assert.match(publicDemo.rendered.trace, /74  read  \[05554\] → 7c/m);
    assert.match(publicDemo.rendered.trace, /75  read  \[07c35\] → f4$/m);
    assert.deepEqual(publicDemo.result.trace.slice(8, 26).map(({ address }) => address), [0x7c06, 0x7c07, 0x7c08, 0x7c09, 0x7c0a, 0x7c0b, 0x7c0c, 0x7c0d, 0x7c09, 0x7c0a, 0x7c0b, 0x7c0c, 0x7c0d, 0x7c09, 0x7c0a, 0x7c0b, 0x7c0c, 0x7c0d]);
    assert.deepEqual(publicDemo.result.trace.slice(0, 9).map(({ address }) => address), [0xffff0, 0xffff1, 0xffff2, 0xffff3, 0xffff4, 0x7c00, 0x7c01, 0x7c02, 0x7c06]);
    assert.equal(publicDemo.result.trace.some(({ address }) => [0x7c03, 0x7c04, 0x7c05].includes(address)), false);
    assert.deepEqual(
      Object.fromEntries(['cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, publicDemo.result.state[name]])),
      { cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 },
    );

    const rom = [0xb8, 0x34, 0x12, 0x05, 0x02, 0x00, 0x35, 0xff, 0x00, 0x2d, 0x01, 0x00, 0xf4];
    const normal = await execute(page, baseUrl, rom);
    assert.deepEqual(normal.trace, rom.map((data, address) => ({ cycle: address, kind: 'read', address, data })));
    assert.deepEqual(normal.state, {
      ip: 13, ax: 0x12c8, ...zeroOtherRegisters, ...zeroSegments, ir: 0xf4, immLow: 1, immHigh: 0, farSegLow: 0, stackLow: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0,
      cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0,
    });

    const overflow = await execute(page, baseUrl, [0xb8, 0x00, 0x80, 0x05, 0x00, 0x80, 0xf4]);
    assert.deepEqual(overflow.state, {
      ip: 7, ax: 0, ...zeroOtherRegisters, ...zeroSegments, ir: 0xf4, immLow: 0, immHigh: 0x80, farSegLow: 0, stackLow: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0,
      cf: 1, pf: 1, af: 0, zf: 1, sf: 0, of: 1,
    });

    const borrow = await execute(page, baseUrl, [0xb8, 0x00, 0x00, 0x2d, 0x01, 0x00, 0xf4]);
    assert.deepEqual(borrow.state, {
      ip: 7, ax: 0xffff, ...zeroOtherRegisters, ...zeroSegments, ir: 0xf4, immLow: 1, immHigh: 0, farSegLow: 0, stackLow: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0,
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

    const segmentedFetch = await execute(page, baseUrl, [0xb8, 0x34, 0x12, 0xf4], {
      loadAddress: 0x12350,
      state: { cs: 0x1234, ip: 0x0010 },
    });
    assert.deepEqual(segmentedFetch.trace.map(({ address }) => address), [0x12350, 0x12351, 0x12352, 0x12353]);
    assert.equal(segmentedFetch.state.cs, 0x1234);
    assert.equal(segmentedFetch.state.ip, 0x0014);
    assert.equal(segmentedFetch.state.ax, 0x1234);

    const farJumped = await execute(page, baseUrl, [0xea, 0x00, 0x20, 0x00, 0x30], {
      loadAddress: 0x12350,
      state: { cs: 0x1234, ip: 0x0010 },
      placements: [{ address: 0x32000, bytes: [0xf4] }],
    });
    assert.deepEqual(farJumped.trace.map(({ address }) => address), [0x12350, 0x12351, 0x12352, 0x12353, 0x12354, 0x32000]);
    assert.equal(farJumped.state.cs, 0x3000);
    assert.equal(farJumped.state.ip, 0x2001);
    assert.equal(farJumped.state.halted, 1);
    assert.equal(farJumped.state.faulted, 0);

    const looped = await execute(page, baseUrl, [0xb8, 0x03, 0x00, 0x2d, 0x01, 0x00, 0x75, 0xfb, 0xf4]);
    assert.deepEqual(looped.trace.map(({ address }) => address), [0, 1, 2, 3, 4, 5, 6, 7, 3, 4, 5, 6, 7, 3, 4, 5, 6, 7, 8]);
    assert.equal(looped.state.ax, 0);
    assert.equal(looped.state.zf, 1);
    assert.equal(looped.state.ip, 9);
    assert.equal(looped.state.halted, 1);
    assert.equal(looped.state.faulted, 0);

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

    const segmentedStore = await execute(page, baseUrl, [0xb8, 0x34, 0x12, 0xa3, 0x20, 0x00, 0xf4], {
      state: { ds: 0x1000 },
    });
    assert.equal(segmentedStore.memory[0x10020], 0x34);
    assert.equal(segmentedStore.memory[0x10021], 0x12);
    assert.deepEqual(segmentedStore.trace.slice(6, 8).map(({ address }) => address), [0x10020, 0x10021]);
    assert.equal(segmentedStore.state.ds, 0x1000);

    const callProgram = [
      0xbc, 0x00, 0x80, 0xe8, 0x04, 0x00, 0xb8, 0x34, 0x12, 0xf4,
      0xb8, 0x78, 0x56, 0xc3,
    ];
    const called = await execute(page, baseUrl, callProgram);
    assert.deepEqual(called.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xbc }, { kind: 'read', address: 1, data: 0x00 }, { kind: 'read', address: 2, data: 0x80 },
      { kind: 'read', address: 3, data: 0xe8 }, { kind: 'read', address: 4, data: 0x04 }, { kind: 'read', address: 5, data: 0x00 },
      { kind: 'write', address: 0x7ffe, data: 0x06 }, { kind: 'write', address: 0x7fff, data: 0x00 },
      { kind: 'read', address: 10, data: 0xb8 }, { kind: 'read', address: 11, data: 0x78 }, { kind: 'read', address: 12, data: 0x56 }, { kind: 'read', address: 13, data: 0xc3 },
      { kind: 'read', address: 0x7ffe, data: 0x06 }, { kind: 'read', address: 0x7fff, data: 0x00 },
      { kind: 'read', address: 6, data: 0xb8 }, { kind: 'read', address: 7, data: 0x34 }, { kind: 'read', address: 8, data: 0x12 }, { kind: 'read', address: 9, data: 0xf4 },
    ]);
    assert.equal(called.state.ax, 0x1234);
    assert.equal(called.state.sp, 0x8000);
    assert.equal(called.state.ip, 10);
    assert.equal(called.state.returnIp, 6);
    assert.equal(called.state.halted, 1);
    assert.equal(called.state.faulted, 0);
    assert.equal(called.memory[0x7ffe], 0x06);
    assert.equal(called.memory[0x7fff], 0x00);

    const segmentedCall = await execute(page, baseUrl, callProgram, { state: { ss: 0x2000 } });
    assert.deepEqual(segmentedCall.trace.filter(({ address }) => address >= 0x20000).map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'write', address: 0x27ffe, data: 0x06 },
      { kind: 'write', address: 0x27fff, data: 0x00 },
      { kind: 'read', address: 0x27ffe, data: 0x06 },
      { kind: 'read', address: 0x27fff, data: 0x00 },
    ]);
    assert.equal(segmentedCall.state.ss, 0x2000);
    assert.equal(segmentedCall.state.sp, 0x8000);
    assert.equal(segmentedCall.state.ax, 0x1234);

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
