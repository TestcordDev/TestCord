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
import { resolveLang } from "@plugins/shikiCodeblocks.desktop/api/languages";
import { classNameFactory } from "@utils/css";
import { DefaultExtractAndLoadChunksRegex, extractAndLoadChunksLazy, findByPropsLazy } from "@webpack";
export const cl = classNameFactory("vc-shiki-");
export const hljs = findByPropsLazy("highlight", "registerLanguage");
export const requireHljs = extractAndLoadChunksLazy(["codeBlock:{react("], new RegExp(`"hljs".+?${DefaultExtractAndLoadChunksRegex.source}`));
export const shouldUseHljs = ({ lang, tryHljs, }) => {
    const hljsLang = lang ? hljs?.getLanguage?.(lang) : null;
    const shikiLang = lang ? resolveLang(lang) : null;
    const langName = shikiLang?.name;
    switch (tryHljs) {
        case "ALWAYS" /* HljsSetting.Always */:
            return true;
        case "PRIMARY" /* HljsSetting.Primary */:
            return !!hljsLang || lang === "";
        case "SECONDARY" /* HljsSetting.Secondary */:
            return !langName && !!hljsLang;
        case "NEVER" /* HljsSetting.Never */:
            return false;
        default: return false;
    }
};
