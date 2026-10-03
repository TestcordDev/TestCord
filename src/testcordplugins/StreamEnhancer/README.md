# StreamEnhancer

TestCord's stream tuning, microphone, preview and viewer-control plugin, forked with two changes.

Copy the source files in this folder to `src/testcordplugins/StreamEnhancer` in a compatible TestCord checkout, replacing the bundled plugin, then build the client. Preserve the original author metadata and license headers. This copy is published as part of the maintained collection. See the root README for installation and validation limits.

Authors: omaw (upstream StreamEnhancer) and DavidHiFi (this fork). License: GPL-3.0-or-later. See LICENSE.

## Fork changes

**Camera preview.** The `REMOTE_VIDEO,paused:` patch replaces Discord's call-tile camera call with `$self.renderZoomableCameraVideo`. The upstream lookup resolved `--custom-zoom-scale` to the StreamTile component, which expects `{participant, selected, popoutType, ...}` and cannot render camera props, so the local preview stayed blank while viewers still received the frames. The fork resolves `location:"VideoStream"` instead, which returns the same component Discord renders at that call site, so the local preview follows Discord's own renderer.

**Spoofed stream badge.** The advertised resolution and frame rate of a screen share are separate from the encoder settings. The fork carries over the Custom Stream Quality badge controls as a `Spoofed stream badge` settings section with two sliders, resolution and FPS, defaulting to off. Two patches feed the values into the outgoing stream metadata; capture resolution, bitrate and camera settings are unchanged.

## Checks

Run `node scripts/testStreamEnhancer.cjs` from the repository root after installing its development dependencies. The checks cover badge isolation from the real encoder config, clamping of invalid values, the native camera render for both self and remote, and each new patch against captured live module code. Set `STREAM_ENHANCER_MODULES` to a captured module JSON to also assert the patch matches. These checks run offline and do not establish live call behaviour.

The resolution slider sets a 16:9 width and height together. Numeric controls snap to evenly spaced presets, display whole numbers, and show at most five marker labels to prevent overlap. Moving a slider no longer remounts it for each value change.

The optional user-panel button opens StreamEnhancer settings and can be hidden with Show panel button. Badge presets extend to 34,560p, or 61,440 by 34,560, and 1,000 FPS. These are advertised metadata only; the encoder uses the real stream settings. Viewer testing found that values above 1,000 FPS display as zero, so 1,000 is the maximum and higher saved values clamp to it. Restart screen sharing after changing badge values to update viewers.
