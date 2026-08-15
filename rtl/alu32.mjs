import { add, div, floor, lit, min, mod, ref, sub } from './ir.mjs';

const WIDTH = 32;
const bits = (prefix, width = WIDTH) => Array.from({ length: width }, (_, index) => `${prefix}-${index}`);
const signals = { 'carry-0': lit(0) };

for (let index = 0; index < WIDTH; index++) {
  signals[`ab-${index}`] = add(ref(`a-${index}`), ref(`b-${index}`));
  signals[`sum-${index}`] = mod(add(ref(`ab-${index}`), ref(`carry-${index}`)), lit(2));
  signals[`carry-${index + 1}`] = floor(div(add(ref(`ab-${index}`), ref(`carry-${index}`)), lit(2)));
}

signals['next-cf'] = ref('carry-32');
signals['next-af'] = ref('carry-4');
signals['next-zf'] = sub(lit(1), min(lit(1), add(...bits('sum').map(ref))));
signals['next-sf'] = ref('sum-31');
signals['next-of'] = mod(add(ref('carry-31'), ref('carry-32')), lit(2));
signals['next-pf'] = sub(lit(1), mod(add(...bits('sum', 8).map(ref)), lit(2)));

export const alu32 = {
  name: 'css386-alu32-add-ripple',
  inputs: { a: { width: WIDTH }, b: { width: WIDTH } },
  state: {
    r: { width: WIDTH },
    cf: { width: 1 }, pf: { width: 1 }, af: { width: 1 },
    zf: { width: 1 }, sf: { width: 1 }, of: { width: 1 }
  },
  signals,
  latches: {
    r: bits('sum'),
    cf: ['next-cf'], pf: ['next-pf'], af: ['next-af'],
    zf: ['next-zf'], sf: ['next-sf'], of: ['next-of']
  }
};
