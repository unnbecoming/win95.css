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
      df: document.querySelector('[data-state="df"]').textContent,
      trace: document.querySelector('#trace').textContent,
    } }));
    assert.equal(publicDemo.result.state.ip, 0x7c52);
    assert.equal(publicDemo.result.state.cs, 0);
    assert.equal(publicDemo.result.state.ax, 0x12c8);
    assert.equal(publicDemo.rendered.ip, '7c52');
    assert.equal(publicDemo.rendered.ax, '12c8');
    assert.equal(publicDemo.rendered.cycles, '110');
    assert.equal(publicDemo.rendered.df, '0');
    assert.match(publicDemo.rendered.trace, /^00  read  \[ffff0\] → ea/m);
    assert.match(publicDemo.rendered.trace, /^04  read  \[ffff4\] → 00/m);
    assert.match(publicDemo.rendered.trace, /^05  read  \[07c00\] → e9/m);
    assert.match(publicDemo.rendered.trace, /^08  read  \[07c06\] → b8/m);
    assert.match(publicDemo.rendered.trace, /26  read  \[07c0e\] → fa/m);
    assert.match(publicDemo.rendered.trace, /29  read  \[07c11\] → 8e/m);
    assert.match(publicDemo.rendered.trace, /31  read  \[07c13\] → 8e/m);
    assert.match(publicDemo.rendered.trace, /33  read  \[07c15\] → 8e/m);
    assert.match(publicDemo.rendered.trace, /35  read  \[07c17\] → fb/m);
    assert.match(publicDemo.rendered.trace, /42  write \[02000\] ← 34/m);
    assert.match(publicDemo.rendered.trace, /43  write \[02001\] ← 12/m);
    assert.match(publicDemo.rendered.trace, /74  read  \[07c3c\] → 89/m);
    assert.match(publicDemo.rendered.trace, /76  write \[07777\] ← 44/m);
    assert.match(publicDemo.rendered.trace, /77  write \[07778\] ← 44/m);
    assert.match(publicDemo.rendered.trace, /78  read  \[07c3e\] → 31/m);
    assert.match(publicDemo.rendered.trace, /80  read  \[07777\] → 44/m);
    assert.match(publicDemo.rendered.trace, /81  read  \[07778\] → 44/m);
    assert.match(publicDemo.rendered.trace, /82  write \[07777\] ← 00/m);
    assert.match(publicDemo.rendered.trace, /83  write \[07778\] ← 00/m);
    assert.match(publicDemo.rendered.trace, /84  read  \[07c40\] → 89/m);
    assert.match(publicDemo.rendered.trace, /86  read  \[07c42\] → 8b/m);
    assert.match(publicDemo.rendered.trace, /88  read  \[07c44\] → 31/m);
    assert.match(publicDemo.rendered.trace, /90  read  \[07c46\] → 33/m);
    assert.match(publicDemo.rendered.trace, /101  write \[05553\] ← 51/m);
    assert.match(publicDemo.rendered.trace, /102  write \[05554\] ← 7c/m);
    assert.match(publicDemo.rendered.trace, /107  read  \[05553\] → 51/m);
    assert.match(publicDemo.rendered.trace, /108  read  \[05554\] → 7c/m);
    assert.match(publicDemo.rendered.trace, /109  read  \[07c51\] → f4$/m);
    assert.deepEqual(publicDemo.result.trace.slice(8, 26).map(({ address }) => address), [0x7c06, 0x7c07, 0x7c08, 0x7c09, 0x7c0a, 0x7c0b, 0x7c0c, 0x7c0d, 0x7c09, 0x7c0a, 0x7c0b, 0x7c0c, 0x7c0d, 0x7c09, 0x7c0a, 0x7c0b, 0x7c0c, 0x7c0d]);
    assert.deepEqual(publicDemo.result.trace.slice(0, 9).map(({ address }) => address), [0xffff0, 0xffff1, 0xffff2, 0xffff3, 0xffff4, 0x7c00, 0x7c01, 0x7c02, 0x7c06]);
    assert.equal(publicDemo.result.trace.some(({ address }) => [0x7c03, 0x7c04, 0x7c05].includes(address)), false);
    assert.deepEqual(
      Object.fromEntries(['cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, publicDemo.result.state[name]])),
      { cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 },
    );
    assert.deepEqual(Object.fromEntries(['cs', 'ds', 'ss', 'es'].map((name) => [name, publicDemo.result.state[name]])), { cs: 0, ds: 0, ss: 0, es: 0 });
    assert.equal(publicDemo.result.state.if, 1);

    const rom = [0xb8, 0x34, 0x12, 0x05, 0x02, 0x00, 0x35, 0xff, 0x00, 0x2d, 0x01, 0x00, 0xf4];
    const normal = await execute(page, baseUrl, rom);
    assert.deepEqual(normal.trace, rom.map((data, address) => ({ cycle: address, kind: 'read', address, data })));
    assert.deepEqual(normal.state, {
      ip: 13, ax: 0x12c8, ...zeroOtherRegisters, ...zeroSegments, ir: 0xf4, immLow: 1, immHigh: 0, farSegLow: 0, stackLow: 0, modrm: 0, dispLow: 0, dispHigh: 0, memLow: 0, memHigh: 0, ldsSegLow: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0, if: 0, df: 0,
      cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0,
    });

    const overflow = await execute(page, baseUrl, [0xb8, 0x00, 0x80, 0x05, 0x00, 0x80, 0xf4]);
    assert.deepEqual(overflow.state, {
      ip: 7, ax: 0, ...zeroOtherRegisters, ...zeroSegments, ir: 0xf4, immLow: 0, immHigh: 0x80, farSegLow: 0, stackLow: 0, modrm: 0, dispLow: 0, dispHigh: 0, memLow: 0, memHigh: 0, ldsSegLow: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0, if: 0, df: 0,
      cf: 1, pf: 1, af: 0, zf: 1, sf: 0, of: 1,
    });

    const borrow = await execute(page, baseUrl, [0xb8, 0x00, 0x00, 0x2d, 0x01, 0x00, 0xf4]);
    assert.deepEqual(borrow.state, {
      ip: 7, ax: 0xffff, ...zeroOtherRegisters, ...zeroSegments, ir: 0xf4, immLow: 1, immHigh: 0, farSegLow: 0, stackLow: 0, modrm: 0, dispLow: 0, dispHigh: 0, memLow: 0, memHigh: 0, ldsSegLow: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0, if: 0, df: 0,
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

    const shortJumped = await execute(page, baseUrl, [0xeb, 0x03, 0x90, 0x90, 0x90, 0xf4]);
    assert.deepEqual(shortJumped.trace.map(({ address }) => address), [0, 1, 5]);
    assert.equal(shortJumped.state.ip, 6);
    assert.equal(shortJumped.state.halted, 1);
    assert.equal(shortJumped.state.faulted, 0);

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

    const stackRegisterIndexes = [0, 1, 2, 3, 5, 6, 7];
    const stackRegisterValues = [0x1111, 0x2222, 0x3333, 0x4444, 0x6666, 0x7777, 0x8888];
    const registerStackProgram = [
      0xbc, 0x00, 0x80,
      ...stackRegisterIndexes.flatMap((index, position) => [0xb8 + index, stackRegisterValues[position] & 0xff, stackRegisterValues[position] >>> 8]),
      ...stackRegisterIndexes.map((index) => 0x50 + index),
      ...stackRegisterIndexes.flatMap((index) => [0xb8 + index, 0x00, 0x00]),
      ...[...stackRegisterIndexes].reverse().map((index) => 0x58 + index),
      0xf4,
    ];
    const registerStack = await execute(page, baseUrl, registerStackProgram, { state: { ss: 0x2000 } });
    assert.deepEqual(
      Object.fromEntries(stackRegisterIndexes.map((index, position) => [['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'][index], registerStack.state[['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'][index]]])),
      { ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, bp: 0x6666, si: 0x7777, di: 0x8888 },
    );
    assert.equal(registerStack.state.sp, 0x8000);
    assert.equal(registerStack.state.faulted, 0);
    assert.deepEqual(
      registerStack.trace.filter(({ address }) => address >= 0x20000).map(({ kind, address }) => ({ kind, address })),
      [
        ...[0x27ffe, 0x27fff, 0x27ffc, 0x27ffd, 0x27ffa, 0x27ffb, 0x27ff8, 0x27ff9, 0x27ff6, 0x27ff7, 0x27ff4, 0x27ff5, 0x27ff2, 0x27ff3].map((address) => ({ kind: 'write', address })),
        ...[0x27ff2, 0x27ff3, 0x27ff4, 0x27ff5, 0x27ff6, 0x27ff7, 0x27ff8, 0x27ff9, 0x27ffa, 0x27ffb, 0x27ffc, 0x27ffd, 0x27ffe, 0x27fff].map((address) => ({ kind: 'read', address })),
      ],
    );

    const pushSp = await execute(page, baseUrl, [0xbc, 0x00, 0x80, 0x54, 0xf4], { state: { ss: 0x2000 } });
    assert.equal(pushSp.state.sp, 0x7ffe);
    assert.equal(pushSp.memory[0x27ffe], 0x00);
    assert.equal(pushSp.memory[0x27fff], 0x80);

    const popSp = await execute(page, baseUrl, [0xbc, 0x00, 0x80, 0x5c, 0xf4], {
      state: { ss: 0x2000 },
      placements: [{ address: 0x28000, bytes: [0x34, 0x12] }],
    });
    assert.equal(popSp.state.sp, 0x1234);
    assert.deepEqual(popSp.trace.filter(({ address }) => address >= 0x20000).map(({ address }) => address), [0x28000, 0x28001]);

    const segmentStack = await execute(page, baseUrl, [0x06, 0x0e, 0x16, 0x1e, 0xf4], {
      loadAddress: 0x30000,
      state: { cs: 0x3000, ss: 0x2000, es: 0x1111, ds: 0x4444, sp: 0x8000 },
    });
    assert.equal(segmentStack.state.sp, 0x7ff8);
    assert.deepEqual(segmentStack.memory, {
      163832: 0x44, 163833: 0x44,
      163834: 0x00, 163835: 0x20,
      163836: 0x00, 163837: 0x30,
      163838: 0x11, 163839: 0x11,
    });

    const popSegments = await execute(page, baseUrl, [0x07, 0x17, 0x1f, 0xf4], {
      state: { ss: 0x2000, sp: 0x8000 },
      placements: [
        { address: 0x28000, bytes: [0x11, 0x11, 0x00, 0x30] },
        { address: 0x38004, bytes: [0x44, 0x44] },
      ],
    });
    assert.deepEqual({ es: popSegments.state.es, ss: popSegments.state.ss, ds: popSegments.state.ds, sp: popSegments.state.sp }, { es: 0x1111, ss: 0x3000, ds: 0x4444, sp: 0x8006 });
    assert.deepEqual(popSegments.trace.filter(({ address }) => address >= 0x20000).map(({ address }) => address), [0x28000, 0x28001, 0x28002, 0x28003, 0x38004, 0x38005]);

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

    const modrmProgram = [
      0xb8, 0x11, 0x11, 0xb9, 0x22, 0x22, 0xba, 0x33, 0x33, 0xbb, 0x44, 0x44,
      0xbc, 0x55, 0x55, 0xbd, 0x66, 0x66, 0xbe, 0x77, 0x77, 0xbf, 0x88, 0x88,
      0x89, 0xc1, 0x89, 0xda, 0x8b, 0xec, 0x8b, 0xfe,
      0x31, 0xc9, 0x33, 0xf6, 0xf4,
    ];
    const modrm = await execute(page, baseUrl, modrmProgram);
    assert.deepEqual(modrm.trace, modrmProgram.map((data, address) => ({ cycle: address, kind: 'read', address, data })));
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, modrm.state[name]])),
      { ax: 0x1111, cx: 0, dx: 0x4444, bx: 0x4444, sp: 0x5555, bp: 0x5555, si: 0, di: 0x7777 },
    );
    assert.deepEqual(
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, modrm.state[name]])),
      { cf: 0, pf: 1, af: 0, zf: 1, sf: 0, of: 0 },
    );
    assert.equal(modrm.state.ip, modrmProgram.length);
    assert.equal(modrm.state.halted, 1);
    assert.equal(modrm.state.faulted, 0);

    const modrmXor = await execute(page, baseUrl, [0xb8, 0x34, 0x12, 0xbb, 0x78, 0x56, 0x31, 0xd8, 0xf4]);
    assert.equal(modrmXor.state.ax, 0x444c);
    assert.deepEqual(
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, modrmXor.state[name]])),
      { cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0 },
    );

    const segmentSetup = await execute(page, baseUrl, [
      0xb8, 0x34, 0x12, 0x8e, 0xc0,
      0xb9, 0x78, 0x56, 0x8e, 0xd1,
      0xba, 0xbc, 0x9a, 0x8e, 0xda,
      0xfa, 0xfb, 0xf4,
    ], { state: { if: 1 } });
    assert.deepEqual(Object.fromEntries(['cs', 'ds', 'ss', 'es'].map((name) => [name, segmentSetup.state[name]])), { cs: 0, ds: 0x9abc, ss: 0x5678, es: 0x1234 });
    assert.deepEqual(Object.fromEntries(['ax', 'cx', 'dx'].map((name) => [name, segmentSetup.state[name]])), { ax: 0x1234, cx: 0x5678, dx: 0x9abc });
    assert.equal(segmentSetup.state.if, 1);
    assert.equal(segmentSetup.state.halted, 1);
    assert.equal(segmentSetup.state.faulted, 0);

    const cli = await execute(page, baseUrl, [0xfa, 0xf4], { state: { if: 1 } });
    assert.equal(cli.state.if, 0);
    const sti = await execute(page, baseUrl, [0xfb, 0xf4]);
    assert.equal(sti.state.if, 1);

    for (const [name, modrmByte] of [['CS', 0xc8], ['reserved', 0xe0], ['memory', 0x00]]) {
      const rejected = await execute(page, baseUrl, [0x8e, modrmByte]);
      assert.deepEqual(rejected.trace.map(({ address }) => address), [0, 1], name);
      assert.equal(rejected.state.ip, 2, name);
      assert.equal(rejected.state.cs, 0, name);
      assert.equal(rejected.state.halted, 1, name);
      assert.equal(rejected.state.faulted, 1, name);
    }

    const eaState = { bx: 0x0100, bp: 0x0200, si: 0x0010, di: 0x0020, ds: 0x1000, ss: 0x2000 };
    const eaCases = [
      ['BX+SI', 0x00, [], 0x10110], ['BX+DI', 0x01, [], 0x10120],
      ['BP+SI', 0x02, [], 0x20210], ['BP+DI', 0x03, [], 0x20220],
      ['SI', 0x04, [], 0x10010], ['DI', 0x05, [], 0x10020],
      ['disp16', 0x06, [0x30, 0x00], 0x10030], ['BX', 0x07, [], 0x10100],
    ];
    for (const [name, modrmByte, displacement, physical] of eaCases) {
      const expected = 0x4000 + modrmByte;
      const loaded = await execute(page, baseUrl, [0x8b, modrmByte, ...displacement, 0xf4], {
        state: eaState,
        placements: [{ address: physical, bytes: [expected & 0xff, expected >>> 8] }],
      });
      assert.equal(loaded.state.ax, expected, name);
      assert.deepEqual(loaded.trace.filter(({ address }) => address === physical || address === physical + 1).map(({ address }) => address), [physical, physical + 1], name);
      assert.equal(loaded.state.halted, 1, name);
      assert.equal(loaded.state.faulted, 0, name);
    }

    const negativeDisp8 = await execute(page, baseUrl, [0x8b, 0x46, 0xfe, 0xf4], {
      state: eaState,
      placements: [{ address: 0x201fe, bytes: [0xcd, 0xab] }],
    });
    assert.equal(negativeDisp8.state.ax, 0xabcd);
    assert.deepEqual(negativeDisp8.trace.map(({ address }) => address), [0, 1, 2, 0x201fe, 0x201ff, 3]);

    const disp16 = await execute(page, baseUrl, [0x8b, 0x80, 0x00, 0x01, 0xf4], {
      state: eaState,
      placements: [{ address: 0x10210, bytes: [0x78, 0x56] }],
    });
    assert.equal(disp16.state.ax, 0x5678);
    assert.deepEqual(disp16.trace.map(({ address }) => address), [0, 1, 2, 3, 0x10210, 0x10211, 4]);

    const memoryStore = await execute(page, baseUrl, [0x89, 0x48, 0x04, 0xf4], {
      state: { bx: 0x0100, si: 0x0010, cx: 0xbeef, ds: 0x1000 },
    });
    assert.deepEqual(memoryStore.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
      { kind: 'write', address: 0x10114 }, { kind: 'write', address: 0x10115 }, { kind: 'read', address: 3 },
    ]);
    assert.deepEqual(memoryStore.memory, { 65812: 0xef, 65813: 0xbe });
    assert.equal(memoryStore.state.cx, 0xbeef);

    const memoryRmw = await execute(page, baseUrl, [0x31, 0x08, 0xf4], {
      state: { bx: 0x0100, si: 0x0010, cx: 0x0f0f, ds: 0x1000 },
      placements: [{ address: 0x10110, bytes: [0xff, 0x00] }],
    });
    assert.deepEqual(memoryRmw.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
      { kind: 'read', address: 0x10110 }, { kind: 'read', address: 0x10111 },
      { kind: 'write', address: 0x10110 }, { kind: 'write', address: 0x10111 }, { kind: 'read', address: 2 },
    ]);
    assert.deepEqual(memoryRmw.memory, { 65808: 0xf0, 65809: 0x0f });
    assert.equal(memoryRmw.state.cx, 0x0f0f);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, memoryRmw.state[name]])), { cf: 0, pf: 1, af: 0, zf: 0, sf: 0, of: 0 });

    const memoryXorLoad = await execute(page, baseUrl, [0x33, 0x01, 0xf4], {
      state: { ax: 0x1234, bx: 0x0100, di: 0x0020, ds: 0x1000 },
      placements: [{ address: 0x10120, bytes: [0xff, 0x00] }],
    });
    assert.equal(memoryXorLoad.state.ax, 0x12cb);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, memoryXorLoad.state[name]])), { cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0 });

    const ldsBp = await execute(page, baseUrl, [0xc5, 0x76, 0xfe, 0xf4], {
      state: { bp: 0x0202, ss: 0x2000, ds: 0x1111, si: 0xaaaa, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
      placements: [{ address: 0x20200, bytes: [0x34, 0x12, 0x78, 0x56] }],
    });
    assert.deepEqual(ldsBp.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
      { kind: 'read', address: 0x20200 }, { kind: 'read', address: 0x20201 },
      { kind: 'read', address: 0x20202 }, { kind: 'read', address: 0x20203 }, { kind: 'read', address: 3 },
    ]);
    assert.deepEqual({ si: ldsBp.state.si, ds: ldsBp.state.ds, ldsSegLow: ldsBp.state.ldsSegLow }, { si: 0x1234, ds: 0x5678, ldsSegLow: 0x78 });
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, ldsBp.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });
    assert.equal(ldsBp.state.faulted, 0);

    const ldsRegisters = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    for (const [index, register] of ldsRegisters.entries()) {
      const offset = 0x4000 + index;
      const segment = 0x5000 + index;
      const loaded = await execute(page, baseUrl, [0xc5, (index << 3) | 0x06, 0x00, 0x30, 0xf4], {
        state: { ds: 0x1000 },
        placements: [{ address: 0x13000, bytes: [offset & 0xff, offset >>> 8, segment & 0xff, segment >>> 8] }],
      });
      assert.equal(loaded.state[register], offset, register);
      assert.equal(loaded.state.ds, segment, register);
      assert.deepEqual(loaded.trace.map(({ address }) => address), [0, 1, 2, 3, 0x13000, 0x13001, 0x13002, 0x13003, 4], register);
      assert.equal(loaded.state.halted, 1, register);
      assert.equal(loaded.state.faulted, 0, register);
    }

    const ldsWrapped = await execute(page, baseUrl, [0xc5, 0x06, 0xfe, 0xff, 0xf4], {
      state: { ds: 0x1000 },
      placements: [
        { address: 0x1fffe, bytes: [0xcd, 0xab] },
        { address: 0x10000, bytes: [0x34, 0x12] },
      ],
    });
    assert.deepEqual(ldsWrapped.trace.map(({ address }) => address), [0, 1, 2, 3, 0x1fffe, 0x1ffff, 0x10000, 0x10001, 4]);
    assert.deepEqual({ ax: ldsWrapped.state.ax, ds: ldsWrapped.state.ds }, { ax: 0xabcd, ds: 0x1234 });

    const ldsRegisterForm = await execute(page, baseUrl, [0xc5, 0xc0, 0xf4], { state: { ax: 0x1111, ds: 0x2222 } });
    assert.deepEqual(ldsRegisterForm.trace.map(({ address }) => address), [0, 1]);
    assert.deepEqual({ ax: ldsRegisterForm.state.ax, ds: ldsRegisterForm.state.ds }, { ax: 0x1111, ds: 0x2222 });
    assert.equal(ldsRegisterForm.state.halted, 1);
    assert.equal(ldsRegisterForm.state.faulted, 1);

    const byteImmediateProgram = [
      0xb0, 0x11, 0xb1, 0x22, 0xb2, 0x33, 0xb3, 0x44,
      0xb4, 0x55, 0xb5, 0x66, 0xb6, 0x77, 0xb7, 0x88, 0xf4,
    ];
    const byteImmediate = await execute(page, baseUrl, byteImmediateProgram, {
      state: { ax: 0xaabb, cx: 0xccdd, dx: 0xeeff, bx: 0x1234, sp: 0x5678, bp: 0x9abc, si: 0xdef0, di: 0x1357, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
    });
    assert.deepEqual(byteImmediate.trace, byteImmediateProgram.map((data, address) => ({ cycle: address, kind: 'read', address, data })));
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, byteImmediate.state[name]])),
      { ax: 0x5511, cx: 0x6622, dx: 0x7733, bx: 0x8844, sp: 0x5678, bp: 0x9abc, si: 0xdef0, di: 0x1357 },
    );
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, byteImmediate.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });

    const lowByteOnly = await execute(page, baseUrl, [0xb1, 0x0b, 0xf4], { state: { cx: 0xab00 } });
    assert.equal(lowByteOnly.state.cx, 0xab0b);
    assert.deepEqual(lowByteOnly.trace.map(({ address }) => address), [0, 1, 2]);
    const highByteOnly = await execute(page, baseUrl, [0xb5, 0x0c, 0xf4], { state: { cx: 0x0034 } });
    assert.equal(highByteOnly.state.cx, 0x0c34);
    assert.deepEqual(highByteOnly.trace.map(({ address }) => address), [0, 1, 2]);

    const cld = await execute(page, baseUrl, [0xfc, 0xf4], {
      state: { df: 1, if: 1, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
    });
    assert.deepEqual({ df: cld.state.df, if: cld.state.if }, { df: 0, if: 1 });
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, cld.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });
    assert.deepEqual(cld.trace.map(({ address }) => address), [0, 1]);

    const manifest = await page.evaluate(() => fetch('/generated/cpu16.manifest.json').then((response) => response.json()));
    assert.deepEqual(Object.keys(manifest.aliases), ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh']);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
