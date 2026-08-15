const cssName = (name) => `--${name}`;
const portPins = (ports) => Object.entries(ports).flatMap(([name, port]) =>
  Array.from({ length: port.width }, (_, index) => port.width === 1 ? name : `${name}-${index}`));

function compile(node) {
  switch (node.op) {
    case 'ref': return `var(${cssName(node.name)})`;
    case 'lit': return String(node.value);
    case 'add': return `calc(${node.args.map(compile).join(' + ')})`;
    case 'sub': return `calc(${compile(node.left)} - ${compile(node.right)})`;
    case 'mul': return `calc(${node.args.map(compile).join(' * ')})`;
    case 'div': return `calc(${compile(node.left)} / ${compile(node.right)})`;
    case 'mod': return `mod(${compile(node.left)}, ${compile(node.right)})`;
    case 'floor': return `round(down, ${compile(node.value)}, 1)`;
    case 'min': return `min(${node.args.map(compile).join(', ')})`;
    case 'abs': return `abs(${compile(node.value)})`;
    default: throw new Error(`unknown IR op ${node.op}`);
  }
}

export function compileNetlist(netlist, className) {
  const inputPins = portPins(netlist.inputs);
  const statePins = portPins(netlist.state);
  const signalPins = Object.keys(netlist.signals);
  const properties = [...inputPins, ...statePins, ...signalPins];
  const registrations = properties.map((name) => `@property ${cssName(name)} {\n  syntax: "<number>";\n  inherits: false;\n  initial-value: 0;\n}`).join('\n\n');
  const inputDefaults = inputPins.map((name) => `  ${cssName(name)}: 0;`);
  const stateDefaults = Object.entries(netlist.state).flatMap(([name, port]) => {
    const initial = port.initial ?? 0;
    if (!Number.isInteger(initial) || initial < 0 || initial >= 2 ** port.width) {
      throw new Error(`initial value outside ${port.width}-bit state ${name}`);
    }
    return Array.from({ length: port.width }, (_, index) => {
      const pin = port.width === 1 ? name : `${name}-${index}`;
      return `  ${cssName(pin)}: ${Math.floor(initial / 2 ** index) % 2};`;
    });
  });
  const defaults = [...inputDefaults, ...stateDefaults].join('\n');
  const signals = Object.entries(netlist.signals).map(([name, expression]) => `  ${cssName(name)}: ${compile(expression)};`).join('\n');
  const css = `/* Generated. Do not hand-edit. */\n${registrations}\n\n.${className} {\n${defaults}\n${signals}\n}\n`;
  const manifest = {
    version: 2,
    name: netlist.name,
    inputs: netlist.inputs,
    state: netlist.state,
    signals: signalPins,
    latches: netlist.latches,
    outputs: netlist.outputs ?? {},
    aliases: netlist.aliases ?? {},
    ...(netlist.byteBus ? { byteBus: netlist.byteBus } : {}),
  };
  return { css, manifest, netCount: properties.length };
}
