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

test('AD LODSW reads a wrapped little-endian word and commits AX plus SI atomically', async () => {
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
        ax: 0x5a11, cx: 0x2222, dx: 0x3333, bx: 0x4444, sp: 0x5555, bp: 0x6666, si: 0xffff, di: 0x7777,
        ds: 0x1000, ss: 0x2000, es: 0x3000, if: 1, tf: 1, df: 0, iopl: 3, nt: 1,
        cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, { state = {}, placements = [], steps = 24 } = {}) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...initial, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        for (const placement of placements) memory.set(placement.bytes, placement.address);
        const machine = new ByteBusMachine(chip, memory);
        const snapshots = [];
        for (let index = 0; index < steps && !chip.state().halted; index++) {
          machine.step();
          snapshots.push({ state: chip.state(), outputs: chip.outputs() });
        }
        return { state: chip.state(), outputs: chip.outputs(), trace: machine.trace, writes: machine.trace.filter(({ kind }) => kind === 'write'), snapshots };
      };
      const forward = execute([0xad, 0xf4], { placements: [{ address: 0x1ffff, bytes: [0xa7] }, { address: 0x10000, bytes: [0xb8] }] });
      const backward = execute([0xad, 0xf4], { state: { ax: 0x9999, ds: 0x4000, si: 0, df: 1 }, placements: [{ address: 0x40000, bytes: [0x12, 0x34] }] });
      const override = execute([0x2e, 0xad, 0xf4], { state: { ax: 0x9999, cs: 0, ds: 0x1000, si: 0x20 }, placements: [{ address: 0x20, bytes: [0x66, 0x77] }, { address: 0x10020, bytes: [0x88, 0x99] }] });
      const atomic = execute([0xad, 0xf4], { placements: [{ address: 0x1ffff, bytes: [0xa7] }, { address: 0x10000, bytes: [0xb8] }], steps: 3 });
      const rep = execute([0xf3, 0xad, 0xf4], { placements: [{ address: 0x1ffff, bytes: [0xa7] }, { address: 0x10000, bytes: [0xb8] }] });
      return { initial, forward, backward, override, atomic, rep };
    });
    const preserved = ['cx', 'dx', 'bx', 'sp', 'bp', 'di', 'ds', 'ss', 'es', 'if', 'tf', 'df', 'iopl', 'nt', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'];
    assert.deepEqual(results.forward.trace.map(({ kind, address, data }) => ({ kind, address, data })), [
      { kind: 'read', address: 0, data: 0xad },
      { kind: 'read', address: 0x1ffff, data: 0xa7 },
      { kind: 'read', address: 0x10000, data: 0xb8 },
      { kind: 'read', address: 1, data: 0xf4 },
    ]);
    assert.deepEqual({ ax: results.forward.state.ax, si: results.forward.state.si }, { ax: 0xb8a7, si: 1 });
    assert.deepEqual(Object.fromEntries(preserved.map((name) => [name, results.forward.state[name]])), Object.fromEntries(preserved.map((name) => [name, results.initial[name]])));
    assert.deepEqual(results.forward.writes, []);
    assert.equal(results.forward.outputs.irq6Request, 1);
    assert.equal(results.forward.state.faulted, 0);
    assert.deepEqual(results.backward.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 0x40000 }, { kind: 'read', address: 0x40001 }, { kind: 'read', address: 1 },
    ]);
    assert.deepEqual({ ax: results.backward.state.ax, si: results.backward.state.si, df: results.backward.state.df }, { ax: 0x3412, si: 0xfffe, df: 1 });
    assert.deepEqual(results.backward.writes, []);
    assert.deepEqual(results.override.trace.map(({ kind, address }) => ({ kind, address })), [
      { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 0x20 }, { kind: 'read', address: 0x21 }, { kind: 'read', address: 2 },
    ]);
    assert.deepEqual({ ax: results.override.state.ax, si: results.override.state.si, csOverride: results.override.state.csOverride }, { ax: 0x7766, si: 0x22, csOverride: 0 });
    assert.deepEqual(results.override.writes, []);
    assert.deepEqual(results.atomic.snapshots.map(({ state }) => ({ ax: state.ax, si: state.si, ip: state.ip, phase: state.phase, stringByte: state.stringByte })), [
      { ax: 0x5a11, si: 0xffff, ip: 1, phase: 14, stringByte: 0 },
      { ax: 0x5a11, si: 0xffff, ip: 1, phase: 15, stringByte: 0xa7 },
      { ax: 0xb8a7, si: 1, ip: 1, phase: 0, stringByte: 0xa7 },
    ]);
    assert.deepEqual(results.rep.trace.map(({ kind, address }) => ({ kind, address })), [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }]);
    assert.equal(results.rep.state.faulted, 1);
    assert.deepEqual({ ax: results.rep.state.ax, si: results.rep.state.si }, { ax: results.initial.ax, si: results.initial.si });
    assert.deepEqual(results.rep.writes, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
