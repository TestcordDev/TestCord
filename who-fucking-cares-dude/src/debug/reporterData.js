/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export const reporterData = {
    failedPatches: {
        foundNoModule: [],
        hadNoEffect: [],
        undoingPatchGroup: [],
        erroredPatch: []
    },
    failedWebpack: {
        find: [],
        findByProps: [],
        findByCode: [],
        findStore: [],
        findCssClasses: [],
        findComponent: [],
        findComponentByCode: [],
        findExportedComponent: [],
        waitFor: [],
        waitForComponent: [],
        waitForStore: [],
        proxyLazyWebpack: [],
        LazyComponentWebpack: [],
        extractAndLoadChunks: [],
        mapMangledModule: []
    }
};
