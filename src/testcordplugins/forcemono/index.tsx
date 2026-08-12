/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import definePlugin, { OptionType } from "@utils/types";
import { React, Toasts } from "@webpack/common";
import { waitForStore } from "@webpack/common/internal";
import EventEmitter from "events";

let MediaEngineStore;
let Connection;
let mediaEngineEmitter: EventEmitter | null = null;
let connectionHandler: ((connection: any) => void) | null = null;
const patchedConns = new Set<any>();

const settings = definePluginSettings({
    forceMono: {
        description: "Force all incoming audio to mono",
        type: OptionType.BOOLEAN,
        default: false,
        onChange() {
            updateDecoder();
        },
    }
});

const getAudioDecoder = () => {
    return {
        channels: 2,
        freq: 48000,
        // stereo: "0" forces mono downmixing
        params: { stereo: settings.store.forceMono ? "0" : "1" },
        type: 120,
        name: "opus",
    };
};

function updateDecoder() {
    if (Connection?.conn) {
        Connection.conn.setTransportOptions({
            audioDecoders: [getAudioDecoder()]
        });
    }
}

// Icon component using the SVG you provided
function MonoIcon({ className, active }: { className?: string; active?: boolean; }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} width="20" height="20" viewBox="0 0 256 256">
            <mask id="foremonoLine">
                <rect width="100%" height="100%" fill="#ffffff" />
                <line
                    className="blackLine"
                    x1="235"
                    y1="21"
                    x2="21"
                    y2="235"
                    stroke="#000000"
                    strokeWidth="64"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <path
                fill={!active ? "var(--status-danger)" : "currentColor"}
                fillRule="evenodd"
                mask="url(#foremonoLine)"
                d="M128.802 95.03c-9.229-9.369-22.39-15.228-37-15.228-27.92 0-50.555 21.402-50.555 47.803 0 26.4 22.634 47.802 50.555 47.802 14.711 0 27.954-5.94 37.193-15.423-12.232-16.88-14.177-19.888-14.177-32.38 0-12.016 5.924-18.458 14.19-31.142 6.753 13.293 13.629 19.445 13.629 31.538 0 12.802-6.03 20.525-13.402 32.614 9.206 9.115 22.185 14.793 36.567 14.793 27.922 0 50.556-21.401 50.556-47.802 0-26.4-22.634-47.803-50.556-47.803-14.608 0-27.77 5.86-37 15.228zM128 75.374C138.501 68.202 151.252 64 165 64c35.899 0 65 28.654 65 64 0 35.346-29.101 64-65 64-13.748 0-26.499-4.202-37-11.374C117.499 187.798 104.748 192 91 192c-35.899 0-65-28.654-65-64 0-35.346 29.101-64 65-64 13.748 0 26.499 4.202 37 11.374z"
            />

            <line
                x1="235"
                y1="21"
                x2="21"
                y2="235"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="21"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

const FORCE_MONO_KEYS = ["forceMono"] as const;

function MonoToggleButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { forceMono } = settings.use(FORCE_MONO_KEYS);

    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : forceMono ? "Disable Force Mono" : "Enable Force Mono"}
            icon={<MonoIcon className={iconForeground} active={forceMono} />}
            role="switch"
            aria-checked={forceMono}
            redGlow={!forceMono}
            plated={nameplate != null}
            onClick={() => {
                const newValue = !forceMono;
                settings.store.forceMono = newValue;

                Toasts.show({
                    message: newValue ? "Force Mono Enabled" : "Force Mono Disabled",
                    id: "MonoToast",
                    type: Toasts.Type.MESSAGE
                });
            }}
        />
    );
}

export default definePlugin({
    name: "Force Mono",
    description: "forces mono audio on audio",
    authors: [{ name: "deracul", id: 1454268753629024529n }],
    tags: ["Voice"],
    settings,

    // Renders the button in the bottom left panel
    userAreaButton: {
        icon: MonoIcon,
        render: MonoToggleButton
    },

    start() {
        waitForStore("MediaEngineStore", store => {
            MediaEngineStore = store;
            const mediaEngine = MediaEngineStore.getMediaEngine();
            if (!mediaEngine) return;

            mediaEngineEmitter = mediaEngine.emitter;
            if (!mediaEngineEmitter) return;

            connectionHandler = (connection: any) => {
                if (connection.context === "default") {
                    Connection = connection;

                    if (connection.conn._forceMonoOrig) {
                        updateDecoder();
                        return;
                    }

                    const originalSetOptions = connection.conn.setTransportOptions;
                    connection.conn._forceMonoOrig = originalSetOptions;
                    patchedConns.add(connection.conn);

                    // Injection hook to keep mono active during channel swaps
                    connection.conn.setTransportOptions = function (options: Record<string, any>) {
                        if (options.audioDecoders) {
                            options.audioDecoders[0] = getAudioDecoder();
                        }
                        return originalSetOptions.apply(this, [options]);
                    };

                    updateDecoder();
                }
            };

            mediaEngineEmitter.on("connection", connectionHandler);
        });
    },

    stop() {
        // Revert to stereo when plugin is stopped
        settings.store.forceMono = false;
        updateDecoder();

        if (mediaEngineEmitter && connectionHandler) {
            mediaEngineEmitter.removeListener("connection", connectionHandler);
        }
        connectionHandler = null;
        mediaEngineEmitter = null;

        for (const conn of patchedConns) {
            try {
                if (conn._forceMonoOrig) {
                    conn.setTransportOptions = conn._forceMonoOrig;
                    delete conn._forceMonoOrig;
                }
            } catch { }
        }
        patchedConns.clear();
        Connection = undefined;
    }
});
