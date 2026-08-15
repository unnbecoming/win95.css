import { add, div, floor, lit, min, mod, ref, sub } from './ir.mjs';

export const bitRef = (name) => ref(name);
export const notBit = (value) => sub(lit(1), value);
export const xorBit = (left, right) => mod(add(left, right), lit(2));
export const andBit = (left, right) => floor(div(add(left, right), lit(2)));
export const orBit = (left, right) => min(lit(1), add(left, right));
export const muxBit = (select, whenZero, whenOne) => orBit(andBit(notBit(select), whenZero), andBit(select, whenOne));
export const allBits = (values) => values.reduce((result, value) => andBit(result, value), lit(1));
export const anyBits = (values) => min(lit(1), add(...values));
export const equalConstant = (prefix, width, constant) => allBits(Array.from({ length: width }, (_, index) => {
  const bit = bitRef(`${prefix}-${index}`);
  return ((constant >>> index) & 1) === 1 ? bit : notBit(bit);
}));
