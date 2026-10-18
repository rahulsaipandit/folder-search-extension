import { z } from 'zod';
import { ActionDefinition, ActionError } from '../types';

const inputSchema = z.object({
  expression: z.string(), // Math expression, e.g., '2 + 3 * 4'
});

const outputSchema = z.union([
  z.object({ result: z.number() }),
  z.object({ error: z.string() }),
]);

// Recursive descent parser - no eval, no new Function, CSP-safe
function evaluateMathExpression(expr: string): number {
  const s = expr.replace(/\s/g, '');
  if (!/^[0-9+\-*/().]+$/.test(s)) {
    throw new Error('Invalid characters in expression');
  }

  let pos = 0;
  const peek = () => s[pos] ?? '';

  function parseExpr(): number { return parseAddSub(); }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek() === '+' || peek() === '-') {
      const op = s[pos++];
      left = op === '+' ? left + parseMulDiv() : left - parseMulDiv();
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const op = s[pos++];
      const right = parseUnary();
      if (op === '/' && right === 0) throw new Error('Division by zero');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  function parseUnary(): number {
    if (peek() === '-') { pos++; return -parseAtom(); }
    if (peek() === '+') { pos++; return parseAtom(); }
    return parseAtom();
  }

  function parseAtom(): number {
    if (peek() === '(') {
      pos++;
      const val = parseExpr();
      if (peek() !== ')') throw new Error('Expected closing parenthesis');
      pos++;
      return val;
    }
    let numStr = '';
    while (/[0-9.]/.test(peek())) numStr += s[pos++];
    if (!numStr) throw new Error('Expected number');
    const n = parseFloat(numStr);
    if (isNaN(n)) throw new Error('Invalid number');
    return n;
  }

  const result = parseExpr();
  if (pos !== s.length) throw new Error('Unexpected characters in expression');
  if (!isFinite(result)) throw new Error('Result is not finite');
  return result;
}

export const CalculatorAction: ActionDefinition<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  id: 'org.page-agent.math.calculate',
  name: 'Calculator',
  description: 'Evaluates mathematical expressions safely',
  version: '1.0.0',
  capabilities: ['system.math'],
  triggers: ['calculate', 'compute', 'what is', 'evaluate', 'how much is', 'math', 'add', 'subtract', 'multiply', 'divide', 'square root', 'percentage'],
  inputSchema,
  outputSchema,
  fallbackToLLM: false,
  execute: async (input, context) => {
    try {
      const result = evaluateMathExpression(input.expression);
      return { result };
    } catch (error) {
      return { error: (error as Error).message };
    }
  },
};