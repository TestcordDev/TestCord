const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = 'src/testcordplugins/';
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function load(name, exports) {
    const writes = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useReducer: () => [0, () => {}], useRef: value => ({ current: value }), useEffect: () => {}
    };
    const settings = [];
    const sandbox = {
        console, Date, Float32Array, Map, Set, Math, Number, Object, Array,
        setInterval, clearInterval, React, VencordCreateElement: React.createElement,
        ErrorBoundary: { wrap: fn => fn },
        Logger: class { error() {} debug() {} warn() {} info() {} },
        definePlugin: p => p,
        definePluginSettings: def => {
            const store = Object.fromEntries(Object.entries(def).map(([key, value]) => [key, value.default ?? value.options?.find(o => o.default)?.value]));
            const result = { def, store, use: () => store, withPrivateSettings() { return this; } }; settings.push(result); return result;
        },
        OptionType: { BOOLEAN: 3, SELECT: 4, SLIDER: 5, STRING: 0 },
        makeRange: (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step),
        findByPropsLazy: () => ({ setLocalVolume: (id, volume) => writes.push([id, volume]) }),
        MediaEngineStore: { isLocalMute: () => false, getLocalVolume: () => 100, isSelfMute: () => false },
        UserStore: { getCurrentUser: () => ({ id: 'self' }), getUser: id => ({ id }) },
        RelationshipStore: { isFriend: () => false },
        SelectedChannelStore: { getVoiceChannelId: () => 'channel' },
        VoiceStateStore: { getVoiceStatesForChannel: () => ({ self: {}, alice: {}, bob: {} }) },
        DataStore: { set: () => Promise.resolve() }, plugins: {}, TestcordDevs: { DavidHiFi: {}, Kurtzon: {} },
        showToast: () => {}, Toasts: { Type: { MESSAGE: 0 } },
        meterStyle: ''
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(root + name + '/index.tsx', 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace('export default definePlugin(', 'const plugin = definePlugin(');
    const suffix = `\nglobalThis.test = { ${exports}, settings, setConnection: value => { connection = value; }, plugin };`;
    const helper = name === "StereoGuard" ? fs.readFileSync(root + name + "/protection.ts", "utf8").replace("export class VolumeHold", "class VolumeHold") : "";
    const input = helper + "\n" + source + suffix;
    const options = { loader: 'tsx', jsxFactory: 'VencordCreateElement', target: 'esnext' };
    let code;
    try {
        code = esbuild.transformSync(input, options).code;
    } catch (error) {
        // Confined environments cannot spawn esbuild's piped service process;
        // fall back to in-process TypeScript transpilation.
        if (error.code !== 'EPERM') throw error;
        const ts = require('typescript');
        code = ts.transpileModule(input, { fileName: 'plugin.tsx', compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'VencordCreateElement', target: ts.ScriptTarget.ESNext } }).outputText;
    }
    vm.runInContext(code, sandbox);
    return { api: sandbox.test, sandbox, writes };
}
const vu = load('VoiceVUMeters', 'readChannel, readLevels, newMeter, meters, VoiceMeter, createWebMeter, syncSelfInput, dropAll, getPan, smooth, MeterBar, tick, readNativeLevels, readStreamLevels, setStreamAmplitude, syncDesktopMeters, setLastScan: value => { lastScanAt = value; }');
function tone(amp = .3) { return Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(i * .1)); }
const sound = tone();
const silence = new Float32Array(2048);
function level(samples) { return vu.api.readChannel({ getFloatTimeDomainData: target => target.set(samples) }, new Float32Array(samples.length), -60); }
check('Hard left has active left and zero right', () => { assert(level(sound).rms > .7); assert.equal(level(silence).rms, 0); });
check('Hard right has zero left and active right', () => { assert.equal(level(silence).peak, 0); assert(level(sound).peak > .7); });
check('Scalar levels resolve SSRC identity rather than numeric array keys', () => {
    vu.api.meters.set('bob', vu.api.newMeter(true));
    vu.api.readLevels({ getUserIdBySsrc: ssrc => ssrc === 42 ? 'bob' : null }, { rtp: { inbound: { '0': { type: 'audio', ssrc: 42, audioLevel: .4 } } } });
    assert.equal(vu.api.meters.get('bob').amplitude, .4);
});
check('Conflicting SSRC and participant keys do not update either user', () => {
    vu.api.meters.set('alice', vu.api.newMeter(true));
    vu.api.readLevels({ getUserIdBySsrc: () => 'bob' }, { rtp: { inbound: { alice: { type: 'audio', ssrc: 42, audioLevel: .8 } } } });
    assert.equal(vu.api.meters.get('bob').amplitude, .4); assert.equal(vu.api.meters.get('alice').amplitude, 0);
});
check('Remote scalar participants keep two bars and a divider', () => {
    const rendered = vu.api.VoiceMeter({ userId: 'bob' });
    assert.equal(rendered.props['data-vu-meter'], 'level');
    assert.match(rendered.props.title, /one level per participant/);
    assert.equal(rendered.props.children.filter(Boolean).length, 3);
});
check('Remote scalar level follows local pan into each bar', () => {
    vu.sandbox.MediaEngineStore.getLocalPan = id => id === 'bob' ? { left: 1, right: 0 } : { left: 1, right: 1 };
    assert.deepEqual([...vu.api.getPan('bob')], [1, 0]);
    assert.deepEqual([...vu.api.getPan('alice')], [1, 1]);
    delete vu.sandbox.MediaEngineStore.getLocalPan;
    assert.deepEqual([...vu.api.getPan('bob')], [1, 1]);
});
check('Real stereo streams render separate bars and divider', () => {
    vu.api.meters.set('stereo', { ...vu.api.newMeter(false), tap: {} });
    const rendered = vu.api.VoiceMeter({ userId: 'stereo' });
    assert.equal(rendered.props['data-vu-meter'], 'lr');
    assert.equal(rendered.props.children.filter(Boolean).length, 3);
});
check('Peak marker holds for 1500 ms', () => {
    const m = vu.api.newMeter(false);
    vu.api.smooth(m, 0, { rms: .6, peak: .9 }, 1000);
    vu.api.smooth(m, 0, { rms: 0, peak: 0 }, 2400);
    assert.equal(m.peak[0], .9);
});
check('Peak marker falls at 12 dB per second after hold', () => {
    const m = vu.api.newMeter(false);
    vu.api.smooth(m, 0, { rms: .6, peak: .9 }, 1000);
    vu.api.smooth(m, 0, { rms: 0, peak: 0 }, 3500);
    assert(Math.abs(m.peak[0] - .7) < 1e-9);
});
check('Peak fall is independent of callback cadence', () => {
    const a = vu.api.newMeter(false), b = vu.api.newMeter(false);
    vu.api.smooth(a, 0, { rms: .6, peak: .9 }, 1000);
    vu.api.smooth(b, 0, { rms: .6, peak: .9 }, 1000);
    for (let t = 1050; t <= 3500; t += 50) vu.api.smooth(a, 0, { rms: 0, peak: 0 }, t);
    vu.api.smooth(b, 0, { rms: 0, peak: 0 }, 3500);
    assert(Math.abs(a.peak[0] - b.peak[0]) < 1e-9);
});
check('Each channel holds its own peak', () => {
    const m = vu.api.newMeter(false);
    vu.api.smooth(m, 0, { rms: .6, peak: .9 }, 1000);
    vu.api.smooth(m, 1, { rms: 0, peak: 0 }, 1000);
    assert.equal(m.peak[0], .9); assert.equal(m.peak[1], 0);
});
check('Full-scale peak marker remains inside the bar', () => {
    const rendered = vu.api.MeterBar({ width: 4, value: 1, peak: 1, showPeak: true });
    const marker = rendered.props.children[1];
    assert.match(marker.props.style.top, /^clamp\(0px,/);
    assert.equal(marker.props.style.height, 2);
});
check('Startup enables requested peak hold once, then respects later preferences', () => {
    vu.api.settings.store.showPeak = false;
    vu.api.meters.clear(); vu.api.plugin.start(); vu.api.plugin.stop();
    assert.equal(vu.api.settings.store.showPeak, true);
    vu.api.settings.store.showPeak = false;
    vu.api.meters.clear(); vu.api.plugin.start(); vu.api.plugin.stop();
    assert.equal(vu.api.settings.store.showPeak, false);
});
check('Identical mix and scalar readings can conceal reversed participant channels', () => {
    const wave = [.5, -.5];
    const sceneA = { alice: [wave, [0, 0]], bob: [[0, 0], wave] };
    const sceneB = { alice: [[0, 0], wave], bob: [wave, [0, 0]] };
    const mix = scene => [0, 1].map(c => wave.map((_, i) => scene.alice[c][i] + scene.bob[c][i]));
    const energy = channels => Math.sqrt(channels.flat().reduce((n, v) => n + v*v, 0)/4);
    assert.deepEqual(mix(sceneA), mix(sceneB));
    assert.equal(energy(sceneA.alice), energy(sceneB.alice));
    assert.equal(energy(sceneA.bob), energy(sceneB.bob));
    assert.notDeepEqual(sceneA.alice, sceneB.alice);
});
async function inputChecks() {
    const v = load('VoiceVUMeters', 'readChannel, readLevels, newMeter, meters, VoiceMeter, createWebMeter, syncSelfInput, dropAll, getPan, smooth, MeterBar, tick, readNativeLevels, setLastScan: value => { lastScanAt = value; }');
    const conn = { context: 'default' };
    v.api.setConnection(conn);
    let stopped = 0, closed = 0, requests = 0, constraints;
    const node = () => ({ connect() {}, disconnect() {} });
    v.sandbox.AudioContext = class {
        destination = {};
        createMediaStreamSource() { return node(); }
        createChannelSplitter() { return node(); }
        createAnalyser() { return { ...node(), fftSize: 1024 }; }
        createGain() { return { ...node(), gain: { value: 1 } }; }
        async resume() {}
        async close() { closed++; }
    };
    v.sandbox.MediaEngineStore.getInputDeviceId = () => 'native-input';
    v.sandbox.MediaEngineStore.getMediaEngine = () => ({ getAudioInputDevices: async () => [{ id: 'native-input', originalId: 'browser-input', name: 'Selected input' }] });
    const track = { getSettings: () => ({ channelCount: 2 }), stop: () => { stopped++; } };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    v.sandbox.navigator = { mediaDevices: {
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'browser-input', label: 'Selected input' }],
        getUserMedia: async value => { requests++; constraints = value; return stream; }
    } };
    await v.api.syncSelfInput(conn);
    check('Self capture selects the exact Discord input without processing', () => {
        assert.equal(constraints.audio.deviceId.exact, 'browser-input');
        assert.equal(constraints.audio.echoCancellation, false);
        assert.equal(constraints.audio.noiseSuppression, false);
        assert.equal(constraints.audio.autoGainControl, false);
        assert.equal(v.api.meters.get('self').ownsInput, true);
        assert.equal(v.api.VoiceMeter({ userId: 'self' }).props['data-vu-meter'], 'lr');
    });
    await v.api.syncSelfInput(conn);
    check('Self capture is reused while the selected device is unchanged', () => assert.equal(requests, 1));
    v.api.dropAll();
    check('Disconnect stops the capture track and closes its owned context', () => { assert.equal(stopped, 1); assert.equal(closed, 1); });
    let finish;
    v.sandbox.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { finish = resolve; });
    const pending = v.api.syncSelfInput(conn);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    v.api.dropAll();
    finish(stream);
    await pending;
    check('Late input capture is discarded after disconnect', () => { assert.equal(stopped, 2); assert.equal(v.api.meters.size, 0); });
    console.log(`${checks} regression checks passed.`);
}
inputChecks().catch(error => { console.error(error); process.exitCode = 1; });

const nativeConnection = { context: 'default' };
vu.sandbox.MediaEngineStore.getMediaEngine = () => ({ connections: [nativeConnection] });
vu.api.setConnection(nativeConnection);
let nativeLevels = [];
vu.sandbox.DiscordNative = { nativeModules: { requireModule: () => ({
    getParticipantStereoLevels: () => ({ installed: true, connection: 1, levels: nativeLevels })
}) } };
function nativeTick() { vu.api.setLastScan(Date.now()); vu.api.tick(); }
function nativeLevel(userId, left, right, ageMs = 0) {
    return { userId, ageMs, channels: 2, rmsLeft: left, rmsRight: right, peakLeft: left, peakRight: right };
}
check('Native remote hard-left/right reaches independent participant bars despite local pan', () => {
    vu.api.meters.clear();
    vu.api.meters.set('alice', vu.api.newMeter(true)); vu.api.meters.set('bob', vu.api.newMeter(true));
    nativeLevels = [nativeLevel('alice', .5, 0), nativeLevel('bob', 0, .4)]; nativeTick();
    const a = vu.api.meters.get('alice'), b = vu.api.meters.get('bob');
    assert(a.display[0] > .8); assert.equal(a.display[1], 0);
    assert.equal(b.display[0], 0); assert(b.display[1] > .8);
    assert.equal(vu.api.VoiceMeter({userId:'alice'}).props['data-vu-meter'],'lr');
});
check('Missing native samples cannot reuse scalar levels as stereo', () => {
    vu.api.meters.clear(); const m = vu.api.newMeter(true); m.amplitude = .9; vu.api.meters.set('alice',m);
    nativeLevels = []; nativeTick(); assert.equal(m.display[0],0); assert.equal(m.display[1],0);
});
check('Stale, invalid and unknown native participant samples are ignored', () => {
    nativeLevels = [nativeLevel('alice', .8, .8, 151),nativeLevel('unknown',.8,.8),nativeLevel('bob',NaN,.4)];
    nativeTick(); assert.equal(vu.api.meters.get('alice').native,undefined); assert.equal(vu.api.meters.has('unknown'),false);
});
check('Native simultaneous channels swap without participant identity swapping', () => {
    vu.api.meters.clear();vu.api.meters.set('alice',vu.api.newMeter(true));vu.api.meters.set('bob',vu.api.newMeter(true));
    nativeLevels = [nativeLevel('alice',0,.5),nativeLevel('bob',.4,0)];nativeTick();
    assert.equal(vu.api.meters.get('alice').display[0],0);assert(vu.api.meters.get('alice').display[1]>.8);
    assert(vu.api.meters.get('bob').display[0]>.8);assert.equal(vu.api.meters.get('bob').display[1],0);
});
check('Stream soundshare outbound feeds the streamer stream meter, not the voice meter', () => {
    vu.api.meters.clear();
    const voiceConn = { context: 'default' };
    vu.api.setConnection(voiceConn);
    vu.sandbox.MediaEngineStore.getMediaEngine = () => ({ connections: [voiceConn, { context: 'stream', streamUserId: 'self', soundshareActive: true }] });
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'self', soundshareActive: true }, { rtp: { outbound: [{ type: 'audio', ssrc: 199, audioLevel: .5 }] } });
    assert(vu.api.meters.get('stream:self').amplitude > .4);
});
check('Viewer stream connection inbound feeds the streamer stream meter', () => {
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'alice' }, { rtp: { inbound: { 0: { type: 'audio', ssrc: 322, audioLevel: .3 } } } });
    assert(vu.api.meters.get('stream:alice').amplitude > .2);
});
check('Stream without an audio track never creates a meter', () => {
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'carl' }, { rtp: { inbound: { 0: { type: 'video', ssrc: 5 } } } });
    assert.equal(vu.api.meters.has('stream:carl'), false);
});
check('Stream meter keys survive the desktop member sweep', () => {
    vu.api.syncDesktopMeters();
    assert(vu.api.meters.has('stream:alice'));
});
check('Stale stream meters release instead of pinning', () => {
    const m = vu.api.meters.get('stream:alice');
    m.lastStreamAt = Date.now() - 4000;
    nativeTick();
    assert.equal(vu.api.meters.has('stream:alice'), false);
});
console.log(`${checks} total checks passed`);
