/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Settings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import { wreq } from "@webpack";
import { FluxDispatcher, React, ReactDOM } from "@webpack/common";
const bdLogger = new Logger("BdApi", "#7289da");
class PatcherManager {
    patches = [];
    pluginName;
    constructor(pluginName) {
        this.pluginName = pluginName || "BdApi";
    }
    getPatchesByCaller(name) {
        if (!name)
            return [];
        const patches = [];
        for (const patch of this.patches) {
            for (const childPatch of patch.children) {
                if (childPatch.caller === name)
                    patches.push(childPatch);
            }
        }
        return patches;
    }
    unpatchAll(caller) {
        const patchesToUnpatch = typeof caller === "string" ? this.getPatchesByCaller(caller) : [];
        for (const patch of patchesToUnpatch) {
            patch.unpatch();
        }
    }
    resolveModule(module) {
        if (!module || typeof module === "function" || (typeof module === "object" && !Array.isArray(module)))
            return module;
        if (typeof module === "string") {
            // Try to find module by displayName/name
            return null; // Would need webpack lookup
        }
        if (Array.isArray(module)) {
            // Try to find by props - use type assertion to access modules
            const wreqAny = wreq;
            if (wreqAny.m) {
                return Object.values(wreqAny.m).find((m) => {
                    if (!m)
                        return false;
                    try {
                        const exports = m.exports || {};
                        return module.every(prop => prop in exports);
                    }
                    catch {
                        return false;
                    }
                });
            }
        }
        return null;
    }
    makeOverride(patch) {
        return function (...args) {
            let returnValue;
            if (!patch.children || !patch.children.length) {
                return patch.originalFunction.apply(this, args);
            }
            // Run "before" patches
            for (const superPatch of patch.children.filter(c => c.type === "before")) {
                try {
                    superPatch.callback(this, args);
                }
                catch (err) {
                    bdLogger.error(`Could not fire before callback of ${patch.functionName} for ${superPatch.caller}`, err);
                }
            }
            // Run "instead" patches
            const insteads = patch.children.filter(c => c.type === "instead");
            if (!insteads.length) {
                returnValue = patch.originalFunction.apply(this, args);
            }
            else {
                for (const insteadPatch of insteads) {
                    try {
                        const tempReturn = insteadPatch.callback(this, args, patch.originalFunction.bind(this));
                        if (typeof tempReturn !== "undefined")
                            returnValue = tempReturn;
                    }
                    catch (err) {
                        bdLogger.error(`Could not fire instead callback of ${patch.functionName} for ${insteadPatch.caller}`, err);
                    }
                }
            }
            // Run "after" patches
            for (const slavePatch of patch.children.filter(c => c.type === "after")) {
                try {
                    const tempReturn = slavePatch.callback(this, args, returnValue);
                    if (typeof tempReturn !== "undefined")
                        returnValue = tempReturn;
                }
                catch (err) {
                    bdLogger.error(`Could not fire after callback of ${patch.functionName} for ${slavePatch.caller}`, err);
                }
            }
            return returnValue;
        };
    }
    rePatch(patch) {
        patch.proxyFunction = patch.module[patch.functionName] = this.makeOverride(patch);
    }
    makePatch(module, functionName, name) {
        const patch = {
            name,
            module,
            functionName,
            originalFunction: module[functionName],
            proxyFunction: null,
            revert: () => {
                patch.module[patch.functionName] = patch.originalFunction;
                patch.proxyFunction = null;
                patch.children = [];
            },
            counter: 0,
            children: []
        };
        patch.proxyFunction = module[functionName] = this.makeOverride(patch);
        // Copy properties from original
        if (patch.originalFunction) {
            Object.assign(module[functionName], patch.originalFunction);
            module[functionName].__originalFunction = patch.originalFunction;
            module[functionName].toString = () => patch.originalFunction.toString();
        }
        this.patches.push(patch);
        return patch;
    }
    pushChildPatch(moduleToPatch, functionName, callback, options = {}) {
        const { type = "after", forcePatch = true } = options;
        const module = this.resolveModule(moduleToPatch) || moduleToPatch;
        if (!module)
            return null;
        if (!module[functionName] && forcePatch)
            module[functionName] = function () { };
        if (!(module[functionName] instanceof Function))
            return null;
        const displayName = options.displayName || module.displayName || module.name || "Unknown";
        const patchId = `${displayName}.${functionName}`;
        let patch = this.patches.find(p => p.module === module && p.functionName === functionName);
        if (!patch) {
            patch = this.makePatch(module, functionName, patchId);
        }
        else if (!patch.proxyFunction) {
            this.rePatch(patch);
        }
        const child = {
            caller: this.pluginName,
            type,
            id: patch.counter,
            callback,
            unpatch: () => {
                const idx = patch.children.findIndex(c => c.id === child.id && c.type === type);
                if (idx !== -1) {
                    patch.children.splice(idx, 1);
                }
                if (patch.children.length <= 0) {
                    const patchNum = this.patches.findIndex(p => p.module === module && p.functionName === functionName);
                    if (patchNum >= 0) {
                        this.patches[patchNum].revert();
                        this.patches.splice(patchNum, 1);
                    }
                }
            }
        };
        patch.children.push(child);
        patch.counter++;
        return child.unpatch;
    }
    before(moduleToPatch, functionName, callback, options = {}) {
        return this.pushChildPatch(moduleToPatch, functionName, callback, { ...options, type: "before" }) || (() => { });
    }
    after(moduleToPatch, functionName, callback, options = {}) {
        return this.pushChildPatch(moduleToPatch, functionName, callback, { ...options, type: "after" }) || (() => { });
    }
    instead(moduleToPatch, functionName, callback, options = {}) {
        return this.pushChildPatch(moduleToPatch, functionName, callback, { ...options, type: "instead" }) || (() => { });
    }
}
const BdWebpack = {
    Filters: {
        byProps: (...props) => (m) => m && props.every(p => m[p] !== undefined),
        byKeys: (...props) => (m) => m && props.every(p => p in m),
        byDisplayName: (displayName) => (m) => m?.displayName === displayName,
        byName: (name) => (m) => m?.name === name,
        byStrings: (...strings) => (m) => {
            if (typeof m !== "function")
                return false;
            try {
                const str = String(m);
                return strings.every(s => str.includes(s));
            }
            catch {
                return false;
            }
        },
        bySource: (...something) => {
            return (_unused, module) => {
                if (!module?.id)
                    return false;
                let source;
                try {
                    source = String(wreq.m[module.id]);
                }
                catch {
                    return false;
                }
                return something.every(search => typeof search === "string" ? source.includes(search) : search.test(source));
            };
        },
        byPrototypeKeys: (...keys) => (m) => m?.prototype && keys.every(k => k in m.prototype),
        byStoreName: (name) => (m) => m?._dispatchToken && m?.getName?.() === name,
        byRegex: (regex, filterFn = m => m) => (m) => {
            const method = filterFn(m);
            if (!method)
                return false;
            let methodString = "";
            try {
                methodString = method.toString();
            }
            catch {
                return false;
            }
            return methodString.search(regex) !== -1;
        },
        combine: (...filters) => (exports, module, id) => filters.every(f => f(exports, module, id)),
        not: (filter) => (exports, module, id) => !filter(exports, module, id),
        byComponentType: (filterFn) => (exports) => {
            const component = getReactComponentType(exports);
            return typeof component === "function" && filterFn(component);
        }
    },
    getModule: (filterFn, options = {}) => {
        const { first = true, defaultExport = true, searchExports = false, raw = false } = options;
        const modules = wreq.c || {};
        const found = [];
        for (const id in modules) {
            if (!Object.prototype.hasOwnProperty.call(modules, id))
                continue;
            let module;
            try {
                module = modules[id];
            }
            catch {
                continue;
            }
            const { exports } = module;
            if (!exports || exports === window)
                continue;
            // Skip DOM/Map-like exports
            if (exports.remove && exports.set && exports.clear && exports.get && !exports.sort)
                continue;
            if (exports?.default?.remove && exports?.default?.set && exports?.default?.clear && exports?.default?.get && !exports?.default?.sort)
                continue;
            // Skip token-related modules
            if (exports?.default?.getToken || exports?.default?.getEmail || exports?.default?.showToken)
                continue;
            if (exports.getToken || exports.getEmail || exports.showToken)
                continue;
            try {
                if (searchExports && typeof exports === "object" && !exports.TypedArray) {
                    if (filterFn(exports, module, id)) {
                        const foundModule = raw ? module : exports;
                        if (first)
                            return foundModule;
                        found.push(foundModule);
                    }
                    for (const key in exports) {
                        let wrappedExport;
                        try {
                            wrappedExport = exports[key];
                        }
                        catch {
                            continue;
                        }
                        if (!wrappedExport)
                            continue;
                        if (typeof wrappedExport !== "object" && typeof wrappedExport !== "function")
                            continue;
                        if (filterFn(wrappedExport, module, id)) {
                            if (raw) {
                                if (first)
                                    return module;
                                found.push(module);
                            }
                            else {
                                if (first)
                                    return wrappedExport;
                                found.push(wrappedExport);
                            }
                        }
                    }
                }
                else {
                    let testExport = exports;
                    if (exports.__esModule && exports.default) {
                        testExport = defaultExport ? exports.default : exports;
                    }
                    else if (exports.A && !exports.Ay) {
                        testExport = defaultExport ? exports.A : exports;
                    }
                    else if (exports.Ay) {
                        testExport = defaultExport ? exports.Ay : exports;
                    }
                    if (filterFn(testExport, module, id)) {
                        if (raw) {
                            if (first)
                                return module;
                            found.push(module);
                        }
                        else {
                            if (first)
                                return testExport;
                            found.push(testExport);
                        }
                    }
                }
            }
            catch {
                continue;
            }
        }
        return first || found.length === 0 ? undefined : found;
    },
    getModuleByProps: (...props) => {
        return BdWebpack.getModule(BdWebpack.Filters.byProps(...props));
    },
    getModuleByDisplayName: (displayName) => {
        return BdWebpack.getModule(BdWebpack.Filters.byDisplayName(displayName));
    },
    getModuleByName: (name) => {
        return BdWebpack.getModule(BdWebpack.Filters.byName(name));
    },
    getByKeys: (...keys) => {
        return BdWebpack.getModule(BdWebpack.Filters.byKeys(...keys));
    },
    getModuleByKeys: (...keys) => {
        return BdWebpack.getModule(BdWebpack.Filters.byKeys(...keys));
    },
    getModuleByStrings: (...strings) => {
        return BdWebpack.getModule(BdWebpack.Filters.byStrings(...strings), { searchExports: true });
    },
    getModuleBySource: (source) => {
        return BdWebpack.getModule(BdWebpack.Filters.bySource(source));
    },
    getModuleByPrototypeKeys: (...keys) => {
        return BdWebpack.getModule(BdWebpack.Filters.byPrototypeKeys(...keys));
    },
    getStore: (name) => {
        return BdWebpack.getModule(BdWebpack.Filters.byStoreName(name));
    },
    waitForModule: (filterFn, timeout = 3000) => {
        return new Promise((resolve, reject) => {
            const module = BdWebpack.getModule(filterFn);
            if (module) {
                resolve(module);
                return;
            }
            const timeoutId = setTimeout(() => {
                reject(new Error(`Module not found within ${timeout}ms`));
            }, timeout);
            const checkInterval = setInterval(() => {
                const found = BdWebpack.getModule(filterFn);
                if (found) {
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId);
                    resolve(found);
                }
            }, 100);
        });
    },
    Bulk: async (queries) => {
        return Promise.all(queries.map(q => BdWebpack.getModule(q.filter, { searchExports: q.defaultExport ?? true })));
    },
    getLazy: (filterFn, options = {}) => {
        let cancelFn = () => { };
        const promise = new Promise((resolve, reject) => {
            const module = BdWebpack.getModule(filterFn);
            if (module) {
                resolve(module);
                cancelFn = () => { };
                return;
            }
            const timeout = options.timeout ?? 5000;
            const timeoutId = setTimeout(() => {
                reject(new Error(`Module not found within ${timeout}ms`));
            }, timeout);
            const checkInterval = setInterval(() => {
                const found = BdWebpack.getModule(filterFn);
                if (found) {
                    clearInterval(checkInterval);
                    clearTimeout(timeoutId);
                    resolve(found);
                }
            }, 100);
            cancelFn = () => {
                clearInterval(checkInterval);
                clearTimeout(timeoutId);
                reject(new Error("Cancelled"));
            };
        });
        return { cancel: cancelFn, promise };
    },
    require: wreq
};
const exoticComponents = {
    memo: Symbol.for("react.memo"),
    forwardRef: Symbol.for("react.forward_ref"),
    lazy: Symbol.for("react.lazy")
};
function getReactComponentType(component) {
    if (!component)
        return component;
    let inner = component;
    // Unwrap Vencord's LazyComponent wrapper if present
    if (typeof inner.$$vencordGetWrappedComponent === "function") {
        const unwrapped = inner.$$vencordGetWrappedComponent();
        if (unwrapped)
            inner = unwrapped;
    }
    // Unwrap React exotic components
    while (true) {
        const typeOf = inner?.$$typeof;
        if (typeOf === exoticComponents.memo) {
            inner = inner.type;
        }
        else if (typeOf === exoticComponents.forwardRef) {
            inner = inner.render;
        }
        else if (typeOf === exoticComponents.lazy) {
            const payload = inner._payload;
            if (payload?._status === 1) {
                inner = payload._result?.default ?? payload._result;
            }
            else {
                return () => { };
            }
        }
        else {
            break;
        }
    }
    return inner;
}
const HOOKS_ERR_MSG = "Cannot read properties of null (reading 'useState')";
const patchedReactHooks = {
    useMemo(factory) { return factory(); },
    useState(initialState) {
        if (typeof initialState === "function")
            initialState = initialState();
        return [initialState, () => { }];
    },
    useReducer(reducer, initialArg, init) {
        const initialState = init ? init(initialArg) : initialArg;
        return [initialState, () => { }];
    },
    useEffect() { },
    useLayoutEffect() { },
    useRef(initialValue) { return { current: initialValue }; },
    useCallback(callback) { return callback; },
    useContext(context) { return context._currentValue; },
    useImperativeHandle() { },
    useDebugValue() { },
    useDeferredValue(value) { return value; },
    useTransition() { return [false, (callback) => callback()]; },
    useId() { return ""; },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useInsertionEffect() { }
};
function wrapInHooks(functionComponent, customPatches = []) {
    return function (...args) {
        const R = React;
        const originalHooks = {};
        for (const key in patchedReactHooks) {
            originalHooks[key] = R[key];
            R[key] = patchedReactHooks[key];
        }
        try {
            return functionComponent.apply(this, args);
        }
        catch (err) {
            if (err.message?.includes(HOOKS_ERR_MSG)) {
                console.warn("[BdApi.ReactUtils] Hooks called outside render context");
                return null;
            }
            throw err;
        }
        finally {
            for (const key in originalHooks) {
                R[key] = originalHooks[key];
            }
        }
    };
}
const ReactUtils = {
    getInternalInstance(node) {
        return node?.[Object.keys(node).find(k => k.startsWith("__reactFiber")) || ""] || null;
    },
    getType: getReactComponentType,
    getOwnerInstance(el, options = {}) {
        const { includePrototype = false } = options;
        let current = el;
        while (current) {
            const fiber = current[Object.keys(current).find(k => k.startsWith("__reactFiber$")) || ""];
            if (fiber) {
                let node = fiber;
                while (node) {
                    if (node.stateNode && typeof node.stateNode === "object") {
                        if (includePrototype || node.stateNode.constructor?.name !== "Object") {
                            return node.stateNode;
                        }
                    }
                    node = node.return;
                }
            }
            current = current.parentElement;
        }
        return null;
    },
    wrapInHooks,
    createNodePatcher(callback) {
        const patcherRef = { patch: null };
        const symId = Symbol("BdApiNodePatcher");
        const patchedFn = function (...args) {
            const res = patchedFn.__originalFunction?.apply(this, args);
            return callback(this, res, this);
        };
        const patchFn = (node, cb) => {
            const type = node?.type;
            if (!type)
                return;
            const innerType = getReactComponentType(type);
            if (!innerType || typeof innerType !== "function")
                return;
            if (innerType[symId]) {
                node.type = innerType[symId];
                return;
            }
            const newType = function (...fnArgs) {
                const result = innerType.apply(this, fnArgs);
                return cb(fnArgs[0], result);
            };
            Object.assign(newType, innerType);
            newType[symId] = newType;
            if (type.type) {
                node.type = React.memo(type.type?.render ? React.forwardRef(newType) : newType, type.compare);
            }
            else if (type.render) {
                node.type = React.forwardRef(newType);
            }
            else if (type._payload) {
                node.type = React.lazy(() => {
                    const out = type._init(type._payload);
                    if (out instanceof Promise) {
                        return out.catch((err) => ({ default: newType }));
                    }
                    return Promise.resolve({ default: newType });
                });
            }
            else {
                node.type = newType;
            }
        };
        patcherRef.patch = patchFn;
        return { patch: patchFn, getOriginal: () => patchedFn.__originalFunction };
    }
};
class FluxCompatibleStore {
    listeners = new Set();
    initialize() { }
    addChangeListener(listener) {
        this.listeners.add(listener);
        return () => this.removeChangeListener(listener);
    }
    removeChangeListener(listener) {
        this.listeners.delete(listener);
    }
    addReactChangeListener(listener) {
        this.listeners.add(listener);
    }
    removeReactChangeListener(listener) {
        this.listeners.delete(listener);
    }
    emitChange() {
        for (const listener of this.listeners) {
            try {
                listener();
            }
            catch (e) {
                bdLogger.error("[Utils.Store] Listener threw an error:", e);
            }
        }
    }
}
let _cachedUseStateFromStores = null;
function getUseStateFromStores() {
    if (_cachedUseStateFromStores)
        return _cachedUseStateFromStores;
    try {
        _cachedUseStateFromStores = wreq.Common?.useStateFromStores;
        if (_cachedUseStateFromStores)
            return _cachedUseStateFromStores;
    }
    catch { }
    try {
        _cachedUseStateFromStores = BdWebpack.getModule((m) => m?.toString?.()?.includes("useStateFromStores"), { searchExports: true });
    }
    catch { }
    return _cachedUseStateFromStores;
}
const HooksHolder = {
    useStateFromStores(stores, selector, deps, comparator) {
        const hook = getUseStateFromStores();
        const storesArray = Array.isArray(stores) ? stores : [stores];
        if (hook) {
            return hook(storesArray, selector, deps, comparator);
        }
        bdLogger.warn("useStateFromStores: Hook not found, using non-reactive fallback");
        return selector();
    },
    useForceUpdate() {
        return React.useReducer((n) => n + 1, 0);
    }
};
class BdDOM {
    pluginName;
    constructor(pluginName) {
        this.pluginName = pluginName || "";
    }
    get screenWidth() {
        return Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    }
    get screenHeight() {
        return Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
    }
    createElement(tag = "div", options = {}, ...children) {
        const { className, id, target } = options;
        const element = document.createElement(tag);
        if (className)
            element.className = className;
        if (id)
            element.id = id;
        if (children.length)
            element.append(...children);
        if (target)
            document.querySelector(target)?.append(element);
        return element;
    }
    appendStyle(id, css) {
        id = id.replace(/(?:^[^a-z]+)|(?:[^\w-]+)/gi, "-");
        let style = document.getElementById(id);
        if (!style) {
            style = document.createElement("style");
            style.id = id;
            let container = document.querySelector("bd-styles");
            if (!container) {
                container = document.createElement("div");
                container.setAttribute("bd-styles", "");
                container.style.display = "none";
                document.head.appendChild(container);
            }
            container.appendChild(style);
        }
        style.textContent = css;
    }
    removeStyle(id) {
        id = id.replace(/(?:^[^a-z]+)|(?:[^\w-]+)/gi, "-");
        const style = document.getElementById(id);
        if (style)
            style.remove();
    }
    getStyle(id) {
        const style = document.getElementById(id);
        return style?.textContent || "";
    }
    toggleStyle(id, toggle) {
        const style = document.getElementById(id);
        if (!style)
            return false;
        const shouldEnable = toggle ?? style.disabled;
        style.disabled = !shouldEnable;
        return shouldEnable;
    }
    querySelector(selector) {
        return document.querySelector(selector);
    }
    querySelectorAll(selector) {
        return document.querySelectorAll(selector);
    }
    addListener(selector, event, handler, options) {
        const elements = this.querySelectorAll(selector);
        elements.forEach(el => el.addEventListener(event, handler, options));
    }
    removeListener(selector, event, handler) {
        const elements = this.querySelectorAll(selector);
        elements.forEach(el => el.removeEventListener(event, handler));
    }
    injectScript(targetName, url) {
        targetName = targetName.replace(/(?:^[^a-z]+)|(?:[^\w-]+)/gi, "-");
        return new Promise((resolve, reject) => {
            let script = document.querySelector(`bd-scripts #${targetName}`);
            if (!script) {
                script = this.createElement("script", { id: targetName });
                document.querySelector("bd-scripts")?.append(script);
            }
            script.src = url;
            script.onload = () => resolve();
            script.onerror = reject;
        });
    }
    removeScript(targetName) {
        targetName = targetName.replace(/(?:^[^a-z]+)|(?:[^\w-]+)/gi, "-");
        const script = document.querySelector(`bd-scripts #${targetName}`);
        if (script)
            script.remove();
    }
    parseHTML(html, asFragment = false) {
        const template = document.createElement("template");
        template.innerHTML = html.trim();
        if (asFragment) {
            return template.content.cloneNode(true);
        }
        const { childNodes } = template.content;
        return childNodes.length === 1 ? childNodes[0] : childNodes;
    }
    injectTheme(id, css) {
        id = id.replace(/(?:^[^a-z]+)|(?:[^\w-]+)/gi, "-");
        let style = document.querySelector(`bd-themes #${id}`);
        if (!style) {
            style = this.createElement("style", { id });
            let container = document.querySelector("bd-themes");
            if (!container) {
                container = document.createElement("div");
                container.setAttribute("bd-themes", "");
                container.style.display = "none";
                document.head.appendChild(container);
            }
            container.appendChild(style);
        }
        style.textContent = css;
    }
    removeTheme(id) {
        id = id.replace(/(?:^[^a-z]+)|(?:[^\w-]+)/gi, "-");
        const style = document.querySelector(`bd-themes #${id}`);
        if (style)
            style.remove();
    }
    animate(update, duration, options = {}) {
        const timing = options.timing || ((t) => t);
        const start = performance.now();
        let id = requestAnimationFrame(function tick(time) {
            let t = (time - start) / duration;
            if (t > 1)
                t = 1;
            update(timing(t));
            if (t < 1)
                id = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(id);
    }
    onAdded(selector, callback) {
        const existing = document.body.querySelector(selector);
        if (existing)
            return callback(existing);
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1)
                        continue;
                    const el = node;
                    const match = el.matches(selector) ? el : el.querySelector(selector);
                    if (match) {
                        observer.disconnect();
                        callback(match);
                        return;
                    }
                }
            }
        });
        observer.observe(document.body, { subtree: true, childList: true });
        return () => observer.disconnect();
    }
    onRemoved(node, callback) {
        const observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                const nodes = Array.from(mutation.removedNodes);
                if (nodes.includes(node) || nodes.some(p => p.contains(node))) {
                    observer.disconnect();
                    callback();
                    return;
                }
            }
        });
        observer.observe(document.body, { subtree: true, childList: true });
        return () => observer.disconnect();
    }
}
class BdData {
    pluginName;
    pluginData = {};
    keyListeners = new Map();
    globalListeners = new Map();
    constructor(pluginName) {
        this.pluginName = pluginName || "";
        if (this.pluginName) {
            this.loadFromStorage();
        }
    }
    getFullKey(key) {
        return this.pluginName ? `${this.pluginName}_${key}` : key;
    }
    loadFromStorage() {
        try {
            const data = localStorage.getItem(`BdData_${this.pluginName}`);
            if (data) {
                this.pluginData = JSON.parse(data);
            }
        }
        catch (e) {
            bdLogger.error(`Failed to load data for ${this.pluginName}:`, e);
        }
    }
    saveToStorage() {
        try {
            localStorage.setItem(`BdData_${this.pluginName}`, JSON.stringify(this.pluginData));
        }
        catch (e) {
            bdLogger.error(`Failed to save data for ${this.pluginName}:`, e);
        }
    }
    async load(key) {
        const fullKey = this.getFullKey(key);
        return this.pluginData[key] ?? null;
    }
    async save(key, value) {
        const fullKey = this.getFullKey(key);
        this.pluginData[key] = value;
        this.saveToStorage();
        this.notifyListeners(key, value);
    }
    async delete(key) {
        delete this.pluginData[key];
        this.saveToStorage();
        this.notifyListeners(key);
    }
    async has(key) {
        return key in this.pluginData;
    }
    async getAll() {
        return { ...this.pluginData };
    }
    on(keyOrListener, listener) {
        if (typeof keyOrListener === "function") {
            if (!this.globalListeners.has(this.pluginName)) {
                this.globalListeners.set(this.pluginName, new Set());
            }
            this.globalListeners.get(this.pluginName).add(keyOrListener);
        }
        else if (typeof keyOrListener === "string" && typeof listener === "function") {
            const fullKey = `${this.pluginName}.${keyOrListener}`;
            if (!this.keyListeners.has(fullKey)) {
                this.keyListeners.set(fullKey, new Set());
            }
            this.keyListeners.get(fullKey).add(listener);
        }
    }
    off(keyOrListener, listener) {
        if (typeof keyOrListener === "function") {
            this.globalListeners.get(this.pluginName)?.delete(keyOrListener);
            if (this.globalListeners.get(this.pluginName)?.size === 0) {
                this.globalListeners.delete(this.pluginName);
            }
        }
        else if (typeof keyOrListener === "string" && typeof listener === "function") {
            const fullKey = `${this.pluginName}.${keyOrListener}`;
            this.keyListeners.get(fullKey)?.delete(listener);
            if (this.keyListeners.get(fullKey)?.size === 0) {
                this.keyListeners.delete(fullKey);
            }
        }
    }
    notifyListeners(key, value) {
        const fullKey = `${this.pluginName}.${key}`;
        const keyListeners = this.keyListeners.get(fullKey);
        if (keyListeners) {
            keyListeners.forEach(fn => fn(value));
        }
        const globalListeners = this.globalListeners.get(this.pluginName);
        if (globalListeners) {
            globalListeners.forEach(fn => fn(key, value));
        }
    }
}
class BdLogger {
    prefix;
    constructor(prefix) {
        this.prefix = prefix ? `[${prefix}]` : "[BdApi]";
    }
    log(...args) { console.log(this.prefix, ...args); }
    info(...args) { console.info(this.prefix, ...args); }
    warn(...args) { console.warn(this.prefix, ...args); }
    error(...args) { console.error(this.prefix, ...args); }
    debug(...args) { console.debug(this.prefix, ...args); }
    stacktrace(context, message, error) {
        console.error(`${this.prefix} ${context}: ${message}`, error);
        if (error?.stack)
            console.error(error.stack);
    }
}
const BdUI = {
    alert(title, content) {
        alert(`${title}\n\n${content}`);
    },
    confirm(title, content, callback) {
        const result = confirm(`${title}\n\n${content}`);
        callback?.(result);
    },
    openModal: (modalConfig) => {
        bdLogger.log("Modal opened", modalConfig);
        return `modal-${Date.now()}`;
    },
    closeModal: (modalKey) => {
        bdLogger.log("Modal closed", modalKey);
    },
    showToast(message, options = {}) {
        // Try to use Discord's native toast
        try {
            const toastModule = BdWebpack.getModule((m) => m.createToast && m.showToast);
            if (toastModule) {
                let type = 1;
                if (typeof options === "number") {
                    type = [0, 1, 2, 3, 4, 5].includes(options) ? options : 1;
                }
                else if (options && typeof options === "object") {
                    const typeMap = {
                        "": 1, info: 1, success: 0, warn: 3, warning: 3, error: 4, danger: 4
                    };
                    type = typeMap[String(options.type || "").toLowerCase()] ?? 1;
                }
                toastModule.showToast(toastModule.createToast(message || "Success!", type));
                return;
            }
        }
        catch (e) {
            bdLogger.warn("Failed to show toast via Discord API:", e);
        }
        // Fallback
        console.log("[Toast]", message);
    },
    showConfirmationModal(title, content, options = {}) {
        // Simplified - would need proper modal integration
        const result = confirm(`${title}\n\n${typeof content === "string" ? content : "[React Content]"}`);
        if (result && options.onConfirm)
            options.onConfirm();
        if (!result && options.onCancel)
            options.onCancel();
        return `modal-${Date.now()}`;
    },
    closeConfirmationModal(key) { },
    closeAllConfirmationModals() { },
    showNotice(content, options = {}) {
        const container = document.createElement("div");
        container.style.cssText = "position:fixed;top:20px;right:20px;z-index:9999;background:var(--background-primary);padding:16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.4);max-width:400px;";
        const title = document.createElement("div");
        title.style.cssText = "font-weight:600;margin-bottom:8px;";
        title.textContent = options.title || "Notice";
        container.appendChild(title);
        if (typeof content === "string") {
            const text = document.createElement("div");
            text.textContent = content;
            container.appendChild(text);
        }
        else if (content instanceof Node) {
            container.appendChild(content);
        }
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close";
        closeBtn.style.cssText = "margin-top:12px;padding:8px 16px;background:var(--brand-500);color:white;border:none;border-radius:4px;cursor:pointer;";
        closeBtn.onclick = () => container.remove();
        container.appendChild(closeBtn);
        document.body.appendChild(container);
        if (options.timeout && options.timeout > 0) {
            setTimeout(() => container.remove(), options.timeout);
        }
        return () => container.remove();
    },
    createTooltip(attachTo, label, options = {}) {
        return new BdTooltip(attachTo, label, options);
    },
    showChangelogModal(options = {}) {
        bdLogger.log("Changelog modal requested", options);
    },
    async showInviteModal(inviteCode) {
        bdLogger.log("Invite modal requested", inviteCode);
    },
    buildSettingItem(setting) {
        const div = document.createElement("div");
        div.className = "bd-setting-item";
        div.innerHTML = `<div style="font-weight:600;margin-bottom:8px;">${setting.name || setting.label || ""}</div>`;
        return div;
    },
    buildSettingsPanel(options) {
        const panel = document.createElement("div");
        panel.className = "bd-settings-panel";
        options.settings.forEach(setting => {
            panel.appendChild(this.buildSettingItem(setting));
        });
        return panel;
    }
};
class BdTooltip {
    element;
    node;
    active = false;
    observer = null;
    constructor(attachTo, label, options = {}) {
        this.node = attachTo;
        this.element = document.createElement("div");
        this.element.className = "bd-tooltip";
        this.element.textContent = label;
        this.element.style.cssText = "position:fixed;padding:8px 12px;background:var(--background-floating);color:var(--text-normal);border-radius:4px;font-size:14px;pointer-events:none;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,0.4);";
        if (options.style) {
            Object.assign(this.element.style, options.style);
        }
        attachTo.addEventListener("mouseenter", () => this.show());
        attachTo.addEventListener("mouseleave", () => this.hide());
    }
    hide() {
        if (!this.active)
            return;
        this.active = false;
        this.element.remove();
        this.observer?.disconnect();
    }
    show() {
        if (this.active)
            return;
        this.active = true;
        document.body.appendChild(this.element);
        const rect = this.node.getBoundingClientRect();
        this.element.style.left = `${rect.left + rect.width / 2 - this.element.offsetWidth / 2}px`;
        this.element.style.top = `${rect.top - this.element.offsetHeight - 8}px`;
        this.observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                const nodes = Array.from(mutation.removedNodes);
                if (nodes.includes(this.node) || nodes.some(n => n.contains(this.node))) {
                    this.hide();
                    return;
                }
            }
        });
        this.observer.observe(document.body, { subtree: true, childList: true });
    }
}
const BdUtils = {
    suppressErrors: (method, message = "") => {
        return (function (...args) {
            try {
                return method.apply(this, args);
            }
            catch (e) {
                console.error(`[BdUtils] Error${message ? `: ${message}` : ""}`, e);
                return undefined;
            }
        });
    },
    formatMissing: (count) => {
        return count === 1 ? "1 missing dependency" : `${count} missing dependencies`;
    },
    getID: () => {
        return `bd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    },
    className: (...classes) => {
        return classes.filter(Boolean).join(" ");
    },
    linkify: (text) => {
        return text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    },
    Store: FluxCompatibleStore
};
const BdContextMenu = {
    patch(navId, callback) {
        bdLogger.warn("ContextMenu.patch is not fully implemented");
        return () => { };
    },
    unpatch(navId, callback) { },
    open(event, menuConfig) {
        bdLogger.warn("ContextMenu.open is not fully implemented");
        return "";
    },
    close() { }
};
const commandRegistry = new Map();
const BdCommands = {
    Types: {
        CommandTypes: { CHAT_INPUT: 1, USER: 2, MESSAGE: 3 },
        InputTypes: { BUILT_IN: 0, TEXT: 1, SEARCH: 2 },
        OptionTypes: {
            SUB_COMMAND: 1, SUB_COMMAND_GROUP: 2, STRING: 3, INTEGER: 4,
            BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10
        },
        MessageEmbedTypes: {
            IMAGE: "image", VIDEO: "video", LINK: "link", ARTICLE: "article",
            RICH: "rich", GIFV: "gifv"
        }
    },
    register(caller, command) {
        if (!caller || typeof caller !== "string") {
            throw new Error("Commands.register: caller must be a string");
        }
        if (!command?.id || !command?.name || typeof command.execute !== "function") {
            throw new Error("Commands.register: command must have id, name, and execute function");
        }
        const fullId = `bd-${caller}-${command.id}`;
        if (!commandRegistry.has(caller)) {
            commandRegistry.set(caller, new Set());
        }
        commandRegistry.get(caller).add(fullId);
        bdLogger.log(`Command registered: ${fullId}`);
        return () => this.unregister(caller, command.id);
    },
    unregister(caller, commandId) {
        const fullId = `bd-${caller}-${commandId}`;
        commandRegistry.get(caller)?.delete(fullId);
        if (commandRegistry.get(caller)?.size === 0) {
            commandRegistry.delete(caller);
        }
    },
    unregisterAll(caller) {
        const commands = commandRegistry.get(caller);
        if (!commands)
            return;
        for (const cmdId of Array.from(commands)) {
            const shortId = cmdId.replace(`bd-${caller}-`, "");
            this.unregister(caller, shortId);
        }
        commandRegistry.delete(caller);
    },
    getCommandsByCaller(caller) {
        const commandIds = commandRegistry.get(caller);
        if (!commandIds)
            return [];
        return Array.from(commandIds);
    }
};
const BdComponents = {
    get Button() { return React.forwardRef((props, ref) => React.createElement("button", { ...props, ref })); },
    get Switch() { return React.forwardRef((props, ref) => React.createElement("input", { ...props, type: "checkbox", ref })); },
    get Slider() { return React.forwardRef((props, ref) => React.createElement("input", { ...props, type: "range", ref })); },
    get TextBox() { return React.forwardRef((props, ref) => React.createElement("input", { ...props, type: "text", ref })); },
    get Dropdown() { return React.forwardRef((props, ref) => React.createElement("select", { ...props, ref })); },
    get Tooltip() { return BdTooltip; },
    get Spinner() { return React.forwardRef((props, ref) => React.createElement("div", { ...props, ref })); },
    get ColorPicker() { return React.forwardRef((props, ref) => React.createElement("input", { ...props, type: "color", ref })); },
    get SettingsPanel() { return BdUI.buildSettingsPanel; }
};
export class BdApiClass {
    static version = "Testcord BD Compatibility Layer v2.0 (Enhanced)";
    static Plugins;
    static Themes;
    static Patcher;
    static Data;
    static DOM;
    static Logger;
    static Webpack;
    static UI;
    static React;
    static ReactDOM;
    static Utils;
    static ContextMenu;
    static Components;
    static Flux;
    static Net;
    static Commands;
    static Hooks;
    static ReactUtils;
    pluginName;
    Patcher;
    Data;
    DOM;
    Logger;
    Webpack;
    UI;
    Components;
    Commands;
    Hooks;
    ReactUtils;
    constructor(pluginName) {
        this.pluginName = pluginName || "";
        this.Patcher = new PatcherManager(pluginName);
        this.Data = new BdData(pluginName);
        this.DOM = new BdDOM(pluginName);
        this.Logger = new BdLogger(pluginName);
        this.Webpack = BdWebpack;
        this.UI = BdUI;
        this.Components = BdComponents;
        this.Commands = BdCommands;
        this.Hooks = HooksHolder;
        this.ReactUtils = ReactUtils;
    }
    static noConflict() {
        return BdApiClass;
    }
    showNotice(content, options = {}) {
        return BdUI.showNotice(content, options);
    }
}
BdApiClass.Logger = BdLogger;
BdApiClass.Webpack = BdWebpack;
BdApiClass.UI = BdUI;
BdApiClass.React = React;
BdApiClass.ReactDOM = ReactDOM;
BdApiClass.Utils = BdUtils;
BdApiClass.ContextMenu = BdContextMenu;
BdApiClass.Components = BdComponents;
BdApiClass.Flux = FluxDispatcher;
BdApiClass.Net = { fetch };
BdApiClass.Commands = BdCommands;
BdApiClass.Hooks = HooksHolder;
BdApiClass.ReactUtils = ReactUtils;
class BdPluginAPI {
    get folder() { return "Betterdiscordplugins"; }
    isEnabled(pluginId) {
        return Settings.plugins[pluginId]?.enabled ?? true;
    }
    enable(pluginId) {
        if (Settings.plugins[pluginId])
            Settings.plugins[pluginId].enabled = true;
    }
    disable(pluginId) {
        if (Settings.plugins[pluginId])
            Settings.plugins[pluginId].enabled = false;
    }
    toggle(pluginId) {
        if (this.isEnabled(pluginId))
            this.disable(pluginId);
        else
            this.enable(pluginId);
    }
    get(pluginId) {
        return window.TestcordBDPlugins?.[pluginId];
    }
    getAll() {
        return Object.values(window.TestcordBDPlugins || {});
    }
    start(pluginId) { this.enable(pluginId); }
    stop(pluginId) { this.disable(pluginId); }
    reload(pluginId) {
        this.disable(pluginId);
        this.enable(pluginId);
    }
}
class BdThemeAPI {
    get folder() { return "themes"; }
    isEnabled(themeId) { return false; }
    enable(themeId) { }
    disable(themeId) { }
    toggle(themeId) { }
    get(themeId) { return window.TestcordBDThemes?.[themeId]; }
    getAll() { return Object.values(window.TestcordBDThemes || {}); }
    reload(themeId) { }
}
BdApiClass.Plugins = new BdPluginAPI();
BdApiClass.Themes = new BdThemeAPI();
BdApiClass.Patcher = new PatcherManager("BdApi");
BdApiClass.Data = new BdData();
BdApiClass.DOM = new BdDOM();
export const BdApi = BdApiClass;
export function createBdApi(pluginName) {
    return new BdApiClass(pluginName);
}
if (typeof window !== "undefined") {
    window.BdApi = new BdApiClass("Global");
}
