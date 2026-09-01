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

function parity(value) {
  let bits = value & 0xff;
  bits ^= bits >>> 4;
  bits ^= bits >>> 2;
  bits ^= bits >>> 1;
  return (bits & 1) ^ 1;
}

function subtractFlags(destination, source) {
  const result = (destination - source) & 0xffff;
  return {
    cf: destination < source ? 1 : 0,
    pf: parity(result),
    af: ((destination ^ source ^ result) >>> 4) & 1,
    zf: result === 0 ? 1 : 0,
    sf: result >>> 15,
    of: ((destination ^ source) & (destination ^ result)) >>> 15,
  };
}

test('3B CMP r16,r/m16 reads words, updates flags, and never writes operands', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
      const initial = {
        ax: 0x0000, cx: 0x0001, dx: 0x7fff, bx: 0x8000,
        sp: 0xffff, bp: 0x0010, si: 0x1234, di: 0xabcd,
        ds: 0x1111, ss: 0x2222, es: 0x3333,
        tf: 1, if: 1, df: 1, iopl: 3, nt: 1,
        cf: 1, pf: 0, af: 1, zf: 0, sf: 1, of: 1,
        fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, state, setup) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        setup?.(memory);
        const machine = new ByteBusMachine(chip, memory);
        const run = machine.run(40);
        return { state: run.state, trace: run.trace.map(({ kind, address }) => ({ kind, address })), memory };
      };
      const registerCases = [];
      for (let destination = 0; destination < 8; destination++) {
        for (let source = 0; source < 8; source++) {
          const run = execute([0x3b, 0xc0 | (destination << 3) | source, 0xf4], initial);
          registerCases.push({ destination, source, state: run.state, trace: run.trace });
        }
      }
      const memoryCases = [
        { destination: 3, value: 0x001e, source: 0x0020 },
        { destination: 0, value: 0x8000, source: 0x0001 },
        { destination: 1, value: 0xffff, source: 0xffff },
        { destination: 2, value: 0x0000, source: 0x0001 },
      ].map(({ destination, value, source }, index) => {
        const address = 0x1000 + index * 2;
        const state = { ...initial, [registers[destination]]: value, ds: 0 };
        const run = execute([0x3b, (destination << 3) | 0x06, address & 0xff, address >>> 8, 0xf4], state, (memory) => {
          memory[address] = source & 0xff;
          memory[address + 1] = source >>> 8;
        });
        return { destination, value, source, address, state: run.state, trace: run.trace, memory: [run.memory[address], run.memory[address + 1]] };
      });
      const csOverride = execute([0x2e, 0x3b, 0x1e, 0x00, 0x01, 0xf4], { ...initial, bx: 0x7fff, ds: 0x1000 }, (memory) => {
        memory[0x0100] = 0x00; memory[0x0101] = 0x80;
        memory[0x10100] = 0xff; memory[0x10101] = 0x7f;
      });
      const bpUsesSs = execute([0x3b, 0x5e, 0x00, 0xf4], { ...initial, bx: 0x001e, bp: 0x0010, ds: 0x1000, ss: 0x2000 }, (memory) => {
        memory[0x10010] = 0x1e; memory[0x10011] = 0x00;
        memory[0x20010] = 0x20; memory[0x20011] = 0x00;
      });
      return {
        registers, initial, registerCases, memoryCases,
        csOverride: { state: csOverride.state, trace: csOverride.trace, memory: [csOverride.memory[0x0100], csOverride.memory[0x0101], csOverride.memory[0x10100], csOverride.memory[0x10101]] },
        bpUsesSs: { state: bpUsesSs.state, trace: bpUsesSs.trace, memory: [bpUsesSs.memory[0x10010], bpUsesSs.memory[0x10011], bpUsesSs.memory[0x20010], bpUsesSs.memory[0x20011]] },
      };
    });
    const collateral = ['ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'];
    for (const entry of results.registerCases) {
      const destination = results.registers[entry.destination];
      const source = results.registers[entry.source];
      assert.deepEqual(entry.trace, [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `register trace ${destination}/${source}`);
      for (const name of results.registers) assert.equal(entry.state[name], results.initial[name], `register compare ${destination}/${source} wrote ${name}`);
      for (const name of collateral) assert.equal(entry.state[name], results.initial[name], `register compare ${destination}/${source} changed ${name}`);
      const expected = subtractFlags(results.initial[destination], results.initial[source]);
      for (const flag of ['cf', 'pf', 'af', 'zf', 'sf', 'of']) assert.equal(entry.state[flag], expected[flag], `register compare ${destination}/${source} ${flag}`);
      assert.equal(entry.state.faulted, 0);
    }
    for (const entry of results.memoryCases) {
      const destination = results.registers[entry.destination];
      assert.deepEqual(entry.trace, [0, 1, 2, 3, entry.address, entry.address + 1, 4].map((address) => ({ kind: 'read', address })), `memory trace ${destination}`);
      for (const name of results.registers) {
        const expectedValue = name === destination ? entry.value : results.initial[name];
        assert.equal(entry.state[name], expectedValue, `memory compare ${destination} wrote ${name}`);
      }
      assert.deepEqual(entry.memory, [entry.source & 0xff, entry.source >>> 8], `memory compare ${destination} wrote operand`);
      const expected = subtractFlags(entry.value, entry.source);
      for (const flag of ['cf', 'pf', 'af', 'zf', 'sf', 'of']) assert.equal(entry.state[flag], expected[flag], `memory compare ${destination} ${flag}`);
      assert.equal(entry.state.faulted, 0);
    }
    assert.deepEqual(results.csOverride.trace, [0, 1, 2, 3, 4, 0x0100, 0x0101, 5].map((address) => ({ kind: 'read', address })));
    assert.deepEqual(results.csOverride.memory, [0x00, 0x80, 0xff, 0x7f]);
    assert.equal(results.csOverride.state.bx, 0x7fff);
    assert.equal(results.csOverride.state.csOverride, 0);
    for (const [flag, value] of Object.entries(subtractFlags(0x7fff, 0x8000))) assert.equal(results.csOverride.state[flag], value, `CS override ${flag}`);
    assert.deepEqual(results.bpUsesSs.trace, [0, 1, 2, 0x20010, 0x20011, 3].map((address) => ({ kind: 'read', address })));
    assert.deepEqual(results.bpUsesSs.memory, [0x1e, 0x00, 0x20, 0x00]);
    assert.equal(results.bpUsesSs.state.bx, 0x001e);
    for (const [flag, value] of Object.entries(subtractFlags(0x001e, 0x0020))) assert.equal(results.bpUsesSs.state[flag], value, `BP/SS ${flag}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
