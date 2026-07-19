/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { isObject } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findAll } from "@webpack";

type DomMethodName = "appendChild" | "removeChild";
type ElementChildMethod = typeof Element.prototype.appendChild;

interface SpringModule {
    Globals: {
        assign(options: { skipAnimation: boolean; }): void;
    };
    Springs: object;
}

const logger = new Logger("HisakoOptimizations");
const domMethods = ["appendChild", "removeChild"] as const;
const delayedClassNames = ["activity", "subText", "botText", "clanTag"] as const;
const originalDomMethods = new Map<DomMethodName, ElementChildMethod>();
const pendingDomTimers = new Set<number>();

let springModules: SpringModule[] = [];
let started = false;

const settings = definePluginSettings({
    disableSpringAnimations: {
        type: OptionType.BOOLEAN,
        description: "Skip Discord spring animations.",
        default: true,
        disabled: () => isPluginEnabled("DisableAnimations") || isPluginEnabled("optimizerPremium"),
        onChange(value) {
            if (!started) return;
            if (value && springModules.length === 0) loadSpringModules();
            setSpringAnimations(value);
        }
    },
    throttleActivityDom: {
        type: OptionType.BOOLEAN,
        description: "Delay expensive activity list DOM updates.",
        default: true,
        disabled: () => isPluginEnabled("optimizerPremium"),
        onChange(value) {
            if (!started) return;
            if (value) installDomThrottling();
            else restoreDomThrottling();
        }
    },
    activityDomDelay: {
        type: OptionType.SLIDER,
        description: "Activity update delay in milliseconds.",
        markers: [25, 50, 75, 100, 150, 200],
        default: 100,
        stickToMarkers: false
    },
    disableTypingDots: {
        type: OptionType.BOOLEAN,
        description: "Disable the CPU intensive typing dots animation.",
        default: true,
        disabled: () => isPluginEnabled("NoTypingAnimation"),
        restartNeeded: true
    }
});

function hasCallableAssign(value: unknown): value is SpringModule["Globals"] {
    return isObject(value) && "assign" in value && typeof value.assign === "function";
}

function isSpringModule(value: unknown): value is SpringModule {
    if (!isObject(value)) return false;

    const module = value as Partial<Record<keyof SpringModule, unknown>>;
    return hasCallableAssign(module.Globals) && isObject(module.Springs);
}

function loadSpringModules() {
    const modules: SpringModule[] = [];

    for (const module of findAll(isSpringModule)) {
        if (isSpringModule(module)) modules.push(module);
    }

    springModules = modules;
}

function setSpringAnimations(skipAnimation: boolean) {
    for (const module of springModules) {
        try {
            module.Globals.assign({ skipAnimation });
        } catch (error) {
            logger.warn("Failed to update a Discord animation module.", error);
        }
    }
}

function shouldDelayNode(node: Node) {
    if (!(node instanceof Element)) return false;
    if (typeof node.className !== "string") return false;

    return delayedClassNames.some(className => node.className.includes(className));
}

function createDomMethod(method: DomMethodName, original: ElementChildMethod): ElementChildMethod {
    return function <T extends Node>(this: Element, node: T): T {
        const delay = settings.store.activityDomDelay;

        if (!settings.store.throttleActivityDom || delay <= 0 || !shouldDelayNode(node)) {
            return original.call(this, node) as T;
        }

        const timer = window.setTimeout(() => {
            pendingDomTimers.delete(timer);

            if (method === "removeChild" && node.parentNode !== this) return;
            if (method === "appendChild" && node.parentNode === this) return;

            original.call(this, node);
        }, delay);

        pendingDomTimers.add(timer);
        return node;
    };
}

function clearPendingDomTimers() {
    for (const timer of pendingDomTimers) {
        window.clearTimeout(timer);
    }

    pendingDomTimers.clear();
}

function installDomThrottling() {
    if (originalDomMethods.size !== 0 || isPluginEnabled("optimizerPremium")) return;

    try {
        for (const method of domMethods) {
            const original = Element.prototype[method];
            originalDomMethods.set(method, original);
            Element.prototype[method] = createDomMethod(method, original);
        }
    } catch (error) {
        restoreDomThrottling();
        logger.warn("Failed to install activity DOM throttling.", error);
    }
}

function restoreDomThrottling() {
    clearPendingDomTimers();

    for (const [method, original] of originalDomMethods) {
        Element.prototype[method] = original;
    }

    originalDomMethods.clear();
}

export default definePlugin({
    name: "Hisako's Optimizations",
    description: "Reduces expensive Discord UI animations and activity updates.",
    authors: [{ name: "irritably", id: 928787166916640838n }],
    tags: ["Utility", "Appearance"],
    searchTerms: ["performance", "optimization", "lag", "activity", "animation"],
    settings,

    patches: [
        {
            find: "dotCycle",
            predicate: () => settings.store.disableTypingDots && !isPluginEnabled("NoTypingAnimation") && !isPluginEnabled("optimizerPremium"),
            replacement: {
                match: /focused:(\i)/g,
                replace: (_, focused) => `_focused:${focused}=false`
            }
        }
    ],

    start() {
        started = true;

        if (settings.store.disableSpringAnimations && !isPluginEnabled("DisableAnimations") && !isPluginEnabled("optimizerPremium")) {
            loadSpringModules();
            setSpringAnimations(true);
        }

        if (settings.store.throttleActivityDom) {
            installDomThrottling();
        }
    },

    stop() {
        started = false;
        restoreDomThrottling();

        if (springModules.length !== 0 && !isPluginEnabled("DisableAnimations") && !isPluginEnabled("optimizerPremium")) {
            setSpringAnimations(false);
        }

        springModules = [];
    }
});
