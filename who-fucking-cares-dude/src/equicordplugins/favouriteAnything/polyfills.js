/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
function supportsToBase64(array) {
    return "toBase64" in array && typeof array.toBase64 === "function";
}
function supportsFromBase64(ctor) {
    return "fromBase64" in ctor && typeof ctor.fromBase64 === "function";
}
const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const map = new Map(chars.split("").map((c, i) => [c, i]));
export function uint8ArrayToBase64(arr) {
    if (supportsToBase64(arr)) {
        return arr.toBase64({ alphabet: "base64url", omitPadding: true });
    }
    if ("detached" in arr.buffer && arr.buffer.detached) {
        throw new TypeError("toBase64 called on array backed by detached buffer");
    }
    let result = "";
    let i = 0;
    for (; i + 2 < arr.length; i += 3) {
        const triplet = (arr[i] << 16) + (arr[i + 1] << 8) + arr[i + 2];
        result +=
            chars[(triplet >> 18) & 63] +
                chars[(triplet >> 12) & 63] +
                chars[(triplet >> 6) & 63] +
                chars[triplet & 63];
    }
    if (i + 2 === arr.length) {
        const triplet = (arr[i] << 16) + (arr[i + 1] << 8);
        result += chars[(triplet >> 18) & 63] + chars[(triplet >> 12) & 63] + chars[(triplet >> 6) & 63];
    }
    else if (i + 1 === arr.length) {
        const triplet = arr[i] << 16;
        result += chars[(triplet >> 18) & 63] + chars[(triplet >> 12) & 63];
    }
    return result;
}
function decodeBase64Chunk(chunk) {
    const actualChunkLength = chunk.length;
    if (actualChunkLength < 4) {
        chunk += actualChunkLength === 2 ? "AA" : "A";
    }
    const c1 = chunk[0];
    const c2 = chunk[1];
    const c3 = chunk[2];
    const c4 = chunk[3];
    const triplet = (map.get(c1) << 18) + (map.get(c2) << 12) + (map.get(c3) << 6) + map.get(c4);
    const chunkBytes = [(triplet >> 16) & 255, (triplet >> 8) & 255, triplet & 255];
    if (actualChunkLength === 2) {
        return [chunkBytes[0]];
    }
    else if (actualChunkLength === 3) {
        return [chunkBytes[0], chunkBytes[1]];
    }
    return chunkBytes;
}
const asciiWhitespaceRegex = /[\u0009\u000A\u000C\u000D\u0020]/;
function skipAsciiWhitespace(string, index) {
    for (; index < string.length; ++index) {
        if (!asciiWhitespaceRegex.test(string[index])) {
            break;
        }
    }
    return index;
}
export function base64ToUint8Array(string) {
    if (supportsFromBase64(Uint8Array)) {
        return Uint8Array.fromBase64(string, { alphabet: "base64url" });
    }
    const bytes = [];
    let chunk = "";
    let index = 0;
    while (true) {
        index = skipAsciiWhitespace(string, index);
        if (index === string.length) {
            if (chunk.length > 0) {
                if (chunk.length === 1) {
                    throw new SyntaxError("malformed padding: exactly one additional character");
                }
                bytes.push(...decodeBase64Chunk(chunk));
            }
            break;
        }
        const char = string[index];
        ++index;
        if (char === "=") {
            if (chunk.length < 2) {
                throw new SyntaxError("padding is too early");
            }
            index = skipAsciiWhitespace(string, index);
            if (chunk.length === 2) {
                if (index === string.length) {
                    throw new SyntaxError("malformed padding - only one =");
                }
                if (string[index] === "=") {
                    ++index;
                    index = skipAsciiWhitespace(string, index);
                }
            }
            if (index < string.length) {
                throw new SyntaxError("unexpected character after padding");
            }
            bytes.push(...decodeBase64Chunk(chunk));
            break;
        }
        if (!chars.includes(char)) {
            throw new SyntaxError(`unexpected character ${JSON.stringify(char)}`);
        }
        chunk += char;
        if (chunk.length === 4) {
            bytes.push(...decodeBase64Chunk(chunk));
            chunk = "";
        }
    }
    return new Uint8Array(bytes);
}
