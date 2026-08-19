/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const FUNCTIONS = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    log: Math.log10,
    ln: Math.log
};
const CONSTANTS = {
    pi: Math.PI,
    e: Math.E
};
const ALLOWED = /^[\d\s+\-*/^%().,a-z]+$/i;
const LOOKS_LIKE_MATH = /[+\-*/^%]|\b(sqrt|abs|round|floor|ceil|sin|cos|tan|log|ln|of)\b/i;
class Parser {
    input;
    pos = 0;
    constructor(input) {
        this.input = input;
    }
    peek() {
        return this.input[this.pos] ?? "";
    }
    skipSpaces() {
        while (this.peek() === " ")
            this.pos += 1;
    }
    word() {
        const start = this.pos;
        while (/[a-z]/i.test(this.peek()))
            this.pos += 1;
        return this.input.slice(start, this.pos).toLowerCase();
    }
    parse() {
        const result = this.expr();
        this.skipSpaces();
        if (this.pos !== this.input.length)
            throw new Error("Unexpected input");
        return result.pct ? result.v / 100 : result.v;
    }
    expr() {
        let left = this.term();
        for (;;) {
            this.skipSpaces();
            const op = this.peek();
            if (op !== "+" && op !== "-")
                break;
            this.pos += 1;
            const right = this.term();
            const rightValue = right.pct ? left.v * (right.v / 100) : right.v;
            left = { v: op === "+" ? left.v + rightValue : left.v - rightValue, pct: false };
        }
        return left;
    }
    term() {
        let left = this.factor();
        for (;;) {
            this.skipSpaces();
            const op = this.peek();
            const isOf = /[a-z]/i.test(op) && this.input.slice(this.pos, this.pos + 2).toLowerCase() === "of" && !/[a-z]/i.test(this.input[this.pos + 2] ?? "");
            if (op === "*" || op === "/") {
                this.pos += 1;
            }
            else if (op === "%" && this.input.slice(this.pos + 1).trimStart().match(/^[\d(]/)) {
                this.pos += 1;
            }
            else if (isOf) {
                this.pos += 2;
                const right = this.factor();
                const leftValue = left.pct ? left.v / 100 : left.v;
                left = { v: leftValue * (right.pct ? right.v / 100 : right.v), pct: false };
                continue;
            }
            else {
                break;
            }
            const right = this.factor();
            const a = left.pct ? left.v / 100 : left.v;
            const b = right.pct ? right.v / 100 : right.v;
            if (op === "*")
                left = { v: a * b, pct: false };
            else if (op === "/")
                left = { v: a / b, pct: false };
            else
                left = { v: a % b, pct: false };
        }
        return left;
    }
    factor() {
        const base = this.unary();
        this.skipSpaces();
        if (this.peek() === "^") {
            this.pos += 1;
            const exponent = this.factor();
            const a = base.pct ? base.v / 100 : base.v;
            const b = exponent.pct ? exponent.v / 100 : exponent.v;
            return { v: a ** b, pct: false };
        }
        return base;
    }
    unary() {
        this.skipSpaces();
        if (this.peek() === "-") {
            this.pos += 1;
            const value = this.unary();
            return { v: -value.v, pct: value.pct };
        }
        return this.primary();
    }
    primary() {
        this.skipSpaces();
        if (this.peek() === "(") {
            this.pos += 1;
            const inner = this.expr();
            this.skipSpaces();
            if (this.peek() !== ")")
                throw new Error("Missing closing paren");
            this.pos += 1;
            return this.percentSuffix({ v: inner.pct ? inner.v / 100 : inner.v, pct: false });
        }
        if (/[a-z]/i.test(this.peek())) {
            const name = this.word();
            if (name in CONSTANTS)
                return this.percentSuffix({ v: CONSTANTS[name], pct: false });
            if (name in FUNCTIONS) {
                this.skipSpaces();
                if (this.peek() !== "(")
                    throw new Error("Expected paren after function");
                this.pos += 1;
                const inner = this.expr();
                this.skipSpaces();
                if (this.peek() !== ")")
                    throw new Error("Missing closing paren");
                this.pos += 1;
                return this.percentSuffix({ v: FUNCTIONS[name](inner.pct ? inner.v / 100 : inner.v), pct: false });
            }
            throw new Error(`Unknown identifier ${name}`);
        }
        const match = /^\d[\d,]*(\.\d+)?/.exec(this.input.slice(this.pos));
        if (!match)
            throw new Error("Expected number");
        this.pos += match[0].length;
        return this.percentSuffix({ v: parseFloat(match[0].replaceAll(",", "")), pct: false });
    }
    percentSuffix(value) {
        this.skipSpaces();
        const rest = this.input.slice(this.pos + 1).trimStart();
        if (this.peek() === "%" && !rest.match(/^[\d(]/)) {
            this.pos += 1;
            return { v: value.v, pct: true };
        }
        return value;
    }
}
export function evaluateExpression(input) {
    const trimmed = input.trim();
    if (!trimmed || !/\d/.test(trimmed))
        return null;
    if (!ALLOWED.test(trimmed) || !LOOKS_LIKE_MATH.test(trimmed))
        return null;
    let value;
    try {
        value = new Parser(trimmed).parse();
    }
    catch {
        return null;
    }
    if (!Number.isFinite(value))
        return null;
    const clean = parseFloat(value.toPrecision(12));
    return {
        value: clean,
        formatted: clean.toLocaleString("en-US", { maximumFractionDigits: 8 }),
        plain: String(clean)
    };
}
