/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { Button, Forms, React, showToast, Toasts } from "@webpack/common";
// ── Constants ──────────────────────────────────────────────────────────────────
const STYLE_ID = "live-wallpaper-style";
const CONTAINER_ID = "live-wallpaper-container";
let active = false;
let wallpaperGeneration = 0;
// ── File picker ────────────────────────────────────────────────────────────────
function pickFile() {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*,video/mp4,video/webm,.gif";
        input.style.display = "none";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
            input.remove();
        };
        input.oncancel = () => { resolve(null); input.remove(); };
        document.body.appendChild(input);
        input.click();
    });
}
const LOCAL_DATA_KEY = "live-wallpaper-local-data";
const REMOTE_URL_KEY = "live-wallpaper-remote-url";
async function getWallpaperUrl() {
    const remote = await DataStore.get(REMOTE_URL_KEY);
    if (remote)
        return remote;
    const local = await DataStore.get(LOCAL_DATA_KEY);
    return local || "";
}
function SettingsComponent() {
    const [currentUrl, setCurrentUrl] = React.useState("");
    const [inputValue, setInputValue] = React.useState("");
    const mounted = React.useRef(true);
    React.useEffect(() => {
        getWallpaperUrl().then(url => {
            if (!mounted.current)
                return;
            setCurrentUrl(url);
            if (!url.startsWith("data:"))
                setInputValue(url);
        });
        return () => { mounted.current = false; };
    }, []);
    const isDataUrl = currentUrl.startsWith("data:");
    const hasFile = currentUrl.length > 0;
    return (<div className="live-wallpaper-settings">
            <Forms.FormTitle tag="h3">File (Image / Gif / Video)</Forms.FormTitle>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* File Picker */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <Button size={Button.Sizes.SMALL} onClick={async () => {
            const dataUrl = await pickFile();
            if (!mounted.current)
                return;
            if (dataUrl) {
                await DataStore.set(REMOTE_URL_KEY, "");
                await DataStore.set(LOCAL_DATA_KEY, dataUrl);
                if (!mounted.current)
                    return;
                setCurrentUrl(dataUrl);
                setInputValue("");
                applyWallpaper();
                showToast("Local wallpaper applied!", Toasts.Type.SUCCESS);
            }
        }}>
                        📁 Choose a local file
                    </Button>

                    {hasFile && (<Button size={Button.Sizes.SMALL} color={Button.Colors.RED} onClick={async () => {
                await DataStore.set(REMOTE_URL_KEY, "");
                await DataStore.set(LOCAL_DATA_KEY, "");
                if (!mounted.current)
                    return;
                setCurrentUrl("");
                setInputValue("");
                applyWallpaper();
                showToast("Wallpaper removed", Toasts.Type.SUCCESS);
            }}>
                            🗑️ Delete
                        </Button>)}
                </div>

                {/* URL Input (Alternative) */}
                <div style={{ marginTop: "8px" }}>
                    <Forms.FormTitle tag="h5" style={{ marginBottom: "8px" }}>OR Paste a URL</Forms.FormTitle>
                    <input type="text" placeholder="https://example.com/video.mp4" value={isDataUrl ? "✅ [Local file loaded]" : inputValue} disabled={isDataUrl} style={{
            width: "100%",
            padding: "8px",
            borderRadius: "4px",
            background: "var(--input-background)",
            color: "var(--text-normal)",
            border: "1px solid var(--input-border)",
            cursor: isDataUrl ? "not-allowed" : "text",
            opacity: isDataUrl ? 0.6 : 1
        }} onChange={async (e) => {
            const val = e.target.value.trim();
            setInputValue(val);
            await DataStore.set(LOCAL_DATA_KEY, "");
            await DataStore.set(REMOTE_URL_KEY, val);
            if (!mounted.current)
                return;
            setCurrentUrl(val);
            applyWallpaper();
        }}/>
                </div>
            </div>

            {hasFile && (<div style={{ marginTop: "10px", fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                    {isDataUrl
                ? `✅ Local file: ${Math.round(currentUrl.length / 1024)} KB`
                : `✅ URL: ${currentUrl.slice(0, 50)}${currentUrl.length > 50 ? "..." : ""}`}
                </div>)}

            <div style={{ margin: "20px 0", borderBottom: "1px solid var(--background-modifier-accent)" }}/>
        </div>);
}
// ── Settings ───────────────────────────────────────────────────────────────────
const settings = definePluginSettings({
    main: {
        type: 6 /* OptionType.COMPONENT */,
        component: SettingsComponent,
    },
    // Note: We removed wallpaperUrl from here.
    // Storage is handled MANUALLY via DataStore in SettingsComponent.
    opacity: {
        type: 5 /* OptionType.SLIDER */,
        description: "Wallpaper opacity (0 = invisible, 0.5 = max)",
        markers: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5],
        default: 0.15,
        stickToMarkers: false,
        restartNeeded: false,
        onChange() { applyWallpaper(); },
    },
    blur: {
        type: 5 /* OptionType.SLIDER */,
        description: "Wallpaper blur (px)",
        markers: [0, 2, 5, 10, 15, 20, 30],
        default: 0,
        stickToMarkers: false,
        restartNeeded: false,
        onChange() { applyWallpaper(); },
    },
    brightness: {
        type: 5 /* OptionType.SLIDER */,
        description: "Wallpaper brightness (0.1 = very dark, 1 = normal, 2 = very bright)",
        markers: [0.1, 0.2, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0],
        default: 1.0,
        stickToMarkers: false,
        restartNeeded: false,
        onChange() { applyWallpaper(); },
    },
    muted: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Muted (no sound by default)",
        default: true,
        restartNeeded: false,
        onChange() { applyWallpaper(); },
    },
    volume: {
        type: 5 /* OptionType.SLIDER */,
        description: "Wallpaper volume",
        markers: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
        default: 1.0,
        stickToMarkers: false,
        restartNeeded: false,
        onChange() { applyWallpaper(); },
    },
});
// ── Wallpaper injection ────────────────────────────────────────────────────────
function removeWallpaperElements() {
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(CONTAINER_ID)?.remove();
}
async function applyWallpaper() {
    const generation = ++wallpaperGeneration;
    removeWallpaperElements();
    const url = await getWallpaperUrl();
    if (!active || generation !== wallpaperGeneration)
        return;
    if (!url)
        return;
    const opacity = settings.store.opacity ?? 0.15;
    const blur = settings.store.blur ?? 0;
    const brightness = settings.store.brightness ?? 1.0;
    const muted = settings.store.muted ?? true;
    const volume = settings.store.volume ?? 1.0;
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.startsWith("data:video/");
    const filters = [];
    if (blur > 0)
        filters.push(`blur(${blur}px)`);
    if (brightness !== 1.0)
        filters.push(`brightness(${brightness})`);
    const filterCSS = filters.length > 0 ? `filter: ${filters.join(" ")};` : "";
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
/* ── LiveWallpaper: full screen overlay OVER Discord ── */
#${CONTAINER_ID} {
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    z-index: 2147483647;
    pointer-events: none;
    overflow: hidden;
    opacity: ${opacity};
    ${filterCSS}
}
#${CONTAINER_ID} img,
#${CONTAINER_ID} video {
    width: 100%; height: 100%;
    object-fit: cover;
}
`.trim();
    document.head.appendChild(style);
    // Create the container with the image/video
    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    if (isVideo) {
        const video = document.createElement("video");
        video.src = url;
        video.autoplay = true;
        video.loop = true;
        video.muted = muted;
        video.volume = volume;
        video.playsInline = true;
        container.appendChild(video);
    }
    else {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        img.draggable = false;
        container.appendChild(img);
    }
    // Inject at the end of body (on top of everything)
    document.body.appendChild(container);
}
// ── Plugin ─────────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "LiveWallpaper",
    description: "Global wallpaper for the entire Discord interface (image, gif, video). Compatible with ChannelWallpaper.",
    tags: ["Appearance", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],
    settings,
    _startTimer: null,
    start() {
        active = true;
        wallpaperGeneration++;
        // Small delay to let the DOM be ready
        this._startTimer = setTimeout(() => {
            this._startTimer = null;
            applyWallpaper();
        }, 300);
    },
    stop() {
        active = false;
        wallpaperGeneration++;
        if (this._startTimer) {
            clearTimeout(this._startTimer);
            this._startTimer = null;
        }
        removeWallpaperElements();
    },
});
