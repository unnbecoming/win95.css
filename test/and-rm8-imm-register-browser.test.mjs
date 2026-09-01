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

function parity8(value) {
  let ones = 0;
  for (let bit = 0; bit < 8; bit++) ones += (value >>> bit) & 1;
  return Number((ones & 1) === 0);
}

test('80 /4 AND r8,imm8 writes every byte alias and exact logical flags', async () => {
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
        ax: 0x9181, cx: 0xa202, dx: 0xb343, bx: 0xc484, sp: 0x5566, bp: 0x7788, si: 0x99aa, di: 0xbbcc,
        ds: 0x1111, ss: 0x2222, es: 0x3333,
        tf: 1, if: 1, df: 1, iopl: 3, nt: 1,
        cf: 1, pf: 0, af: 1, zf: 0, sf: 0, of: 1,
        fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, state) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: 0, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, 0);
        const run = new ByteBusMachine(chip, memory).run(20);
        return { state: run.state, trace: run.trace.map(({ kind, address }) => ({ kind, address })) };
      };
      const vectors = [
        { initial: 0xf3, immediate: 0x0f },
        { initial: 0x80, immediate: 0xff },
        { initial: 0x55, immediate: 0xaa },
        { initial: 0xff, immediate: 0xfe },
      ];
      const cases = [];
      for (let destination = 0; destination < 8; destination++) {
        const target = aliases[destination];
        for (const vector of vectors) {
          const state = { ...base };
          state[target.register] = (state[target.register] & ~(0xff << target.shift)) | (vector.initial << target.shift);
          const run = execute([0x80, 0xe0 | destination, vector.immediate, 0xf4], state);
          cases.push({ destination, ...vector, seeded: state, state: run.state, trace: run.trace });
        }
      }
      const invalidSelectors = [0, 1, 2, 3, 6].map((selector) => {
        const run = execute([0x80, 0xc0 | (selector << 3), 0x0f, 0xf4], base);
        return { selector, state: run.state, trace: run.trace };
      });
      const sub = execute([0x80, 0xe8, 0x01, 0xf4], { ...base, ax: 0x91f3 });
      const cmp = execute([0x80, 0xf8, 0x01, 0xf4], { ...base, ax: 0x91f3 });
      return { aliases, base, cases, invalidSelectors, sub, cmp };
    });
    const registers = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
    const collateral = ['ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'fdcDor', 'fdcInterrupt'];
    const fullTrace = [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: 2 }, { kind: 'read', address: 3 }];
    for (const entry of results.cases) {
      const target = results.aliases[entry.destination];
      const result = entry.initial & entry.immediate;
      const expectedRegister = (entry.seeded[target.register] & ~(0xff << target.shift)) | (result << target.shift);
      assert.deepEqual(entry.trace, fullTrace, `${entry.destination}/${entry.initial.toString(16)}/${entry.immediate.toString(16)} trace`);
      for (const register of registers) assert.equal(entry.state[register], register === target.register ? expectedRegister : entry.seeded[register], `${entry.destination} ${register}`);
      for (const name of collateral) assert.equal(entry.state[name], entry.seeded[name], `${entry.destination} ${name}`);
      assert.equal(entry.state.cf, 0);
      assert.equal(entry.state.pf, parity8(result));
      assert.equal(entry.state.af, 0);
      assert.equal(entry.state.zf, Number(result === 0));
      assert.equal(entry.state.sf, result >>> 7);
      assert.equal(entry.state.of, 0);
      assert.equal(entry.state.faulted, 0);
    }
    for (const entry of results.invalidSelectors) {
      assert.deepEqual(entry.trace, [{ kind: 'read', address: 0 }, { kind: 'read', address: 1 }], `selector ${entry.selector}`);
      assert.equal(entry.state.faulted, 1, `selector ${entry.selector}`);
      for (const register of registers) assert.equal(entry.state[register], results.base[register], `selector ${entry.selector} ${register}`);
    }
    assert.deepEqual(results.sub.trace, fullTrace);
    assert.equal(results.sub.state.ax, 0x91f2);
    assert.equal(results.sub.state.faulted, 0);
    assert.deepEqual(results.cmp.trace, fullTrace);
    assert.equal(results.cmp.state.ax, 0x91f3);
    assert.equal(results.cmp.state.faulted, 0);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
