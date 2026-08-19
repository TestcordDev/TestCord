/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
const orig = {};
const mungeSDP = sdp => {
    if (!sdp)
        return sdp;
    const opusPts = new Set();
    // find the opus codecs by PT (payload type)
    // and add them to a set to update the params later
    // this is a known issue with discord's implementation
    // on chromium based browsers (see https://support.discord.com/hc/en-us/community/posts/23128064608151-Fix-stereo-audio-for-Chromium-based-browsers-perhaps-WebRTC-SDP-issue)
    for (const line of sdp.split(/\r\n/)) {
        const m = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
        if (m)
            opusPts.add(m[1]);
    }
    if (!opusPts.size)
        return sdp;
    // now check each line of the SDP for the opus codecs
    // and update the params to include stereo and sprop-stereo
    return sdp.replace(/^a=fmtp:(\d+)\s+(.+)$/gmi, (full, pt, params) => {
        if (!opusPts.has(pt))
            return full;
        if (/(\bstereo=1\b)|(\bsprop-stereo=1\b)/i.test(params))
            return full;
        const sep = params.endsWith(";") ? "" : ";";
        return `a=fmtp:${pt} ${params}${sep}stereo=1;sprop-stereo=1`;
    });
};
const patchSDPDesc = desc => {
    if (!desc || !desc.sdp)
        return desc;
    return { type: desc.type, sdp: mungeSDP(desc.sdp) };
};
export default definePlugin({
    name: "StereoScreenshareAudio",
    description: "Patches Discord's WebRTC SDP to enable stereo audio while watching streams (should only be necessary with vesktop & co.)",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    async start() {
        const SRD = RTCPeerConnection.prototype.setRemoteDescription;
        const SLD = RTCPeerConnection.prototype.setLocalDescription;
        // only wrap if not already wrapped by this plugin
        if (!SRD._stereoScreenshareAudioPatched) {
            orig.SRD = SRD;
            const wrappedSRD = function (desc, ...rest) {
                return SRD.call(this, patchSDPDesc(desc), ...rest);
            };
            wrappedSRD._stereoScreenshareAudioPatched = true;
            RTCPeerConnection.prototype.setRemoteDescription = wrappedSRD;
        }
        if (!SLD._stereoScreenshareAudioPatched) {
            orig.SLD = SLD;
            const wrappedSLD = function (desc, ...rest) {
                return SLD.call(this, patchSDPDesc(desc), ...rest);
            };
            wrappedSLD._stereoScreenshareAudioPatched = true;
            RTCPeerConnection.prototype.setLocalDescription = wrappedSLD;
        }
    },
    async stop() {
        // only restore if our own wrapper is still the active one,
        // otherwise another plugin owns the chain and we leave it alone
        const srd = RTCPeerConnection.prototype.setRemoteDescription;
        if (srd?._stereoScreenshareAudioPatched && orig.SRD) {
            RTCPeerConnection.prototype.setRemoteDescription = orig.SRD;
        }
        const sld = RTCPeerConnection.prototype.setLocalDescription;
        if (sld?._stereoScreenshareAudioPatched && orig.SLD) {
            RTCPeerConnection.prototype.setLocalDescription = orig.SLD;
        }
        orig.SRD = undefined;
        orig.SLD = undefined;
    },
});
