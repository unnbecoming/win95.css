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

test('AB STOSW writes a wrapped little-endian word and commits DI atomically', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const initial = {
        ax: 0xb8a7, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x1234, di: 0xffff,
        ds: 0x1000, ss: 0x2000, es: 0x1000, if: 1, tf: 1, df: 0, iopl: 3, nt: 1,
        cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, { state = {}, steps = 24 } = {}) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...initial, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        const machine = new ByteBusMachine(chip, memory);
        const snapshots = [];
        for (let index = 0; index < steps && !chip.state().halted; index++) {
          machine.step();
          snapshots.push({ state: chip.state(), low: memory[0x1ffff], high: memory[0x10000] });
        }
        return { state: chip.state(), outputs: chip.outputs(), trace: machine.trace, snapshots, low: memory[0x1ffff], high: memory[0x10000] };
      };
      const forward = execute([0xab, 0xf4]);
      const backward = execute([0xab, 0xf4], { state: { ax: 0x3412, es: 0x4000, di: 0, df: 1 } });
      const atomic = execute([0xab, 0xf4], { steps: 3 });
      const repZero = execute([0xf3, 0xab, 0xf4], { state: { cx: 0 } });
      const repThree = execute([0xf3, 0xab, 0xf4], { state: { ax: 0x3412, cx: 3, es: 0x2000, di: 0x20 } });
      const csOverride = execute([0x2e, 0xab, 0xf4]);
      return { initial, forward, backward, atomic, repZero, repThree, csOverride };
    });
    const preserved = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'ds', 'ss', 'es', 'if', 'tf', 'df', 'iopl', 'nt', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'];
    assert.deepEqual(results.forward.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xab },
      { kind: 'write', address: 0x1ffff, data: 0xa7 },
      { kind: 'write', address: 0x10000, data: 0xb8 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.equal(results.forward.state.di, 1);
    assert.deepEqual(Object.fromEntries(preserved.map((name) => [name, results.forward.state[name]])), Object.fromEntries(preserved.map((name) => [name, results.initial[name]])));
    assert.deepEqual({ low: results.forward.low, high: results.forward.high }, { low: 0xa7, high: 0xb8 });
    assert.equal(results.forward.outputs.irq6Request, 1);
    assert.equal(results.forward.state.faulted, 0);
    assert.deepEqual(results.backward.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xab },
      { kind: 'write', address: 0x40000, data: 0x12 },
      { kind: 'write', address: 0x40001, data: 0x34 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.deepEqual({ ax: results.backward.state.ax, di: results.backward.state.di, df: results.backward.state.df }, { ax: 0x3412, di: 0xfffe, df: 1 });
    assert.deepEqual(results.atomic.snapshots.map(({ state, low, high }) => ({ di: state.di, ip: state.ip, phase: state.phase, low, high })), [
      { di: 0xffff, ip: 1, phase: 14, low: 0, high: 0 },
      { di: 0xffff, ip: 1, phase: 15, low: 0xa7, high: 0 },
      { di: 1, ip: 1, phase: 0, low: 0xa7, high: 0xb8 },
    ]);
    assert.deepEqual(results.repZero.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
    ]);
    assert.deepEqual({ ax: results.repZero.state.ax, cx: results.repZero.state.cx, di: results.repZero.state.di, rep: results.repZero.state.rep, faulted: results.repZero.state.faulted }, { ax: results.initial.ax, cx: 0, di: results.initial.di, rep: 0, faulted: 0 });
    assert.equal(results.repZero.trace.some(({ kind }) => kind === 'write'), false);
    assert.deepEqual(results.repThree.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xf3 }, { kind: 'read', address: 1, data: 0xab },
      { kind: 'write', address: 0x20020, data: 0x12 }, { kind: 'write', address: 0x20021, data: 0x34 },
      { kind: 'write', address: 0x20022, data: 0x12 }, { kind: 'write', address: 0x20023, data: 0x34 },
      { kind: 'write', address: 0x20024, data: 0x12 }, { kind: 'write', address: 0x20025, data: 0x34 },
      { kind: 'read', address: 2, data: 0xf4 },
    ]);
    assert.deepEqual({ ax: results.repThree.state.ax, cx: results.repThree.state.cx, di: results.repThree.state.di, rep: results.repThree.state.rep, cf: results.repThree.state.cf, zf: results.repThree.state.zf, faulted: results.repThree.state.faulted }, { ax: 0x3412, cx: 0, di: 0x26, rep: 0, cf: results.initial.cf, zf: results.initial.zf, faulted: 0 });
    assert.deepEqual(results.csOverride.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }]);
    assert.equal(results.csOverride.state.faulted, 1);
    assert.deepEqual({ ax: results.csOverride.state.ax, di: results.csOverride.state.di }, { ax: results.initial.ax, di: results.initial.di });
    assert.equal(results.csOverride.trace.some(({ kind }) => kind === 'write'), false);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('AA STOSB writes AL to ES:DI and commits byte string state atomically', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const initial = {
        ax: 0xb844, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x1234, di: 0xffff,
        ds: 0x3000, ss: 0x2000, es: 0x1000, if: 1, tf: 1, df: 0, iopl: 3, nt: 1,
        cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, { state = {}, steps = 24, watch = [] } = {}) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...initial, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        const machine = new ByteBusMachine(chip, memory);
        const snapshots = [];
        for (let index = 0; index < steps && !chip.state().halted; index++) {
          machine.step();
          snapshots.push({ state: chip.state(), memory: Object.fromEntries(watch.map((address) => [address, memory[address]])) });
        }
        return { state: chip.state(), outputs: chip.outputs(), trace: machine.trace, snapshots, memory: Object.fromEntries(watch.map((address) => [address, memory[address]])) };
      };
      const forward = execute([0xaa, 0xf4], { watch: [0x1ffff, 0x10000] });
      const backward = execute([0xaa, 0xf4], { state: { ax: 0x7e12, es: 0x4000, di: 0, df: 1 }, watch: [0x40000] });
      const atomic = execute([0xaa, 0xf4], { steps: 2, watch: [0x1ffff] });
      const repZero = execute([0xf3, 0xaa, 0xf4], { state: { cx: 0 }, watch: [0x1ffff] });
      const repThree = execute([0xf3, 0xaa, 0xf4], { state: { ax: 0x3412, cx: 3, es: 0x2000, di: 0x20 }, watch: [0x20020, 0x20021, 0x20022] });
      const csOverride = execute([0x2e, 0xaa, 0xf4], { watch: [0x1ffff] });
      const lockPrefix = execute([0xf0, 0xaa, 0xf4], { watch: [0x1ffff] });
      const authentic = execute([0xaa, 0xf4], { state: { ax: 0x0044, cx: 1, di: 0, es: 0xb800, df: 0 }, watch: [0xb8000] });
      return { initial, forward, backward, atomic, repZero, repThree, csOverride, lockPrefix, authentic };
    });
    const preserved = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'ds', 'ss', 'es', 'if', 'tf', 'df', 'iopl', 'nt', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'];
    assert.deepEqual(results.forward.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xaa },
      { kind: 'write', address: 0x1ffff, data: 0x44 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.equal(results.forward.state.di, 0);
    assert.deepEqual(Object.fromEntries(preserved.map((name) => [name, results.forward.state[name]])), Object.fromEntries(preserved.map((name) => [name, results.initial[name]])));
    assert.deepEqual(results.forward.memory, { 65536: 0, 131071: 0x44 });
    assert.equal(results.forward.outputs.irq6Request, 1);
    assert.equal(results.forward.state.faulted, 0);
    assert.deepEqual(results.backward.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xaa },
      { kind: 'write', address: 0x40000, data: 0x12 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.deepEqual({ ax: results.backward.state.ax, di: results.backward.state.di, df: results.backward.state.df }, { ax: 0x7e12, di: 0xffff, df: 1 });
    assert.deepEqual(results.atomic.snapshots.map(({ state, memory }) => ({ di: state.di, ip: state.ip, phase: state.phase, byte: memory[131071] })), [
      { di: 0xffff, ip: 1, phase: 14, byte: 0 },
      { di: 0, ip: 1, phase: 0, byte: 0x44 },
    ]);
    assert.deepEqual(results.repZero.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 },
    ]);
    assert.deepEqual({ cx: results.repZero.state.cx, di: results.repZero.state.di, rep: results.repZero.state.rep, faulted: results.repZero.state.faulted }, { cx: 0, di: results.initial.di, rep: 0, faulted: 0 });
    assert.equal(results.repZero.trace.some(({ kind }) => kind === 'write'), false);
    assert.deepEqual(results.repThree.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xf3 }, { kind: 'read', address: 1, data: 0xaa },
      { kind: 'write', address: 0x20020, data: 0x12 }, { kind: 'write', address: 0x20021, data: 0x12 },
      { kind: 'write', address: 0x20022, data: 0x12 }, { kind: 'read', address: 2, data: 0xf4 },
    ]);
    assert.deepEqual({ ax: results.repThree.state.ax, cx: results.repThree.state.cx, di: results.repThree.state.di, rep: results.repThree.state.rep, cf: results.repThree.state.cf, zf: results.repThree.state.zf, faulted: results.repThree.state.faulted }, { ax: 0x3412, cx: 0, di: 0x23, rep: 0, cf: results.initial.cf, zf: results.initial.zf, faulted: 0 });
    for (const invalid of [results.csOverride, results.lockPrefix]) {
      assert.equal(invalid.state.faulted, 1);
      assert.equal(invalid.trace.some(({ kind }) => kind === 'write'), false);
      assert.deepEqual({ ax: invalid.state.ax, di: invalid.state.di }, { ax: results.initial.ax, di: results.initial.di });
    }
    assert.deepEqual(results.authentic.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xaa }, { kind: 'write', address: 0xb8000, data: 0x44 }, { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.deepEqual({ ax: results.authentic.state.ax, cx: results.authentic.state.cx, di: results.authentic.state.di, es: results.authentic.state.es, df: results.authentic.state.df, byte: results.authentic.memory[753664], faulted: results.authentic.state.faulted }, { ax: 0x0044, cx: 1, di: 1, es: 0xb800, df: 0, byte: 0x44, faulted: 0 });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
