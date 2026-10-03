/* SPDX-License-Identifier: GPL-3.0-or-later */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");
const root = path.join(__dirname, "../src/testcordplugins/StreamEnhancer");
function load(file) {
    const code = esbuild.transformSync(fs.readFileSync(path.join(root, file), "utf8"), { loader: "ts", format: "cjs" }).code;
    const sandbox = { module: { exports: {} } };
    vm.runInNewContext(code, sandbox);
    return sandbox.module.exports;
}
const { normalizeBadgeConfig, advertiseBadge, badgeFps, badgeResolution } = load("badge.ts");
const config = normalizeBadgeConfig({ spoofBadgeEnabled: true });
const video = Object.freeze({ maxResolution: Object.freeze({ type: "fixed", width: 1920, height: 1080 }), maxFrameRate: 60, maxBitrate: 12000000 });
const audio = Object.freeze({ type: "audio", maxBitrate: 192000 });
const streams = Object.freeze([video, audio]);
const out = advertiseBadge({ context: "stream" }, streams, config);
assert.equal(out[0].maxResolution.height, 4320);
assert.equal(out[0].maxResolution.width, 7680);
assert.equal(out[0].maxFrameRate, 360);
assert.equal(out[0].maxBitrate, video.maxBitrate);
assert.equal(video.maxResolution.height, 1080);
assert.equal(video.maxFrameRate, 60);
assert.equal(out[1], audio);
assert.equal(advertiseBadge({ context: "default" }, streams, config), streams);
assert.equal(advertiseBadge({ context: "stream" }, streams, normalizeBadgeConfig({})), streams);
assert.equal(advertiseBadge({ context: "stream" }, null, config), null);
assert.equal(badgeFps(60, config), 360);
assert.equal(badgeFps(60, normalizeBadgeConfig({})), 60);
const local = Object.freeze({ width: 1920, height: 1080, type: 0 });
assert.equal(badgeResolution(local, normalizeBadgeConfig({})), local);
assert.equal(badgeResolution(local, config).height, out[0].maxResolution.height);
assert.equal(badgeResolution(local, config).type, 0);
const invalid = normalizeBadgeConfig({ spoofBadgeWidth: NaN, spoofBadgeHeight: Infinity, spoofBadgeFps: -5 });
assert.equal(invalid.spoofBadgeWidth, 7680);
assert.equal(invalid.spoofBadgeHeight, 4320);
assert.equal(invalid.spoofBadgeFps, 1);
assert.equal(normalizeBadgeConfig({ spoofBadgeFps: 2000000 }).spoofBadgeFps, 1000);
const state = fs.readFileSync(path.join(root, "state.ts"), "utf8");
const cameraCode = state.slice(state.indexOf("const CameraVideo ="), state.indexOf("// useStateFromStores compares results"));
const native = {};
const sandbox = { module: { exports: {} }, findComponentByCodeLazy: query => { assert.equal(query, 'location:"VideoStream"'); return native; }, React: { createElement: (component, props) => ({ component, props }) } };
vm.runInNewContext(esbuild.transformSync(cameraCode, { loader: "ts", format: "cjs" }).code, sandbox);
const render = sandbox.module.exports.renderZoomableCameraVideo;
for (const mirror of [true, false]) {
    const props = { streamId: "camera-stream", videoComponent: {}, mirror, videoSpinnerContext: mirror ? "SELF_VIDEO" : "REMOTE_VIDEO", fit: "contain", paused: false };
    const result = render(props, 1n);
    assert.equal(result.component, native);
    for (const [key, value] of Object.entries(props)) assert.equal(result.props[key], value);
    assert.equal(result.props.key, "1");
}
assert.equal(render({}, null).props.key, undefined);
const { streamEnhancerPatches } = load("patches.ts");
if (process.env.STREAM_ENHANCER_MODULES) {
    const { modules } = JSON.parse(fs.readFileSync(process.env.STREAM_ENHANCER_MODULES, "utf8"));
    for (const find of ['REMOTE_VIDEO,paused:', '"useMaxQuality"', "this._sentVideo&&"]) {
        const patch = streamEnhancerPatches.find(p => p.find === find);
        const term = find.replaceAll('"', '');
        const found = modules[term];
        assert.equal(found.length, 1, `one live module for ${find}`);
        let code = found[0].code;
        for (const replacement of [].concat(patch.replacement)) {
            const match = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), replacement.match.flags);
            assert.equal([...code.matchAll(new RegExp(match.source, "g"))].length, 1, `${find}: ${match}`);
            code = code.replace(match, replacement.replace.replaceAll("$self", "Vencord.Plugins.plugins.StreamEnhancer"));
        }
        assert.doesNotThrow(() => new Function(`return ({${code}})`));
    }
}
console.log("StreamEnhancer badge isolation, validation, native self/remote camera and patch checks passed.");
const { sliderChoices, nearestChoice, choiceAt, showChoiceLabel, badgeSize } = load("slider.ts");
const fpsChoices = sliderChoices([30, 60, 120, 144, 240, 360, 1000], 1, 1000);
assert.equal(nearestChoice(360.59, fpsChoices), 5);
assert.equal(choiceAt(5.49, fpsChoices), 360);
assert.equal(choiceAt(5.51, fpsChoices), 1000);
assert.equal(choiceAt(-5, fpsChoices), 30);
assert.equal(choiceAt(99, fpsChoices), 1000);
assert.equal(badgeSize(1080).spoofBadgeWidth, 1920);
assert.equal(badgeSize(4320).spoofBadgeWidth, 7680);
assert.equal(badgeSize(8640).spoofBadgeWidth, 15360);
assert.ok(Array.from({length: 30}, (_, i) => i).filter(i => showChoiceLabel(i, 30)).length <= 5);
console.log("StreamEnhancer preset snapping and paired badge resolution checks passed.");

const huge = normalizeBadgeConfig({ spoofBadgeEnabled: true, ...badgeSize(34560), spoofBadgeFps: 1000000 });
const hugeStreams = advertiseBadge({ context: "stream" }, streams, huge);
assert.equal(hugeStreams[0].maxResolution.width, 61440);
assert.equal(hugeStreams[0].maxResolution.height, 34560);
assert.equal(hugeStreams[0].maxFrameRate, 1000);
assert.ok(hugeStreams[0].maxPixelCount <= 2147483647);
assert.equal(hugeStreams[0].maxBitrate, video.maxBitrate);
assert.equal(advertiseBadge({ context: "default" }, streams, huge), streams);
assert.equal(normalizeBadgeConfig({ spoofBadgeWidth: Infinity }).spoofBadgeWidth, 7680);
const indexSource = fs.readFileSync(path.join(root, "index.tsx"), "utf8");
const buttonSource = indexSource.slice(indexSource.indexOf("export function StreamEnhancerButton"), indexSource.indexOf("const streamEnhancer ="));
let visible = true, opened = null;
const plugin = {};
const buttonSandbox = { module: { exports: {} }, streamEnhancerSettings: { use: () => ({ showPanelButton: visible }) }, UserAreaButton: {}, ScreenshareIcon: {}, plugins: { StreamEnhancer: plugin }, openPluginModal: p => { opened = p; }, React: { createElement: (type, props) => ({ type, props }) } };
vm.runInNewContext(esbuild.transformSync(buttonSource, {loader:"tsx",format:"cjs",jsxFactory:"React.createElement"}).code, buttonSandbox);
const renderButton = buttonSandbox.module.exports.StreamEnhancerButton;
const button = renderButton({iconForeground:"native-icon",hideTooltips:false,nameplate:{}});
assert.equal(button.props["aria-label"], "Stream Enhancer");
assert.equal(button.props.plated, true);
button.props.onClick();
assert.equal(opened, plugin);
assert.equal(renderButton({hideTooltips:true}).props.tooltipText, undefined);
visible = false;
assert.equal(renderButton({}), null);
console.log("StreamEnhancer 1,000-FPS bounds, encoder isolation and optional panel button checks passed.");
