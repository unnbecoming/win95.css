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

test('77 JA branches only above with signed wrapped displacement', async () => {
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
        ds: 0x1000, ss: 0x2000, es: 0x3000, tf: 1, if: 1, df: 1, iopl: 3, nt: 1, rep: 0,
        pf: 0, af: 1, sf: 1, of: 1, fdcDor: 0x0c, fdcInterrupt: 1,
      };
      const execute = (bytes, { loadAddress = 0, state = {}, placements = [] } = {}) => {
        const chip = new CssChip(document.querySelector('#cpu'), manifest);
        chip.seedState({ cs: 0, ip: loadAddress & 0xffff, ...initial, ...state });
        chip.drive({ busData: 0 });
        const memory = new Uint8Array(0x100000);
        memory.set(bytes, loadAddress);
        for (const placement of placements) memory.set(placement.bytes, placement.address);
        const run = new ByteBusMachine(chip, memory).run(24);
        return { state: run.state, outputs: chip.outputs(), trace: run.trace, writes: run.trace.filter(({ kind }) => kind === 'write') };
      };
      const conditions = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([cf, zf]) => ({ cf, zf, run: execute([0x77, 0x02, 0xf4, 0x90, 0xf4], { state: { cf, zf } }) }));
      const authentic = execute([0x77, 0x1a, 0xf4], { state: { cf: 0, zf: 0 }, placements: [{ address: 0x001c, bytes: [0xf4] }] });
      const negative = execute([0xf4, 0x77, 0xfd], { loadAddress: 0x0100, state: { ip: 0x0101, cf: 0, zf: 0 } });
      const positiveWrap = execute([0x77, 0x02], { loadAddress: 0xfffe, state: { cf: 0, zf: 0 }, placements: [{ address: 0x0002, bytes: [0xf4] }] });
      const negativeWrap = execute([0x77, 0xfd], { state: { cf: 0, zf: 0 }, placements: [{ address: 0xffff, bytes: [0xf4] }] });
      return { initial, conditions, authentic, negative, positiveWrap, negativeWrap };
    });
    const collateral = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di', 'ds', 'ss', 'es', 'tf', 'if', 'df', 'iopl', 'nt', 'rep', 'cf', 'pf', 'af', 'zf', 'sf', 'of', 'fdcDor', 'fdcInterrupt'];
    for (const { cf, zf, run } of results.conditions) {
      const taken = cf === 0 && zf === 0;
      assert.deepEqual(run.trace.map(({ kind, address }) => ({ kind, address })), [
        { kind: 'read', address: 0 }, { kind: 'read', address: 1 }, { kind: 'read', address: taken ? 4 : 2 },
      ], `cf=${cf},zf=${zf}`);
      const expected = { ...results.initial, cf, zf };
      assert.deepEqual(Object.fromEntries(collateral.map((key) => [key, run.state[key]])), Object.fromEntries(collateral.map((key) => [key, expected[key]])), `cf=${cf},zf=${zf}`);
      assert.deepEqual(run.writes, [], `cf=${cf},zf=${zf}`);
      assert.equal(run.outputs.irq6Request, 1, `cf=${cf},zf=${zf}`);
      assert.equal(run.state.faulted, 0, `cf=${cf},zf=${zf}`);
    }
    assert.deepEqual(results.authentic.trace.map(({ address }) => address), [0x0000, 0x0001, 0x001c]);
    assert.deepEqual(results.negative.trace.map(({ address }) => address), [0x0101, 0x0102, 0x0100]);
    assert.deepEqual(results.positiveWrap.trace.map(({ address }) => address), [0xfffe, 0xffff, 0x0002]);
    assert.deepEqual(results.negativeWrap.trace.map(({ address }) => address), [0x0000, 0x0001, 0xffff]);
    for (const run of [results.authentic, results.negative, results.positiveWrap, results.negativeWrap]) {
      const expected = { ...results.initial, cf: 0, zf: 0 };
      assert.deepEqual(Object.fromEntries(collateral.map((key) => [key, run.state[key]])), Object.fromEntries(collateral.map((key) => [key, expected[key]])));
      assert.deepEqual(run.writes, []);
      assert.equal(run.state.faulted, 0);
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
