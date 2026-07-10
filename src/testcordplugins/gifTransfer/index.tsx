/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import type { ModuleFactory } from "@vencord/discord-types/webpack";
import { findByPropsLazy, wreq } from "@webpack";
import { showToast, Toasts, UserSettingsActionCreators, UserSettingsProtoStore } from "@webpack/common";

const logger = new Logger("GifTransfer");

// ─── Types ───────────────────────────────────────────────────────────────────

interface GifEntry {
    url: string;
    src: string;
    width: number;
    height: number;
    format: number;
    order: number;
}

interface ExportFile {
    version: number;
    exportedAt: string;
    totalGifs: number;
    gifs: GifEntry[];
}

// ─── Settings ────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    skipDuplicates: {
        type: OptionType.BOOLEAN,
        description: "Skip GIFs that are already in your favorites when importing",
        default: true,
    },
    runtimeUnlock: {
        type: OptionType.BOOLEAN,
        description: "Lift the favorite GIF limit at runtime without a restart. Re-evaluates Discord's FrecencyUserSettings module. Only needed if the limit patch did not apply on startup.",
        default: false,
    },
    delayBetweenImports: {
        type: OptionType.NUMBER,
        description: "Wait between each GIF when importing (ms). Prevents Discord rate-limits.",
        default: 800,
    },
    autoIncreaseDelay: {
        type: OptionType.BOOLEAN,
        description: "Automatically increase delay when hitting rate limits. Prevents 429 errors.",
        default: true,
    },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const UserSettingsDelay = findByPropsLazy("INFREQUENT_USER_ACTION");

function getFrecencyActions(): any | null {
    try {
        return UserSettingsActionCreators?.FrecencyUserSettingsActionCreators ?? null;
    } catch {
        return null;
    }
}

function getCurrentGifs(): Record<string, GifEntry> {
    try {
        const fromProto = UserSettingsProtoStore?.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs;
        if (fromProto) return fromProto;
    } catch { }
    try {
        const fromActions = getFrecencyActions()?.getCurrentValue?.()?.favoriteGifs?.gifs;
        if (fromActions) return fromActions;
    } catch { }
    return {};
}

function getAddGifFn(): ((gif: any) => void) | null {
    const actions = getFrecencyActions();
    if (!actions || typeof actions.updateAsync !== "function") return null;

    return (gif: any) => {
        const existing = getCurrentGifs();
        const orders = Object.values(existing).map((g: any) => g?.order ?? 0);
        const maxOrder = orders.length > 0 ? Math.max(...orders) : 0;
        const newOrder = maxOrder + 1;

        actions.updateAsync(
            "favoriteGifs",
            (favoriteGifs: any) => {
                if (!favoriteGifs) return;
                if (!favoriteGifs.gifs) favoriteGifs.gifs = {};
                if (favoriteGifs.gifs[gif.url]) return;
                favoriteGifs.gifs[gif.url] = {
                    src: gif.src ?? gif.url,
                    width: Number(gif.width) || 498,
                    height: Number(gif.height) || 280,
                    format: Number(gif.format) || 2,
                    order: newOrder,
                };
            },
            UserSettingsDelay?.INFREQUENT_USER_ACTION ?? 3
        );
    };
}

// ─── Runtime limit lift (no restart) ──────────────────────────────────────────

let runtimeUnlockApplied = false;
const LIMIT_RE = /\.toBinary\(t\)\.length>\d+/;

function applyRuntimeUnlock(): boolean {
    if (runtimeUnlockApplied) return true;

    const factories = wreq?.m;
    if (!factories) {
        logger.warn("Webpack module map unavailable, cannot lift limit at runtime.");
        return false;
    }

    for (const id in factories) {
        const src = factories[id].toString();
        if (!LIMIT_RE.test(src)) continue;

        const patched = src.replace(LIMIT_RE, ".toBinary(t).length>Number.MAX_SAFE_INTEGER");
        // Already lifted (e.g. by the static patch on this same module) — nothing to do.
        if (patched === src) {
            runtimeUnlockApplied = true;
            logger.info("Limit already lifted on module", id, "skipping runtime re-eval.");
            return true;
        }

        try {
            const isArrow = patched.startsWith("(");
            const wrapped = "0," + (isArrow ? "" : "function") + patched.slice(patched.indexOf("("));
            wreq.m[id] = (0, eval)(wrapped) as ModuleFactory;
            delete wreq.c[id];
            wreq(id);
            runtimeUnlockApplied = true;
            logger.info("Lifted favorite GIF limit at runtime on module", id);
            return true;
        } catch (e) {
            logger.error("Runtime limit lift failed on module", id, e);
            return false;
        }
    }

    logger.warn("Could not find the favorite GIF limit module to lift at runtime.");
    return false;
}

// ─── Export ──────────────────────────────────────────────────────────────────

async function exportGifs(): Promise<void> {
    const gifs = getCurrentGifs();
    const entries = Object.entries(gifs);

    if (entries.length === 0) {
        showToast("No favorite GIFs found to export.", Toasts.Type.FAILURE);
        return;
    }

    const gifsArray: GifEntry[] = entries.map(([url, data]: [string, any]) => ({
        url,
        src: data.src,
        width: Number(data.width) || 498,
        height: Number(data.height) || 280,
        format: Number(data.format) || 2,
        order: Number(data.order) || 0,
    }));

    const exportData: ExportFile = {
        version: 2,
        exportedAt: new Date().toISOString(),
        totalGifs: gifsArray.length,
        gifs: gifsArray,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gif-favorites-${Date.now()}.json`;
    a.click();

    showToast(`Exported ${gifsArray.length} GIFs successfully!`, Toasts.Type.SUCCESS);
}

// ─── Verify ──────────────────────────────────────────────────────────────────

async function verifyGifs(file: File): Promise<void> {
    try {
        const text = await file.text();
        const data: ExportFile = JSON.parse(text);

        if (!data.gifs || !Array.isArray(data.gifs)) {
            showToast("Invalid file format.", Toasts.Type.FAILURE);
            return;
        }

        const currentGifs = getCurrentGifs();
        const currentUrls = new Set(Object.keys(currentGifs));

        let found = 0;
        let missing = 0;
        let duplicates = 0;
        const missingList: string[] = [];

        for (const gif of data.gifs) {
            if (currentUrls.has(gif.url)) {
                found++;
            } else {
                missing++;
                missingList.push(gif.url);
            }
        }

        const urlsSeen = new Set<string>();
        for (const gif of data.gifs) {
            if (urlsSeen.has(gif.url)) duplicates++;
            else urlsSeen.add(gif.url);
        }

        const report = [
            "=== GIF Verification Report ===",
            `Total in file: ${data.gifs.length}`,
            `Found in favorites: ${found}`,
            `Missing from favorites: ${missing}`,
            `Duplicate URLs in file: ${duplicates}`,
            missing > 0
                ? `\nMissing GIFs:\n${missingList.slice(0, 10).join("\n")}${missingList.length > 10 ? `\n...and ${missingList.length - 10} more` : ""}`
                : "\nAll GIFs are present! ✅",
        ].join("\n");

        console.log(report);

        if (missing === 0) {
            showToast(`All ${found} GIFs verified! No missing GIFs. ✅`, Toasts.Type.SUCCESS);
        } else {
            showToast(`Missing ${missing} GIFs. Press Import again to retry. Check console for details.`, Toasts.Type.FAILURE);
        }
    } catch (e) {
        showToast("Failed to read file.", Toasts.Type.FAILURE);
        console.error("[GifTransfer] Verify error:", e);
    }
}

// ─── Import ──────────────────────────────────────────────────────────────────

async function importGifs(file: File): Promise<void> {
    const addGif = getAddGifFn();
    if (!addGif) {
        showToast("Could not find Discord's internal GIF function. Try reloading Discord.", Toasts.Type.FAILURE);
        return;
    }

    let data: ExportFile;
    try {
        data = JSON.parse(await file.text());
    } catch {
        showToast("Invalid JSON file.", Toasts.Type.FAILURE);
        return;
    }

    if (!data.gifs || !Array.isArray(data.gifs)) {
        showToast("Invalid file format.", Toasts.Type.FAILURE);
        return;
    }

    const seen = new Set<string>();
    const deduped = data.gifs.filter(gif => {
        if (seen.has(gif.url)) return false;
        seen.add(gif.url);
        return true;
    });

    const filedupes = data.gifs.length - deduped.length;
    if (filedupes > 0) console.log(`[GifTransfer] Removed ${filedupes} duplicate URLs from import file.`);

    const currentGifs = getCurrentGifs();
    const currentUrls = new Set(Object.keys(currentGifs));

    const toImport = settings.store.skipDuplicates
        ? deduped.filter(gif => !currentUrls.has(gif.url))
        : deduped;

    const skipped = deduped.length - toImport.length;

    if (toImport.length === 0) {
        showToast("All GIFs are already in your favorites. Nothing to import. ✅", Toasts.Type.MESSAGE);
        return;
    }

    showToast(`Importing ${toImport.length} GIFs... (${skipped} skipped as duplicates)`, Toasts.Type.MESSAGE);
    console.log(`[GifTransfer] Starting import: ${toImport.length} GIFs | Skipping: ${skipped} | File dupes removed: ${filedupes}`);

    let ok = 0;
    let err = 0;
    let delay = settings.store.delayBetweenImports ?? 800;
    let rateLimitHits = 0;

    for (const gif of toImport) {
        try {
            addGif({
                url: gif.url,
                src: gif.src ?? gif.url,
                width: Number(gif.width) || 498,
                height: Number(gif.height) || 280,
                format: Number(gif.format) || 2,
            });
            ok++;
        } catch (e: any) {
            err++;
            // Check if it's a rate limit error
            const isRateLimit = e?.status === 429 || e?.text?.includes("rate limit") || e?.body?.retry_after;
            if (isRateLimit && settings.store.autoIncreaseDelay) {
                rateLimitHits++;
                delay = Math.min(delay * 2, 5000); // Double delay, max 5s
                console.log(`[GifTransfer] Rate limit hit! Increased delay to ${delay}ms`);
                showToast(`Rate limited. Increased delay to ${delay}ms. Retrying...`, Toasts.Type.FAILURE);
                // Wait extra to let Discord cool down
                await sleep(delay * 2);
                continue; // Retry this GIF with new delay
            }
            console.warn("[GifTransfer] Failed to import GIF:", gif.url, e);
        }

        await sleep(delay);

        if ((ok + err) % 50 === 0)
            console.log(`[GifTransfer] Progress: ${ok + err}/${toImport.length} | OK: ${ok} | Errors: ${err} | Delay: ${delay}ms`);
    }

    console.log(`[GifTransfer] ✅ Done! Imported: ${ok} | Errors: ${err} | Skipped: ${skipped}`);
    showToast(`Import complete! ${ok} GIFs added, ${skipped} duplicates skipped, ${err} errors.`, ok > 0 ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE);
}

// ─── File Picker Helper ───────────────────────────────────────────────────────

function openFilePicker(onFile: (file: File) => void): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
    };
    input.click();
}

// ─── DOM Injection ───────────────────────────────────────────────────────────

const BUTTONS_ID = "gif-transfer-buttons";

function createButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute("data-gif-transfer", "true");
    Object.assign(btn.style, {
        background: "none",
        border: "1px solid var(--interactive-normal, #b9bbbe)",
        borderRadius: "4px",
        color: "var(--interactive-normal, #b9bbbe)",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: "600",
        fontFamily: "var(--font-primary, Whitney)",
        padding: "2px 8px",
        margin: "0 2px",
        height: "24px",
        lineHeight: "1",
        transition: "background 0.15s, color 0.15s, border-color 0.15s",
        whiteSpace: "nowrap",
        flexShrink: "0",
    });
    btn.addEventListener("mouseenter", () => {
        btn.style.background = "var(--brand-500, #5865f2)";
        btn.style.color = "#fff";
        btn.style.borderColor = "var(--brand-500, #5865f2)";
    });
    btn.addEventListener("mouseleave", () => {
        btn.style.background = "none";
        btn.style.color = "var(--interactive-normal, #b9bbbe)";
        btn.style.borderColor = "var(--interactive-normal, #b9bbbe)";
    });
    btn.addEventListener("click", e => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

function injectButtons(navList: Element): void {
    if (navList.querySelector(`#${BUTTONS_ID}`)) return;

    const wrapper = document.createElement("div");
    wrapper.id = BUTTONS_ID;
    Object.assign(wrapper.style, {
        display: "flex",
        alignItems: "center",
        marginLeft: "auto",
        paddingRight: "8px",
        gap: "4px",
        pointerEvents: "all",
    });

    wrapper.appendChild(createButton("Export", "Export favorite GIFs to JSON file", () => exportGifs()));
    wrapper.appendChild(createButton("Import", "Import favorite GIFs from JSON file (skips duplicates)", () => openFilePicker(f => importGifs(f))));
    wrapper.appendChild(createButton("Verify", "Check which GIFs from a file are missing from your favorites", () => openFilePicker(f => verifyGifs(f))));

    (navList as HTMLElement).style.display = "flex";
    (navList as HTMLElement).style.alignItems = "center";

    navList.appendChild(wrapper);
}

function tryInject(): void {
    const pickerOpen = document.getElementById("gif-picker-tab") != null;
    if (!pickerOpen) {
        document.getElementById(BUTTONS_ID)?.remove();
        return;
    }

    const allTabLists = document.querySelectorAll('[role="tablist"]');
    for (const tl of allTabLists) {
        const label = (tl.getAttribute("aria-label") ?? "").toLowerCase();
        if (
            label.includes("expresi") ||
            label.includes("expression") ||
            label.includes("categor") ||
            label.includes("selector") ||
            label.includes("picker")
        ) {
            // Check if the currently selected tab is GIF (by text or by id)
            const activeTab = tl.querySelector('[role="tab"][aria-selected="true"]');
            const activeIsGif =
                activeTab?.textContent?.trim().toUpperCase() === "GIF" ||
                activeTab?.id === "gif-picker-tab" ||
                activeTab?.closest("[id*=gif-picker]") != null;
            if (activeIsGif) {
                injectButtons(tl);
            } else {
                // Remove buttons if not on GIF tab
                tl.querySelector("#" + BUTTONS_ID)?.remove();
            }
            return;
        }
    }
}

let injectTimer: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function startObserver(): void {
    pollInterval = setInterval(() => {
        tryInject();
    }, 1000);
    tryInject();
}

function stopObserver(): void {
    if (injectTimer) {
        clearTimeout(injectTimer);
        injectTimer = null;
    }
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    document.querySelectorAll(`#${BUTTONS_ID}`).forEach(el => el.remove());
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "GifTransfer",
    description: "Export and import all your favorite GIFs between accounts. Bypasses Discord's limit via patches.",
    tags: ["Media", "Utility"],
    authors: [TestcordDevs.nnenaza, TestcordDevs.x2b],
    settings,

    patches: [
        {
            find: "toBinary(t).length>",
            noWarn: true,
            replacement: {
                match: /\.toBinary\(\i\)\.length>\d+/,
                replace: ".toBinary(t).length>Number.MAX_SAFE_INTEGER",
            }
        },
    ],

    settingsAboutComponent() {
        return (
            <div style={{ fontSize: "14px", lineHeight: "1.8" }}>
                <p style={{ marginBottom: "12px", color: "var(--header-secondary, #b9bbbe)" }}>
                    Adds <b style={{ color: "var(--header-primary, #fff)" }}>Export</b>, <b style={{ color: "var(--header-primary, #fff)" }}>Import</b>, and <b style={{ color: "var(--header-primary, #fff)" }}>Verify</b> buttons to the GIF picker tab bar,
                    so you can transfer your favorite GIFs between Discord accounts.
                </p>

                <p style={{ marginBottom: "4px", color: "var(--header-primary, #fff)" }}>📤 <b>Export</b> <span style={{ color: "var(--header-secondary, #b9bbbe)", fontWeight: "normal" }}>— saves all your favorite GIFs to a .json file.</span></p>
                <p style={{ marginBottom: "4px", color: "var(--header-primary, #fff)" }}>📥 <b>Import</b> <span style={{ color: "var(--header-secondary, #b9bbbe)", fontWeight: "normal" }}>— loads GIFs from a .json file. Skips duplicates automatically.</span></p>
                <p style={{ marginBottom: "16px", color: "var(--header-primary, #fff)" }}>🔍 <b>Verify</b> <span style={{ color: "var(--header-secondary, #b9bbbe)", fontWeight: "normal" }}>— checks which GIFs from a file are missing from your favorites.</span></p>

                <p style={{ marginBottom: "6px", color: "#43b581", fontWeight: "700", fontSize: "13px" }}>
                    ✅ Bypasses Discord's GIF Limit
                </p>
                <p style={{ marginBottom: "16px", color: "var(--header-secondary, #b9bbbe)" }}>
                    Patches Discord's internal validation to remove the "Too many favorite GIFs" limit.
                    Uses Discord's actual API so GIFs appear in your favorites properly.
                    Includes automatic rate limit handling — slows down if Discord asks it to.
                </p>

                <Link href="https://github.com/Mixiruri" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <img
                        src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png"
                        alt="GitHub"
                        style={{ width: 20, height: 20, borderRadius: "50%", verticalAlign: "middle" }}
                    />
                    <span>Mixiruri on GitHub</span>
                </Link>
            </div>
        );
    },

    start() {
        try {
            UserSettingsActionCreators?.FrecencyUserSettingsActionCreators?.loadIfNecessary?.();
        } catch { }
        if (settings.store.runtimeUnlock) applyRuntimeUnlock();
        startObserver();
    },

    stop() {
        stopObserver();
    },

    toolboxActions: {
        "Export Favorite GIFs"() {
            exportGifs();
        },
        "Import Favorite GIFs"() {
            openFilePicker(file => importGifs(file));
        },
        "Verify GIFs (compare file vs favorites)"() {
            openFilePicker(file => verifyGifs(file));
        },
    },
});
