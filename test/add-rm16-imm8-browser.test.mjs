import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];

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

function parity8(value) {
  let ones = 0;
  for (let bit = 0; bit < 8; bit++) ones += (value >> bit) & 1;
  return ones % 2 === 0 ? 1 : 0;
}

function add16(destination, immediate) {
  const source = immediate & 0x80 ? immediate | 0xff00 : immediate;
  const full = destination + source;
  const result = full & 0xffff;
  return {
    result,
    flags: {
      cf: full > 0xffff ? 1 : 0,
      pf: parity8(result),
      af: (destination & 0xf) + (source & 0xf) > 0xf ? 1 : 0,
      zf: result === 0 ? 1 : 0,
      sf: (result >> 15) & 1,
      of: (~(destination ^ source) & (destination ^ result) & 0x8000) !== 0 ? 1 : 0,
    },
  };
}

test('83 /0 ADD r16,imm8 sign-extends, writes one GPR, and updates arithmetic flags', async () => {
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
        ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0x7777, di: 0x8888,
        ds: 0x1000, ss: 0x2000, es: 0x3000, if: 1, df: 1, rep: 0,
        cf: 0, pf: 0, af: 0, zf: 0, sf: 0, of: 0, fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, state = {}) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...initial, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        const run = new ByteBusMachine(chip, memory).run(24);
        return { state: run.state, outputs: chip.outputs(), trace: run.trace, writes: run.trace.filter(({ kind }) => kind === 'write') };
      };
      const cases = [
        { register: 'ax', value: 0x7fff, immediate: 0x01 },
        { register: 'cx', value: 0xffff, immediate: 0x01 },
        { register: 'dx', value: 0x0000, immediate: 0xff },
        { register: 'bx', value: 0x0080, immediate: 0x80 },
        { register: 'sp', value: 0x8000, immediate: 0xff },
        { register: 'bp', value: 0x000f, immediate: 0x01 },
        { register: 'si', value: 0x1234, immediate: 0x7f },
        { register: 'di', value: 0x0001, immediate: 0xff },
      ].map(({ register, value, immediate }, index) => ({ register, value, immediate, run: execute([0x83, 0xc0 | index, immediate, 0xf4], { [register]: value }) }));
      const invalidSelectors = Array.from({ length: 6 }, (_, offset) => offset + 1).map((selector) => ({ selector, run: execute([0x83, 0xc0 | (selector << 3), 0x01, 0xf4]) }));
      const memory = execute([0x83, 0x06, 0x34, 0x12, 0x01, 0xf4]);
      const compare = execute([0x83, 0xf8, 0x30, 0xf4], { ax: 0x0030, cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1 });
      return { initial, cases, invalidSelectors, memory, compare };
    });
    const collateral = ['ds', 'ss', 'es', 'if', 'df', 'rep', 'fdcDor', 'fdcInterrupt'];
    for (const { register, value, immediate, run } of results.cases) {
      const expected = add16(value, immediate);
      const expectedRegisters = { ...Object.fromEntries(registers.map((name) => [name, results.initial[name]])), [register]: expected.result };
      assert.deepEqual(Object.fromEntries(registers.map((name) => [name, run.state[name]])), expectedRegisters, register);
      assert.deepEqual(Object.fromEntries(Object.keys(expected.flags).map((name) => [name, run.state[name]])), expected.flags, register);
      assert.deepEqual(Object.fromEntries(collateral.map((name) => [name, run.state[name]])), Object.fromEntries(collateral.map((name) => [name, results.initial[name]])), register);
      assert.deepEqual(run.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
      ], register);
      assert.deepEqual(run.writes, [], register);
      assert.equal(run.outputs.irq6Request, 1, register);
      assert.equal(run.state.faulted, 0, register);
    }
    const preservedOnReject = [...registers, 'ds', 'ss', 'es', 'if', 'df', 'rep', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'];
    for (const { selector, run } of results.invalidSelectors) {
      assert.deepEqual(run.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }], `selector /${selector}`);
      assert.deepEqual(Object.fromEntries(preservedOnReject.map((name) => [name, run.state[name]])), Object.fromEntries(preservedOnReject.map((name) => [name, results.initial[name]])), `selector /${selector}`);
      assert.equal(run.state.faulted, 1, `selector /${selector}`);
      assert.deepEqual(run.writes, [], `selector /${selector}`);
    }
    assert.deepEqual(results.memory.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }]);
    assert.equal(results.memory.state.faulted, 1);
    assert.deepEqual(results.memory.writes, []);
    assert.deepEqual(Object.fromEntries(preservedOnReject.map((name) => [name, results.memory.state[name]])), Object.fromEntries(preservedOnReject.map((name) => [name, results.initial[name]])));
    assert.deepEqual(results.compare.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 },
    ]);
    assert.equal(results.compare.state.ax, 0x0030);
    assert.deepEqual(Object.fromEntries(['cf', 'pf', 'af', 'zf', 'sf', 'of'].map((name) => [name, results.compare.state[name]])), { cf: 0, pf: 1, af: 0, zf: 1, sf: 0, of: 0 });
    assert.equal(results.compare.state.faulted, 0);
    assert.deepEqual(results.compare.writes, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
