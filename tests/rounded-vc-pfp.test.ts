/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { transformSync } from "esbuild";

import { makeRange } from "../src/utils/types";

const source = readFileSync(new URL("../src/testcordplugins/RoundedVcPfp/index.tsx", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
let lookups = 0;
let user: { getDefaultAvatarURL?: unknown; } = {};
const voiceState: { channelId?: string; } = {};
let profile: { banner?: string; } | undefined;
let fetches = 0;
const usrbgState = { enabled: false, hasBackground: false };
const store: Record<string, unknown> = {
    avatarRadius: 5,
    cornerRadius: 12,
    zoom: 100,
    hideTileBackground: false,
    hideUserBackgrounds: false,
    showUserBanners: false,
    preferBanners: false,
    enableGlow: false,
    glowColor: "#45475a",
    speakingIndicator: "box"
};
const sandbox = {
    EquicordDevs: { mochienya: {} }, TestcordDevs: { DavidHiFi: {} },
    definePlugin: (plugin: unknown) => plugin,
    definePluginSettings: () => ({ store }), OptionType: { SLIDER: 5 }, style: "",
    makeRange,
    UserStore: { getUser: () => { lookups++; return user; } },
    VoiceStateStore: { getVoiceStateForUser: () => voiceState.channelId ? voiceState : undefined },
    ChannelStore: { getChannel: () => ({ guild_id: "guild-1" }) },
    ChannelRTCStore: { getSpeakingParticipants: () => [{ user: { id: "1" }, speaking: true }] },
    UserProfileStore: { getUserProfile: () => profile },
    IconUtils: { getUserBannerURL: () => "banner-url" },
    fetchUserProfile: () => { fetches++; return Promise.resolve(); },
    isPluginEnabled: () => usrbgState.enabled,
    usrbg: { name: "USRBG", userHasBackground: () => usrbgState.hasBackground },
    useStateFromStores: () => undefined,
    getUserAvatarUrl: () => undefined
};
vm.createContext(sandbox);
vm.runInContext(transformSync(source, { loader: "tsx", format: "cjs" }).code, sandbox);
const plugin = (sandbox as typeof sandbox & { plugin: { getVoiceBackgroundStyles(props: { className?: string; participantUserId?: string; children?: unknown; }): Record<string, string> | undefined; }; }).plugin;

const styles = (props: { participantUserId: string; }) => plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: props.participantUserId }) ?? {};



test("Only participant tiles receive avatar styles", () => {
    for (const props of [{ participantUserId: "1" }, { className: "other", participantUserId: "1" }, { className: "tile" }]) {
        assert.equal(plugin.getVoiceBackgroundStyles(props), undefined);
    }
    assert.equal(lookups, 0);
});

test("The callable default avatar fallback applies to tiles", () => {
    user = { getDefaultAvatarURL: () => "default-avatar" };
    const result = plugin.getVoiceBackgroundStyles({ className: "tile_example", participantUserId: "1" });
    assert.equal(result?.["--full-res-avatar"], 'url("default-avatar")');
    assert.equal(result?.["--vc-pfp-radius"], "12px");
});

test("A missing or noncallable default avatar uses the CDN fallback", () => {
    for (const value of [undefined, "not-a-function"]) {
        user = { getDefaultAvatarURL: value };
        assert.equal(plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: "1" })?.["--full-res-avatar"], 'url("https://cdn.discordapp.com/embed/avatars/0.png")');
    }
});

test("Picture masking follows the radius slider and the theme slot is always set", () => {
    Object.assign(store, { avatarRadius: 24 });
    const result = styles({ participantUserId: "1" });
    assert.ok(result["--vc-pfp-avatar-mask"]?.includes("rx%3D'24'"));
    assert.equal(result["--vc-pfp-avatar-radius"], "24%");
    assert.equal(result["--vc-pfp-glow-slot"], "1");
    Object.assign(store, { avatarRadius: 5 });
});

test("The glow follows its own switch while the box shows or hides", () => {
    Object.assign(store, { hideTileBackground: false, enableGlow: true });
    const result = styles({ participantUserId: "1" });
    assert.equal(result["backgroundColor"], "");
    assert.equal("backgroundImage" in result, false);
    assert.equal(result["--vc-pfp-hide-bg"], "");
    assert.equal(result["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6))");

    Object.assign(store, { hideTileBackground: true, enableGlow: false });
    const floating = styles({ participantUserId: "1" });
    assert.equal(floating["backgroundColor"], "transparent");
    assert.equal(floating["--vc-pfp-hide-bg"], "1");
    assert.equal(floating["--vc-pfp-glow-filter"], "");
    Object.assign(store, { enableGlow: false });
});

test("The speaking ring emits its markers only in picture mode while speaking", () => {
    Object.assign(store, { speakingIndicator: "box" });
    const boxed = styles({ participantUserId: "1" });
    assert.equal(boxed["--vc-pfp-ring-pic"], "");
    assert.equal(boxed["--vc-pfp-speaking"], "");

    Object.assign(store, { speakingIndicator: "picture" });
    const silent = styles({ participantUserId: "1" });
    assert.equal(silent["--vc-pfp-ring-pic"], "1");
    assert.equal(silent["--vc-pfp-speaking"], "");
    assert.equal(silent["--vc-pfp-glow-filter"], "");
    Object.assign(store, { speakingIndicator: "box" });
});

test("Picture mode merges the speaking bloom into the filter while speaking", () => {
    voiceState.channelId = "channel-1";
    Object.assign(store, { speakingIndicator: "picture", enableGlow: true, glowColor: "#45475a" });
    const talking = styles({ participantUserId: "1" });
    assert.equal(talking["--vc-pfp-speaking"], "1");
    assert.equal(talking["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6)) drop-shadow(0 0 2px var(--green-360, #23a55a)) drop-shadow(0 0 8px var(--green-360, #23a55a))");

    Object.assign(store, { enableGlow: false });
    const bloomOnly = styles({ participantUserId: "1" });
    assert.equal(bloomOnly["--vc-pfp-glow-filter"], "drop-shadow(0 0 2px var(--green-360, #23a55a)) drop-shadow(0 0 8px var(--green-360, #23a55a))");

    Object.assign(store, { speakingIndicator: "box" });
    const boxed = styles({ participantUserId: "1" });
    assert.equal(boxed["--vc-pfp-glow-filter"], "");
    voiceState.channelId = undefined;
});

test("User backgrounds stay visible without their own switch and hide with it", () => {
    Object.assign(store, { hideTileBackground: true, hideUserBackgrounds: false });
    const keep = styles({ participantUserId: "1" });
    assert.equal(keep["backgroundColor"], "transparent");
    assert.equal("backgroundImage" in keep, false);

    Object.assign(store, { hideTileBackground: false, hideUserBackgrounds: true });
    const hideUser = styles({ participantUserId: "1" });
    assert.equal(hideUser["backgroundImage"], "none");
    assert.equal(hideUser["backgroundColor"], "");

    Object.assign(store, { hideTileBackground: true, hideUserBackgrounds: true });
    const both = styles({ participantUserId: "1" });
    assert.equal(both["backgroundImage"], "none");
    assert.equal(both["backgroundColor"], "transparent");

    Object.assign(store, { hideTileBackground: false, hideUserBackgrounds: false });
    assert.equal("backgroundImage" in styles({ participantUserId: "1" }), false);
});

test("A profile banner paints the tile unless USRBG already claims it", () => {
    profile = { banner: "banner-hash" };
    Object.assign(store, { showUserBanners: true, hideUserBackgrounds: true });
    assert.equal(styles({ participantUserId: "1" })["backgroundImage"], "none");

    Object.assign(store, { hideUserBackgrounds: false });
    const banner = styles({ participantUserId: "1" });
    assert.equal(banner["backgroundImage"], 'url("banner-url")');
    assert.equal(banner["backgroundSize"], "cover");
    assert.equal(banner["backgroundPosition"], "center");
    assert.equal(banner["backgroundRepeat"], "no-repeat");

    usrbgState.enabled = true;
    usrbgState.hasBackground = true;
    assert.equal("backgroundImage" in styles({ participantUserId: "1" }), false);

    Object.assign(store, { preferBanners: true });
    assert.equal(styles({ participantUserId: "1" })["backgroundImage"], 'url("banner-url")');

    usrbgState.enabled = false;
    usrbgState.hasBackground = false;
    Object.assign(store, { preferBanners: false });
    profile = undefined;
});

test("Users without a banner keep the default look and are fetched once", () => {
    Object.assign(store, { showUserBanners: true });
    fetches = 0;
    assert.equal("backgroundImage" in styles({ participantUserId: "2" }), false);
    assert.equal("backgroundImage" in styles({ participantUserId: "2" }), false);
    assert.equal(fetches, 1);
    Object.assign(store, { showUserBanners: false });
});

test("The glow filter composes both layers from the configured hex", () => {
    Object.assign(store, { hideTileBackground: true, enableGlow: true, glowColor: "#45475a" });
    const result = styles({ participantUserId: "1" });
    assert.equal(result["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6))");

    Object.assign(store, { glowColor: "#a8c" });
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(170, 136, 204, 0.4)) drop-shadow(0 0 3px rgba(170, 136, 204, 0.6))");
    Object.assign(store, { enableGlow: true, glowColor: "not-a-color" });
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-glow-filter"], "");
    Object.assign(store, { hideTileBackground: false, enableGlow: false, glowColor: "#45475a" });
});

test("Stream tiles do not inherit their owner's speaking glow", () => {
    Object.assign(store, { speakingIndicator: "picture", enableGlow: false });
    voiceState.channelId = "channel-1";
    const children = { props: { children: [{ props: { participant: { streamId: "stream-1" } } }] } };
    const stream = plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: "1", children });
    assert.equal(stream?.["--vc-pfp-stream"], "1");
    assert.equal(stream?.["--vc-pfp-speaking"], "");
    assert.equal(stream?.["--vc-pfp-glow-filter"], "");
    const person = styles({ participantUserId: "1" });
    assert.equal(person["--vc-pfp-stream"], "");
    assert.equal(person["--vc-pfp-speaking"], "1");
    assert.ok(person["--vc-pfp-glow-filter"].includes("--green-360"));
    Object.assign(store, { speakingIndicator: "box" });
    delete voiceState.channelId;
});
