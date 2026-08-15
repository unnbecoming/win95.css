import { add, div, floor, lit, min, mod, ref, sub } from './ir.mjs';
import { andBit, anyBits, equalConstant, notBit, orBit, xorBit } from './bits.mjs';

const WIDTH = 32;
export const operations = { ADD: 0, SUB: 1, AND: 2, OR: 3, XOR: 4 };
const bits = (prefix, width = WIDTH) => Array.from({ length: width }, (_, index) => `${prefix}-${index}`);
const signals = {};

for (const [name, code] of Object.entries(operations)) signals[`select-${name.toLowerCase()}`] = equalConstant('op', 3, code);
signals['select-arithmetic'] = orBit(ref('select-add'), ref('select-sub'));
signals['carry-0'] = ref('select-sub');

for (let index = 0; index < WIDTH; index++) {
  signals[`effective-b-${index}`] = xorBit(ref(`b-${index}`), ref('select-sub'));
  signals[`ab-${index}`] = add(ref(`a-${index}`), ref(`effective-b-${index}`));
  signals[`arithmetic-${index}`] = mod(add(ref(`ab-${index}`), ref(`carry-${index}`)), lit(2));
  signals[`carry-${index + 1}`] = floor(div(add(ref(`ab-${index}`), ref(`carry-${index}`)), lit(2)));
  signals[`and-${index}`] = andBit(ref(`a-${index}`), ref(`b-${index}`));
  signals[`or-${index}`] = orBit(ref(`a-${index}`), ref(`b-${index}`));
  signals[`xor-${index}`] = xorBit(ref(`a-${index}`), ref(`b-${index}`));
  signals[`result-${index}`] = anyBits([
    andBit(ref('select-arithmetic'), ref(`arithmetic-${index}`)),
    andBit(ref('select-and'), ref(`and-${index}`)),
    andBit(ref('select-or'), ref(`or-${index}`)),
    andBit(ref('select-xor'), ref(`xor-${index}`)),
  ]);
}

signals['arithmetic-cf'] = orBit(
  andBit(notBit(ref('select-sub')), ref('carry-32')),
  andBit(ref('select-sub'), notBit(ref('carry-32'))),
);
signals['arithmetic-af'] = orBit(
  andBit(notBit(ref('select-sub')), ref('carry-4')),
  andBit(ref('select-sub'), notBit(ref('carry-4'))),
);
signals['next-cf'] = andBit(ref('select-arithmetic'), ref('arithmetic-cf'));
signals['next-af'] = andBit(ref('select-arithmetic'), ref('arithmetic-af'));
signals['next-zf'] = sub(lit(1), min(lit(1), add(...bits('result').map(ref))));
signals['next-sf'] = ref('result-31');
signals['next-of'] = andBit(ref('select-arithmetic'), xorBit(ref('carry-31'), ref('carry-32')));
signals['next-pf'] = sub(lit(1), mod(add(...bits('result', 8).map(ref)), lit(2)));

export const alu32 = {
  name: 'css386-alu32',
  inputs: { a: { width: WIDTH }, b: { width: WIDTH }, op: { width: 3 } },
  state: {
    r: { width: WIDTH },
    cf: { width: 1 }, pf: { width: 1 }, af: { width: 1 },
    zf: { width: 1 }, sf: { width: 1 }, of: { width: 1 }
  },
  signals,
  latches: {
    r: bits('result'),
    cf: ['next-cf'], pf: ['next-pf'], af: ['next-af'],
    zf: ['next-zf'], sf: ['next-sf'], of: ['next-of']
  }
};
