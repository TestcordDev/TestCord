/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export default class TarFile {
    buffers;
    constructor() {
        this.buffers = [];
    }
    addTextFile(name, text, metadata = {}) {
        this.addFile(name, new TextEncoder().encode(text), metadata);
    }
    addFile(name, data, { mtime = 0 } = {}) {
        this.buffers.push(this.header([
            [100, name.toString()], // name
            [8, 0o644], // mode
            [8, 0o1000], // uid
            [8, 0o1000], // gid
            [12, data.length], // size
            [12, mtime], // mtime
            [8, null], // checksum
            [1, "0"], // type
            [100, ""], // name of linked file (??)
            [255, ""], // padding
        ]));
        this.buffers.push(data.buffer);
        this.buffers.push(new ArrayBuffer(-data.length & 0x1FF));
    }
    header(fields) {
        const buffer = new ArrayBuffer(512);
        const u1 = new Uint8Array(buffer);
        let checksum = 0;
        let checksumPos = null;
        let pos = 0;
        for (const [size, val] of fields) {
            let string;
            if (val === null) {
                checksumPos = pos;
                string = " ".repeat(size);
            }
            else if (typeof val === "string") {
                string = val;
            }
            else if (typeof val === "number") {
                string = val.toString(8).padStart(size - 1, "0");
            }
            else {
                throw new Error("invalid value", val);
            }
            if (string.length > size)
                throw new Error(`${string} is longer than ${size} characters`);
            Array.from(string).forEach((c, i) => checksum += u1[pos + i] = c.charCodeAt(0));
            pos += size;
        }
        Array.from("\0".repeat(8)).forEach((c, i) => u1[checksumPos + i] = c.charCodeAt(0));
        Array.from(checksum.toString(8).padStart(7, "0")).forEach((c, i) => u1[checksumPos + i] = c.charCodeAt(0));
        return buffer;
    }
    save(filename) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(this.buffers, { "type": "application/x-tar" }));
        a.download = filename;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }
}
