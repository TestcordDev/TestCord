/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export const SYM_IS_PROXY = Symbol("SettingsStore.isProxy");
export const SYM_GET_RAW_TARGET = Symbol("SettingsStore.getRawTarget");
/**
 * The SettingsStore allows you to easily create a mutable store that
 * has support for global and path-based change listeners.
 */
export class SettingsStore {
    pathListeners = new Map();
    prefixListeners = new Map();
    globalListeners = new Set();
    proxyContexts = new WeakMap();
    // Every nested read used to allocate a brand new Proxy, so `Settings.plugins`
    // never equalled `Settings.plugins`. That made object reads ~50x slower than plain
    // ones in hot paths like isPluginEnabled, and it silently broke every React memo
    // and effect that lists a settings object in its dependencies - those deps changed
    // identity on every single render. Proxies are now created once per target.
    proxyCache = new WeakMap();
    proxyHandler = (() => {
        const self = this;
        return {
            get(target, key, receiver) {
                if (key === SYM_IS_PROXY) {
                    return true;
                }
                if (key === SYM_GET_RAW_TARGET) {
                    return target;
                }
                let v = Reflect.get(target, key, receiver);
                const proxyContext = self.proxyContexts.get(target);
                if (proxyContext == null) {
                    return v;
                }
                const { root, path } = proxyContext;
                if (!(key in target) && self.getDefaultValue != null) {
                    v = self.getDefaultValue({
                        target,
                        key,
                        root,
                        path
                    });
                }
                if (typeof v === "object" && v !== null && !v[SYM_IS_PROXY]) {
                    const getPath = `${path}${path && "."}${key}`;
                    return self.makeProxy(v, root, getPath);
                }
                return v;
            },
            set(target, key, value) {
                if (value?.[SYM_IS_PROXY]) {
                    value = value[SYM_GET_RAW_TARGET];
                }
                if (target[key] === value) {
                    return true;
                }
                if (!Reflect.set(target, key, value)) {
                    return false;
                }
                const proxyContext = self.proxyContexts.get(target);
                if (proxyContext == null) {
                    return true;
                }
                const { root, path } = proxyContext;
                const setPath = `${path}${path && "."}${key}`;
                self.notifyListeners(setPath, value, root);
                return true;
            },
            deleteProperty(target, key) {
                if (!Reflect.deleteProperty(target, key)) {
                    return false;
                }
                const proxyContext = self.proxyContexts.get(target);
                if (proxyContext == null) {
                    return true;
                }
                const { root, path } = proxyContext;
                const deletePath = `${path}${path && "."}${key}`;
                self.notifyListeners(deletePath, undefined, root);
                return true;
            }
        };
    })();
    constructor(plain, options = {}) {
        this.plain = plain;
        this.store = this.makeProxy(plain);
        Object.assign(this, options);
    }
    makeProxy(object, root = object, path = "") {
        const cached = this.proxyCache.get(object);
        if (cached !== undefined)
            return cached;
        this.proxyContexts.set(object, {
            root,
            path
        });
        const proxy = new Proxy(object, this.proxyHandler);
        this.proxyCache.set(object, proxy);
        return proxy;
    }
    notifyPrefixListeners(pathString, pathElements, value) {
        for (let i = 1; i <= pathElements.length; i++) {
            const prefix = pathElements.slice(0, i).join(".");
            this.prefixListeners.get(prefix)?.forEach(cb => cb(value, pathString));
        }
    }
    notifyListeners(pathStr, value, root) {
        const paths = pathStr.split(".");
        // Because we support any type of settings with OptionType.CUSTOM, and those objects get proxied recursively,
        // the path ends up including all the nested paths (plugins.pluginName.settingName.example.one).
        // So, we need to extract the top-level setting path (plugins.pluginName.settingName),
        // to be able to notify globalListeners and top-level setting name listeners (let { settingName } = settings.use(["settingName"]),
        // with the new value
        if (paths.length > 3 && paths[0] === "plugins") {
            const settingPath = paths.slice(0, 3);
            const settingPathStr = settingPath.join(".");
            const settingValue = settingPath.reduce((acc, curr) => acc[curr], root);
            this.globalListeners.forEach(cb => cb(root, settingPathStr));
            this.pathListeners.get(settingPathStr)?.forEach(cb => cb(settingValue));
        }
        else {
            this.globalListeners.forEach(cb => cb(root, pathStr));
        }
        this.pathListeners.get(pathStr)?.forEach(cb => cb(value));
        this.notifyPrefixListeners(pathStr, paths, value);
    }
    /**
     * Set the data of the store.
     * This will update this.store and this.plain (and old references to them will be stale! Avoid storing them in variables)
     *
     * Additionally, all global listeners (and those for pathToNotify, if specified) will be called with the new data
     * @param value New data
     * @param pathToNotify Optional path to notify instead of globally. Used to transfer path via ipc
     */
    setData(value, pathToNotify) {
        if (this.readOnly)
            throw new Error("SettingsStore is read-only");
        this.plain = value;
        this.store = this.makeProxy(value);
        if (pathToNotify) {
            let v = value;
            const path = pathToNotify.split(".");
            for (const p of path) {
                if (!v) {
                    console.warn(`Settings#setData: Path ${pathToNotify} does not exist in new data. Not dispatching update`);
                    return;
                }
                v = v[p];
            }
            this.pathListeners.get(pathToNotify)?.forEach(cb => cb(v));
            this.notifyPrefixListeners(pathToNotify, path, v);
        }
        this.markAsChanged();
    }
    /**
     * Add a global change listener, that will fire whenever any setting is changed
     *
     * @param data The new data. This is either the new value set on the path, or the new root object if it was changed
     * @param path The path of the setting that was changed. Empty string if the root object was changed
     */
    addGlobalChangeListener(cb) {
        this.globalListeners.add(cb);
    }
    /**
     * Add a scoped change listener that will fire whenever a setting matching the specified path is changed.
     *
     * For example if path is `"foo.bar"`, the listener will fire on
     * ```js
     * Setting.store.foo.bar = "hi"
     * ```
     * but not on
     * ```js
     * Setting.store.foo.baz = "hi"
     * ```
     */
    addChangeListener(path, cb) {
        const listeners = this.pathListeners.get(path) ?? new Set();
        listeners.add(cb);
        this.pathListeners.set(path, listeners);
    }
    /**
     * Add a prefix change listener that will fire whenever a setting matching the specified prefix is changed.
     * For example if prefix is `"foo"`, the listener will fire on
     * ```js
     * Setting.store.foo.bar = "hi"
     * Setting.store.foo.baz = "hi"
     * ```
     */
    addPrefixChangeListener(prefix, cb) {
        const listeners = this.prefixListeners.get(prefix) ?? new Set();
        listeners.add(cb);
        this.prefixListeners.set(prefix, listeners);
    }
    /**
     * Remove a global listener
     * @see {@link addGlobalChangeListener}
     */
    removeGlobalChangeListener(cb) {
        this.globalListeners.delete(cb);
    }
    /**
     * Remove a scoped listener
     * @see {@link addChangeListener}
     */
    removeChangeListener(path, cb) {
        const listeners = this.pathListeners.get(path);
        if (!listeners)
            return;
        listeners.delete(cb);
        if (!listeners.size)
            this.pathListeners.delete(path);
    }
    /**
     * Remove a prefix listener
     * @see {@link addPrefixChangeListener}
     */
    removePrefixChangeListener(prefix, cb) {
        const listeners = this.prefixListeners.get(prefix);
        if (!listeners)
            return;
        listeners.delete(cb);
        if (!listeners.size)
            this.prefixListeners.delete(prefix);
    }
    /**
     * Call all global change listeners
     */
    markAsChanged() {
        this.globalListeners.forEach(cb => cb(this.plain, ""));
    }
}
