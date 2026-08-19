"use strict";
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/* eslint-disable @stylistic/no-mixed-spaces-and-tabs */
/**
* @name Uncompressed Images
* @author Knew
* @description Hijacks the client cache & alters the low quality thumbnail image shown by default to the lossless version that was uploaded. V4 boasts a completely new approach that performs more similarly to native Discord, unlike V1-V3, which all infamously lagged due to excessive DOM manipulation.
* @version 4.00
* @authorId 332116671294734336
* @authorLink https://github.com/Knewest
* @invite NqqqzajfK4
* @website https://twitter.com/KnewestLSEP
* @source https://github.com/Knewest/Uncompressed-Discord-Images
* @updateUrl https://raw.githubusercontent.com/Knewest/Uncompressed-Discord-Images/main/UncompressedImages.plugin.js
* @changelog {banner} https://betterdiscord.app/resources/thumbnails/1284.png
* @changelog {blurb} Missed or want to know previous changelogs? Find them [here](https://github.com/Knewest/Uncompressed-Discord-Images/releases).
* @changelog {footer} Need help? Join the [support server (NqqqzajfK4)](https://discord.gg/NqqqzajfK4).
*/
module.exports = class UncompressedImages {
    start() {
        (function () {
            "use strict";
            // Ensure each transformed URL is processed only once, so no repeated reloads.
            const urlCache = new Map();
            // List of video extensions that will be explicitly ignored so video embedding doesn't get bricked.
            const VIDEO_EXTENSIONS = new Set([
                "mp4", "mov", "webm", "av1", "mkv", "avi", "wmv", "m4v"
            ]);
            function isVideoExtension(url) {
                try {
                    const u = new URL(url, location.href);
                    const filename = u.pathname.split("/").pop().toLowerCase();
                    const ext = filename.split(".").pop();
                    return VIDEO_EXTENSIONS.has(ext);
                }
                catch (_) {
                    return false;
                }
            }
            // Converts 'media.discordapp.net' to 'cdn.discordapp.com', and also wiping '?format=webp' while keeping all the other parameters intact.
            function transformUrl(raw) {
                if (!raw || typeof raw !== "string")
                    return raw;
                if (!raw.includes("media.discordapp.net") && !raw.includes("/attachments/"))
                    return raw;
                if (isVideoExtension(raw)) {
                    urlCache.set(raw, "__VIDEO__");
                    return raw;
                }
                try {
                    // Cache hijacking.
                    const u = new URL(raw, location.href);
                    if (u.hostname === "media.discordapp.net" && u.pathname.startsWith("/attachments/")) {
                        u.hostname = "cdn.discordapp.com";
                        u.searchParams.delete("format");
                        return u.toString();
                    }
                }
                catch (e) {
                    // Backup method, if URL parsing fails.
                    try {
                        if (raw.indexOf("media.discordapp.net/attachments/") !== -1) {
                            let s = raw.replace("media.discordapp.net", "cdn.discordapp.com");
                            s = s.replace(/[?&]format=webp/gi, "");
                            s = s.replace("?&", "?").replace("&&", "&");
                            s = s.replace(/[?&]$/, "");
                            return s;
                        }
                    }
                    catch (_) { }
                }
                return raw;
            }
            // Transform 'srcset' entries.
            function transformSrcset(srcset) {
                if (!srcset || typeof srcset !== "string")
                    return srcset;
                // If the entire 'srcset' is for a video URL, filter it. (Search for "Video filter").
                if (isVideoExtension(srcset) || urlCache.get(srcset) === "__VIDEO__")
                    return srcset;
                return srcset.split(",").map(part => {
                    const trimmed = part.trim();
                    if (!trimmed)
                        return trimmed;
                    const spaceIndex = trimmed.search(/\s/);
                    if (spaceIndex === -1)
                        return transformUrl(trimmed);
                    const urlPart = trimmed.slice(0, spaceIndex);
                    const rest = trimmed.slice(spaceIndex);
                    if (isVideoExtension(urlPart) || urlCache.get(urlPart) === "__VIDEO__")
                        return trimmed;
                    return transformUrl(urlPart) + rest;
                }).join(", ");
            }
            // Reference to original DOM APIs.
            const imgProto = HTMLImageElement.prototype;
            const origSrcDesc = Object.getOwnPropertyDescriptor(imgProto, "src") || {};
            const origSrcsetDesc = Object.getOwnPropertyDescriptor(imgProto, "srcset") || {};
            const origSetAttribute = Element.prototype.setAttribute;
            const origGetAttribute = Element.prototype.getAttribute;
            // Hijack the cache to update the lower quality image with a higher quality one.
            function applyTransformedSrc(img, originalString) {
                try {
                    // Video embed filtering (Search for "Video filter").
                    if (isVideoExtension(originalString) || urlCache.get(originalString) === "__VIDEO__")
                        return false;
                    const cached = urlCache.get(originalString) || transformUrl(originalString);
                    urlCache.set(originalString, cached);
                    if (cached === originalString)
                        return false;
                    if (img.dataset.knewestUncompressedImagesCdn === cached)
                        return true;
                    img.dataset.knewestUncompressedImagesCdn = cached;
                    if (origSrcDesc && typeof origSrcDesc.set === "function") {
                        origSrcDesc.set.call(img, cached);
                    }
                    else {
                        Element.prototype.setAttribute = origSetAttribute;
                        try {
                            img.setAttribute("src", cached);
                        }
                        finally {
                            Element.prototype.setAttribute = setAttributeWrapper;
                        }
                    }
                    return true;
                }
                catch (_) {
                    return false;
                }
            }
            // Intercept 'setAttribute' for 'src' and 'srcset 'before the client tries to load them. Probably the biggest issue I had prior to V4.0.
            function setAttributeWrapper(name, value) {
                try {
                    const lower = String(name).toLowerCase();
                    if (lower === "src" && this instanceof HTMLImageElement) {
                        const s = String(value);
                        // Video filter.
                        if (isVideoExtension(s) || urlCache.get(s) === "__VIDEO__")
                            return origSetAttribute.call(this, name, value);
                        const transformed = urlCache.has(s) ? urlCache.get(s) : transformUrl(s);
                        urlCache.set(s, transformed);
                        if (transformed !== s)
                            return origSetAttribute.call(this, "src", transformed);
                    }
                    if (lower === "srcset" && this instanceof HTMLImageElement) {
                        const s = String(value);
                        if (isVideoExtension(s) || urlCache.get(s) === "__VIDEO__")
                            return origSetAttribute.call(this, name, value);
                        const transformed = transformSrcset(s);
                        if (transformed !== s)
                            return origSetAttribute.call(this, "srcset", transformed);
                    }
                }
                catch (_) { }
                return origSetAttribute.call(this, name, value);
            }
            Element.prototype.setAttribute = setAttributeWrapper;
            // 'getAttribute' wrapper.
            function getAttributeWrapper(name) {
                try {
                    const lower = String(name).toLowerCase();
                    if (lower === "src" && this instanceof HTMLImageElement) {
                        const val = origGetAttribute.call(this, "src") || "";
                        if (isVideoExtension(val) || urlCache.get(val) === "__VIDEO__")
                            return val;
                        return urlCache.get(val) || transformUrl(val);
                    }
                    if (lower === "srcset" && this instanceof HTMLImageElement) {
                        const val = origGetAttribute.call(this, "srcset") || "";
                        if (isVideoExtension(val) || urlCache.get(val) === "__VIDEO__")
                            return val;
                        return transformSrcset(val);
                    }
                }
                catch (_) { }
                return origGetAttribute.call(this, name);
            }
            Element.prototype.getAttribute = getAttributeWrapper;
            // Override '.src' property.
            if (origSrcDesc && typeof origSrcDesc.set === "function") {
                Object.defineProperty(imgProto, "src", {
                    configurable: true,
                    enumerable: true,
                    get: function () {
                        if (this.dataset && this.dataset.knewestUncompressedImagesCdn)
                            return this.dataset.knewestUncompressedImagesCdn;
                        return origSrcDesc.get.call(this);
                    },
                    set: function (val) {
                        try {
                            const s = String(val || "");
                            // Video filter.
                            if (isVideoExtension(s) || urlCache.get(s) === "__VIDEO__")
                                return origSrcDesc.set.call(this, val);
                            if (!s.includes("media.discordapp.net") || !s.includes("/attachments/"))
                                return origSrcDesc.set.call(this, val);
                            const transformed = urlCache.get(s) || transformUrl(s);
                            urlCache.set(s, transformed);
                            if (this.dataset)
                                this.dataset.knewestUncompressedImagesCdn = transformed;
                            return origSrcDesc.set.call(this, transformed);
                        }
                        catch (_) { }
                        return origSrcDesc.set.call(this, val);
                    }
                });
            }
            // Override '.srcset' property.
            if (origSrcsetDesc && typeof origSrcsetDesc.set === "function") {
                Object.defineProperty(imgProto, "srcset", {
                    configurable: true,
                    enumerable: true,
                    get: function () {
                        return origSrcsetDesc.get.call(this);
                    },
                    set: function (val) {
                        try {
                            const s = String(val || "");
                            if (isVideoExtension(s) || urlCache.get(s) === "__VIDEO__")
                                return origSrcsetDesc.set.call(this, val);
                            const transformed = transformSrcset(s);
                            if (transformed !== s)
                                return origSrcsetDesc.set.call(this, transformed);
                        }
                        catch (_) { }
                        return origSrcsetDesc.set.call(this, val);
                    }
                });
            }
            // Main function that processes an image once and applies the correct transformations. Versions piror to V4 often processed an image several times...
            function processImg(img) {
                try {
                    if (!(img instanceof HTMLImageElement))
                        return;
                    // Video filter.
                    if (isVideoExtension(img.src) || urlCache.get(img.src) === "__VIDEO__")
                        return;
                    const attrSrc = origGetAttribute.call(img, "src");
                    if (attrSrc) {
                        applyTransformedSrc(img, attrSrc);
                    }
                    else {
                        const propSrc = img.src;
                        if (propSrc.includes("media.discordapp.net") && propSrc.includes("/attachments/")) {
                            applyTransformedSrc(img, propSrc);
                        }
                    }
                    const attrSrcset = origGetAttribute.call(img, "srcset");
                    if (attrSrcset) {
                        const t = transformSrcset(attrSrcset);
                        if (t !== attrSrcset)
                            origSetAttribute.call(img, "srcset", t);
                    }
                }
                catch (_) { }
            }
            // On start, sweep the entire DOM for '<img>' elements and secure them.
            function initialSweep() {
                try {
                    const imgs = document.getElementsByTagName("img");
                    for (const img of imgs)
                        processImg(img);
                }
                catch (_) { }
            }
            initialSweep();
        })();
    } // Main code ends here, don't forget. That "}" is attached to the "start () {" function.
    stop() {
        // Restore Image prototype descriptors
        if (this._origSrcDesc) {
            Object.defineProperty(HTMLImageElement.prototype, "src", this._origSrcDesc);
        }
        if (this._origSrcsetDesc) {
            Object.defineProperty(HTMLImageElement.prototype, "srcset", this._origSrcsetDesc);
        }
        // Restore document.createElement
        if (this._origCreateElement) {
            document.createElement = this._origCreateElement;
        }
        // Restore attribute handlers
        if (this._origSetAttribute) {
            Element.prototype.setAttribute = this._origSetAttribute;
        }
        if (this._origGetAttribute) {
            Element.prototype.getAttribute = this._origGetAttribute;
        }
        // Clear URL cache used by this script
        if (this._urlCache && this._urlCache.clear) {
            this._urlCache.clear();
        }
    }
};
/**
* Version 4.00 of 'Uncompressed Images'.
* Copyright (Boost Software License 1.0) 2023-2026 Knew
* Link to plugin: https://github.com/Knewest/Uncompressed-Discord-Images
* Support server: https://discord.gg/NqqqzajfK4
*/
/** IGNORE THIS
* @changelog {banner} https://cdn.discordapp.com/attachments/753561208073879642/1134847376541106176/output_animation8.webp
* @changelog {blurb} Missed or want to know previous changelogs? Find them [here](https://github.com/Knewest/embed-more-images/releases).
* @changelog {fixed.item}
* @changelog {added.title} What I changed
* @changelog {added.item}
* @changelog {footer} Need help? Join my the [support server (NqqqzajfK4)](https://discord.gg/NqqqzajfK4).
*/
