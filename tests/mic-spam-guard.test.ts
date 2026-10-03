/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { transformSync } from "esbuild";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const source = read("../src/testcordplugins/MicSpamGuard/index.tsx")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
const holdSource = read("../src/testcordplugins/MicSpamGuard/protection.ts")
    .replace("export class VolumeHold", "class VolumeHold");
const code = transformSync(holdSource + "\n" + source, { loader: "tsx", format: "cjs" }).code;

const toRaw = (volume: number) =>
    volume === 0 ? 0 : (volume < 100 ? (volume / 100) ** 2.8 : 10 ** ((volume / 100 - 1) * 6 / 20)) * 100;
const toSlider = (raw: number) =>
    raw === 0 ? 0 : (raw < 100 ? (raw / 100) ** (1 / 2.8) : 20 * Math.log10(raw / 100) / 6 + 1) * 100;

const v = (t: Harness, user = "2") => t.volumes.get(user) as number;

interface Harness {
    run: (expr: string) => any;
    sample: (db: number, user?: string) => void;
    stats: (payload: any) => void;
    advance: (ms: number) => void;
    speech: (db: number, ms: number, user?: string) => void;
    store: Record<string, any>;
    storeWrites: string[];
    channel: { id: string | null; };
    notifications: Array<{ title: string; body: string; }>;
    toasts: Array<{ message: string; options: { duration?: number; position?: number; }; }>;
    volumes: Map<string, number>;
    writes: Array<{ user: string; value: number; at: number; }>;
    persisted: Map<string, any>;
    muted: Set<string>;
    friends: Set<string>;
    members: Set<string>;
    plugin: any;
}

function setup(initial: Record<string, number> = {}): Harness {
    let now = 100000;
    const volumes = new Map(Object.entries(initial));
    const writes: Array<{ user: string; value: number; at: number; }> = [];
    const persisted = new Map<string, any>();
    const storeWrites: string[] = [];
    const notifications: Array<{ title: string; body: string; }> = [];
    const toasts: Array<{ message: string; options: { duration?: number; position?: number; }; }> = [];
    const timers = new Map<number, { fn: () => void; at: number; }>();
    let nextTimer = 1;
    const muted = new Set<string>();
    const friends = new Set<string>();
    const members = new Set(["1", "2", "3", "4"]);
    const channel: { id: string | null; } = { id: "channel" };
    const emitter = { on() {}, off() {} };
    const conn = { context: "default", emitter, getUserIdBySsrc: () => "2" };
    let store: Record<string, any>;
    const sandbox: any = {
        Date: { now: () => now },
        console,
        setInterval: () => 1,
        clearInterval: () => {},
        setTimeout: (fn: () => void, ms = 0) => {
            const id = nextTimer++;
            timers.set(id, { fn, at: now + ms });
            return id;
        },
        clearTimeout: (id: number) => { timers.delete(id); },
        DataStore: {
            get: async (key: string) => persisted.get(key),
            set: async (key: string, value: any) => {
                persisted.set(key, value);
                storeWrites.push(key);
            },
            del: async (key: string) => persisted.delete(key)
        },
        plugins: {},
        TestcordDevs: { DavidHiFi: { name: "DavidHiFi" } },
        UserAreaButton() {},
        openPluginModal() {},
        Logger: class {
            debug() {}
            error(...args: any[]) { throw Error(args.join(" ")); }
        },
        definePlugin: (plugin: any) => plugin,
        makeRange: (a: number, b: number, step = 1) =>
            Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step),
        OptionType: { BOOLEAN: 1, SLIDER: 2, SELECT: 3 },
        definePluginSettings: (defs: Record<string, any>) => {
            store = Object.fromEntries(
                Object.entries(defs).map(([key, def]) => [key, def.default ?? def.options?.find((o: any) => o.default)?.value])
            );
            store.ignoreFriends = false;
            store.dynamicUserVolume = true;
            store.autoMute = false;
            store.notify = false;
            return { store, defs };
        },
        findByPropsLazy: () => ({
            setLocalVolume: (user: string, value: number) => {
                assert(Number.isFinite(value));
                volumes.set(user, value);
                writes.push({ user, value, at: now });
            }
        }),
        findByCodeLazy: (...filters: any[]) => (filters.includes("Math.log10") ? toSlider : toRaw),
        Button: {},
        React: { useSyncExternalStore: (_subscribe: any, read: any) => read(), createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }) },
        ReactDOM: { createPortal: (child: any, target: any) => ({ child, target }) },
        NotificationComponent() {},
        document: { body: {} },
        RelationshipStore: { isFriend: (user: string) => friends.has(user) },
        SelectedChannelStore: { getVoiceChannelId: () => channel.id },
        UserStore: { getCurrentUser: () => ({ id: "1" }), getUser: (user: string) => ({ username: user, bot: user === "4" }) },
        VoiceStateStore: {
            getVoiceStatesForChannel: () => Object.fromEntries([...members].map(user => [user, {}]))
        },
        MediaEngineStore: {
            getMediaEngine: () => ({ connections: [conn] }),
            getLocalVolume: (user: string) => volumes.get(user) ?? 100,
            isLocalMute: (user: string) => muted.has(user)
        },
        showToast(message: string, _type: number, options: { duration?: number; position?: number; }) { toasts.push({ message, options }); },
        persistNotification(data: { title: string; body: string; }) { notifications.push(data); return Promise.resolve(); },
        showNotification() { throw Error("MicSpamGuard must not use the shared notification queue"); },
        Toasts: { Type: { MESSAGE: 1 }, Position: { TOP: 0 } }
    };
    sandbox.lodash = {
        debounce: (fn: (...args: any[]) => void, wait = 0) => {
            let timer: number | undefined;
            const wrapped: any = (...args: any[]) => {
                if (timer !== undefined) sandbox.clearTimeout(timer);
                timer = sandbox.setTimeout(() => {
                    timer = undefined;
                    fn(...args);
                }, wait);
            };
            wrapped.flush = () => {
                if (timer === undefined) return;
                sandbox.clearTimeout(timer);
                timer = undefined;
                fn();
            };
            wrapped.cancel = () => {
                if (timer !== undefined) sandbox.clearTimeout(timer);
                timer = undefined;
            };
            return wrapped;
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const run = (expr: string) => vm.runInContext(expr, sandbox);
    const stats = (payload: any) => {
        sandbox.payload = payload;
        run("onStats(payload)");
    };
    const sample = (db: number, user = "2") =>
        stats({ rtp: { inbound: { [user]: { audioLevel: db === -Infinity ? 0 : 10 ** (db / 20) } } } });
    const runTimers = () => {
        const due = [...timers].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at);
        for (const [id, timer] of due) {
            timers.delete(id);
            timer.fn();
        }
    };
    const advance = (ms: number) => {
        for (let i = 0; i < ms; i += 100) {
            now += Math.min(100, ms - i);
            run("updateProtection(Date.now()); updateDynamics(Date.now())");
            runTimers();
        }
    };
    const speech = (db: number, ms: number, user = "2") => {
        for (let i = 0; i < ms; i += 100) {
            sample(db, user);
            advance(100);
        }
    };

    return {
        run, sample, stats, advance, speech, store,
        storeWrites, channel, notifications, toasts, volumes, writes, persisted, muted, friends, members,
        plugin: sandbox.plugin
    };
}

test("Volume conversion filters match Discord's cached functions and 100% stays 100%", () => {
    const curve = JSON.parse(read("./fixtures/discord-volume-curve.json"));
    const context: any = vm.createContext({});
    vm.runInContext(curve.code, context);
    assert(/Math\.pow\([^,]+,\s*2\.8\)/.test(context.i.toString()));
    assert(context.r.toString().includes("Math.log10") && context.r.toString().includes("35714285714285715"));
    for (const slider of [5, 20, 60, 100, 200, 400, 1000]) {
        assert(Math.abs(context.i(slider) - toRaw(slider)) < 0.00001);
        assert(Math.abs(context.r(context.i(slider)) - slider) < 0.00001);
    }
    assert.equal(context.r(100), 100);
    assert(context.r(20) > 55 && context.r(20) < 57);
});

test("Loud speech drops promptly and compression target is separate from mute threshold", () => {
    const t = setup();
    t.store.threshold = 90;
    t.speech(-3, 500);
    assert(v(t) < 65);
    t.speech(-3, 2500);
    assert(Math.abs(v(t) - 48) <= 48 * 0.05 + 1);
});

test("Quiet speech rises gradually and respects the 200% ceiling", () => {
    const t = setup();
    t.speech(-35, 1000);
    assert(v(t) < 115);
    t.speech(-35, 15000);
    const slider = toSlider(v(t));
    assert(slider > 190 && slider <= 200.1);
});

test("Silence and background noise do not trigger boost", () => {
    const t = setup();
    t.speech(-Infinity, 4000);
    t.speech(-50, 4000);
    assert.equal(t.writes.length, 0);
});

test("Automatic balancing detects very quiet speech without boosting silence", () => {
    const t = setup();
    t.speech(-46, 16000);
    assert(toSlider(v(t)) > 190);
    t.speech(-Infinity, 14000);
    assert.equal(t.volumes.get("2"), 100);
});

test("One-second desktop samples do not release gain between samples", () => {
    const t = setup();
    for (let i = 0; i < 8; i++) {
        t.sample(-3);
        t.advance(1000);
    }
    assert(v(t) < 65);
    assert(t.writes.filter(w => w.at >= 102000).every(w => w.value < 65));
});

test("Loud to quiet transition recovers smoothly without jumping to 200", () => {
    const t = setup();
    t.speech(-3, 2000);
    const low = v(t);
    t.speech(-18, 300);
    assert(v(t) < 70 && v(t) >= low);
    t.speech(-Infinity, 12000);
    assert.equal(t.volumes.get("2"), 100);
    assert.equal(t.run("turnedDown.size"), 0);
});

test("Boost returns to exact manual baseline during silence", () => {
    const t = setup({ "2": 137 });
    t.speech(-35, 15000);
    t.speech(-Infinity, 14000);
    assert.equal(t.volumes.get("2"), 137);
});

test("Quiet boost fades smoothly after silence rather than snapping down", () => {
    const t = setup();
    t.speech(-35, 15000);
    t.speech(-Infinity, 1600);
    assert(v(t) > 150);
    t.speech(-Infinity, 12000);
    assert.equal(t.volumes.get("2"), 100);
});

test("Manual volume changes become the baseline and manual zero remains zero", () => {
    const t = setup();
    t.speech(-3, 1000);
    t.volumes.set("2", 150);
    t.advance(100);
    assert.equal(t.run('turnedDown.get("2").base'), 150);
    t.run('restoreAll("silent")');
    assert.equal(t.volumes.get("2"), 150);
    t.speech(-3, 1000);
    t.volumes.set("2", 0);
    t.advance(100);
    t.speech(-35, 3000);
    assert.equal(t.volumes.get("2"), 0);
});

test("Unlocked 600% baseline is never confused with 100% or 200%", () => {
    const t = setup({ "2": 600 });
    t.speech(-3, 1000);
    t.run('restoreAll("silent")');
    assert.equal(t.volumes.get("2"), 600);
});

test("Automatic cut remains bounded for a very high manual baseline", () => {
    const t = setup({ "2": 6000 });
    t.speech(0, 4000);
    assert(v(t) >= 378);
    t.run('restoreAll("silent")');
    assert.equal(t.volumes.get("2"), 6000);
});

test("Two users receive independent loud and quiet adjustments", () => {
    const t = setup();
    for (let i = 0; i < 160; i++) {
        t.stats({ rtp: { inbound: { "2": { audioLevel: 10 ** (-3 / 20) }, "3": { audioLevel: 10 ** (-35 / 20) } } } });
        t.advance(100);
    }
    assert(v(t) < 65);
    assert(toSlider(v(t, "3")) > 190);
});

test("Friends, self, bots, local mute and users outside the call are excluded", () => {
    const t = setup();
    t.store.ignoreFriends = true;
    t.friends.add("2");
    t.muted.add("3");
    for (const user of ["1", "2", "3", "4", "9"]) t.speech(0, 1000, user);
    assert.equal(t.writes.length, 0);
});

test("Ignore restores immediately and Restore pauses until Resume", () => {
    const t = setup();
    t.speech(-3, 1000);
    t.run('toggleIgnored("2")');
    assert.equal(t.volumes.get("2"), 100);
    t.run('toggleIgnored("2")');
    t.speech(-3, 1000);
    t.run('restoreVolume("2", "manual")');
    t.speech(-3, 2000);
    assert.equal(t.volumes.get("2"), 100);
    t.run('pausedDynamics.delete("2")');
    t.speech(-3, 1000);
    assert(v(t) < 65);
});

test("Malformed stats and video entries cannot trigger adjustments", () => {
    const t = setup();
    t.stats({ rtp: { inbound: { "2": [{ audioLevel: NaN }, { kind: "video", audioLevel: 1 }, { audioLevel: -1 }] } } });
    t.advance(1000);
    assert.equal(t.writes.length, 0);
});

test("Multiple audio entries use the loudest sample, including SSRC mapping", () => {
    const t = setup();
    t.run("poll()");
    t.stats({ rtp: { inbound: [{ ssrc: 12, audioLevel: 0.7 }, { ssrc: 13, audioLevel: 0 }] } });
    t.advance(400);
    assert(v(t) < 65);
});

test("Leaving the call restores held volumes and clears controller state", async () => {
    const t = setup();
    await t.plugin.start();
    t.run("poll()");
    t.speech(-3, 1000);
    t.members.delete("2");
    t.run("poll()");
    assert.equal(t.volumes.get("2"), 100);
    assert.equal(t.run("turnedDown.size"), 0);
    await t.plugin.stop();
});

test("Disable restores volumes and persistence ends with no stale holds", async () => {
    const t = setup();
    t.speech(-3, 1000);
    t.store.enabled = false;
    t.run("settings.defs.enabled.onChange()");
    t.advance(1000);
    await t.run("persistQueue");
    assert.equal(t.volumes.get("2"), 100);
    assert.equal(Object.keys(t.persisted.get("MicSpamGuard_held_volumes")).length, 0);
});

test("Crash recovery restores exact saved raw volumes and rejects invalid values", async () => {
    const t = setup({ "2": 24 });
    t.persisted.set("MicSpamGuard_held_volumes", { "2": 600, "3": NaN, "4": -1 });
    await t.plugin.start();
    assert.equal(t.volumes.get("2"), 600);
    assert.equal(t.volumes.get("3"), undefined);
    assert.equal(t.volumes.get("4"), undefined);
    await t.plugin.stop();
});

test("Mute mode still holds and restores the manual volume", () => {
    const t = setup({ "2": 155 });
    t.store.dynamicUserVolume = false;
    t.store.threshold = 98;
    t.store.autoMute = true;
    t.speech(0, 1000);
    assert.equal(t.volumes.get("2"), 0);
    t.run('unmute("2", "manual")');
    assert.equal(t.volumes.get("2"), 155);
});

test("Mute protection and volume controls remain separately configurable", () => {
    const t = setup();
    t.store.autoMute = true;
    assert.equal(t.store.dynamicTarget, 65);
    assert.equal(t.store.dynamicMaxReduction, 12);
    assert.equal(t.store.dynamicMaxBoost, 6);
    assert.equal(t.store.dynamicResponse, 250);
    for (const key of ["threshold", "sensitivity", "autoUnmute", "dynamicTarget", "dynamicMaxReduction", "dynamicMaxBoost", "dynamicResponse"]) {
        assert.equal(t.plugin.settings.defs[key].hidden(), false);
    }
    t.store.dynamicUserVolume = false;
    assert.equal(t.plugin.settings.defs.dynamicTarget.hidden(), true);
    assert.equal(t.plugin.settings.defs.threshold.hidden(), false);
});

test("Everyday loud speech is balanced without an extreme mute", () => {
    const t = setup();
    t.store.autoMute = true;
    t.speech(-6, 5000);
    assert(v(t) > 0 && v(t) < 100);
    assert.equal(t.run("mutedByUs.size"), 0);
});

test("Consecutive extreme samples mute while dynamic balancing is enabled", () => {
    const t = setup({ "2": 155 });
    t.store.autoMute = true;
    t.speech(-6, 1000);
    t.speech(0, 500);
    assert.equal(t.volumes.get("2"), 0);
    assert.equal(t.run("turnedDown.size"), 0);
    t.run('unmute("2", "manual")');
    assert.equal(t.volumes.get("2"), 155);
});

test("Normal samples break the extreme mute count", () => {
    const t = setup();
    t.store.autoMute = true;
    for (let i = 0; i < 10; i++) {
        t.sample(0);
        t.advance(100);
        t.sample(-6);
        t.advance(100);
    }
    assert(v(t) > 0);
    assert.equal(t.run("mutedByUs.size"), 0);
});

test("Old low thresholds cannot mute everyday speech", () => {
    const t = setup();
    t.store.autoMute = true;
    t.store.threshold = 70;
    t.speech(-6, 5000);
    assert(v(t) > 0);
});

test("Fresh safe speech restores protection smoothly to 100% after the configured hold", () => {
    const t = setup({ "2": 155 }); t.run("poll()"); t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); assert.equal(v(t), 0);
    t.speech(-20, 3000); assert.equal(v(t), 0);
    t.speech(-20, 500); assert(v(t) > 0 && v(t) < 100);
    t.speech(-20, 1200); assert.equal(v(t), 100);
});

test("Continuous blasts cannot periodically reopen a held volume", () => {
    const t = setup();
    t.run("poll()");
    t.store.autoMute = true;
    t.store.autoUnmute = 3;
    t.speech(0, 1000);
    const count = t.writes.length;
    t.speech(0, 30000);
    assert.equal(t.volumes.get("2"), 0);
    assert(t.writes.slice(count).every(w => w.value === 0));
});

test("Fresh zero readings restore a held user after silence", () => {
    const t = setup(); t.run("poll()"); t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); t.speech(-Infinity, 6000);
    assert.equal(v(t), 100); assert.equal(t.run("mutedByUs.size"), 0);
});

test("Missing readings cannot leave a guard-owned zero volume forever", () => {
    const t = setup(); t.run("poll()"); t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); t.advance(3000); assert.equal(v(t), 0);
    t.advance(5000); assert.equal(v(t), 100); assert.equal(t.run("mutedByUs.size"), 0);
});

test("A returning blast closes partial recovery before the next full-volume write", () => {
    const t = setup();
    t.run("poll()");
    t.store.autoMute = true;
    t.store.autoUnmute = 3;
    t.store.dynamicUserVolume = false;
    t.speech(0, 1000);
    t.speech(-20, 3600);
    assert(v(t) > 0);
    t.speech(0, 100);
    assert.equal(t.volumes.get("2"), 0);
    t.speech(-20, 2000);
    assert.equal(t.volumes.get("2"), 0);
});

test("Brief natural speech pauses do not reset verified safe recovery", () => {
    const t = setup();
    t.run("poll()");
    t.store.autoMute = true;
    t.store.autoUnmute = 3;
    t.store.dynamicUserVolume = false;
    t.speech(0, 1000);
    t.speech(-20, 2000);
    t.speech(-Infinity, 500);
    t.speech(-20, 2200);
    assert.equal(t.volumes.get("2"), 100);
});

test("Quiet evidence gaps do not restart recovery forever", () => {
    const t = setup(); t.run("poll()"); t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); t.speech(-20, 2500); t.advance(2500); t.speech(-20, 1500);
    assert.equal(v(t), 100);
});

test("Auto restore off never raises volume despite continuous safe speech", () => {
    const t = setup();
    t.run("poll()");
    t.store.autoMute = true;
    t.store.autoUnmute = 0;
    t.speech(0, 1000);
    t.speech(-20, 20000);
    assert.equal(t.volumes.get("2"), 0);
});

test("Duplicated timestamps do not accelerate the quiet interval", () => {
    const t = setup(); t.run("poll()"); t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000);
    for (let i = 0; i < 100; i++) t.sample(-20);
    assert.equal(v(t), 0);
});

test("Manual volume changes during protection remain the user's choice", () => {
    const t = setup();
    t.run("poll()");
    t.store.autoMute = true;
    t.speech(0, 1000);
    t.volumes.set("2", 137);
    t.advance(100);
    assert.equal(t.volumes.get("2"), 137);
    assert.equal(t.run("volumeHolds.size"), 0);
});

test("Disabling protection restores its mute and keeps balancing enabled", () => {
    const t = setup();
    t.store.autoMute = true;
    t.speech(0, 1000);
    t.store.autoMute = false;
    t.run("settings.defs.autoMute.onChange(false)");
    assert.equal(t.volumes.get("2"), 100);
    assert(t.store.dynamicUserVolume);
});

test("Gentler defaults keep ordinary loud speech near the manual volume", () => {
    const t = setup();
    t.speech(-12, 3000);
    const slider = toSlider(v(t));
    assert(slider > 90 && slider < 100);
});

test("Reduction limits and disabling boost are respected", () => {
    const t = setup();
    t.store.dynamicMaxReduction = 3;
    t.speech(0, 3000);
    assert(v(t) >= 70.7);
    t.run('restoreAll("silent")');
    t.store.dynamicMaxBoost = 0;
    t.speech(-35, 5000);
    assert.equal(t.volumes.get("2"), 100);
});

test("Lower targets reduce more and faster response reacts sooner", () => {
    const a = setup();
    const b = setup();
    a.store.dynamicResponse = 150;
    b.store.dynamicResponse = 400;
    a.speech(-3, 300);
    b.speech(-3, 300);
    assert(v(a) < v(b));

    const c = setup();
    const d = setup();
    c.store.dynamicTarget = 55;
    d.store.dynamicTarget = 75;
    c.speech(-3, 3000);
    d.speech(-3, 3000);
    assert(v(c) < v(d));
});

test("A conflicting SSRC owner cannot mute or change the keyed participant", () => {
    const t = setup();
    t.run("poll()");
    t.store.autoMute = true;
    for (let i = 0; i < 5; i++) {
        t.stats({ rtp: { inbound: { "3": { ssrc: 12, audioLevel: 1 } } } });
        t.advance(1000);
    }
    assert.equal(t.writes.length, 0);
});

test("Self audio mislabeled under another member cannot affect anyone", () => {
    const t = setup();
    t.run("poll(); connection.getUserIdBySsrc=()=> '1'");
    t.store.autoMute = true;
    for (let i = 0; i < 5; i++) {
        t.stats({ rtp: { inbound: { "2": { ssrc: 12, audioLevel: 1 } } } });
        t.advance(1000);
    }
    assert.equal(t.writes.length, 0);
});

test("Explicit user identity conflicts cannot cause volume writes", () => {
    const t = setup();
    t.store.autoMute = true;
    for (let i = 0; i < 5; i++) {
        t.stats({ rtp: { inbound: { "2": { userId: "1", audioLevel: 1 }, "3": { user_id: "2", audioLevel: 1 } } } });
        t.advance(1000);
    }
    assert.equal(t.writes.length, 0);
});

test("Unknown numeric keys without a verified owner are ignored", () => {
    const t = setup();
    t.run("poll();connection.getUserIdBySsrc=()=>null");
    t.stats({ rtp: { inbound: { "999": { audioLevel: 1 }, aggregate: { audioLevel: 1 } } } });
    t.advance(1000);
    assert.equal(t.writes.length, 0);
    assert.equal(t.run("levels.has('999')"), false);
});

test("Outgoing self audio never controls silent incoming participants", () => {
    const t = setup();
    t.store.autoMute = true;
    for (let i = 0; i < 5; i++) {
        t.stats({ rtp: { outbound: { "1": { audioLevel: 1 } }, inbound: { "2": { audioLevel: 0 }, "3": { audioLevel: 0 } } } });
        t.advance(1000);
    }
    assert.equal(t.writes.length, 0);
});

test("Malformed explicit identities and outbound entries cannot control a member", () => {
    const t = setup();
    t.store.autoMute = true;
    for (let i = 0; i < 5; i++) {
        t.stats({
            rtp: {
                inbound: {
                    "2": [{ userId: 1, audioLevel: 1 }, { type: "outbound-rtp", audioLevel: 1 }, { direction: "outbound", audioLevel: 1 }],
                    "3": { user_id: "", audioLevel: 1 }
                }
            }
        });
        t.advance(1000);
    }
    assert.equal(t.writes.length, 0);
});

test("A failed SSRC lookup cannot fall back to a guessed participant", () => {
    const t = setup();
    t.run("poll();connection.getUserIdBySsrc=()=> {throw Error('no identity');}");
    t.store.autoMute = true;
    for (let i = 0; i < 5; i++) {
        t.stats({ rtp: { inbound: { "2": { ssrc: 12, audioLevel: 1 } } } });
        t.advance(1000);
    }
    assert.equal(t.writes.length, 0);
});

test("Startup migrates aggressive saved limits and restores held raw baselines", async () => {
    const t = setup({ "2": 20 });
    Object.assign(t.store, { dynamicTarget: 60, dynamicMaxReduction: 24, dynamicMaxBoost: 12, threshold: 80, sensitivity: 5, autoUnmute: 3 });
    t.persisted.set("MicSpamGuard_held_volumes", { "2": 155 });
    await t.plugin.start();
    assert.equal(t.store.dynamicTarget, 65);
    assert.equal(t.store.dynamicMaxReduction, 12);
    assert.equal(t.store.dynamicMaxBoost, 6);
    assert.equal(t.store.threshold, 98);
    assert.equal(t.store.sensitivity, 5);
    assert.equal(t.store.autoUnmute, 3);
    assert.equal(t.volumes.get("2"), 155);
    assert.equal(t.persisted.has("MicSpamGuard_held_volumes"), false);
    assert.equal(t.persisted.get("MicSpamGuard_balance_v2"), true);
    Object.assign(t.store, { dynamicTarget: 70, dynamicMaxReduction: 18, dynamicMaxBoost: 9, threshold: 95 });
    await t.plugin.start();
    assert.equal(t.store.dynamicTarget, 70);
    assert.equal(t.store.dynamicMaxReduction, 18);
    assert.equal(t.store.dynamicMaxBoost, 9);
    assert.equal(t.store.threshold, 95);
});

test("Startup preserves already moderate saved settings", async () => {
    const t = setup();
    Object.assign(t.store, { dynamicTarget: 70, dynamicMaxReduction: 9, dynamicMaxBoost: 3, threshold: 95 });
    await t.plugin.start();
    assert.equal(t.store.dynamicTarget, 70);
    assert.equal(t.store.dynamicMaxReduction, 9);
    assert.equal(t.store.dynamicMaxBoost, 3);
    assert.equal(t.store.threshold, 95);
});

test("Steady speech stops sending volume writes once the value sits in the deadband", () => {
    const t = setup();
    t.speech(-3, 8000);
    const settled = t.writes.length;
    t.speech(-3, 3000);
    assert(t.writes.length - settled <= 3);
});

test("Repeated held volume changes collapse into one debounced DataStore write", async () => {
    const t = setup();
    t.run('savedVolume.set("2", 90); persistHeld()');
    t.run('savedVolume.set("2", 80); persistHeld()');
    t.run('savedVolume.set("3", 70); persistHeld()');
    assert.equal(t.persisted.has("MicSpamGuard_held_volumes"), false);
    t.run("heldWrite.flush()");
    await t.run("persistQueue");
    const held = t.persisted.get("MicSpamGuard_held_volumes");
    assert.equal(Object.keys(held).length, 2);
    assert.equal(held["2"], 80);
    assert.equal(held["3"], 70);
    assert.equal(t.storeWrites.length, 1);
});


test("Balancing actions show prominent notices without a notice every tick", () => {
    const t = setup(); t.store.notify = true; t.store.notificationMode = "verbose"; t.speech(-6, 5000);
    assert(t.notifications.some(n => n.body.includes("Turned down")));
    assert(t.notifications.length <= 2);
    assert.equal(t.toasts.length, 0);
    t.speech(-Infinity, 12000);
    assert(t.notifications.some(n => n.body.includes("Restored")));
    assert.equal(v(t), 100);
});

test("Mute and automatic 100% recovery each get a notification", () => {
    const t = setup(); t.run("poll()"); t.store.notify = true; t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); t.speech(-Infinity, 6000);
    assert(t.notifications.some(n => n.body.startsWith("Muted")));
    assert(t.notifications.some(n => n.body.includes("to 100%")));
});

test("Notifications disabled suppress both presentation channels", () => {
    const t = setup(); t.speech(-6, 5000); t.speech(-Infinity, 12000);
    assert.equal(t.notifications.length, 0); assert.equal(t.toasts.length, 0);
});


test("Standard mode shows essential events once and skips balancing notices", () => {
    const t = setup(); t.store.notify = true;
    assert.equal(t.store.notificationMode, "standard");
    t.speech(-6, 5000); t.speech(-Infinity, 12000);
    assert.equal(t.notifications.length, 0); assert.equal(t.toasts.length, 0);
    t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); t.speech(-Infinity, 6000);
    assert.equal(t.notifications.length, 2); assert.equal(t.toasts.length, 0);
    assert.equal(t.notifications[1].body, "Restored 2 to 100%.");
});

test("Verbose adds context without adding a second notification channel", () => {
    const t = setup(); t.store.notify = true; t.store.notificationMode = "verbose";
    t.store.autoMute = true; t.store.autoUnmute = 3; t.store.dynamicUserVolume = false;
    t.speech(0, 1000); t.speech(-Infinity, 6000);
    assert.equal(t.notifications.length, 2); assert.equal(t.toasts.length, 0);
    assert(t.notifications[0].body.includes("Level 100%"));
    assert(t.notifications[1].body.includes("After 3 seconds"));
});


test("A burst replaces current activity instead of creating a popup backlog", () => {
    const t = setup(); t.store.notify = true; t.store.notificationMode = "verbose";
    for (let i = 0; i < 100; i++) t.run(`notifyAction("Action ${i}", {userId:"2"})`);
    assert.equal(t.run("noticeItems.length"), 1);
    assert.equal(t.run("noticeItems[0].body"), "Action 99");
    t.advance(3100); assert.equal(t.run("noticeItems.length"), 0);
});

test("The activity card bounds rows and expires old participants independently", () => {
    const t = setup(); t.store.notify = true;
    for (const id of ["1", "2", "3", "4"]) t.run(`notifyAction("User ${id}", {userId:"${id}"})`);
    assert.equal(t.run("noticeItems.length"), 3);
    t.advance(2000); t.run('notifyAction("Updated", {userId:"2"})');
    t.advance(1100); assert.equal(t.run("noticeItems.length"), 1);
    assert.equal(t.run("noticeItems[0].body"), "Updated");
});

test("Leaving the call clears activity and rejects later stale actions", () => {
    const t = setup(); t.run("poll()"); t.store.notify = true;
    t.run('notifyAction("Before leaving", {userId:"2"})');
    t.channel.id = null; t.run("poll()"); assert.equal(t.run("noticeItems.length"), 0);
    t.run('notifyAction("Stale", {userId:"2"})'); assert.equal(t.run("noticeItems.length"), 0);
    t.advance(10000); assert.equal(t.run("noticeItems.length"), 0);
});

test("Mode changes, disabling notices and plugin shutdown clear current activity", () => {
    const t = setup(); t.store.notify = true;
    t.run('notifyAction("Mode change")'); t.plugin.settings.defs.notificationMode.onChange();
    assert.equal(t.run("noticeItems.length"), 0);
    t.run('notifyAction("Disable")'); t.plugin.settings.defs.notify.onChange(false);
    assert.equal(t.run("noticeItems.length"), 0);
    t.run('notifyAction("Stop")'); t.plugin.stop(); assert.equal(t.run("noticeItems.length"), 0);
});


test("Activity renders as one live card and dismissing it clears all rows", () => {
    const t = setup(); t.store.notify = true;
    t.run('notifyAction("First", {userId:"2"}); notifyAction("Second", {userId:"3"})');
    const view = t.run("GuardNotice()");
    assert.equal(view.child.props.title, "MicSpamGuard");
    assert.equal(view.child.props.permanent, true);
    assert.equal(view.child.props.body, "First\nSecond");
    view.child.props.onClose(); assert.equal(t.run("GuardNotice()"), null);
});
