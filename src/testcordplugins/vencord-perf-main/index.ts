/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    name: "perf",
description: "[RISKY]Collection of small performance improvements[RISKY]",
    tags: ["Developers", "Utility"],
    authors: [
        {
            id: 579731384868798464n,
            name: "void",
        },
    ],
patches: [{
        // The tooltip module uses flushSync to immediately push state changes which is kinda unnecessary
        // We bypass this by directly setting the state in a normal variable but still use setState to control the rendering
        find: "this.state.shouldShowTooltip!==",
        replacement: [{
            match: /\w.flushSync\(\(\)=>\{this\.setState\(\{shouldShowTooltip:(\w)\}\)\}\)/,
            replace: (_, param) => "this.__open=" + param + ",this.setState({shouldShowTooltip:" + param + "})",
        }, {
            match: /if\(this\.state\.shouldShowTooltip!==(\w)\)/,
            replace: "if(this.__open!==$1)",
        }]
    }, {
        // cache getters
        // not sure if this one does a whole lot tbh
        find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
        replacement: [{
            match: /(\w)=>\{let \w=(\w)\[null==\w\?(\w)\.kod:\w\];null!=\w&&\((\w)\(\)\.each\(\w\.usableEmojis,(\w)\),\w\(\)\.each\(\w\.emoticons,(\w)\)\)\};/,
            replace: (_, e, q, k, a, n, r) => `${e} => {` +
                `const t = ${q}[null == ${e} ? ${k}.kod : ${e}];` +
                "const usableEmojis = t?.usableEmojis;" +
                "const emoticons = t?.emoticons;" +
                `null != t && (${a}().each(usableEmojis, ${n}), ${a}().each(emoticons, ${r}))` +
                "};",
        }]
    }, {
        // Kill loading spinner
        find: /\w\.\w\.getAppSpinnerSources\(\)/,
        replacement: [{
            match: /let \w=\w\.\w\.getAppSpinnerSources\(\).+?;(\w\.\w).+?\)\}/,
            replace: "$1 = () => null;",
        }]
    }, {
        // Remove canvas that renders stuff like confetti etc
        find: "\"SpriteCanvas-module_spriteCanvasHidden",
        replacement: {
            match: /,\w\.createElement\("canvas",{.+?\)}\)/,
            replace: "",
        }
    }, {
        // Remove analytics from gateway, this cost me upwards of 100ms because they JSON.stringify the entire thing
        find: "getDispatchHandler needs to be passed in first!",
        replacement: {
            match: /let \i=Date\.now\(\),(\i=\i\.Z\.flush\(\i,\i\));\i\.\i\.showPerformanceTelemetry\?.+?Telemetry\(.+?,\i\)/,
            replace: "let $1",
        }
    }]
});
