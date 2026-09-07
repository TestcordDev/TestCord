/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { React } from "@webpack/common";

import { useModules } from "./registry";
import type { ModulePosition } from "./types";

interface ModulesContainerProps {
    position?: ModulePosition;
}

export function ModulesContainer({ position = "above" }: ModulesContainerProps) {
    const modules = useModules();
    const activeModules = modules.filter(m => m.enabled && (m.position ?? "above") === position);

    if (activeModules.length === 0) return null;

    return (
        <div
            className={`vc-panel-layout-modules-container vc-panel-modules-${position}`}
            style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                boxSizing: "border-box",
                overflow: "hidden",
            }}
        >
            {activeModules.map(module => {
                const Component = module.render;
                return (
                    <div
                        key={module.id}
                        className="vc-panel-module-item"
                        data-module-id={module.id}
                        style={{ width: "100%" }}
                    >
                        <ErrorBoundary
                            fallback={() => (
                                <div
                                    style={{
                                        padding: "4px 8px",
                                        margin: "4px 8px",
                                        borderRadius: "6px",
                                        background: "var(--background-message-automod, rgba(237, 66, 69, 0.1))",
                                        color: "var(--text-danger, #ed4245)",
                                        fontSize: "11px",
                                    }}
                                >
                                    Module "{module.name}" encountered an error.
                                </div>
                            )}
                        >
                            <Component module={module} />
                        </ErrorBoundary>
                    </div>
                );
            })}
        </div>
    );
}
