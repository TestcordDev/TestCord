/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { useForceUpdater } from "@utils/react";
import { useEffect } from "@webpack/common";
const propsProviders = new Map();
const listeners = new Map();
const surfaceInstances = new Map();
const failedPropsProviders = new WeakSet();
const logger = new Logger("SurfaceClasses");
function getPropsProviderSet(surfaceId) {
    let set = propsProviders.get(surfaceId);
    if (set == null) {
        set = new Set();
        propsProviders.set(surfaceId, set);
    }
    return set;
}
function getListenerSet(surfaceId) {
    let set = listeners.get(surfaceId);
    if (set == null) {
        set = new Set();
        listeners.set(surfaceId, set);
    }
    return set;
}
function chainHandlers(first, second) {
    if (!first)
        return second;
    if (!second)
        return first;
    return (event) => {
        first(event);
        second(event);
    };
}
function chainRefs(first, second) {
    if (!first)
        return second;
    if (!second)
        return first;
    return (instance) => {
        first(instance);
        second(instance);
    };
}
function mergeSurfaceProvidedProps(target, source) {
    const ref = chainRefs(target.ref, source.ref);
    if (ref)
        target.ref = ref;
    const onFocusCapture = chainHandlers(target.onFocusCapture, source.onFocusCapture);
    if (onFocusCapture)
        target.onFocusCapture = onFocusCapture;
    const onBlurCapture = chainHandlers(target.onBlurCapture, source.onBlurCapture);
    if (onBlurCapture)
        target.onBlurCapture = onBlurCapture;
    const onMouseDownCapture = chainHandlers(target.onMouseDownCapture, source.onMouseDownCapture);
    if (onMouseDownCapture)
        target.onMouseDownCapture = onMouseDownCapture;
    const onMouseOverCapture = chainHandlers(target.onMouseOverCapture, source.onMouseOverCapture);
    if (onMouseOverCapture)
        target.onMouseOverCapture = onMouseOverCapture;
    const onMouseOutCapture = chainHandlers(target.onMouseOutCapture, source.onMouseOutCapture);
    if (onMouseOutCapture)
        target.onMouseOutCapture = onMouseOutCapture;
    if (source.style) {
        target.style = { ...target.style, ...source.style };
    }
    // Copy only string data-* attributes so providers cannot smuggle in
    // arbitrary props (className in particular is deliberately unsupported).
    for (const [key, value] of Object.entries(source)) {
        if (key.startsWith("data-") && typeof value === "string") {
            target[key] = value;
        }
    }
    return target;
}
function getSurfaceProps(surfaceId) {
    const props = {};
    for (const provider of propsProviders.get(surfaceId) ?? []) {
        let providedProps;
        try {
            providedProps = provider();
        }
        catch (error) {
            if (!failedPropsProviders.has(provider)) {
                failedPropsProviders.add(provider);
                logger.error(`Surface props provider failed for ${surfaceId}`, error);
            }
            continue;
        }
        if (providedProps) {
            mergeSurfaceProvidedProps(props, providedProps);
        }
    }
    return props;
}
function notifyOneSurface(surfaceId) {
    const surfaceInstance = surfaceInstances.get(surfaceId)?.deref();
    if (surfaceInstance) {
        surfaceInstance.forceUpdate();
    }
    else {
        surfaceInstances.delete(surfaceId);
    }
    for (const listener of listeners.get(surfaceId) ?? []) {
        listener();
    }
}
export function addSurfacePropsProvider(surfaceId, provider) {
    getPropsProviderSet(surfaceId).add(provider);
    notifyOneSurface(surfaceId);
    return () => {
        propsProviders.get(surfaceId)?.delete(provider);
        notifyOneSurface(surfaceId);
    };
}
/** Re-renders a surface after the state backing one of its providers changed. */
export function notifySurfaceClassesChanged(surfaceId) {
    notifyOneSurface(surfaceId);
}
/** @internal Injected by SurfaceClassesAPI patch (do NOT call directly) */
export function _getSurfaceProps(surfaceId) {
    return getSurfaceProps(surfaceId);
}
/** @internal Injected by SurfaceClassesAPI patch (do NOT call directly) */
export function _useSurfaceProps(surfaceId) {
    const forceUpdate = useForceUpdater();
    useEffect(() => {
        const listener = () => forceUpdate();
        getListenerSet(surfaceId).add(listener);
        return () => { listeners.get(surfaceId)?.delete(listener); };
    }, [surfaceId]);
    return getSurfaceProps(surfaceId);
}
/**
 * @internal Injected by SurfaceClassesAPI patch (do NOT call directly).
 * Only used for class component surfaces where hooks cannot be injected into render().
 * Function component surfaces use _useSurfaceProps instead.
 */
export function _trackSurfaceInstance(surfaceId, instance) {
    if (surfaceInstances.get(surfaceId)?.deref() !== instance) {
        surfaceInstances.set(surfaceId, new WeakRef(instance));
    }
}
