function numericValue(element, name) {
  const property = `--${name}`;
  const typed = element.computedStyleMap?.().get(property);
  if (typed && typeof typed.value === 'number') return typed.value;
  const raw = getComputedStyle(element).getPropertyValue(property).trim();
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`pin ${name} did not resolve to a number: ${raw}`);
  return value;
}

const pinName = (port, width, index) => width === 1 ? port : `${port}-${index}`;

export class CssChip {
  constructor(element, manifest) {
    this.element = element;
    this.manifest = manifest;
  }

  writeBus(name, port, value) {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** port.width) throw new Error(`value outside ${port.width}-bit port ${name}`);
    for (let index = 0; index < port.width; index++) {
      const bit = Math.floor(value / 2 ** index) % 2;
      this.element.style.setProperty(`--${pinName(name, port.width, index)}`, String(bit));
    }
  }

  readBus(name, port) {
    let value = 0;
    for (let index = 0; index < port.width; index++) {
      value += numericValue(this.element, pinName(name, port.width, index)) * 2 ** index;
    }
    return value;
  }

  drive(values) {
    for (const [name, port] of Object.entries(this.manifest.inputs)) {
      if (!(name in values)) throw new Error(`missing input port ${name}`);
      this.writeBus(name, port, values[name]);
    }
  }

  sample(names) {
    return Object.fromEntries(names.map((name) => [name, numericValue(this.element, name)]));
  }

  cycle() {
    for (const [state, sourcePins] of Object.entries(this.manifest.latches)) {
      const port = this.manifest.state[state];
      for (let index = 0; index < port.width; index++) {
        const bit = numericValue(this.element, sourcePins[index]);
        this.element.style.setProperty(`--${pinName(state, port.width, index)}`, String(bit));
      }
    }
    return Object.fromEntries(Object.entries(this.manifest.state).map(([name, port]) => [name, this.readBus(name, port)]));
  }
}
