/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { Button } from "@components/Button";
import { useEffect, useState } from "@webpack/common";

export function DeleteCacheButton() {
    const [size, setSize] = useState(0);
    const [deleteKeys, setDeleteKeys] = useState<string[]>([]);

    useEffect(() => {
        let unmounted = false;
        DataStore.entries().then(entries => {
            if (unmounted) return;
            let totalSize = 0;
            const keys: string[] = [];
            for (const [key, value] of entries) {
                if (typeof key === "string" && (key.startsWith("whisper-") || key.startsWith("onnx-"))) {
                    totalSize += (value as string).length;
                    keys.push(key);
                }
            }
            setSize(totalSize);
            setDeleteKeys(keys);
        });
        return () => { unmounted = true; };
    }, []);

    return <Button
        disabled={size === 0}
        variant="dangerPrimary"
        onClick={() => {
            DataStore.delMany(deleteKeys).then(() => { setSize(0); setDeleteKeys([]); });
        }}
    >
        Delete all cached files ({(size / 1024 / 1024).toFixed(2)} MB)
    </Button>;
}
