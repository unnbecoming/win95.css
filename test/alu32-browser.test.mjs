import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const operations = { ADD: 0, SUB: 1, AND: 2, OR: 3, XOR: 4 };

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

function resultFlags(r) {
  const low = r & 0xff;
  let ones = 0;
  for (let bit = 0; bit < 8; bit++) ones += (low >>> bit) & 1;
  return { pf: ones % 2 === 0 ? 1 : 0, zf: r === 0 ? 1 : 0, sf: r >= 0x8000_0000 ? 1 : 0 };
}

function oracle(a, b, op) {
  let r;
  let cf = 0;
  let af = 0;
  let of = 0;
  if (op === operations.ADD) {
    const wide = a + b;
    r = wide % 0x1_0000_0000;
    cf = wide >= 0x1_0000_0000 ? 1 : 0;
    af = (a % 16) + (b % 16) >= 16 ? 1 : 0;
    of = ((a < 0x8000_0000) === (b < 0x8000_0000)) && ((r < 0x8000_0000) !== (a < 0x8000_0000)) ? 1 : 0;
  } else if (op === operations.SUB) {
    r = (a - b + 0x1_0000_0000) % 0x1_0000_0000;
    cf = a < b ? 1 : 0;
    af = (a % 16) < (b % 16) ? 1 : 0;
    of = ((a < 0x8000_0000) !== (b < 0x8000_0000)) && ((r < 0x8000_0000) !== (a < 0x8000_0000)) ? 1 : 0;
  } else if (op === operations.AND) {
    r = (a & b) >>> 0;
  } else if (op === operations.OR) {
    r = (a | b) >>> 0;
  } else if (op === operations.XOR) {
    r = (a ^ b) >>> 0;
  } else {
    throw new Error(`unsupported op ${op}`);
  }
  return { r, cf, ...resultFlags(r), af, of };
}

function vectors() {
  const edges = [
    [0, 0], [1, 1], [0xffff_ffff, 1], [0xffff_ffff, 0xffff_ffff],
    [0x7fff_ffff, 1], [0x8000_0000, 0x8000_0000], [0x0f, 1], [0xff, 1],
    [0x1234_5678, 0x8765_4321]
  ];
  const result = Object.values(operations).flatMap((op) => edges.map(([a, b]) => [a, b, op]));
  let state = 0x386_95;
  for (let index = 0; index < 1000; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const a = state;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result.push([a, state, index % Object.keys(operations).length]);
  }
  return result;
}

test('generated CSS ALU matches independent operation oracles in Chromium', async () => {
  const server = await serve();
  const address = server.address();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/alu.html`);
    await page.waitForFunction(() => window.css386?.alu);
    const cases = vectors();
    const actual = await page.evaluate((items) => items.map(([a, b, op]) => window.css386.alu(a, b, op)), cases);
    for (let index = 0; index < cases.length; index++) {
      const expected = oracle(...cases[index]);
      if (JSON.stringify(actual[index]) !== JSON.stringify(expected)) {
        const probe = await page.evaluate(([a, b, op]) => ({ state: window.css386.alu(a, b, op), pins: window.css386.pins() }), cases[index]);
        assert.deepEqual(probe.state, expected, `vector ${index}: ${JSON.stringify(cases[index])}; pins=${JSON.stringify(probe.pins)}`);
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
