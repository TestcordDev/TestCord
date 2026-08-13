/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useEffect, useState } from "@webpack/common";

import { lruSet, TEXT } from "../constants";
import { cl } from "../css";
import { Native } from "../nativeBridge";

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
const MAX_CACHE_ENTRIES = 8;

const cache = new Map<string, string>();

async function loadCover(coverUrl: string): Promise<string> {
    if (!Native) return "";

    const cached = cache.get(coverUrl);
    if (cached) {
        lruSet(cache, coverUrl, cached, MAX_CACHE_ENTRIES);
        return cached;
    }

    const resolved = await Native.getCoverDataUrl(coverUrl);
    if (resolved) lruSet(cache, coverUrl, resolved, MAX_CACHE_ENTRIES);
    return resolved;
}

export function TrackCover({ coverUrl, title }: { coverUrl: string; title: string; }) {
    const [source, setSource] = useState("");
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setSource(cache.get(coverUrl) ?? "");
        setAttempt(0);

        if (coverUrl) {
            void loadCover(coverUrl).then(resolved => {
                if (!cancelled) setSource(resolved);
            });
        }

        return () => {
            cancelled = true;
        };
    }, [coverUrl]);

    useEffect(() => {
        const delay = RETRY_DELAYS_MS[attempt];
        if (!coverUrl || source || delay === undefined) return;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            void loadCover(coverUrl).then(resolved => {
                if (cancelled) return;
                if (resolved) setSource(resolved);
                else setAttempt(value => value + 1);
            });
        }, delay);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [coverUrl, source, attempt]);

    if (!source) return null;

    return (
        <img
            className={cl("cover")}
            src={source}
            alt={`${TEXT.cover}: ${title}`}
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setSource("")}
        />
    );
}
