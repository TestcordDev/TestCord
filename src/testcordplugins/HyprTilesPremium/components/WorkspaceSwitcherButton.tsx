/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { findExportedComponentLazy } from "@webpack";
import { React, useStateFromStores } from "@webpack/common";

import { switchWorkspaceAndNavigate } from "../controller";
import { settings } from "../settings";
import { HyprTilesStore } from "../store";
import { WorkspaceIndex } from "../types";

const cl = classNameFactory("vc-hyprtiles-");
const HomeIcon = findExportedComponentLazy("HomeIcon") as React.ComponentType<Record<string, unknown>>;

function WorkspaceSwitcherButtonInner() {
    const { workspaceCount } = settings.store;
    const inlineWorkspaces = Array.from({ length: workspaceCount - 1 }, (_, i) => (i + 2) as WorkspaceIndex);

    const activeWorkspace = useStateFromStores([HyprTilesStore], () => HyprTilesStore.getState().activeWorkspace, []);

    return (
        <div className={cl("switcher-wrap")}>
            <HeaderBarButton
                icon={HomeIcon}
                tooltip={null}
                selected={activeWorkspace === 1}
                onClick={() => switchWorkspaceAndNavigate(1 as WorkspaceIndex)}
            />
            {inlineWorkspaces.length > 0 && (
                <div className={cl("switcher-inline")}>
                    {inlineWorkspaces.map(index => (
                        <button
                            key={index}
                            type="button"
                            aria-label={`Workspace ${index}`}
                            className={classes(cl("ws-btn"), activeWorkspace === index && cl("ws-btn-active"))}
                            onClick={() => switchWorkspaceAndNavigate(index)}
                        >
                            {index}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export const WorkspaceSwitcherButton = ErrorBoundary.wrap(WorkspaceSwitcherButtonInner, { noop: true });
