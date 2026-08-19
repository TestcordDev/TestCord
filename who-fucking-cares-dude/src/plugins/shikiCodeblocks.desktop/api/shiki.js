/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { dispatchTheme } from "@plugins/shikiCodeblocks.desktop/hooks/useTheme";
import { shikiOnigasmSrc, shikiWorkerSrc } from "@utils/dependencies";
import { WorkerClient } from "@vap/core/ipc";
import { getGrammar, languages, loadLanguages, resolveLang } from "./languages";
import { themes } from "./themes";
const themeUrls = Object.values(themes);
let resolveClient;
export const shiki = {
    client: null,
    currentTheme: null,
    currentThemeUrl: null,
    timeoutMs: 10000,
    languages,
    themes,
    loadedThemes: new Set(),
    loadedLangs: new Set(),
    clientPromise: new Promise(resolve => resolveClient = resolve),
    init: async (initThemeUrl) => {
        /** https://stackoverflow.com/q/58098143 */
        const workerBlob = await fetch(shikiWorkerSrc).then(res => res.blob());
        const client = shiki.client = new WorkerClient("shiki-client", "shiki-host", workerBlob, { name: "ShikiWorker" });
        await client.init();
        const themeUrl = initThemeUrl || themeUrls[0];
        await loadLanguages();
        await client.run("setOnigasm", { wasm: shikiOnigasmSrc });
        await client.run("setHighlighter", { theme: themeUrl, langs: [] });
        shiki.loadedThemes.add(themeUrl);
        await shiki._setTheme(themeUrl);
        resolveClient(client);
    },
    _setTheme: async (themeUrl) => {
        shiki.currentThemeUrl = themeUrl;
        const { themeData } = await shiki.client.run("getTheme", { theme: themeUrl });
        shiki.currentTheme = JSON.parse(themeData);
        dispatchTheme({ id: themeUrl, theme: shiki.currentTheme });
    },
    loadTheme: async (themeUrl) => {
        const client = await shiki.clientPromise;
        if (shiki.loadedThemes.has(themeUrl))
            return;
        await client.run("loadTheme", { theme: themeUrl });
        shiki.loadedThemes.add(themeUrl);
    },
    setTheme: async (themeUrl) => {
        await shiki.clientPromise;
        themeUrl ||= themeUrls[0];
        if (!shiki.loadedThemes.has(themeUrl))
            await shiki.loadTheme(themeUrl);
        await shiki._setTheme(themeUrl);
    },
    loadLang: async (langId) => {
        const client = await shiki.clientPromise;
        const lang = resolveLang(langId);
        if (!lang || shiki.loadedLangs.has(lang.id))
            return;
        await client.run("loadLanguage", {
            lang: {
                ...lang,
                grammar: lang.grammar ?? await getGrammar(lang),
            }
        });
        shiki.loadedLangs.add(lang.id);
    },
    tokenizeCode: async (code, langId) => {
        const client = await shiki.clientPromise;
        const lang = resolveLang(langId);
        if (!lang)
            return [];
        if (!shiki.loadedLangs.has(lang.id))
            await shiki.loadLang(lang.id);
        return await client.run("codeToThemedTokens", {
            code,
            lang: langId,
            theme: shiki.currentThemeUrl ?? themeUrls[0],
        });
    },
    destroy() {
        shiki.currentTheme = null;
        shiki.currentThemeUrl = null;
        dispatchTheme({ id: null, theme: null });
        shiki.client?.destroy();
    }
};
