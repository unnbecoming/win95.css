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
const zeroInterruptState = { intOffsetLow: 0, intOffsetHigh: 0, intSegmentLow: 0, tf: 0, iopl: 0, nt: 0 };
const zeroFdcState = { fdcDor: 0, fdcInterrupt: 0 };

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
    return { ...result, outputs: chip.outputs(), memory: written };
  }, { bytes: rom, loadAddress: options.loadAddress ?? 0, state: { cs: 0, ip: 0, ...(options.state ?? {}) }, placements: options.placements ?? [] });
}

async function executeSteps(page, baseUrl, rom, steps, options = {}) {
  await page.goto(`${baseUrl}/test/cpu16.html`);
  return page.evaluate(async ({ bytes, loadAddress, state, placements, count }) => {
    const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
    const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
    const chip = new CssChip(document.querySelector('#cpu'), manifest);
    chip.seedState(state);
    const memory = new Uint8Array(0x100000);
    memory.set(bytes, loadAddress);
    for (const placement of placements) memory.set(placement.bytes, placement.address);
    const machine = new ByteBusMachine(chip, memory);
    const snapshots = [];
    for (let index = 0; index < count; index++) snapshots.push(machine.step());
    return { snapshots, trace: machine.trace, state: chip.state() };
  }, { bytes: rom, loadAddress: options.loadAddress ?? 0, state: { cs: 0, ip: 0, ...(options.state ?? {}) }, placements: options.placements ?? [], count: steps });
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
      rep: document.querySelector('[data-state="rep"]').textContent,
      trace: document.querySelector('#trace').textContent,
    } }));
    assert.equal(publicDemo.result.state.ip, 0x7c52);
    assert.equal(publicDemo.result.state.cs, 0);
    assert.equal(publicDemo.result.state.ax, 0x12c8);
    assert.equal(publicDemo.rendered.ip, '7c52');
    assert.equal(publicDemo.rendered.ax, '12c8');
    assert.equal(publicDemo.rendered.cycles, '110');
    assert.equal(publicDemo.rendered.df, '0');
    assert.equal(publicDemo.rendered.rep, '0');
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
      ip: 13, ax: 0x12c8, ...zeroOtherRegisters, ...zeroSegments, ...zeroInterruptState, ...zeroFdcState, ir: 0xf4, immLow: 1, immHigh: 0, farSegLow: 0, stackLow: 0, stackHigh: 0, modrm: 0, dispLow: 0, dispHigh: 0, memLow: 0, memHigh: 0, ldsSegLow: 0, stringByte: 0, byteImmediate: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0, if: 0, df: 0, rep: 0, csOverride: 0,
      cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0,
    });

    const moffs8 = await execute(page, baseUrl, [0xa0, 0x34, 0x12, 0xf4], {
      state: { ax: 0xabcd, ds: 0x1000, cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1 },
      placements: [{ address: 0x11234, bytes: [0x42] }],
    });
    assert.equal(moffs8.state.ax, 0xab42);
    assert.deepEqual(moffs8.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 0x11234 }, { kind: 'read', address: 3 },
    ]);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, moffs8.state[flag]])), { cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1 });
    assert.deepEqual(moffs8.memory, {});

    for (const [opcode, initial, immediate, expected] of [[0x24, 0xd5, 0x3f, 0x15], [0x0c, 0x80, 0x08, 0x88]]) {
      const logical = await execute(page, baseUrl, [opcode, immediate, 0xf4], { state: { ax: 0x1200 | initial, cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1 } });
      assert.equal(logical.state.ax, 0x1200 | expected);
      assert.deepEqual(logical.trace.map(({ address }) => address), [0, 1, 2]);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, logical.state[flag]])), {
        cf: 0,
        pf: Number(expected.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
        af: 0,
        zf: Number(expected === 0),
        sf: expected >>> 7,
        of: 0,
      });
    }

    const portOutput = await execute(page, baseUrl, [0xba, 0xf2, 0x03, 0xb0, 0x08, 0xee, 0xf4], {
      state: { ax: 0xab00, cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1 },
    });
    assert.deepEqual(portOutput.trace, [
      { cycle: 0, kind: 'read', address: 0, data: 0xba }, { cycle: 1, kind: 'read', address: 1, data: 0xf2 },
      { cycle: 2, kind: 'read', address: 2, data: 0x03 }, { cycle: 3, kind: 'read', address: 3, data: 0xb0 },
      { cycle: 4, kind: 'read', address: 4, data: 0x08 }, { cycle: 5, kind: 'read', address: 5, data: 0xee },
      { cycle: 6, kind: 'out', port: 0x03f2, data: 0x08 }, { cycle: 7, kind: 'read', address: 6, data: 0xf4 },
    ]);
    assert.equal(portOutput.state.dx, 0x03f2);
    assert.equal(portOutput.state.ax, 0xab08);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, portOutput.state[flag]])), { cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1 });
    assert.equal(portOutput.state.fdcDor, 0x08);
    assert.equal(portOutput.state.fdcInterrupt, 0);
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcReset', 'fdcInterrupt', 'irq6Request'].map((name) => [name, portOutput.outputs[name]])), { fdcDor: 0x08, fdcReset: 1, fdcInterrupt: 0, irq6Request: 0 });
    assert.deepEqual(portOutput.memory, {});

    const resetRelease = await execute(page, baseUrl, [0xba, 0xf2, 0x03, 0xb0, 0x08, 0xee, 0xeb, 0x00, 0xeb, 0x00, 0x0c, 0x04, 0xee, 0xf4]);
    assert.deepEqual(resetRelease.trace.filter(({ kind }) => kind === 'out').map(({ port, data }) => ({ port, data })), [
      { port: 0x03f2, data: 0x08 }, { port: 0x03f2, data: 0x0c },
    ]);
    assert.equal(resetRelease.state.fdcDor, 0x0c);
    assert.equal(resetRelease.state.fdcInterrupt, 1);
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcReset', 'fdcInterrupt', 'irq6Request'].map((name) => [name, resetRelease.outputs[name]])), { fdcDor: 0x0c, fdcReset: 0, fdcInterrupt: 1, irq6Request: 1 });

    const gatedPending = await execute(page, baseUrl, [0xba, 0xf2, 0x03, 0xb0, 0x04, 0xee, 0x0c, 0x08, 0xee, 0xf4]);
    assert.equal(gatedPending.state.fdcDor, 0x0c);
    assert.equal(gatedPending.state.fdcInterrupt, 1);
    assert.equal(gatedPending.outputs.irq6Request, 1);

    const resetClears = await execute(page, baseUrl, [0xba, 0xf2, 0x03, 0xb0, 0x08, 0xee, 0xf4], { state: { fdcDor: 0x0c, fdcInterrupt: 1 } });
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((name) => [name, resetClears.state[name]])), { fdcDor: 0x08, fdcInterrupt: 0 });
    assert.equal(resetClears.outputs.irq6Request, 0);

    const reservedBits = await execute(page, baseUrl, [0xba, 0xf2, 0x03, 0xb0, 0xff, 0xee, 0xf4]);
    assert.equal(reservedBits.state.fdcDor, 0x3d);
    assert.equal(reservedBits.outputs.irq6Request, 1);

    const unrelatedPort = await execute(page, baseUrl, [0xba, 0xf3, 0x03, 0xb0, 0x08, 0xee, 0xf4], { state: { fdcDor: 0x0c, fdcInterrupt: 1 } });
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((name) => [name, unrelatedPort.state[name]])), { fdcDor: 0x0c, fdcInterrupt: 1 });
    assert.equal(unrelatedPort.outputs.irq6Request, 1);

    const overflow = await execute(page, baseUrl, [0xb8, 0x00, 0x80, 0x05, 0x00, 0x80, 0xf4]);
    assert.deepEqual(overflow.state, {
      ip: 7, ax: 0, ...zeroOtherRegisters, ...zeroSegments, ...zeroInterruptState, ...zeroFdcState, ir: 0xf4, immLow: 0, immHigh: 0x80, farSegLow: 0, stackLow: 0, stackHigh: 0, modrm: 0, dispLow: 0, dispHigh: 0, memLow: 0, memHigh: 0, ldsSegLow: 0, stringByte: 0, byteImmediate: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0, if: 0, df: 0, rep: 0, csOverride: 0,
      cf: 1, pf: 1, af: 0, zf: 1, sf: 0, of: 1,
    });

    const borrow = await execute(page, baseUrl, [0xb8, 0x00, 0x00, 0x2d, 0x01, 0x00, 0xf4]);
    assert.deepEqual(borrow.state, {
      ip: 7, ax: 0xffff, ...zeroOtherRegisters, ...zeroSegments, ...zeroInterruptState, ...zeroFdcState, ir: 0xf4, immLow: 1, immHigh: 0, farSegLow: 0, stackLow: 0, stackHigh: 0, modrm: 0, dispLow: 0, dispHigh: 0, memLow: 0, memHigh: 0, ldsSegLow: 0, stringByte: 0, byteImmediate: 0, returnIp: 0, phase: 0, halted: 1, faulted: 0, if: 0, df: 0, rep: 0, csOverride: 0,
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

    const retfState = {
      ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0xfffe, bp: 0x5555, si: 0x6666, di: 0x7777,
      cs: 0x1000, ip: 0, ds: 0x3000, ss: 0, es: 0x4000,
      if: 1, tf: 1, df: 1, iopl: 3, nt: 1, rep: 0, csOverride: 0,
      cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
    };
    const retfPlacements = [
      { address: 0xfffe, bytes: [0x34, 0x12] },
      { address: 0x0000, bytes: [0x00, 0x20] },
      { address: 0x21234, bytes: [0xf4] },
    ];
    const returnedFar = await execute(page, baseUrl, [0xca, 0x02, 0x00], {
      loadAddress: 0x10000, state: retfState, placements: retfPlacements,
    });
    assert.deepEqual(returnedFar.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0x10000 }, { kind: 'read', address: 0x10001 }, { kind: 'read', address: 0x10002 },
      { kind: 'read', address: 0xfffe }, { kind: 'read', address: 0xffff }, { kind: 'read', address: 0x0000 }, { kind: 'read', address: 0x0001 },
      { kind: 'read', address: 0x21234 },
    ]);
    assert.deepEqual(Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'ds', 'ss', 'es', 'if', 'tf', 'df', 'iopl', 'nt', 'rep', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'].map((name) => [name, returnedFar.state[name]])), Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'ds', 'ss', 'es', 'if', 'tf', 'df', 'iopl', 'nt', 'rep', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'].map((name) => [name, retfState[name]])));
    assert.deepEqual({ cs: returnedFar.state.cs, ip: returnedFar.state.ip, sp: returnedFar.state.sp, halted: returnedFar.state.halted, faulted: returnedFar.state.faulted }, { cs: 0x2000, ip: 0x1235, sp: 0x0004, halted: 1, faulted: 0 });
    assert.deepEqual(returnedFar.memory, {});

    const partialFar = await executeSteps(page, baseUrl, [0xca, 0x02, 0x00], 7, {
      loadAddress: 0x10000, state: retfState, placements: retfPlacements,
    });
    assert.deepEqual(partialFar.snapshots.slice(0, 6).map(({ state }) => ({ ip: state.ip, cs: state.cs, sp: state.sp })), [
      { ip: 1, cs: 0x1000, sp: 0xfffe },
      { ip: 2, cs: 0x1000, sp: 0xfffe },
      { ip: 3, cs: 0x1000, sp: 0xfffe },
      { ip: 3, cs: 0x1000, sp: 0xfffe },
      { ip: 3, cs: 0x1000, sp: 0xfffe },
      { ip: 3, cs: 0x1000, sp: 0xfffe },
    ]);
    assert.deepEqual({ ip: partialFar.snapshots[6].state.ip, cs: partialFar.snapshots[6].state.cs, sp: partialFar.snapshots[6].state.sp }, { ip: 0x1234, cs: 0x2000, sp: 0x0004 });

    for (const cleanup of [0, 1, 0x1234, 0xffff]) {
      const stack = 0x0100;
      const cleanupResult = await execute(page, baseUrl, [0xca, cleanup & 0xff, cleanup >>> 8], {
        loadAddress: 0x10000,
        state: { cs: 0x1000, ip: 0, ss: 0, sp: stack },
        placements: [{ address: stack, bytes: [0x00, 0x01, 0x00, 0x20] }, { address: 0x20100, bytes: [0xf4] }],
      });
      assert.equal(cleanupResult.state.sp, (stack + 4 + cleanup) & 0xffff, `${cleanup}`);
      assert.equal(cleanupResult.state.cs, 0x2000, `${cleanup}`);
      assert.equal(cleanupResult.state.ip, 0x0101, `${cleanup}`);
      assert.equal(cleanupResult.state.faulted, 0, `${cleanup}`);
    }

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

    const loopState = {
      ax: 0x1111, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888,
      ds: 0x1000, ss: 0x2000, es: 0x3000, if: 1, df: 1, rep: 0,
      cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
    };
    const loopCollateralKeys = ['ax', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'ds', 'ss', 'es', 'if', 'df', 'rep', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'];
    for (const cx of [0x0000, 0x0001, 0x0002]) {
      const decremented = (cx - 1) & 0xffff;
      const taken = decremented !== 0;
      const result = await execute(page, baseUrl, [0xe2, 0x02, 0xf4, 0x90, 0xf4], { state: { ...loopState, cx } });
      assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: taken ? 4 : 2 },
      ], `loop/${cx}`);
      assert.equal(result.state.cx, decremented, `loop/${cx}`);
      assert.deepEqual(Object.fromEntries(loopCollateralKeys.map((key) => [key, result.state[key]])), Object.fromEntries(loopCollateralKeys.map((key) => [key, loopState[key]])), `loop/${cx}`);
      assert.equal(result.outputs.irq6Request, 1, `loop/${cx}`);
      assert.deepEqual(result.memory, {}, `loop/${cx}`);
      assert.equal(result.state.faulted, 0, `loop/${cx}`);
    }

    const loopNegative = await execute(page, baseUrl, [0xf4, 0xe2, 0xfd], {
      loadAddress: 0x0100, state: { ...loopState, cs: 0, ip: 0x0101, cx: 2 },
    });
    assert.deepEqual(loopNegative.trace.map(({ address }) => address), [0x0101, 0x0102, 0x0100]);
    assert.deepEqual({ cx: loopNegative.state.cx, ip: loopNegative.state.ip }, { cx: 1, ip: 0x0101 });
    assert.deepEqual(Object.fromEntries(loopCollateralKeys.map((key) => [key, loopNegative.state[key]])), Object.fromEntries(loopCollateralKeys.map((key) => [key, loopState[key]])));

    const loopPositiveWrap = await execute(page, baseUrl, [0xe2, 0x02], {
      loadAddress: 0xfffe, state: { ...loopState, cs: 0, ip: 0xfffe, cx: 2 }, placements: [{ address: 0x0002, bytes: [0xf4] }],
    });
    assert.deepEqual(loopPositiveWrap.trace.map(({ address }) => address), [0xfffe, 0xffff, 0x0002]);
    assert.deepEqual({ cx: loopPositiveWrap.state.cx, ip: loopPositiveWrap.state.ip }, { cx: 1, ip: 0x0003 });
    assert.deepEqual(Object.fromEntries(loopCollateralKeys.map((key) => [key, loopPositiveWrap.state[key]])), Object.fromEntries(loopCollateralKeys.map((key) => [key, loopState[key]])));

    const loopNegativeWrap = await execute(page, baseUrl, [0xe2, 0xfd], {
      state: { ...loopState, cs: 0, ip: 0, cx: 2 }, placements: [{ address: 0xffff, bytes: [0xf4] }],
    });
    assert.deepEqual(loopNegativeWrap.trace.map(({ address }) => address), [0x0000, 0x0001, 0xffff]);
    assert.deepEqual({ cx: loopNegativeWrap.state.cx, ip: loopNegativeWrap.state.ip }, { cx: 1, ip: 0x0000 });
    assert.deepEqual(Object.fromEntries(loopCollateralKeys.map((key) => [key, loopNegativeWrap.state[key]])), Object.fromEntries(loopCollateralKeys.map((key) => [key, loopState[key]])));

    for (const cf of [0, 1]) {
      const jb = await execute(page, baseUrl, [0x72, 0x02, 0xf4, 0x90, 0xf4], {
        state: { cf, ax: 0x1111, bx: 0x2222, ds: 0x3333, ss: 0x4444, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
      });
      assert.deepEqual(jb.trace.map(({ address }) => address), [0, 1, cf ? 4 : 2], `${cf}`);
      assert.deepEqual(Object.fromEntries(['ax', 'bx', 'ds', 'ss', 'cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, jb.state[name]])), { ax: 0x1111, bx: 0x2222, ds: 0x3333, ss: 0x4444, cf, pf: 1, af: 1, zf: 1, sf: 1, of: 1 }, `${cf}`);
      assert.equal(jb.state.faulted, 0, `${cf}`);
    }
    for (const cf of [0, 1]) {
      for (const zf of [0, 1]) {
        const jbe = await execute(page, baseUrl, [0x76, 0x02, 0xf4, 0x90, 0xf4], { state: { cf, zf, ax: 0x1234, pf: 1, af: 1, sf: 1, of: 1 } });
        assert.deepEqual(jbe.trace.map(({ address }) => address), [0, 1, cf || zf ? 4 : 2], `${cf}/${zf}`);
        assert.deepEqual(Object.fromEntries(['ax', 'cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, jbe.state[name]])), { ax: 0x1234, cf, pf: 1, af: 1, zf, sf: 1, of: 1 }, `${cf}/${zf}`);
        assert.equal(jbe.state.faulted, 0, `${cf}/${zf}`);
      }
    }

    const jbNegative = await execute(page, baseUrl, [0xf4, 0x72, 0xfd], { loadAddress: 0x0100, state: { ip: 0x0101, cf: 1 } });
    assert.deepEqual(jbNegative.trace.map(({ address }) => address), [0x0101, 0x0102, 0x0100]);
    assert.equal(jbNegative.state.ip, 0x0101);
    const jbWrap = await execute(page, baseUrl, [0x72, 0x02], {
      loadAddress: 0xfffe,
      state: { ip: 0xfffe, cf: 1 },
      placements: [{ address: 0x0002, bytes: [0xf4] }],
    });
    assert.deepEqual(jbWrap.trace.map(({ address }) => address), [0xfffe, 0xffff, 0x0002]);
    assert.equal(jbWrap.state.ip, 0x0003);

    const jlArchitecturalKeys = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'if', 'df', 'rep', 'cf', 'pf', 'af', 'zf', 'sf', 'of'];
    const jlArchitecture = (state) => Object.fromEntries(jlArchitecturalKeys.map((name) => [name, state[name] ?? 0]));
    const jlBaseState = { ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888, ds: 0x1000, ss: 0x2000, es: 0x3000, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 1 };
    for (const sf of [0, 1]) {
      for (const of of [0, 1]) {
        const state = { ...jlBaseState, sf, of };
        const result = await execute(page, baseUrl, [0x7c, 0x02, 0xf4, 0x90, 0xf4], { state });
        const taken = sf !== of;
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: taken ? 4 : 2 },
        ], `${sf}/${of}`);
        assert.deepEqual(jlArchitecture(result.state), jlArchitecture(state), `${sf}/${of}`);
        assert.deepEqual(result.memory, {}, `${sf}/${of}`);
        assert.equal(result.state.halted, 1, `${sf}/${of}`);
        assert.equal(result.state.faulted, 0, `${sf}/${of}`);
      }
    }

    const jlNegative = await execute(page, baseUrl, [0xf4, 0x7c, 0xfd], {
      loadAddress: 0x0100,
      state: { ...jlBaseState, cs: 0, ip: 0x0101, sf: 1, of: 0 },
    });
    assert.deepEqual(jlNegative.trace.map(({ address }) => address), [0x0101, 0x0102, 0x0100]);
    assert.deepEqual(jlArchitecture(jlNegative.state), jlArchitecture({ ...jlBaseState, sf: 1, of: 0 }));
    assert.equal(jlNegative.state.ip, 0x0101);

    const jlPositiveWrap = await execute(page, baseUrl, [0x7c, 0x02], {
      loadAddress: 0xfffe,
      state: { ...jlBaseState, cs: 0, ip: 0xfffe, sf: 1, of: 0 },
      placements: [{ address: 0x0002, bytes: [0xf4] }],
    });
    assert.deepEqual(jlPositiveWrap.trace.map(({ address }) => address), [0xfffe, 0xffff, 0x0002]);
    assert.deepEqual(jlArchitecture(jlPositiveWrap.state), jlArchitecture({ ...jlBaseState, sf: 1, of: 0 }));
    assert.equal(jlPositiveWrap.state.ip, 0x0003);

    const jlNegativeWrap = await execute(page, baseUrl, [0x7c, 0xfd], {
      state: { ...jlBaseState, cs: 0, ip: 0, sf: 0, of: 1 },
      placements: [{ address: 0xffff, bytes: [0xf4] }],
    });
    assert.deepEqual(jlNegativeWrap.trace.map(({ address }) => address), [0x0000, 0x0001, 0xffff]);
    assert.deepEqual(jlArchitecture(jlNegativeWrap.state), jlArchitecture({ ...jlBaseState, sf: 0, of: 1 }));
    assert.equal(jlNegativeWrap.state.ip, 0x0000);

    const intState = {
      ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x8000, bp: 0x6666, si: 0x7777, di: 0x8888,
      cs: 0x2222, ds: 0x3333, ss: 0x1000, es: 0x4444,
      cf: 1, pf: 1, af: 1, zf: 1, sf: 1, tf: 1, if: 1, df: 1, of: 1, iopl: 3, nt: 1,
    };
    const interrupted = await execute(page, baseUrl, [0xcd, 0x21], {
      loadAddress: 0x22220,
      state: intState,
      placements: [
        { address: 0x0084, bytes: [0x00, 0x01, 0x00, 0x30] },
        { address: 0x30100, bytes: [0xf4] },
      ],
    });
    assert.deepEqual(interrupted.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0x22220, data: 0xcd }, { kind: 'read', address: 0x22221, data: 0x21 },
      { kind: 'write', address: 0x17ffe, data: 0xd7 }, { kind: 'write', address: 0x17fff, data: 0x7f },
      { kind: 'write', address: 0x17ffc, data: 0x22 }, { kind: 'write', address: 0x17ffd, data: 0x22 },
      { kind: 'write', address: 0x17ffa, data: 0x02 }, { kind: 'write', address: 0x17ffb, data: 0x00 },
      { kind: 'read', address: 0x0084, data: 0x00 }, { kind: 'read', address: 0x0085, data: 0x01 },
      { kind: 'read', address: 0x0086, data: 0x00 }, { kind: 'read', address: 0x0087, data: 0x30 },
      { kind: 'read', address: 0x30100, data: 0xf4 },
    ]);
    assert.deepEqual(interrupted.memory, { 98298: 0x02, 98299: 0x00, 98300: 0x22, 98301: 0x22, 98302: 0xd7, 98303: 0x7f });
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'df', 'of', 'iopl', 'nt'].map((name) => [name, interrupted.state[name]])),
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'df', 'of', 'iopl', 'nt'].map((name) => [name, intState[name]])),
    );
    assert.deepEqual(Object.fromEntries(['sp', 'cs', 'ip', 'if', 'tf', 'halted', 'faulted'].map((name) => [name, interrupted.state[name]])), { sp: 0x7ffa, cs: 0x3000, ip: 0x0101, if: 0, tf: 0, halted: 1, faulted: 0 });

    const intVectorZero = await execute(page, baseUrl, [0xcd, 0x00], {
      loadAddress: 0x4000,
      state: { cs: 0x0400, ss: 0x0600, sp: 0, ax: 0xaaaa, if: 1, tf: 1 },
      placements: [
        { address: 0x0000, bytes: [0x00, 0x02, 0x00, 0x05] },
        { address: 0x05200, bytes: [0xf4] },
      ],
    });
    assert.deepEqual(intVectorZero.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0x4000 }, { kind: 'read', address: 0x4001 },
      { kind: 'write', address: 0x15ffe }, { kind: 'write', address: 0x15fff },
      { kind: 'write', address: 0x15ffc }, { kind: 'write', address: 0x15ffd },
      { kind: 'write', address: 0x15ffa }, { kind: 'write', address: 0x15ffb },
      { kind: 'read', address: 0x0000 }, { kind: 'read', address: 0x0001 }, { kind: 'read', address: 0x0002 }, { kind: 'read', address: 0x0003 },
      { kind: 'read', address: 0x05200 },
    ]);
    assert.deepEqual(intVectorZero.memory, { 90106: 0x02, 90107: 0x00, 90108: 0x00, 90109: 0x04, 90110: 0x02, 90111: 0x03 });
    assert.deepEqual(Object.fromEntries(['sp', 'cs', 'ip', 'ax', 'if', 'tf', 'halted', 'faulted'].map((name) => [name, intVectorZero.state[name]])), { sp: 0xfffa, cs: 0x0500, ip: 0x0201, ax: 0xaaaa, if: 0, tf: 0, halted: 1, faulted: 0 });

    const intVectorMax = await execute(page, baseUrl, [0xcd, 0xff], {
      loadAddress: 0x7000,
      state: { cs: 0x0700, ss: 0x0900, sp: 0x0100, bx: 0xbbbb, cf: 1, of: 1 },
      placements: [
        { address: 0x03fc, bytes: [0x00, 0x03, 0x00, 0x08] },
        { address: 0x08300, bytes: [0xf4] },
      ],
    });
    assert.deepEqual(intVectorMax.trace.slice(8, 12).map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0x03fc }, { kind: 'read', address: 0x03fd }, { kind: 'read', address: 0x03fe }, { kind: 'read', address: 0x03ff },
    ]);
    assert.deepEqual(Object.fromEntries(['sp', 'cs', 'ip', 'bx', 'cf', 'of', 'halted', 'faulted'].map((name) => [name, intVectorMax.state[name]])), { sp: 0x00fa, cs: 0x0800, ip: 0x0301, bx: 0xbbbb, cf: 1, of: 1, halted: 1, faulted: 0 });

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

    const pushfAState = {
      ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x8000, bp: 0x5555, si: 0x6666, di: 0x7777,
      cs: 0x3000, ds: 0x4000, ss: 0x2000, es: 0x5000,
      cf: 1, pf: 0, af: 1, zf: 0, sf: 1, tf: 0, if: 1, df: 0, of: 1, iopl: 2, nt: 0,
      fdcDor: 0x3c, fdcInterrupt: 1,
    };
    const pushfA = await execute(page, baseUrl, [0x9c, 0xf4], { loadAddress: 0x30000, state: pushfAState });
    assert.deepEqual(pushfA.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0x30000, data: 0x9c },
      { kind: 'write', address: 0x27ffe, data: 0x93 },
      { kind: 'write', address: 0x27fff, data: 0x2a },
      { kind: 'read', address: 0x30001, data: 0xf4 },
    ]);
    assert.deepEqual(pushfA.memory, { 163838: 0x93, 163839: 0x2a });
    assert.equal(pushfA.state.sp, 0x7ffe);
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, pushfA.state[name]])),
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, pushfAState[name]])),
    );
    assert.equal(pushfA.state.halted, 1);
    assert.equal(pushfA.state.faulted, 0);

    const pushfBState = {
      ax: 0x8888, cx: 0x9999, dx: 0xaaaa, bx: 0xbbbb, sp: 0x0000, bp: 0xcccc, si: 0xdddd, di: 0xeeee,
      cs: 0, ds: 0x1111, ss: 0x1000, es: 0x2222,
      cf: 0, pf: 1, af: 0, zf: 1, sf: 0, tf: 1, if: 0, df: 1, of: 0, iopl: 1, nt: 1,
      fdcDor: 0x08, fdcInterrupt: 1,
    };
    const pushfB = await execute(page, baseUrl, [0x9c, 0xf4], { state: pushfBState });
    assert.deepEqual(pushfB.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0x9c },
      { kind: 'write', address: 0x1fffe, data: 0x46 },
      { kind: 'write', address: 0x1ffff, data: 0x55 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.equal(pushfB.state.sp, 0xfffe);
    assert.equal(pushfB.memory[0x1fffe], 0x46);
    assert.equal(pushfB.memory[0x1ffff], 0x55);
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, pushfB.state[name]])),
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, pushfBState[name]])),
    );
    assert.equal(pushfB.state.halted, 1);
    assert.equal(pushfB.state.faulted, 0);

    const popfAInitial = { ...pushfBState, sp: 0x8000, ss: 0x2000, fdcDor: 0x3c, fdcInterrupt: 1 };
    const popfA = await execute(page, baseUrl, [0x9d, 0xf4], {
      state: popfAInitial,
      placements: [{ address: 0x28000, bytes: [0xb9, 0xaa] }],
    });
    assert.deepEqual(popfA.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0x9d },
      { kind: 'read', address: 0x28000, data: 0xb9 },
      { kind: 'read', address: 0x28001, data: 0xaa },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.equal(popfA.state.sp, 0x8002);
    assert.deepEqual(
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt'].map((name) => [name, popfA.state[name]])),
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt'].map((name) => [name, pushfAState[name]])),
    );
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'fdcDor', 'fdcInterrupt'].map((name) => [name, popfA.state[name]])),
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'fdcDor', 'fdcInterrupt'].map((name) => [name, popfAInitial[name]])),
    );
    assert.equal(popfA.outputs.irq6Request, 1);
    assert.equal(popfA.state.halted, 1);
    assert.equal(popfA.state.faulted, 0);

    const popfBInitial = { ...pushfAState, cs: 0, sp: 0xffff, ss: 0x1000, fdcDor: 0x08, fdcInterrupt: 1 };
    const popfB = await execute(page, baseUrl, [0x9d, 0xf4], {
      state: popfBInitial,
      placements: [{ address: 0x1ffff, bytes: [0x46] }, { address: 0x10000, bytes: [0x55] }],
    });
    assert.deepEqual(popfB.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0x9d },
      { kind: 'read', address: 0x1ffff, data: 0x46 },
      { kind: 'read', address: 0x10000, data: 0x55 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.equal(popfB.state.sp, 0x0001);
    assert.deepEqual(
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt'].map((name) => [name, popfB.state[name]])),
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt'].map((name) => [name, pushfBState[name]])),
    );
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'fdcDor', 'fdcInterrupt'].map((name) => [name, popfB.state[name]])),
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'fdcDor', 'fdcInterrupt'].map((name) => [name, popfBInitial[name]])),
    );
    assert.equal(popfB.state.halted, 1);
    assert.equal(popfB.state.faulted, 0);

    const popfPartial = await executeSteps(page, baseUrl, [0x9d], 2, {
      state: popfAInitial,
      placements: [{ address: 0x28000, bytes: [0xb9, 0xaa] }],
    });
    assert.deepEqual(popfPartial.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0x9d },
      { kind: 'read', address: 0x28000, data: 0xb9 },
    ]);
    assert.equal(popfPartial.state.sp, 0x8000);
    assert.deepEqual(
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt'].map((name) => [name, popfPartial.state[name]])),
      Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt'].map((name) => [name, popfAInitial[name]])),
    );

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

    const addRegisters = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    const addInitial = { ax: 0x0001, cx: 0x7fff, dx: 0x8000, bx: 0xffff, sp: 0x00ff, bp: 0xff01, si: 0x5555, di: 0xaaaa };
    const addFlags = (left, right) => {
      const sum = left + right;
      const result = sum & 0xffff;
      return {
        cf: Number(sum > 0xffff),
        pf: Number((result & 0xff).toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
        af: Number(((left & 0xf) + (right & 0xf)) > 0xf),
        zf: Number(result === 0),
        sf: result >>> 15,
        of: Number(((~(left ^ right) & (left ^ result)) & 0x8000) !== 0),
      };
    };
    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...addInitial, cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1 };
        const result = await execute(page, baseUrl, [0x03, 0xc0 | (destination << 3) | source, 0xf4], { state });
        const expected = { ...addInitial, [addRegisters[destination]]: (addInitial[addRegisters[destination]] + addInitial[addRegisters[source]]) & 0xffff };
        assert.deepEqual(Object.fromEntries(addRegisters.map((name) => [name, result.state[name]])), expected, `${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), addFlags(addInitial[addRegisters[destination]], addInitial[addRegisters[source]]), `${source}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `${source}/${destination}`);
        assert.deepEqual(result.memory, {}, `${source}/${destination}`);
      }
    }
    const addMemoryRejected = await execute(page, baseUrl, [0x03, 0x06, 0x00, 0x10]);
    assert.deepEqual(addMemoryRejected.trace.map(({ address }) => address), [0, 1]);
    assert.equal(addMemoryRejected.state.faulted, 1);

    const subFlags = (left, right) => {
      const result = (left - right) & 0xffff;
      return {
        cf: Number(left < right),
        pf: Number((result & 0xff).toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
        af: Number((left & 0xf) < (right & 0xf)),
        zf: Number(result === 0),
        sf: result >>> 15,
        of: Number((((left ^ right) & (left ^ result)) & 0x8000) !== 0),
      };
    };
    const biosSubSelf = await execute(page, baseUrl, [0x2b, 0xc0, 0xf4], {
      state: { ax: 0x9001, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888, cs: 0, ds: 0x1111, ss: 0x2222, es: 0x3333, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, tf: 1, if: 1, df: 1, of: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 },
    });
    assert.equal(biosSubSelf.state.ax, 0);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, biosSubSelf.state[flag]])), { cf: 0, pf: 1, af: 0, zf: 1, sf: 0, of: 0 });
    assert.deepEqual(biosSubSelf.trace.map(({ kind, address, data }) => ({ kind, address, data })), [{ kind: 'read', address: 0, data: 0x2b }, { kind: 'read', address: 1, data: 0xc0 }, { kind: 'read', address: 2, data: 0xf4 }]);
    assert.deepEqual(Object.fromEntries(['cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, biosSubSelf.state[name]])), { cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888, cs: 0, ds: 0x1111, ss: 0x2222, es: 0x3333, tf: 1, if: 1, df: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 });
    assert.equal(biosSubSelf.outputs.irq6Request, 1);
    assert.deepEqual(biosSubSelf.memory, {});

    const subInitial = { ...addInitial, cs: 0, ds: 0x1111, ss: 0x2222, es: 0x3333, tf: 1, if: 1, df: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...subInitial, cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0 };
        const result = await execute(page, baseUrl, [0x2b, 0xc0 | (destination << 3) | source, 0xf4], { state });
        const expected = { ...addInitial, [addRegisters[destination]]: (addInitial[addRegisters[destination]] - addInitial[addRegisters[source]]) & 0xffff };
        assert.deepEqual(Object.fromEntries(addRegisters.map((name) => [name, result.state[name]])), expected, `sub ${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), subFlags(addInitial[addRegisters[destination]], addInitial[addRegisters[source]]), `sub ${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cs', 'ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, result.state[name]])), Object.fromEntries(['cs', 'ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, subInitial[name]])), `sub collateral ${source}/${destination}`);
        assert.equal(result.outputs.irq6Request, 1, `sub irq ${source}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `sub trace ${source}/${destination}`);
        assert.deepEqual(result.memory, {}, `sub memory ${source}/${destination}`);
      }
    }
    const subMemoryRejected = await execute(page, baseUrl, [0x2b, 0x06, 0x00, 0x10]);
    assert.deepEqual(subMemoryRejected.trace.map(({ address }) => address), [0, 1]);
    assert.equal(subMemoryRejected.state.faulted, 1);

    const xchgBxDx = await execute(page, baseUrl, [0x87, 0xd3, 0xf4], {
      state: { ax: 0x1001, cx: 0x1002, dx: 0xabcd, bx: 0x1234, sp: 0x1005, bp: 0x1006, si: 0x1007, di: 0x1008, cs: 0, ds: 0x1111, ss: 0x2222, es: 0x3333, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, tf: 1, if: 1, df: 1, of: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 },
    });
    assert.equal(xchgBxDx.state.bx, 0xabcd);
    assert.equal(xchgBxDx.state.dx, 0x1234);
    assert.deepEqual(Object.fromEntries(['ax', 'cx', 'sp', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, xchgBxDx.state[name]])), { ax: 0x1001, cx: 0x1002, sp: 0x1005, bp: 0x1006, si: 0x1007, di: 0x1008, cs: 0, ds: 0x1111, ss: 0x2222, es: 0x3333, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, tf: 1, if: 1, df: 1, of: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 });
    assert.equal(xchgBxDx.outputs.irq6Request, 1);
    assert.deepEqual(xchgBxDx.trace.map(({ kind, address, data }) => ({ kind, address, data })), [{ kind: 'read', address: 0, data: 0x87 }, { kind: 'read', address: 1, data: 0xd3 }, { kind: 'read', address: 2, data: 0xf4 }]);
    assert.deepEqual(xchgBxDx.memory, {});

    const xchgInitial = { ax: 0x1101, cx: 0x2202, dx: 0x3303, bx: 0x4404, sp: 0x5505, bp: 0x6606, si: 0x7707, di: 0x8808, cs: 0, ds: 0x1111, ss: 0x2222, es: 0x3333, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, tf: 1, if: 1, df: 1, of: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
    for (let reg = 0; reg < 8; reg++) {
      for (let rm = 0; rm < 8; rm++) {
        const result = await execute(page, baseUrl, [0x87, 0xc0 | (reg << 3) | rm, 0xf4], { state: xchgInitial });
        const expected = Object.fromEntries(addRegisters.map((name) => [name, xchgInitial[name]]));
        [expected[addRegisters[reg]], expected[addRegisters[rm]]] = [xchgInitial[addRegisters[rm]], xchgInitial[addRegisters[reg]]];
        assert.deepEqual(Object.fromEntries(addRegisters.map((name) => [name, result.state[name]])), expected, `xchg ${reg}/${rm}`);
        assert.deepEqual(Object.fromEntries(['cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, result.state[name]])), Object.fromEntries(['cs', 'ds', 'ss', 'es', 'cf', 'pf', 'af', 'zf', 'sf', 'tf', 'if', 'df', 'of', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, xchgInitial[name]])), `xchg collateral ${reg}/${rm}`);
        assert.equal(result.outputs.irq6Request, 1, `xchg irq ${reg}/${rm}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `xchg trace ${reg}/${rm}`);
        assert.deepEqual(result.memory, {}, `xchg memory ${reg}/${rm}`);
      }
    }
    const xchgMemoryRejected = await execute(page, baseUrl, [0x87, 0x06, 0x00, 0x10]);
    assert.deepEqual(xchgMemoryRejected.trace.map(({ address }) => address), [0, 1]);
    assert.equal(xchgMemoryRejected.state.faulted, 1);

    const indirectCall = await execute(page, baseUrl, [0xff, 0x17, 0xf4], {
      state: { bx: 0x0100, ds: 0x1000, ss: 0x2000, sp: 0x8000, ax: 0x1234, cf: 1 },
      placements: [{ address: 0x10100, bytes: [0x00, 0x02] }, { address: 0x00200, bytes: [0xf4] }],
    });
    assert.deepEqual(indirectCall.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xff }, { kind: 'read', address: 1, data: 0x17 },
      { kind: 'read', address: 0x10100, data: 0x00 }, { kind: 'read', address: 0x10101, data: 0x02 },
      { kind: 'write', address: 0x27ffe, data: 0x02 }, { kind: 'write', address: 0x27fff, data: 0x00 },
      { kind: 'read', address: 0x00200, data: 0xf4 },
    ]);
    assert.equal(indirectCall.state.sp, 0x7ffe);
    assert.equal(indirectCall.state.ax, 0x1234);
    assert.equal(indirectCall.state.cf, 1);
    assert.equal(indirectCall.state.faulted, 0);

    const csIndirectCall = await execute(page, baseUrl, [0x2e, 0xff, 0x17, 0xf4], {
      loadAddress: 0x10000,
      state: { cs: 0x1000, bx: 0x0100, ds: 0x2000, ss: 0x3000, sp: 0x0001 },
      placements: [
        { address: 0x10100, bytes: [0x00, 0x02] }, { address: 0x20100, bytes: [0x00, 0x03] },
        { address: 0x10200, bytes: [0xf4] }, { address: 0x10300, bytes: [0x90] },
      ],
    });
    assert.deepEqual(csIndirectCall.trace.filter(({ address }) => [0x10100, 0x10101, 0x20100, 0x20101].includes(address)).map(({ address }) => address), [0x10100, 0x10101]);
    assert.equal(csIndirectCall.state.sp, 0xffff);
    assert.deepEqual(csIndirectCall.memory, { 262143: 0x03, 196608: 0x00 });
    assert.equal(csIndirectCall.state.csOverride, 0);
    assert.equal(csIndirectCall.state.faulted, 0);

    for (const [name, bytes] of [['selector', [0xff, 0x07]], ['register', [0xff, 0xd0]]]) {
      const rejected = await execute(page, baseUrl, bytes);
      assert.deepEqual(rejected.trace.map(({ address }) => address), [0, 1], name);
      assert.equal(rejected.state.faulted, 1, name);
    }

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

    for (const initialCarry of [0, 1]) {
      const initial = {
        ax: 0x1234, cx: 0x5678, dx: 0x9abc, bx: 0xdef0, sp: 0x2468, bp: 0x1357, si: 0xaaaa, di: 0x5555,
        ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, tf: 1, df: 1, iopl: 3, nt: 1,
        cf: initialCarry, pf: 1, af: 1, zf: 1, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const cmc = await execute(page, baseUrl, [0xf5, 0xf4], { state: initial });
      assert.deepEqual(cmc.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
        { kind: 'read', address: 0, data: 0xf5 }, { kind: 'read', address: 1, data: 0xf4 },
      ], `CMC CF=${initialCarry}`);
      assert.equal(cmc.state.cf, 1 - initialCarry, `CMC CF=${initialCarry}`);
      assert.deepEqual(
        Object.fromEntries(Object.keys(initial).filter((name) => name !== 'cf').map((name) => [name, cmc.state[name]])),
        Object.fromEntries(Object.entries(initial).filter(([name]) => name !== 'cf')),
        `CMC CF=${initialCarry}`,
      );
      assert.deepEqual(Object.fromEntries(['fdcReset', 'irq6Request'].map((name) => [name, cmc.outputs[name]])), { fdcReset: 0, irq6Request: 1 }, `CMC CF=${initialCarry}`);
      assert.deepEqual(cmc.memory, {}, `CMC CF=${initialCarry}`);
      assert.deepEqual({ ip: cmc.state.ip, halted: cmc.state.halted, faulted: cmc.state.faulted }, { ip: 2, halted: 1, faulted: 0 }, `CMC CF=${initialCarry}`);

      const clc = await execute(page, baseUrl, [0xf8, 0xf4], { state: initial });
      assert.deepEqual(clc.trace.map(({ address }) => address), [0, 1], `CF=${initialCarry}`);
      assert.equal(clc.state.cf, 0, `CF=${initialCarry}`);
      assert.deepEqual(
        Object.fromEntries(Object.keys(initial).filter((name) => name !== 'cf').map((name) => [name, clc.state[name]])),
        Object.fromEntries(Object.entries(initial).filter(([name]) => name !== 'cf')),
        `CF=${initialCarry}`,
      );
      assert.deepEqual(Object.fromEntries(['fdcReset', 'irq6Request'].map((name) => [name, clc.outputs[name]])), { fdcReset: 0, irq6Request: 1 }, `CF=${initialCarry}`);
      assert.deepEqual({ ip: clc.state.ip, halted: clc.state.halted, faulted: clc.state.faulted }, { ip: 2, halted: 1, faulted: 0 }, `CF=${initialCarry}`);

      const stc = await execute(page, baseUrl, [0xf9, 0xf4], { state: initial });
      assert.deepEqual(stc.trace.map(({ address }) => address), [0, 1], `STC CF=${initialCarry}`);
      assert.equal(stc.state.cf, 1, `STC CF=${initialCarry}`);
      assert.deepEqual(
        Object.fromEntries(Object.keys(initial).filter((name) => name !== 'cf').map((name) => [name, stc.state[name]])),
        Object.fromEntries(Object.entries(initial).filter(([name]) => name !== 'cf')),
        `STC CF=${initialCarry}`,
      );
      assert.deepEqual(Object.fromEntries(['fdcReset', 'irq6Request'].map((name) => [name, stc.outputs[name]])), { fdcReset: 0, irq6Request: 1 }, `STC CF=${initialCarry}`);
      assert.deepEqual({ ip: stc.state.ip, halted: stc.state.halted, faulted: stc.state.faulted }, { ip: 2, halted: 1, faulted: 0 }, `STC CF=${initialCarry}`);
    }

    for (const [name, modrmByte] of [['CS', 0xc8], ['reserved', 0xe0]]) {
      const rejected = await execute(page, baseUrl, [0x8e, modrmByte]);
      assert.deepEqual(rejected.trace.map(({ address }) => address), [0, 1], name);
      assert.equal(rejected.state.ip, 2, name);
      assert.equal(rejected.state.cs, 0, name);
      assert.equal(rejected.state.halted, 1, name);
      assert.equal(rejected.state.faulted, 1, name);
    }

    const segmentMemory = await execute(page, baseUrl, [
      0x8e, 0x06, 0x30, 0x00,
      0x8e, 0x52, 0xfe,
      0x8e, 0x9f, 0x00, 0x01,
      0xf4,
    ], {
      state: { bx: 0x0100, bp: 0x0200, si: 0x0010, ds: 0x1000, ss: 0x2000 },
      placements: [
        { address: 0x10030, bytes: [0x11, 0x11] },
        { address: 0x2020e, bytes: [0x22, 0x22] },
        { address: 0x10200, bytes: [0x33, 0x33] },
      ],
    });
    assert.deepEqual(Object.fromEntries(['es', 'ss', 'ds'].map((name) => [name, segmentMemory.state[name]])), { es: 0x1111, ss: 0x2222, ds: 0x3333 });
    assert.deepEqual(segmentMemory.trace.filter(({ address }) => address >= 0x10000).map(({ address }) => address), [0x10030, 0x10031, 0x2020e, 0x2020f, 0x10200, 0x10201]);
    assert.equal(segmentMemory.state.faulted, 0);

    const csOverride = await execute(page, baseUrl, [0x2e, 0x8e, 0x1e, 0x7f, 0x19, 0xf4], {
      loadAddress: 0x10000,
      state: { cs: 0x1000, ds: 0x2000 },
      placements: [
        { address: 0x1197f, bytes: [0x40, 0x00] },
        { address: 0x2197f, bytes: [0xde, 0xad] },
      ],
    });
    assert.deepEqual(csOverride.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0x10000 }, { kind: 'read', address: 0x10001 }, { kind: 'read', address: 0x10002 },
      { kind: 'read', address: 0x10003 }, { kind: 'read', address: 0x10004 },
      { kind: 'read', address: 0x1197f }, { kind: 'read', address: 0x11980 }, { kind: 'read', address: 0x10005 },
    ]);
    assert.equal(csOverride.state.ds, 0x0040);
    assert.equal(csOverride.state.csOverride, 0);
    assert.equal(csOverride.state.faulted, 0);

    const csOverrideBp = await execute(page, baseUrl, [0x2e, 0x8e, 0x5e, 0x04, 0xf4], {
      loadAddress: 0x10000,
      state: { cs: 0x1000, ss: 0x2000, bp: 0x0100 },
      placements: [
        { address: 0x10104, bytes: [0x34, 0x12] },
        { address: 0x20104, bytes: [0x78, 0x56] },
      ],
    });
    assert.equal(csOverrideBp.state.ds, 0x1234);
    assert.deepEqual(csOverrideBp.trace.filter(({ address }) => address === 0x10104 || address === 0x10105 || address === 0x20104 || address === 0x20105).map(({ address }) => address), [0x10104, 0x10105]);
    assert.equal(csOverrideBp.state.csOverride, 0);
    assert.equal(csOverrideBp.state.faulted, 0);

    const invalidCsOverride = await execute(page, baseUrl, [0x2e, 0xf4]);
    assert.deepEqual(invalidCsOverride.trace.map(({ address }) => address), [0, 1]);
    assert.equal(invalidCsOverride.state.faulted, 1);

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

    const movsb = await execute(page, baseUrl, [0xa4, 0xf4], {
      state: { ds: 0x1000, es: 0x2000, si: 0x0010, di: 0x0020, cx: 0x1234, cf: 1 },
      placements: [{ address: 0x10010, bytes: [0xab] }],
    });
    assert.deepEqual(movsb.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xa4 },
      { kind: 'read', address: 0x10010, data: 0xab },
      { kind: 'write', address: 0x20020, data: 0xab },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.deepEqual({ si: movsb.state.si, di: movsb.state.di, cx: movsb.state.cx, rep: movsb.state.rep, cf: movsb.state.cf }, { si: 0x0011, di: 0x0021, cx: 0x1234, rep: 0, cf: 1 });
    assert.deepEqual(movsb.memory, { 131104: 0xab });

    const movsbBackward = await execute(page, baseUrl, [0xa4, 0xf4], {
      state: { ds: 0x1000, es: 0x2000, si: 0x0010, di: 0x0020, cx: 7, df: 1 },
      placements: [{ address: 0x10010, bytes: [0xcd] }],
    });
    assert.deepEqual({ si: movsbBackward.state.si, di: movsbBackward.state.di, cx: movsbBackward.state.cx, df: movsbBackward.state.df }, { si: 0x000f, di: 0x001f, cx: 7, df: 1 });
    assert.deepEqual(movsbBackward.memory, { 131104: 0xcd });

    const repMovsb = await execute(page, baseUrl, [0xf3, 0xa4, 0xf4], {
      state: { ds: 0x1000, es: 0x2000, si: 0x0010, di: 0x0020, cx: 3, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
      placements: [{ address: 0x10010, bytes: [0x11, 0x22, 0x33] }],
    });
    assert.deepEqual(repMovsb.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xf3 }, { kind: 'read', address: 1, data: 0xa4 },
      { kind: 'read', address: 0x10010, data: 0x11 }, { kind: 'write', address: 0x20020, data: 0x11 },
      { kind: 'read', address: 0x10011, data: 0x22 }, { kind: 'write', address: 0x20021, data: 0x22 },
      { kind: 'read', address: 0x10012, data: 0x33 }, { kind: 'write', address: 0x20022, data: 0x33 },
      { kind: 'read', address: 2, data: 0xf4 },
    ]);
    assert.deepEqual({ si: repMovsb.state.si, di: repMovsb.state.di, cx: repMovsb.state.cx, rep: repMovsb.state.rep, stringByte: repMovsb.state.stringByte }, { si: 0x0013, di: 0x0023, cx: 0, rep: 0, stringByte: 0x33 });
    assert.deepEqual(repMovsb.memory, { 131104: 0x11, 131105: 0x22, 131106: 0x33 });
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, repMovsb.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });

    const repZero = await execute(page, baseUrl, [0xf3, 0xa4, 0xf4], {
      state: { ds: 0x1000, es: 0x2000, si: 0x0010, di: 0x0020, cx: 0 },
    });
    assert.deepEqual(repZero.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
    ]);
    assert.deepEqual({ si: repZero.state.si, di: repZero.state.di, cx: repZero.state.cx, rep: repZero.state.rep }, { si: 0x0010, di: 0x0020, cx: 0, rep: 0 });
    assert.deepEqual(repZero.memory, {});

    const invalidRepTarget = await execute(page, baseUrl, [0xf3, 0xb8, 0x34, 0x12, 0xf4]);
    assert.deepEqual(invalidRepTarget.trace.map(({ address }) => address), [0, 1]);
    assert.equal(invalidRepTarget.state.ip, 2);
    assert.equal(invalidRepTarget.state.halted, 1);
    assert.equal(invalidRepTarget.state.faulted, 1);

    const byteAliases = [
      { register: 'ax', shift: 0 }, { register: 'cx', shift: 0 }, { register: 'dx', shift: 0 }, { register: 'bx', shift: 0 },
      { register: 'ax', shift: 8 }, { register: 'cx', shift: 8 }, { register: 'dx', shift: 8 }, { register: 'bx', shift: 8 },
    ];
    const movRm8RegInitial = { ax: 0x81a1, cx: 0x82b2, dx: 0x83c3, bx: 0x84d4, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 };
    const byteValue = (state, selector) => (state[byteAliases[selector].register] >>> byteAliases[selector].shift) & 0xff;
    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const result = await execute(page, baseUrl, [0x88, 0xc0 | (source << 3) | destination, 0xf4], {
          state: { ...movRm8RegInitial, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
        });
        const expected = { ...movRm8RegInitial };
        const target = byteAliases[destination];
        const mask = 0xff << target.shift;
        expected[target.register] = (expected[target.register] & ~mask) | (byteValue(movRm8RegInitial, source) << target.shift);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
        ]);
        assert.deepEqual(Object.fromEntries(Object.keys(movRm8RegInitial).map((name) => [name, result.state[name]])), expected);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, result.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });
      }
    }

    for (let source = 0; source < 8; source++) {
      const result = await execute(page, baseUrl, [0x88, 0x45 | (source << 3), 0xf9, 0xf4], {
        state: { ...movRm8RegInitial, di: 0x0100, ds: 0x1000, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
      });
      assert.deepEqual(result.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
        { kind: 'read', address: 0, data: 0x88 }, { kind: 'read', address: 1, data: 0x45 | (source << 3) },
        { kind: 'read', address: 2, data: 0xf9 }, { kind: 'write', address: 0x100f9, data: byteValue(movRm8RegInitial, source) },
        { kind: 'read', address: 3, data: 0xf4 },
      ]);
      assert.deepEqual(result.memory, { 65785: byteValue(movRm8RegInitial, source) });
      assert.deepEqual(Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, result.state[name]])), { ...movRm8RegInitial, di: 0x0100 });
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, result.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });
    }

    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...movRm8RegInitial, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 };
        const result = await execute(page, baseUrl, [0x8a, 0xc0 | (destination << 3) | source, 0xf4], { state });
        const expected = { ...movRm8RegInitial };
        const target = byteAliases[destination];
        const mask = 0xff << target.shift;
        expected[target.register] = (expected[target.register] & ~mask) | (byteValue(state, source) << target.shift);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
        ], `${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(Object.keys(movRm8RegInitial).map((name) => [name, result.state[name]])), expected, `${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, result.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 }, `${source}/${destination}`);
        assert.deepEqual(result.memory, {}, `${source}/${destination}`);
      }
    }
    for (let destination = 0; destination < 8; destination++) {
      for (const [name, modrmByte, displacement, physical] of eaCases) {
        const state = { ...movRm8RegInitial, ...eaState, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 };
        const value = 0x20 + destination;
        const result = await execute(page, baseUrl, [0x8a, modrmByte | (destination << 3), ...displacement, 0xf4], { state, placements: [{ address: physical, bytes: [value] }] });
        const target = byteAliases[destination];
        const expectedValue = (state[target.register] & ~(0xff << target.shift)) | (value << target.shift);
        assert.deepEqual(result.trace.filter(({ address }) => address === physical).map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: physical }], `${destination}/${name}`);
        assert.equal(result.state[target.register], expectedValue, `${destination}/${name}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 }, `${destination}/${name}`);
        assert.deepEqual(result.memory, {}, `${destination}/${name}`);
        assert.equal(result.state.faulted, 0, `${destination}/${name}`);
      }
    }

    const xorByteFlags = (result) => ({
      cf: 0,
      pf: Number(result.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
      af: 0,
      zf: Number(result === 0),
      sf: result >>> 7,
      of: 0,
    });
    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...movRm8RegInitial, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1 };
        const result = await execute(page, baseUrl, [0x32, 0xc0 | (destination << 3) | source, 0xf4], { state });
        const value = byteValue(state, destination) ^ byteValue(state, source);
        const target = byteAliases[destination];
        const expected = (state[target.register] & ~(0xff << target.shift)) | (value << target.shift);
        assert.equal(result.state[target.register], expected, `${source}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
        ], `${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), xorByteFlags(value), `${source}/${destination}`);
        assert.deepEqual(result.memory, {}, `${source}/${destination}`);
      }
    }
    for (let destination = 0; destination < 8; destination++) {
      for (const [name, modrmByte, displacement, physical] of eaCases) {
        const state = { ...movRm8RegInitial, ...eaState, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1 };
        const memoryValue = 0x91 + destination;
        const result = await execute(page, baseUrl, [0x32, modrmByte | (destination << 3), ...displacement, 0xf4], { state, placements: [{ address: physical, bytes: [memoryValue] }] });
        const value = byteValue(state, destination) ^ memoryValue;
        const target = byteAliases[destination];
        const expected = (state[target.register] & ~(0xff << target.shift)) | (value << target.shift);
        assert.equal(result.state[target.register], expected, `${destination}/${name}`);
        assert.deepEqual(result.trace.filter(({ address }) => address === physical).map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: physical }], `${destination}/${name}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), xorByteFlags(value), `${destination}/${name}`);
        assert.deepEqual(result.memory, {}, `${destination}/${name}`);
        assert.equal(result.state.faulted, 0, `${destination}/${name}`);
      }
    }

    const orInitial = { ax: 0x8055, cx: 0xff00, dx: 0x7f01, bx: 0x0faa, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 };
    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...orInitial, ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
        const result = await execute(page, baseUrl, [0x0a, 0xc0 | (destination << 3) | source, 0xf4], { state });
        const value = byteValue(state, destination) | byteValue(state, source);
        const target = byteAliases[destination];
        const expected = { ...orInitial, [target.register]: (state[target.register] & ~(0xff << target.shift)) | (value << target.shift) };
        assert.deepEqual(Object.fromEntries(Object.keys(orInitial).map((name) => [name, result.state[name]])), expected, `${source}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
        ], `${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), xorByteFlags(value), `${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['ds', 'ss', 'es', 'if', 'df', 'fdcDor', 'fdcInterrupt'].map((name) => [name, result.state[name]])), { ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1, fdcDor: 0x0c, fdcInterrupt: 1 }, `${source}/${destination}`);
        assert.equal(result.outputs.irq6Request, 1, `${source}/${destination}`);
        assert.deepEqual(result.memory, {}, `${source}/${destination}`);
        assert.equal(result.state.faulted, 0, `${source}/${destination}`);
      }
    }
    const orMemoryRejected = await execute(page, baseUrl, [0x0a, 0x06, 0x00, 0x10]);
    assert.deepEqual(orMemoryRejected.trace.map(({ address }) => address), [0, 1]);
    assert.equal(orMemoryRejected.state.faulted, 1);

    const decValues = [0x00, 0x01, 0x10, 0x80, 0xff, 0x7f, 0x11, 0x81];
    for (const carry of [0, 1]) {
      for (let destination = 0; destination < 8; destination++) {
        const initial = decValues[destination];
        const decremented = (initial - 1) & 0xff;
        const state = { ...movRm8RegInitial, ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1, cf: carry, pf: 0, af: 0, zf: 0, sf: 0, of: 0, fdcDor: 0x0c, fdcInterrupt: 1 };
        const target = byteAliases[destination];
        state[target.register] = (state[target.register] & ~(0xff << target.shift)) | (initial << target.shift);
        const result = await execute(page, baseUrl, [0xfe, 0xc8 | destination, 0xf4], { state });
        const expected = (state[target.register] & ~(0xff << target.shift)) | (decremented << target.shift);
        const expectedRegisters = { ...movRm8RegInitial, [target.register]: expected };
        const expectedFlags = {
          cf: carry,
          pf: Number(decremented.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
          af: Number((initial & 0x0f) === 0),
          zf: Number(decremented === 0),
          sf: decremented >>> 7,
          of: Number(initial === 0x80),
        };
        assert.deepEqual(Object.fromEntries(Object.keys(movRm8RegInitial).map((name) => [name, result.state[name]])), expectedRegisters, `${carry}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
        ], `${carry}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), expectedFlags, `${carry}/${destination}`);
        assert.deepEqual(Object.fromEntries(['ds', 'ss', 'es', 'if', 'df', 'fdcDor', 'fdcInterrupt'].map((name) => [name, result.state[name]])), { ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1, fdcDor: 0x0c, fdcInterrupt: 1 }, `${carry}/${destination}`);
        assert.equal(result.outputs.irq6Request, 1, `${carry}/${destination}`);
        assert.deepEqual(result.memory, {}, `${carry}/${destination}`);
        assert.equal(result.state.faulted, 0, `${carry}/${destination}`);
      }
    }
    for (const selector of [0, 2, 3, 4, 5, 6, 7]) {
      const result = await execute(page, baseUrl, [0xfe, 0xc0 | (selector << 3)]);
      assert.deepEqual(result.trace.map(({ address }) => address), [0, 1], `fe/${selector}`);
      assert.equal(result.state.faulted, 1, `fe/${selector}`);
    }
    const decMemoryRejected = await execute(page, baseUrl, [0xfe, 0x0e, 0x00, 0x10]);
    assert.deepEqual(decMemoryRejected.trace.map(({ address }) => address), [0, 1]);
    assert.equal(decMemoryRejected.state.faulted, 1);

    const shlValues = [0x00, 0x01, 0x7f, 0x80, 0xff, 0x40, 0x81, 0x55];
    for (let destination = 0; destination < 8; destination++) {
      const state = { ...movRm8RegInitial, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 0 };
      const target = byteAliases[destination];
      state[target.register] = (state[target.register] & ~(0xff << target.shift)) | (shlValues[destination] << target.shift);
      const result = await execute(page, baseUrl, [0xd0, 0xe0 | destination, 0xf4], { state });
      const shifted = (shlValues[destination] << 1) & 0xff;
      const expected = (state[target.register] & ~(0xff << target.shift)) | (shifted << target.shift);
      const expectedFlags = {
        cf: shlValues[destination] >>> 7,
        pf: Number(shifted.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
        af: 0,
        zf: Number(shifted === 0),
        sf: shifted >>> 7,
        of: (shifted >>> 7) ^ (shlValues[destination] >>> 7),
      };
      assert.equal(result.state[target.register], expected, `${destination}`);
      assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `${destination}`);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), expectedFlags, `${destination}`);
      assert.deepEqual(result.memory, {}, `${destination}`);
    }
    for (const [name, bytes] of [['selector', [0xd0, 0xc0]], ['memory', [0xd0, 0x26, 0x00, 0x10]]]) {
      const result = await execute(page, baseUrl, bytes);
      assert.deepEqual(result.trace.map(({ address }) => address), [0, 1], name);
      assert.equal(result.state.faulted, 1, name);
    }

    for (const count of [0, 1, 4, 7]) {
      for (let destination = 0; destination < 8; destination++) {
        const initial = (0x81 + destination * 13) & 0xff;
        const state = { ...movRm8RegInitial, cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: destination & 1 };
        const target = byteAliases[destination];
        state[target.register] = (state[target.register] & ~(0xff << target.shift)) | (initial << target.shift);
        const result = await execute(page, baseUrl, [0xc0, 0xc0 | destination, count, 0xf4], { state });
        const effective = count & 7;
        const rotated = effective === 0 ? initial : ((initial << effective) | (initial >>> (8 - effective))) & 0xff;
        const expected = (state[target.register] & ~(0xff << target.shift)) | (rotated << target.shift);
        assert.equal(result.state[target.register], expected, `${count}/${destination}`);
        assert.equal(result.state.cf, effective === 0 ? 1 : rotated & 1, `${count}/${destination}`);
        assert.equal(result.state.of, effective === 1 ? ((rotated >>> 7) ^ (rotated & 1)) : (destination & 1), `${count}/${destination}`);
        assert.deepEqual(Object.fromEntries(['pf', 'af', 'zf', 'sf'].map((flag) => [flag, result.state[flag]])), { pf: 0, af: 1, zf: 1, sf: 1 }, `${count}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 }], `${count}/${destination}`);
      }
    }
    for (const [name, bytes] of [['selector', [0xc0, 0xc8, 0x04]], ['memory', [0xc0, 0x06, 0x00, 0x10, 0x04]]]) {
      const result = await execute(page, baseUrl, bytes);
      assert.deepEqual(result.trace.map(({ address }) => address), [0, 1], name);
      assert.equal(result.state.faulted, 1, name);
    }

    const cmpFlags = (destination, source) => {
      const result = (destination - source) & 0xff;
      return {
        cf: Number(destination < source),
        pf: Number(result.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0),
        af: Number(((destination ^ source ^ result) & 0x10) !== 0),
        zf: Number(result === 0),
        sf: result >>> 7,
        of: Number(((destination ^ source) & (destination ^ result) & 0x80) !== 0),
      };
    };
    const cmpInitial = { ax: 0xff00, cx: 0x1001, dx: 0x0f7f, bx: 0x5580, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888 };
    const architecturalKeys = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'cs', 'ds', 'ss', 'es', 'if', 'df', 'rep'];
    const architecturalState = (state) => Object.fromEntries(architecturalKeys.map((name) => [name, state[name] ?? 0]));
    const cmpImmediateValues = [0x01, 0x10, 0x7f, 0x80, 0xff, 0x0f, 0x55, 0xaa];
    for (let destination = 0; destination < 8; destination++) {
      const immediate = cmpImmediateValues[destination];
      const state = { ...cmpInitial, ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1 };
      const result = await execute(page, baseUrl, [0x80, 0xf8 | destination, immediate, 0xf4], { state });
      assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      ], `80/${destination}`);
      assert.deepEqual(architecturalState(result.state), architecturalState(state), `80/${destination}`);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), cmpFlags(byteValue(state, destination), immediate), `80/${destination}`);
      assert.deepEqual(result.memory, {}, `80/${destination}`);
      assert.equal(result.state.faulted, 0, `80/${destination}`);
    }
    const subImmediateValues = [0x01, 0x01, 0xff, 0x01, 0xff, 0x11, 0x10, 0xaa];
    for (let destination = 0; destination < 8; destination++) {
      const immediate = subImmediateValues[destination];
      const state = { ...cmpInitial, ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
      const result = await execute(page, baseUrl, [0x80, 0xe8 | destination, immediate, 0xf4], { state });
      const target = byteAliases[destination];
      const subtracted = (byteValue(state, destination) - immediate) & 0xff;
      const expected = { ...state, [target.register]: (state[target.register] & ~(0xff << target.shift)) | (subtracted << target.shift) };
      assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      ], `80/5/${destination}`);
      assert.deepEqual(architecturalState(result.state), architecturalState(expected), `80/5/${destination}`);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), cmpFlags(byteValue(state, destination), immediate), `80/5/${destination}`);
      assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((name) => [name, result.state[name]])), { fdcDor: 0x0c, fdcInterrupt: 1 }, `80/5/${destination}`);
      assert.equal(result.outputs.irq6Request, 1, `80/5/${destination}`);
      assert.deepEqual(result.memory, {}, `80/5/${destination}`);
      assert.equal(result.state.faulted, 0, `80/5/${destination}`);
    }
    for (const selector of [0, 1, 2, 3, 4, 6]) {
      const result = await execute(page, baseUrl, [0x80, 0xc0 | (selector << 3), 0x01]);
      assert.deepEqual(result.trace.map(({ address }) => address), [0, 1], `selector/${selector}`);
      assert.equal(result.state.faulted, 1, `selector/${selector}`);
    }
    for (const selector of [0, 2, 3, 5, 6, 7]) {
      const result = await execute(page, baseUrl, [0x80, 0x06 | (selector << 3), 0x00, 0x10, 0x01]);
      assert.deepEqual(result.trace.map(({ address }) => address), [0, 1], `memory-selector/${selector}`);
      assert.equal(result.state.faulted, 1, `memory-selector/${selector}`);
    }

    const testFlags = (destination, immediate) => {
      const result = destination & immediate;
      return { cf: 0, pf: Number(result.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0), af: 0, zf: Number(result === 0), sf: result >>> 7, of: 0 };
    };
    const biosTestState = { ...cmpInitial, ds: 0, ss: 0x2222, es: 0x3333, if: 1, df: 1, cf: 1, pf: 1, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
    const biosTest = await execute(page, baseUrl, [0xf6, 0x06, 0x3e, 0x00, 0x80, 0xf4], {
      state: biosTestState, placements: [{ address: 0x003e, bytes: [0x90] }],
    });
    assert.deepEqual(biosTest.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      { kind: 'read', address: 4 }, { kind: 'read', address: 0x003e }, { kind: 'read', address: 5 },
    ]);
    assert.deepEqual(architecturalState(biosTest.state), architecturalState(biosTestState));
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, biosTest.state[flag]])), testFlags(0x90, 0x80));
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((name) => [name, biosTest.state[name]])), { fdcDor: 0x0c, fdcInterrupt: 1 });
    assert.equal(biosTest.outputs.irq6Request, 1);
    assert.deepEqual(biosTest.memory, {});
    assert.equal(biosTest.state.faulted, 0);

    const testMemoryValues = [0x00, 0x01, 0x7f, 0x80, 0xff, 0x10, 0x0f, 0x55];
    const testImmediateValues = [0xff, 0x01, 0x80, 0x7f, 0x0f, 0xf0, 0x55, 0xaa];
    for (const [destination, [name, modrmByte, displacement, physical]] of eaCases.entries()) {
      const immediate = testImmediateValues[destination];
      const state = { ...cmpInitial, ...eaState, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
      const result = await execute(page, baseUrl, [0xf6, modrmByte, ...displacement, immediate, 0xf4], {
        state, placements: [{ address: physical, bytes: [testMemoryValues[destination]] }],
      });
      assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
        ...displacement.map((_, index) => ({ kind: 'read', address: 2 + index })),
        { kind: 'read', address: 2 + displacement.length }, { kind: 'read', address: physical }, { kind: 'read', address: 3 + displacement.length },
      ], name);
      assert.deepEqual(architecturalState(result.state), architecturalState(state), name);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), testFlags(testMemoryValues[destination], immediate), name);
      assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((key) => [key, result.state[key]])), { fdcDor: 0x0c, fdcInterrupt: 1 }, name);
      assert.equal(result.outputs.irq6Request, 1, name);
      assert.deepEqual(result.memory, {}, name);
      assert.equal(result.state.faulted, 0, name);
    }
    for (const selector of [1, 2, 3, 4, 5, 6, 7]) {
      const result = await execute(page, baseUrl, [0xf6, 0x06 | (selector << 3), 0x3e, 0x00, 0x80]);
      assert.deepEqual(result.trace.map(({ address }) => address), [0, 1], `f6/selector/${selector}`);
      assert.equal(result.state.faulted, 1, `f6/selector/${selector}`);
    }
    const testRegister = await execute(page, baseUrl, [0xf6, 0xc0, 0x80]);
    assert.deepEqual(testRegister.trace.map(({ address }) => address), [0, 1]);
    assert.equal(testRegister.state.faulted, 1);

    const biosAndState = { ...cmpInitial, ds: 0, ss: 0x2222, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
    const biosAnd = await execute(page, baseUrl, [0x80, 0x26, 0x3e, 0x00, 0x7f, 0xf4], {
      state: biosAndState, placements: [{ address: 0x003e, bytes: [0xff] }],
    });
    assert.deepEqual(biosAnd.trace.map(({ kind, address, data }) => ({ kind, address, ...(kind === 'write' ? { data } : {}) })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      { kind: 'read', address: 4 }, { kind: 'read', address: 0x003e }, { kind: 'write', address: 0x003e, data: 0x7f }, { kind: 'read', address: 5 },
    ]);
    assert.deepEqual(architecturalState(biosAnd.state), architecturalState(biosAndState));
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, biosAnd.state[flag]])), testFlags(0xff, 0x7f));
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((name) => [name, biosAnd.state[name]])), { fdcDor: 0x0c, fdcInterrupt: 1 });
    assert.equal(biosAnd.outputs.irq6Request, 1);
    assert.deepEqual(biosAnd.memory, { 62: 0x7f });
    assert.equal(biosAnd.state.faulted, 0);

    const andMemoryValues = [0x00, 0x01, 0x7f, 0x80, 0xff, 0x10, 0x0f, 0x55];
    const andImmediateValues = [0xff, 0x00, 0x80, 0x7f, 0x0f, 0xf0, 0x55, 0xaa];
    for (const [destination, [name, modrmByte, displacement, physical]] of eaCases.entries()) {
      const immediate = andImmediateValues[destination];
      const expected = andMemoryValues[destination] & immediate;
      const state = { ...cmpInitial, ...eaState, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
      const result = await execute(page, baseUrl, [0x80, modrmByte | 0x20, ...displacement, immediate, 0xf4], {
        state, placements: [{ address: physical, bytes: [andMemoryValues[destination]] }],
      });
      assert.deepEqual(result.trace.map(({ kind, address, data }) => ({ kind, address, ...(kind === 'write' ? { data } : {}) })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
        ...displacement.map((_, index) => ({ kind: 'read', address: 2 + index })),
        { kind: 'read', address: 2 + displacement.length }, { kind: 'read', address: physical }, { kind: 'write', address: physical, data: expected }, { kind: 'read', address: 3 + displacement.length },
      ], `and/${name}`);
      assert.deepEqual(architecturalState(result.state), architecturalState(state), `and/${name}`);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), testFlags(andMemoryValues[destination], immediate), `and/${name}`);
      assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((key) => [key, result.state[key]])), { fdcDor: 0x0c, fdcInterrupt: 1 }, `and/${name}`);
      assert.equal(result.outputs.irq6Request, 1, `and/${name}`);
      assert.deepEqual(result.memory, { [physical]: expected }, `and/${name}`);
      assert.equal(result.state.faulted, 0, `and/${name}`);
    }

    const andRegister = await execute(page, baseUrl, [0x80, 0xe0, 0x7f]);
    assert.deepEqual(andRegister.trace.map(({ address }) => address), [0, 1]);
    assert.equal(andRegister.state.faulted, 1);

    const orFlags = (destination, immediate) => {
      const result = destination | immediate;
      return { cf: 0, pf: Number(result.toString(2).split('').filter((bit) => bit === '1').length % 2 === 0), af: 0, zf: Number(result === 0), sf: result >>> 7, of: 0 };
    };
    const biosOrState = { ...cmpInitial, ds: 0x0040, ss: 0x2222, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
    const biosOr = await execute(page, baseUrl, [0x80, 0x0e, 0x41, 0x00, 0x80, 0xf4], {
      state: biosOrState, placements: [{ address: 0x0441, bytes: [0x00] }],
    });
    assert.deepEqual(biosOr.trace.map(({ kind, address, data }) => ({ kind, address, ...(kind === 'write' ? { data } : {}) })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      { kind: 'read', address: 4 }, { kind: 'read', address: 0x0441 }, { kind: 'write', address: 0x0441, data: 0x80 }, { kind: 'read', address: 5 },
    ]);
    assert.deepEqual(architecturalState(biosOr.state), architecturalState(biosOrState));
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, biosOr.state[flag]])), orFlags(0x00, 0x80));
    assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((name) => [name, biosOr.state[name]])), { fdcDor: 0x0c, fdcInterrupt: 1 });
    assert.equal(biosOr.outputs.irq6Request, 1);
    assert.deepEqual(biosOr.memory, { 1089: 0x80 });
    assert.equal(biosOr.state.faulted, 0);

    const orMemoryValues = [0x00, 0x01, 0x7f, 0x80, 0xff, 0x10, 0x0f, 0x55];
    const orImmediateValues = [0x00, 0x80, 0x01, 0x7f, 0x0f, 0xf0, 0x55, 0xaa];
    for (const [destination, [name, modrmByte, displacement, physical]] of eaCases.entries()) {
      const immediate = orImmediateValues[destination];
      const expected = orMemoryValues[destination] | immediate;
      const state = { ...cmpInitial, ...eaState, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 1, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1 };
      const result = await execute(page, baseUrl, [0x80, modrmByte | 0x08, ...displacement, immediate, 0xf4], {
        state, placements: [{ address: physical, bytes: [orMemoryValues[destination]] }],
      });
      assert.deepEqual(result.trace.map(({ kind, address, data }) => ({ kind, address, ...(kind === 'write' ? { data } : {}) })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
        ...displacement.map((_, index) => ({ kind: 'read', address: 2 + index })),
        { kind: 'read', address: 2 + displacement.length }, { kind: 'read', address: physical }, { kind: 'write', address: physical, data: expected }, { kind: 'read', address: 3 + displacement.length },
      ], name);
      assert.deepEqual(architecturalState(result.state), architecturalState(state), name);
      assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), orFlags(orMemoryValues[destination], immediate), name);
      assert.deepEqual(Object.fromEntries(['fdcDor', 'fdcInterrupt'].map((key) => [key, result.state[key]])), { fdcDor: 0x0c, fdcInterrupt: 1 }, name);
      assert.equal(result.outputs.irq6Request, 1, name);
      assert.deepEqual(result.memory, { [physical]: expected }, name);
      assert.equal(result.state.faulted, 0, name);
    }

    const csOr = await execute(page, baseUrl, [0x2e, 0x80, 0x0e, 0x41, 0x00, 0x20, 0xf4], {
      state: { ...biosOrState, cs: 0, ds: 0x0040 },
      placements: [{ address: 0x0041, bytes: [0x01] }, { address: 0x0441, bytes: [0x02] }],
    });
    assert.deepEqual(csOr.trace.map(({ kind, address, data }) => ({ kind, address, ...(kind === 'write' ? { data } : {}) })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 }, { kind: 'read', address: 4 },
      { kind: 'read', address: 5 }, { kind: 'read', address: 0x0041 }, { kind: 'write', address: 0x0041, data: 0x21 }, { kind: 'read', address: 6 },
    ]);
    assert.deepEqual(csOr.memory, { 65: 0x21 });
    assert.equal(csOr.state.csOverride, 0);
    assert.equal(csOr.state.faulted, 0);

    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...cmpInitial, ds: 0x1111, ss: 0x2222, es: 0x3333, tf: 1, if: 1, df: 1, iopl: 3, nt: 1, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 0, fdcDor: 0x0c, fdcInterrupt: 1 };
        const result = await execute(page, baseUrl, [0x2a, 0xc0 | (destination << 3) | source, 0xf4], { state });
        const target = byteAliases[destination];
        const value = (byteValue(state, destination) - byteValue(state, source)) & 0xff;
        const expected = { ...cmpInitial, [target.register]: (state[target.register] & ~(0xff << target.shift)) | (value << target.shift) };
        assert.deepEqual(Object.fromEntries(Object.keys(cmpInitial).map((name) => [name, result.state[name]])), expected, `sub8 ${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'].map((name) => [name, result.state[name]])), { ds: 0x1111, ss: 0x2222, es: 0x3333, tf: 1, if: 1, df: 1, iopl: 3, nt: 1, fdcDor: 0x0c, fdcInterrupt: 1 }, `sub8 collateral ${source}/${destination}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, result.state[name]])), cmpFlags(byteValue(state, destination), byteValue(state, source)), `sub8 flags ${source}/${destination}`);
        assert.equal(result.outputs.irq6Request, 1, `sub8 irq ${source}/${destination}`);
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `sub8 trace ${source}/${destination}`);
        assert.deepEqual(result.memory, {}, `sub8 memory ${source}/${destination}`);
        assert.equal(result.state.faulted, 0, `sub8 fault ${source}/${destination}`);
      }
    }
    const subRegRm8MemoryRejected = await execute(page, baseUrl, [0x2a, 0x06, 0x00, 0x10]);
    assert.deepEqual(subRegRm8MemoryRejected.trace.map(({ address }) => address), [0, 1]);
    assert.equal(subRegRm8MemoryRejected.state.faulted, 1);

    for (let source = 0; source < 8; source++) {
      for (let destination = 0; destination < 8; destination++) {
        const state = { ...cmpInitial, ds: 0x1111, ss: 0x2222, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 0 };
        const result = await execute(page, baseUrl, [0x38, 0xc0 | (source << 3) | destination, 0xf4], { state });
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
        ]);
        assert.deepEqual(architecturalState(result.state), architecturalState(state));
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, result.state[name]])), cmpFlags(byteValue(cmpInitial, destination), byteValue(cmpInitial, source)));
        assert.deepEqual(result.memory, {});
        assert.equal(result.state.faulted, 0);
      }
    }

    const cmpMemoryValues = [0x00, 0x01, 0x7f, 0x80, 0xff, 0x10, 0x0f, 0x55];
    for (const [destination, [name, modrmByte, displacement, physical]] of eaCases.entries()) {
      for (let source = 0; source < 8; source++) {
        const state = { ...cmpInitial, ...eaState, es: 0x3333, if: 1, df: 1, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 0 };
        const result = await execute(page, baseUrl, [0x38, modrmByte | (source << 3), ...displacement, 0xf4], {
          state,
          placements: [{ address: physical, bytes: [cmpMemoryValues[destination]] }],
        });
        assert.deepEqual(result.trace.map(({ kind, address }) => ({ kind, address })), [
          { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
          ...displacement.map((_, index) => ({ kind: 'read', address: 2 + index })),
          { kind: 'read', address: physical }, { kind: 'read', address: 2 + displacement.length },
        ], `${name}/${source}`);
        assert.deepEqual(architecturalState(result.state), architecturalState(state), `${name}/${source}`);
        assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, result.state[flag]])), cmpFlags(cmpMemoryValues[destination], byteValue(state, source)), `${name}/${source}`);
        assert.deepEqual(result.memory, {}, `${name}/${source}`);
        assert.equal(result.state.faulted, 0, `${name}/${source}`);
      }
    }

    const cmpNegativeDisp8 = await execute(page, baseUrl, [0x38, 0x7e, 0xfe, 0xf4], {
      state: { ...cmpInitial, bx: 0xaa00, bp: 0x0200, ss: 0x2000 },
      placements: [{ address: 0x201fe, bytes: [0x2a] }],
    });
    assert.deepEqual(cmpNegativeDisp8.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
      { kind: 'read', address: 0x201fe }, { kind: 'read', address: 3 },
    ]);
    assert.deepEqual(architecturalState(cmpNegativeDisp8.state), architecturalState({ ...cmpInitial, bx: 0xaa00, bp: 0x0200, ss: 0x2000 }));
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, cmpNegativeDisp8.state[flag]])), cmpFlags(0x2a, 0xaa));
    assert.deepEqual(cmpNegativeDisp8.memory, {});

    const cmpDisp16 = await execute(page, baseUrl, [0x38, 0xa8, 0x00, 0x01, 0xf4], {
      state: { ...cmpInitial, bx: 0x0100, si: 0x0010, cx: 0x1001, ds: 0x1000 },
      placements: [{ address: 0x10210, bytes: [0x10] }],
    });
    assert.deepEqual(cmpDisp16.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      { kind: 'read', address: 0x10210 }, { kind: 'read', address: 4 },
    ]);
    assert.deepEqual(architecturalState(cmpDisp16.state), architecturalState({ ...cmpInitial, bx: 0x0100, si: 0x0010, cx: 0x1001, ds: 0x1000 }));
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((flag) => [flag, cmpDisp16.state[flag]])), cmpFlags(0x10, 0x10));
    assert.deepEqual(cmpDisp16.memory, {});

    const movRm8RegBp = await execute(page, baseUrl, [0x88, 0x7e, 0xf9, 0xf4], {
      state: { ...movRm8RegInitial, bp: 0x0100, ds: 0x1000, ss: 0x2000 },
    });
    assert.deepEqual(movRm8RegBp.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0x88 }, { kind: 'read', address: 1, data: 0x7e },
      { kind: 'read', address: 2, data: 0xf9 }, { kind: 'write', address: 0x200f9, data: 0x84 },
      { kind: 'read', address: 3, data: 0xf4 },
    ]);
    assert.deepEqual(movRm8RegBp.memory, { 131321: 0x84 });

    const movRm8RegisterProgram = [
      0xc6, 0xc0, 0x10, 0xc6, 0xc1, 0x11, 0xc6, 0xc2, 0x12, 0xc6, 0xc3, 0x13,
      0xc6, 0xc4, 0x14, 0xc6, 0xc5, 0x15, 0xc6, 0xc6, 0x16, 0xc6, 0xc7, 0x17, 0xf4,
    ];
    const movRm8Registers = await execute(page, baseUrl, movRm8RegisterProgram, {
      state: { ax: 0xaabb, cx: 0xccdd, dx: 0xeeff, bx: 0x1234, sp: 0x5678, bp: 0x9abc, si: 0xdef0, di: 0x1357, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
    });
    assert.deepEqual(movRm8Registers.trace.map(({ kind, address }) => ({ kind, address })), movRm8RegisterProgram.map((_, address) => ({ kind: 'read', address })));
    assert.deepEqual(
      Object.fromEntries(['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'].map((name) => [name, movRm8Registers.state[name]])),
      { ax: 0x1410, cx: 0x1511, dx: 0x1612, bx: 0x1713, sp: 0x5678, bp: 0x9abc, si: 0xdef0, di: 0x1357 },
    );
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, movRm8Registers.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });

    const movRm8LowOnly = await execute(page, baseUrl, [0xc6, 0xc1, 0x2a, 0xf4], { state: { cx: 0xab00 } });
    assert.equal(movRm8LowOnly.state.cx, 0xab2a);
    const movRm8HighOnly = await execute(page, baseUrl, [0xc6, 0xc5, 0x2b, 0xf4], { state: { cx: 0x0034 } });
    assert.equal(movRm8HighOnly.state.cx, 0x2b34);

    const movRm8Memory = await execute(page, baseUrl, [0xc6, 0x45, 0xfe, 0x0f, 0xf4], {
      state: { di: 0x0100, ds: 0x1000, cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 },
    });
    assert.deepEqual(movRm8Memory.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xc6 }, { kind: 'read', address: 1, data: 0x45 },
      { kind: 'read', address: 2, data: 0xfe }, { kind: 'read', address: 3, data: 0x0f },
      { kind: 'write', address: 0x100fe, data: 0x0f }, { kind: 'read', address: 4, data: 0xf4 },
    ]);
    assert.deepEqual(movRm8Memory.memory, { 65790: 0x0f });
    assert.equal(movRm8Memory.state.byteImmediate, 0x0f);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, movRm8Memory.state[name]])), { cf: 1, pf: 1, af: 1, zf: 1, sf: 1, of: 1 });

    const movRm8Bp = await execute(page, baseUrl, [0xc6, 0x46, 0xfe, 0xaa, 0xf4], {
      state: { bp: 0x0200, ss: 0x2000, ds: 0x1000 },
    });
    assert.deepEqual(movRm8Bp.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
      { kind: 'read', address: 3 }, { kind: 'write', address: 0x201fe }, { kind: 'read', address: 4 },
    ]);
    assert.deepEqual(movRm8Bp.memory, { 131582: 0xaa });

    const movRm8Direct = await execute(page, baseUrl, [0xc6, 0x06, 0x34, 0x12, 0x55, 0xf4], { state: { ds: 0x1000 } });
    assert.deepEqual(movRm8Direct.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
      { kind: 'read', address: 3 }, { kind: 'read', address: 4 }, { kind: 'write', address: 0x11234 },
      { kind: 'read', address: 5 },
    ]);
    assert.deepEqual(movRm8Direct.memory, { 70196: 0x55 });

    const invalidMovRm8Selector = await execute(page, baseUrl, [0xc6, 0x4d, 0xfe, 0x99, 0xf4], { state: { di: 0x0100, ds: 0x1000 } });
    assert.deepEqual(invalidMovRm8Selector.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 },
    ]);
    assert.equal(invalidMovRm8Selector.state.ip, 2);
    assert.equal(invalidMovRm8Selector.state.halted, 1);
    assert.equal(invalidMovRm8Selector.state.faulted, 1);
    assert.deepEqual(invalidMovRm8Selector.memory, {});

    const manifest = await page.evaluate(() => fetch('/generated/cpu16.manifest.json').then((response) => response.json()));
    assert.deepEqual(Object.keys(manifest.aliases), ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh']);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
