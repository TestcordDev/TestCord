/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { NativeSettings } from "@main/settings";
import { session } from "electron";
export const ConnectSrc = ["connect-src"];
export const ImageSrc = [...ConnectSrc, "img-src"];
export const CssSrc = ["style-src", "font-src"];
export const ImageAndMediaSrc = [...ImageSrc, "media-src"];
export const ImageAndCssSrc = [...ImageSrc, ...CssSrc];
export const ImageScriptsAndCssSrc = [...ImageAndCssSrc, "script-src", "worker-src"];
export const CSPSrc = ["style-src", "connect-src", "img-src", "frame-src", "font-src", "media-src", "worker-src"];
// Plugins can whitelist their own domains by importing this object in their native.ts
// script and just adding to it. But generally, you should just edit this file instead
export const CspPolicies = {
    "http://localhost:*": ImageAndCssSrc,
    "http://127.0.0.1:*": ImageAndCssSrc,
    "localhost:*": ImageAndCssSrc,
    "127.0.0.1:*": ImageAndCssSrc,
    "*.github.io": ImageAndCssSrc, // GitHub pages, used by most themes
    "github.com": ImageAndCssSrc, // GitHub content (stuff uploaded to markdown forms), used by most themes
    "raw.githubusercontent.com": ImageAndCssSrc, // GitHub raw, used by some themes
    "*.gitlab.io": ImageAndCssSrc, // GitLab pages, used by some themes
    "gitlab.com": ImageAndCssSrc, // GitLab raw, used by some themes
    "*.codeberg.page": ImageAndCssSrc, // Codeberg pages, used by some themes
    "codeberg.org": ImageAndCssSrc, // Codeberg raw, used by some themes
    "*.githack.com": ImageAndCssSrc, // githack (namely raw.githack.com), used by some themes
    "jsdelivr.net": ImageAndCssSrc, // jsDelivr, used by very few themes
    "fonts.googleapis.com": CssSrc, // Google Fonts, used by many themes
    "i.imgur.com": ImageSrc, // Imgur, used by some themes
    "i.ibb.co": ImageSrc, // ImgBB, used by some themes
    "i.pinimg.com": ImageSrc, // Pinterest, used by some themes
    "files.catbox.moe": ImageAndCssSrc, // Catbox, used by some themes
    "cdn.discordapp.com": ImageAndCssSrc, // Discord CDN, used by Vencord and some themes to load media
    "media.discordapp.net": ImageSrc, // Discord media CDN, possible alternative to Discord CDN
    // CDNs used for some things by Vencord.
    // FIXME: we really should not be using CDNs anymore
    "cdnjs.cloudflare.com": ImageScriptsAndCssSrc,
    "cdn.jsdelivr.net": ImageScriptsAndCssSrc,
    // Function Specific
    "api.github.com": ConnectSrc, // used for updating Vencord itself
    "ws.audioscrobbler.com": ConnectSrc, // Last.fm API
    "musicbrainz.org": ConnectSrc,
    "*.listenbrainz.org": ConnectSrc,
    "coverartarchive.org": ConnectSrc,
    "archive.org": ConnectSrc,
    "*.archive.org": ConnectSrc,
    "translate-pa.googleapis.com": ConnectSrc, // Google Translate API
    "*.vencord.dev": [...ImageAndCssSrc, ...ConnectSrc], // VenCloud (api.vencord.dev) and Badges (badges.vencord.dev)
    "manti.vendicated.dev": ImageSrc, // ReviewDB API
    "decor.fieryflames.dev": ConnectSrc, // Decor API
    "ugc.decor.fieryflames.dev": ImageSrc, // Decor CDN
    "sponsor.ajay.app": ConnectSrc, // Dearrow API
    "dearrow-thumb.ajay.app": ImageSrc, // Dearrow Thumbnail CDN
    "usrbg.is-hardly.online": ImageSrc, // USRBG API
    "icons.duckduckgo.com": ImageSrc, // DuckDuckGo Favicon API (Reverse Image Search)
    // Equicord & Spotify & CordCat APIs
    "badges.equicord.org": ImageAndCssSrc,
    "badge.equicord.org": ImageAndCssSrc, // badge images + badges.json (BadgeAPI)
    "obamabot.me": [...ConnectSrc, "img-src"], // third-party badge service (globalBadges)
    "*.obamabot.me": [...ConnectSrc, "img-src"],
    "themes.equicord.org": [...ImageAndCssSrc, ...ConnectSrc], // theme marketplace previews, CSS + API
    "equicord.org": ImageSrc, // plugin card / settings icons
    "cloud.equicord.org": ConnectSrc, // Equicord Cloud settings sync
    "spotify-lyrics-api-pi.vercel.app": ConnectSrc,
    "api.cord.cat": ConnectSrc,
    "fonts.google.com": ConnectSrc, // Google Fonts catalog RPC (font browser plugins)
    "timezone.creations.works": ConnectSrc, // timezone list
    // AI APIs — used by Testcord plugins (TestcordAI, ChatGPT, AutoCorrect, VoiceDictation, TriviaAI, etc.)
    "api.groq.com": ConnectSrc,
    "api.openai.com": ConnectSrc,
    "homelander.ca": ConnectSrc,
    "swishai.up.railway.app": ConnectSrc,
    // HCaptcha
    "*.hcaptcha.com": [...CSPSrc, "script-src"],
    // Tenor, used by TenorSearch plugin and some themes
    "*.tenor.com": ImageAndMediaSrc,
    "*.tenor.co": ImageAndMediaSrc,
    "api.tenor.com": ConnectSrc,
    // File hosters used by renderer-side upload paths (fileUpload, bigFileUpload, bypassUpload, BigFileUploadEnhanced)
    "gofile.io": ConnectSrc,
    "upload.gofile.io": ConnectSrc,
    "catbox.moe": ConnectSrc,
    "litterbox.catbox.moe": ConnectSrc,
    "tmpfiles.org": ConnectSrc,
    "temp.sh": ConnectSrc,
    "pixeldrain.com": ConnectSrc,
    "buzzheavier.com": ConnectSrc,
    "w.buzzheavier.com": ConnectSrc,
    "filebin.net": ConnectSrc,
    "nest.rip": ConnectSrc,
    "api.e-z.host": ConnectSrc,
    "encrypting.host": ConnectSrc,
    "pixelvault.co": ConnectSrc,
    "discord.nfp.is": ConnectSrc,
    "file.fast": ConnectSrc,
    "embeds.video": [...ConnectSrc, "frame-src"],
    "www.viewstl.com": [...ConnectSrc, "frame-src"],
    "drive.google.com": [...ConnectSrc, "frame-src"],
    "embed.tidal.com": [...ConnectSrc, "frame-src"],
    // Plugin APIs fetched from the renderer
    "aiapi.serversmp.xyz": ConnectSrc,
    "api.anthropic.com": ConnectSrc,
    "api.together.xyz": ConnectSrc,
    "openrouter.ai": ConnectSrc,
    "reidverse-ai.up.railway.app": ConnectSrc,
    "integrate.api.nvidia.com": ConnectSrc,
    "translate.googleapis.com": ConnectSrc,
    "translate.google.com": ConnectSrc,
    "api.dictionaryapi.dev": ConnectSrc,
    "api.imgur.com": ConnectSrc,
    "api.jsonbin.io": ConnectSrc,
    "api.stats.fm": ConnectSrc,
    "stats.fm": ConnectSrc,
    "api.urbandictionary.com": ConnectSrc,
    "www.urbandictionary.com": [...ConnectSrc, "img-src"],
    "en.wikipedia.org": ConnectSrc,
    "fr.wikipedia.org": ConnectSrc,
    "assets.ppy.sh": ConnectSrc,
    "free.freeipapi.com": ConnectSrc,
    "ipwho.is": ConnectSrc,
    "huskapi.nin0.dev": ConnectSrc,
    "lrclib.net": ConnectSrc,
    "nekos.best": ConnectSrc,
    "openpgpjs.org": ConnectSrc,
    "keys.openpgp.org": ConnectSrc,
    "keyserver.ubuntu.com": ConnectSrc,
    "pgp.mit.edu": ConnectSrc,
    "fakeprofile.sampath.me": ConnectSrc,
    "rdap.org": ConnectSrc,
    "stackoverflow.com": ConnectSrc,
    "www.reddit.com": ConnectSrc,
    "store.line.me": ConnectSrc,
    "api.spotify.com": ConnectSrc,
    "open.spotify.com": ConnectSrc,
    "api-v2.soundcloud.com": ConnectSrc,
    "api.music.yandex.net": ConnectSrc,
    "music.yandex.ru": ConnectSrc,
    "api.mail.tm": ConnectSrc,
    "api.purrbot.site": ConnectSrc,
    "api.thecatapi.com": ConnectSrc,
    "api.thedogapi.com": ConnectSrc,
    "api.ipapi.is": ConnectSrc,
    "cors.keiran0.workers.dev": ConnectSrc,
    "corsproxy.io": ConnectSrc,
    "tiktok-tts-aio.exampleuser.workers.dev": ConnectSrc,
    "opencode.ai": ConnectSrc,
    "devina.io": ConnectSrc,
    "picard.musicbrainz.org": ConnectSrc,
    "betterdiscord.app": CSPSrc,
    "streaks.equicord.org": ConnectSrc,
    "dc.songspotlight.nexpid.xyz": ConnectSrc,
    "reviewdb.mantikafasi.dev": [...ConnectSrc, "img-src"],
    "embed.sammcheese.net": ConnectSrc,
    "dsa.discord.food": ConnectSrc,
    "docs.discord.food": ConnectSrc,
    "unpkg.com": ConnectSrc,
    "canary.discord.com": [...ConnectSrc, "img-src"],
    "disboard.org": ConnectSrc,
    "discordhub.com": ConnectSrc,
    "discordservers.com": ConnectSrc,
    "top.gg": ConnectSrc,
    // Image CDNs loaded by plugins
    // Moebooru boards serve files/assets from separate CDN hosts than their API
    "cdn.donmai.us": [...ConnectSrc, "img-src"],
    "files.yande.re": [...ConnectSrc, "img-src"],
    "assets.yande.re": [...ConnectSrc, "img-src"],
    "files.konachan.com": [...ConnectSrc, "img-src"],
    "assets.konachan.com": [...ConnectSrc, "img-src"],
    "*.purrbot.site": [...ConnectSrc, "img-src"],
    "cdn.ipwhois.io": ImageSrc, // ipwho.is country flag images
    "*.betterdiscord.app": CSPSrc, // BD theme thumbnails/CDN
    "camo.githubusercontent.com": ImageSrc,
    "github.githubassets.com": ImageSrc,
    "dearrow.ajay.app": ImageSrc,
    "st.ayaka.one": ImageSrc,
    "placehold.jp": ImageSrc,
    "twemoji.maxcdn.com": ImageSrc,
    "www.openstreetmap.org": ImageSrc,
    "view.officeapps.live.com": ImageSrc,
    "danbooru.donmai.us": [...ConnectSrc, "img-src"],
    "safebooru.org": [...ConnectSrc, "img-src"],
    "konachan.com": [...ConnectSrc, "img-src"],
    "yande.re": [...ConnectSrc, "img-src"],
    "tbib.org": [...ConnectSrc, "img-src"],
    "xbooru.com": [...ConnectSrc, "img-src"],
    "femboyfinder.firestreaker2.gq": [...ConnectSrc, "img-src"],
    // Media
    "www.myinstants.com": [...ConnectSrc, "media-src"],
};
const findHeader = (headers, headerName) => {
    return Object.keys(headers).find(h => h.toLowerCase() === headerName);
};
const parsePolicy = (policy) => {
    const result = {};
    policy.split(";").forEach(directive => {
        const [directiveKey, ...directiveValue] = directive.trim().split(/\s+/g);
        if (directiveKey && !Object.prototype.hasOwnProperty.call(result, directiveKey)) {
            result[directiveKey] = directiveValue;
        }
    });
    return result;
};
const stringifyPolicy = (policy) => Object.entries(policy)
    .filter(([, values]) => values?.length)
    .map(directive => directive.flat().join(" "))
    .join("; ");
const patchCsp = (headers) => {
    const reportOnlyHeader = findHeader(headers, "content-security-policy-report-only");
    if (reportOnlyHeader)
        delete headers[reportOnlyHeader];
    const header = findHeader(headers, "content-security-policy");
    if (header) {
        const csp = parsePolicy(headers[header][0]);
        const pushDirective = (directive, ...values) => {
            csp[directive] ??= [...(csp["default-src"] ?? [])];
            csp[directive].push(...values);
        };
        pushDirective("style-src", "'unsafe-inline'", "file:", "blob:", "data:", "vencord:", "vesktop:", "equicord:", "equibop:");
        // we could make unsafe-inline safe by using strict-dynamic with a random nonce on our Vencord loader script https://content-security-policy.com/strict-dynamic/
        // HOWEVER, at the time of writing (24 Jan 2025), Discord is INSANE and also uses unsafe-inline
        // Once they stop using it, we also should
        pushDirective("script-src", "'unsafe-inline'", "'unsafe-eval'");
        for (const directive of ["style-src", "connect-src", "img-src", "font-src", "media-src", "worker-src"]) {
            pushDirective(directive, "blob:", "data:", "vencord:", "vesktop:", "equicord:", "equibop:");
        }
        for (const [host, directives] of Object.entries(NativeSettings.store.customCspRules)) {
            for (const directive of directives) {
                pushDirective(directive, host);
            }
        }
        for (const [host, directives] of Object.entries(CspPolicies)) {
            for (const directive of directives) {
                pushDirective(directive, host);
            }
        }
        headers[header] = [stringifyPolicy(csp)];
    }
};
const CorsPassthroughDomains = [
    "api.groq.com",
    "api.openai.com",
    "badges.equicord.org",
    "spotify-lyrics-api-pi.vercel.app",
    "api.cord.cat",
];
export function initCsp() {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        const { responseHeaders, resourceType } = details;
        if (responseHeaders) {
            if (resourceType === "mainFrame")
                patchCsp(responseHeaders);
            // Fix hosts that don't properly set the css content type, such as
            // raw.githubusercontent.com
            if (resourceType === "stylesheet") {
                const header = findHeader(responseHeaders, "content-type");
                if (header)
                    responseHeaders[header] = ["text/css"];
            }
            // Inject CORS headers for AI API domains so plugins (VoiceDictation, ChatGPT, etc.)
            // can fetch from the renderer without CORS errors.
            // Only inject when the server didn't set its own — assigning over an existing
            // header under different casing yields duplicate values ("https://discord.com, *")
            // which browsers reject outright
            if (CorsPassthroughDomains.some(d => details.url.startsWith(`https://${d}/`))) {
                const setIfMissing = (name, value) => {
                    if (!findHeader(responseHeaders, name))
                        responseHeaders[name] = [value];
                };
                setIfMissing("access-control-allow-origin", "*");
                setIfMissing("access-control-allow-headers", "*");
                setIfMissing("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
            }
        }
        cb({ cancel: false, responseHeaders });
    });
}
