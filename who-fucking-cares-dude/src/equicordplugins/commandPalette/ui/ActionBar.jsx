/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { IS_MAC } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { formatComboKeys } from "./keyboard";
const cl = classNameFactory("vc-cmdpal-");
export function Shortcut({ combo }) {
    return (<span className={cl("shortcut")}>
            {formatComboKeys(combo).map((key, i) => (<kbd key={i} className={cl("key")}>{key}</kbd>))}
        </span>);
}
export function ActionBar({ hint, primaryLabel, showActionsHint }) {
    return (<div className={cl("footer")}>
            <span className={cl("footer-hint")}>{hint ?? "Testcord"}</span>
            <div className={cl("footer-actions")}>
                {primaryLabel && (<span className={cl("footer-action")}>
                        {primaryLabel}
                        <Shortcut combo={["enter"]}/>
                    </span>)}
                {showActionsHint && (<>
                        <span className={cl("footer-divider")}/>
                        <span className={cl("footer-action")}>
                            Actions
                            <Shortcut combo={[IS_MAC ? "meta" : "ctrl", "k"]}/>
                        </span>
                    </>)}
            </div>
        </div>);
}
