/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findByCodeLazy, findLazy } from "@webpack";
let defaultSounds = null;
const findDefaultSounds = findLazy(module => module.resolve && module.id && module.keys().some(key => key.endsWith(".mp3")), false);
const AudioPlayerConstructor = findByCodeLazy("could not play audio");
export const audioProcessorFunctions = {};
export var AudioType;
(function (AudioType) {
    /** An external URL that follows the Content Security Policy. */
    AudioType["URL"] = "url";
    /** A base64-encoded data URI. */
    AudioType["DATA"] = "data-uri";
    /** A Blob URI. */
    AudioType["BLOB"] = "blob";
    /** A file path. */
    AudioType["PATH"] = "file-path";
    /** An internal Discord audio filename (e.g. "discodo"). */
    AudioType["DISCORD"] = "discord";
    /** Any other unrecognized audio type. */
    AudioType["OTHER"] = "other";
})(AudioType || (AudioType = {}));
// Wrap the player to allow reprocessing the audio when properties are changed and to alleviate
// the confusion between the public API accepting 0-100 volume while the internal API uses 0-1 volume.
class AudioPlayerWrapper {
    internalPlayer;
    constructor(internalPlayer) { this.internalPlayer = internalPlayer; }
    get audio() { return this.internalPlayer.audio; }
    set audio(value) { this.internalPlayer.preprocessDataOriginal.audio = value; this.internalPlayer.processAudio(); }
    get volume() { return this.internalPlayer._volume * 100; }
    set volume(value) { this.internalPlayer.preprocessDataOriginal.volume = Math.max(0, Math.min(1, value / 100)); this.internalPlayer.processAudio(); }
    get speed() { return this.internalPlayer._speed; }
    set speed(value) { this.internalPlayer.preprocessDataOriginal.speed = Math.max(0.0625, Math.min(16, value)); this.internalPlayer.processAudio(); }
    get time() { return this.internalPlayer._audio?.then(audio => audio.currentTime) ?? null; }
    set time(value) { this.internalPlayer.ensureAudio().then(audio => audio.currentTime = value); }
    get persistent() { return this.internalPlayer.persistent; }
    set persistent(value) { this.internalPlayer.persistent = value; }
    get preload() { return this.internalPlayer.preload; }
    set preload(value) { this.internalPlayer.preload = value; value && this.internalPlayer.ensureAudio(); }
    get muted() { return this.internalPlayer._audio?.then(audio => audio.muted) ?? null; }
    set muted(value) { this.internalPlayer.ensureAudio().then(audio => audio.muted = value); }
    get paused() { return this.internalPlayer._audio?.then(audio => audio.paused) ?? null; }
    set paused(value) { value ? this.internalPlayer.pause() : this.internalPlayer.play(); }
    get type() { return this.internalPlayer.type; }
    get duration() { return this.internalPlayer._audio?.then(audio => audio.duration) ?? null; }
    load() { this.internalPlayer.ensureAudio(); }
    loop() { this.internalPlayer.loop(); }
    play() { this.internalPlayer.play(); }
    pause() { this.internalPlayer.pause(); }
    stop(restart) { this.internalPlayer.stop(restart); }
    restart() { this.internalPlayer.stop(true); }
    seek(time) { this.internalPlayer.ensureAudio().then(audio => audio.currentTime = time); }
    mute() { this.internalPlayer.ensureAudio().then(audio => audio.muted = true); }
    unmute() { this.internalPlayer.ensureAudio().then(audio => audio.muted = false); }
    delete() { this.internalPlayer.destroyAudio(); }
}
/**
 * Creates an audio player.
 * @param audio The internal Discord audio filename (e.g. "discodo"), a data URI, or an external URL that follows the CSP.
 * @param options Additional options for the audio player.
 * @param options.volume The volume of the audio, between 0 and 100, defaulting to 100.
 * @param options.speed The playback speed of the audio, between 0.0625 and 16, defaulting to 1.
 * @param options.preload Whether to load the audio immediately. If persistent is false, this will only apply until the first playback.
 * @param options.persistent Whether the audio element is persistent and not recreated for every playback. If persistent, you must call delete() to free the memory. Defaults to false.
 * @param options.onEnded An optional callback that is called every time the audio finishes playing.
 * @param options.onError An optional error handler that is passed an Error object when an error occurs during audio playback.
 * @return The created audio player.
 */
export function createAudioPlayer(audio, options = {}) {
    const internalPlayer = new AudioPlayerConstructor(options, audio, null, null, "default");
    return new AudioPlayerWrapper(internalPlayer);
}
/**
 * Plays an audio instantly and returns the player.
 * @param audio The internal Discord audio filename (e.g. "discodo"), a data URI, or an external URL that follows the CSP.
 * @param options Additional options for the audio player.
 * @param options.volume The volume of the audio, between 0 and 100, defaulting to 100.
 * @param options.speed The playback speed of the audio, between 0.0625 and 16, defaulting to 1.
 * @param options.preload Whether to load the audio immediately. If persistent is false, this will only apply until the first playback.
 * @param options.persistent Whether the audio element is persistent and not recreated for every playback. If persistent, you must call delete() to free the memory. Defaults to false.
 * @param options.onEnded An optional callback that is called every time the audio finishes playing.
 * @param options.onError An optional error handler that is passed an Error object when an error occurs during audio playback.
 * @return The created audio player.
 */
export function playAudio(audio, options = {}) {
    const player = createAudioPlayer(audio, options);
    player.play();
    return player;
}
/**
 * Identifies the type of audio based on its string.
 * @param audio The audio string to identify.
 * @returns The identified AudioType.
 */
export function identifyAudioType(audio) {
    if (defaultAudioNames().includes(audio))
        return AudioType.DISCORD;
    try {
        const url = new URL(audio);
        if (url.protocol === "http:" || url.protocol === "https:")
            return AudioType.URL;
        if (url.protocol === "data:")
            return AudioType.DATA;
        if (url.protocol === "blob:")
            return AudioType.BLOB;
        if (url.protocol === "file:")
            return AudioType.PATH;
        return AudioType.OTHER;
    }
    catch {
        return AudioType.OTHER;
    }
}
/**
 * Adds a function to process an audio before it is played.
 * @param key A unique identifier for this audio processor. Plugin name is recommended.
 * @param processor A function that takes a data object with audio, volume (0-100), and type (AudioType) attributes, and modifies the audio and volume in place.
 */
export function addAudioProcessor(key, processor) {
    audioProcessorFunctions[key] = processor;
}
/**
 * Removes an audio processor by its key.
 * @param key The unique identifier of the audio processor to remove.
 */
export function removeAudioProcessor(key) {
    delete audioProcessorFunctions[key];
}
/** Returns an array of all internal Discord audio filenames. */
export function defaultAudioNames() {
    defaultSounds ??= (findDefaultSounds.keys() || []).map(key => {
        const match = key.match(/((?:\w|-)+)\.mp3$/);
        return match ? match[1] : null;
    }).filter(Boolean);
    return defaultSounds;
}
