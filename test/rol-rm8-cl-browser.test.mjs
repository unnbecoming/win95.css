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

function rotateLeft8(value, count) {
  const effective = count & 7;
  return effective === 0 ? value : ((value << effective) | (value >>> (8 - effective))) & 0xff;
}

test('D2 /0 ROL r/m8,CL rotates all byte registers with i386 count semantics', async () => {
  const server = await serve();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/test/cpu16.html`);
    const results = await page.evaluate(async () => {
      const [{ CssChip }, { ByteBusMachine }] = await Promise.all([import('/src/chip.js'), import('/src/byte-bus-machine.js')]);
      const manifest = await fetch('/generated/cpu16.manifest.json').then((response) => response.json());
      const aliases = [
        { register: 'ax', shift: 0 }, { register: 'cx', shift: 0 }, { register: 'dx', shift: 0 }, { register: 'bx', shift: 0 },
        { register: 'ax', shift: 8 }, { register: 'cx', shift: 8 }, { register: 'dx', shift: 8 }, { register: 'bx', shift: 8 },
      ];
      const base = {
        ax: 0x9181, cx: 0xa201, dx: 0xb342, bx: 0xc483, sp: 0x5566, bp: 0x7788, si: 0x99aa, di: 0xbbcc,
        ds: 0x1111, ss: 0x2222, es: 0x3333,
        tf: 1, if: 1, df: 1, iopl: 3, nt: 1,
        cf: 1, pf: 0, af: 1, zf: 1, sf: 0, of: 1,
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
        const run = machine.run(20);
        return { state: run.state, trace: run.trace.map(({ kind, address }) => ({ kind, address })), memory };
      };
      const cases = [];
      for (const count of [0, 1, 4, 8, 31, 32]) {
        for (let destination = 0; destination < 8; destination++) {
          const target = aliases[destination];
          const desired = (0x81 + destination * 13) & 0xff;
          const state = { ...base, cx: (base.cx & 0xff00) | count, of: destination & 1 };
          if (destination !== 1) state[target.register] = (state[target.register] & ~(0xff << target.shift)) | (desired << target.shift);
          const initial = (state[target.register] >>> target.shift) & 0xff;
          const run = execute([0xd2, 0xc0 | destination, 0xf4], state);
          cases.push({ count, destination, initial, seeded: state, state: run.state, trace: run.trace });
        }
      }
      const invalidSelectors = Array.from({ length: 7 }, (_, index) => index + 1).map((selector) => {
        const run = execute([0xd2, 0xc0 | (selector << 3), 0xf4], base);
        return { selector, state: run.state, trace: run.trace };
      });
      const memory = execute([0xd2, 0x06, 0x00, 0x10, 0xf4], base, (bytes) => { bytes[0x1000] = 0x81; });
      return { aliases, base, cases, invalidSelectors, memory: { state: memory.state, trace: memory.trace, byte: memory.memory[0x1000] } };
    });
    const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    const collateral = ['ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'];
    for (const entry of results.cases) {
      const target = results.aliases[entry.destination];
      const masked = entry.count & 0x1f;
      const rotated = rotateLeft8(entry.initial, masked);
      const expectedRegister = (entry.seeded[target.register] & ~(0xff << target.shift)) | (rotated << target.shift);
      assert.deepEqual(entry.trace, [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }], `${entry.count}/${entry.destination} trace`);
      for (const register of registers) assert.equal(entry.state[register], register === target.register ? expectedRegister : entry.seeded[register], `${entry.count}/${entry.destination} ${register}`);
      for (const name of collateral) assert.equal(entry.state[name], entry.seeded[name], `${entry.count}/${entry.destination} ${name}`);
      assert.equal(entry.state.cf, masked === 0 ? entry.seeded.cf : rotated & 1, `${entry.count}/${entry.destination} cf`);
      assert.equal(entry.state.of, masked === 1 ? ((rotated >>> 7) ^ (rotated & 1)) : entry.seeded.of, `${entry.count}/${entry.destination} of`);
      for (const flag of ['pf', 'af', 'zf', 'sf']) assert.equal(entry.state[flag], entry.seeded[flag], `${entry.count}/${entry.destination} ${flag}`);
      assert.equal(entry.state.faulted, 0, `${entry.count}/${entry.destination} faulted`);
    }
    for (const entry of results.invalidSelectors) {
      assert.deepEqual(entry.trace, [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }], `selector ${entry.selector}`);
      assert.equal(entry.state.faulted, 1, `selector ${entry.selector}`);
      for (const register of registers) assert.equal(entry.state[register], results.base[register], `selector ${entry.selector} ${register}`);
    }
    assert.deepEqual(results.memory.trace, [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }]);
    assert.equal(results.memory.state.faulted, 1);
    assert.equal(results.memory.byte, 0x81);
    for (const register of registers) assert.equal(results.memory.state[register], results.base[register], `memory ${register}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
