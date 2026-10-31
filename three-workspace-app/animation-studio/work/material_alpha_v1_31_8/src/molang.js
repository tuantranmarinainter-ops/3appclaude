// SPDX-License-Identifier: GPL-3.0-or-later
// Independent, bounded parser for the Molang subset used by Animation Studio.
const MAX_LENGTH = 4096;
const MAX_DEPTH = 128;
const functions = Object.freeze({
  sin: [1, (x) => Math.sin((x * Math.PI) / 180)],
  cos: [1, (x) => Math.cos((x * Math.PI) / 180)],
  abs: [1, Math.abs],
  clamp: [3, (x, low, high) => Math.min(Math.max(x, low), high)],
  lerp: [3, (a, b, t) => a + (b - a) * t],
  min: [2, Math.min],
  max: [2, Math.max],
  random: [2, null],
});
const own = (object, key) => object != null && Object.hasOwn(object, key) ? object[key] : undefined;
const ownCaseInsensitive = (object, key) => {
  if (object == null || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const matchingKey = Object.keys(object).find((candidate) => candidate.toLowerCase() === key);
  return matchingKey === undefined ? undefined : object[matchingKey];
};

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    const rest = source.slice(i);
    const match = /^(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)?|<=|>=|==|!=|[+*/()?,:\-<>])/.exec(rest);
    if (!match) throw Error(`Ký tự không hợp lệ tại vị trí ${i + 1}.`);
    tokens.push({ text: match[0], pos: i });
    i += match[0].length;
  }
  tokens.push({ text: '', pos: i });
  return tokens;
}

function parse(source) {
  const tokens = tokenize(source);
  let index = 0;
  let depth = 0;
  const peek = () => tokens[index].text;
  const take = (text) => peek() === text && (++index, true);
  const requireToken = (text) => { if (!take(text)) throw Error(`Thiếu '${text}' tại vị trí ${tokens[index].pos + 1}.`); };
  function expression() {
    if (++depth > MAX_DEPTH) throw Error('Biểu thức quá sâu.');
    try {
      let node = comparison();
      if (take('?')) {
        const yes = expression();
        requireToken(':');
        node = { type: 'conditional', condition: node, yes, no: expression() };
      }
      return node;
    } finally { depth--; }
  }
  function binary(next, operators) {
    let node = next();
    while (operators.includes(peek())) {
      const op = tokens[index++].text;
      node = { type: 'binary', op, left: node, right: next() };
    }
    return node;
  }
  function comparison() { return binary(sum, ['<', '>', '<=', '>=', '==', '!=']); }
  function sum() { return binary(product, ['+', '-']); }
  function product() { return binary(unary, ['*', '/']); }
  function unary() {
    if (peek() === '+' || peek() === '-') {
      if (++depth > MAX_DEPTH) throw Error('Biểu thức quá sâu.');
      try { return { type: 'unary', op: tokens[index++].text, value: unary() }; }
      finally { depth--; }
    }
    return primary();
  }
  function primary() {
    const token = tokens[index];
    if (take('(')) { const node = expression(); requireToken(')'); return node; }
    if (/^(?:\d|\.\d)/.test(token.text)) {
      index++;
      const value = Number(token.text);
      if (!Number.isFinite(value)) throw Error('Số không hợp lệ.');
      return { type: 'number', value };
    }
    if (/^[A-Za-z_]/.test(token.text)) {
      index++;
      const name = token.text.toLowerCase();
      if (take('(')) {
        const func = name.startsWith('math.') ? own(functions, name.slice(5)) : undefined;
        if (!func) throw Error(`Hàm không được hỗ trợ: ${token.text}.`);
        const args = [];
        if (!take(')')) {
          do { args.push(expression()); } while (take(','));
          requireToken(')');
        }
        if (args.length !== func[0]) throw Error(`Hàm ${token.text} cần ${func[0]} đối số.`);
        return { type: 'call', name: name.slice(5), args, pos: token.pos };
      }
      if (!/^(?:query\.(?:anim_time|life_time)|q\.(?:anim_time|life_time)|(?:variable|v)\.[a-z_][a-z_0-9]*)$/.test(name))
        throw Error(`Biến không được hỗ trợ: ${token.text}.`);
      return { type: 'variable', name };
    }
    throw Error(`Thiếu giá trị tại vị trí ${token.pos + 1}.`);
  }
  const node = expression();
  if (peek()) throw Error(`Ký hiệu không mong đợi tại vị trí ${tokens[index].pos + 1}.`);
  return node;
}

function lookup(name, context) {
  const [prefix, key] = name.split('.');
  let value;
  if (prefix === 'q' || prefix === 'query') {
    value = own(context, `query.${key}`) ?? own(context, `q.${key}`) ?? own(context, key) ?? own(own(context, 'query'), key);
  } else {
    value = ownCaseInsensitive(context, `variable.${key}`) ?? ownCaseInsensitive(context, `v.${key}`) ?? ownCaseInsensitive(own(context, 'variables'), key);
  }
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`Giá trị biến ${name} không hợp lệ.`);
  return value;
}
function randomAt(seed, pos) {
  let hash = 2166136261;
  const input = `${seed}:${pos}`;
  for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
function evaluate(node, context, depth = 0) {
  if (depth > MAX_DEPTH) throw Error('Biểu thức quá sâu.');
  const ev = (child) => evaluate(child, context, depth + 1);
  switch (node.type) {
    case 'number': return node.value;
    case 'variable': return lookup(node.name, context);
    case 'unary': return node.op === '-' ? -ev(node.value) : ev(node.value);
    case 'conditional': return ev(node.condition) !== 0 ? ev(node.yes) : ev(node.no);
    case 'call': {
      const args = node.args.map(ev);
      if (node.name === 'random') return args[0] + (args[1] - args[0]) * randomAt(own(context, 'seed') ?? 0, node.pos);
      return functions[node.name][1](...args);
    }
    case 'binary': {
      const a = ev(node.left), b = ev(node.right);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw Error('Không thể chia cho 0.'); return a / b;
        case '<': return Number(a < b);
        case '>': return Number(a > b);
        case '<=': return Number(a <= b);
        case '>=': return Number(a >= b);
        case '==': return Number(a === b);
        case '!=': return Number(a !== b);
      }
    }
  }
  throw Error('Biểu thức không hợp lệ.');
}

/** Evaluate untrusted input without executing JavaScript. Missing variables default to zero. */
export function evaluateMolang(source, context = {}) {
  try {
    if (typeof source !== 'string' || source.length > MAX_LENGTH || !source.trim())
      throw Error('Biểu thức trống hoặc quá dài.');
    const value = evaluate(parse(source), context ?? {});
    if (!Number.isFinite(value)) throw Error('Kết quả không phải số hữu hạn.');
    return { value, error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : 'Biểu thức không hợp lệ.' };
  }
}
