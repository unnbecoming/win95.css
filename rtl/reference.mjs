const mod = (left, right) => ((left % right) + right) % right;

export function evaluateExpression(node, environment) {
  switch (node.op) {
    case 'ref': return environment[node.name];
    case 'lit': return node.value;
    case 'add': return node.args.reduce((sum, value) => sum + evaluateExpression(value, environment), 0);
    case 'sub': return evaluateExpression(node.left, environment) - evaluateExpression(node.right, environment);
    case 'mul': return node.args.reduce((product, value) => product * evaluateExpression(value, environment), 1);
    case 'div': return evaluateExpression(node.left, environment) / evaluateExpression(node.right, environment);
    case 'mod': return mod(evaluateExpression(node.left, environment), evaluateExpression(node.right, environment));
    case 'floor': return Math.floor(evaluateExpression(node.value, environment));
    case 'min': return Math.min(...node.args.map((value) => evaluateExpression(value, environment)));
    case 'abs': return Math.abs(evaluateExpression(node.value, environment));
    default: throw new Error(`unknown IR op ${node.op}`);
  }
}

export function evaluateNetlist(netlist, inputs) {
  const environment = { ...inputs };
  for (const [name, expression] of Object.entries(netlist.signals)) {
    environment[name] = evaluateExpression(expression, environment);
  }
  return Object.fromEntries(Object.entries(netlist.latches).map(([state, pins]) => [
    state,
    pins.reduce((value, pin, index) => value + environment[pin] * 2 ** index, 0),
  ]));
}
