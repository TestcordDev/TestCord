/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export function createInterpositionSlot(hook, read, write, nextSequence, onChange) {
    let captured = false;
    let original;
    const layers = [];
    function capture() {
        if (captured)
            return;
        original = read();
        captured = true;
    }
    function rebuild() {
        capture();
        let chain = original;
        for (const layer of [...layers].sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)) {
            chain = layer.wrap(chain);
        }
        write(chain);
    }
    return {
        register(owner, priority, wrap) {
            if (!owner.trim())
                throw new TypeError("Runtime hook owner must not be empty.");
            if (!Number.isFinite(priority))
                throw new TypeError("Runtime hook priority must be finite.");
            const layer = { owner, priority, sequence: nextSequence(), wrap };
            layers.push(layer);
            try {
                rebuild();
            }
            catch (error) {
                layers.splice(layers.indexOf(layer), 1);
                if (captured)
                    rebuild();
                throw error;
            }
            onChange();
            let disposed = false;
            return () => {
                if (disposed)
                    return;
                disposed = true;
                const index = layers.indexOf(layer);
                if (index === -1)
                    return;
                layers.splice(index, 1);
                rebuild();
                onChange();
            };
        },
        ownership() {
            return layers.map(layer => ({ owner: layer.owner, hook, priority: layer.priority }));
        }
    };
}
