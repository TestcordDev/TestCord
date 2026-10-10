# VoiceVUMeters

Per-participant left/right voice meters, peak markers and a divider in the channel list and on call tiles. Fork of [Kurtzon Audio's VoiceVUMeters](https://github.com/kurtzonaudio/kurtcord-plugins), maintained by DavidHiFi. MIT licensed. The native helper includes MinHook under its own license.

## Channel measurement

Web audio clients expose a stream for each participant. The plugin splits each stream into left and right channels. On Discord Desktop, your own meter captures the exact selected input before Discord encoding, without echo cancellation, noise suppression or automatic gain control in that capture. It closes when the input changes or the call or plugin stops.

Desktop remote stereo requires the companion native bridge. It reads signed 16-bit decoded PCM from a callback that identifies both the connection and participant. It enables the Opus receiver's explicit stereo parameter, which is required in addition to a two-channel codec description. A hard-left sender moves only their left bar. A hard-right sender moves only their right bar. RMS and peaks come from the samples before your local pan. Mono and dual-mono audio can move both bars; equal levels alone are not proof of stereo content.

The helper retains only levels, never participant audio. Stale samples expire. Closed connections and stream-sharing connections cannot supply another call's meters. Production code preserves the native callback, return value and playback flags. It does not change input capture, encoding, device selection, gain or routing. The isolated decoder test has separate input-disable and output-discard controls that are absent from the shipped addon.

The helper accepts only the audited Windows x64 voice binary with SHA256 `4039dcd110a2d2b17672a62f94d11dd5a9a4e59ab2420915ef1362a29467a4a5`. A changed native binary disables the tap. Without the bridge, Desktop falls back to one scalar level through your local pan; its tooltip identifies that limitation. A shared output mix never supplies participant identity.

## Install

Copy `index.tsx` into `src/testcordplugins/VoiceVUMeters` and build your client. The `native` folder is a companion installation, not a TestCord native IPC plugin. For the matching existing DiscordStereoLoader payload, run `native/Install-Bridge.ps1 -AuditOnly`, then `native/Install-Bridge.ps1`. The script verifies the voice binary, backs up the wrapper and copies the bridge. It does not restart Discord. Restart after your call to load both components.

To rebuild the helper, use an x64 MSVC C++20 toolchain and CMake. Configure with `-DNODE_INCLUDE_DIR=<folder containing node_api.h>` from Node 24 headers, then build the Release `participant_tap` target. Stable Node-API version 8 avoids an Electron-specific import library. MinHook 1.3.4 source is included; no submodule download is needed. Run `callback_test.exe` and `node native/bridge-test.cjs` for the source-level checks.

## Settings and validation

Floor sets the bottom of the meter scale. Show Peak holds each channel's peak for 1.5 seconds, then falls at 12 dB per second. Show Self controls the selected input meter. Two bars and the divider remain visible for mono participants. Show VU meters on chooses between voice profile tiles, screen share tiles, or both.

Screen share tiles meter the stream's own audio, never the streamer's microphone. Go live audio rides its own RTC connection that names the streamer, so the meter follows that connection: the streamer's soundshare on its outbound, a viewer's stream audio on its inbound. A stream without audio shows no meter, and unopened stream previews stay meter-free as before. Web clients have no per-stream audio data, so their screen share tiles stay meter-free.

On 2026-10-01, two synthetic participants sent independently encoded, encrypted Opus packets through the actual installed native voice decoder in an isolated process. The left participant reached a left peak of 0.517 with a zero right peak. The right participant reached a right peak of 0.501 with a zero left peak. Connection-owned participant callbacks supplied 492 frames. This verifies the native decoder path, beyond injecting synthetic arrays into the meter.

33 meter/identity/guard regression checks, native metric checks, bridge connection/decoder checks, targeted lint and full Desktop and Equibop builds passed. Both builds retain the current guard sources and their recovery helpers. The bridge and all three plugins loaded successfully in Discord with no matching startup warnings or errors. A live friend's transmitted hard-pan test and a visual peak-marker inspection were not performed. The maintainer previously confirmed their own live Ableton hard pan.

## Rollback

Restore the backed-up wrapper and renderer files and remove the companion bridge files if they were newly installed. Restart Discord after the call. The local activation backup is `backups/2026-10-01/voice-native-stereo`, with evidence in `reports/2026-10-01-voice-native-stereo`. No DevTools, hotkeys, focus automation or clipboard injection were used. Protected audio processes survived activation.

This contribution includes the native helper source and its tests. Build the helper and place the resulting `participant_tap.node` beside `Install-Bridge.ps1` before installation. No precompiled native addon is included in this PR. The optional companion requires an existing compatible DiscordStereoLoader installation.
