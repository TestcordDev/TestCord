/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./PrivacySecurityPanel.css";
import { Switch } from "@components/Switch";
import { React, useEffect, useState } from "@webpack/common";
const DEFAULT_SHIELDS = {
    experimentalTracing: false,
    experimentalRtcDiagnostics: false,
    experimentalRemoteLogging: false
};
const EXPERIMENTS = [
    {
        key: "experimentalTracing",
        title: "Block Tracing",
        description: "Blocks Discord first-party API requests ending in /tracing.",
        test: "Switch channels, type a message and open context menus."
    },
    {
        key: "experimentalRtcDiagnostics",
        title: "Block RTC Diagnostics",
        description: "Blocks call-quality diagnostic reports without blocking voice signaling or media.",
        test: "Join voice, change input and output devices, then start and stop a stream."
    },
    {
        key: "experimentalRemoteLogging",
        title: "Block Remote Logs",
        description: "Blocks Discord remote debug-log uploads. Local logs remain available.",
        test: "Restart Discord, check for updates and confirm crash recovery still works."
    }
];
export function ExperimentalPanel() {
    const [shields, setShields] = useState(DEFAULT_SHIELDS);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        let active = true;
        const load = async () => {
            try {
                const data = await VencordNative.privacy.getData();
                if (active && data.shields) {
                    setShields({
                        experimentalTracing: data.shields.experimentalTracing === true,
                        experimentalRtcDiagnostics: data.shields.experimentalRtcDiagnostics === true,
                        experimentalRemoteLogging: data.shields.experimentalRemoteLogging === true
                    });
                }
            }
            catch {
                if (active)
                    setError("Could not load the current experiment settings.");
            }
            finally {
                if (active)
                    setLoaded(true);
            }
        };
        void load();
        return () => { active = false; };
    }, []);
    const setShield = async (key, value) => {
        const previous = shields[key];
        setError(null);
        setShields(current => ({ ...current, [key]: value }));
        try {
            const updated = await VencordNative.privacy.toggleShield(key, value);
            if (updated)
                setShields(current => ({ ...current, [key]: updated[key] === true }));
        }
        catch {
            setShields(current => ({ ...current, [key]: previous }));
            setError("The change could not be saved. The previous setting was restored.");
        }
    };
    const enabledCount = Object.values(shields).filter(Boolean).length;
    return (<>
            <section className="ps-card">
                <div className="ps-card-header">
                    <div className="ps-header-title-group">
                        <h2 className="ps-card-title-text">Experimental Privacy Protections</h2>
                        <span className="ps-badge ps-badge-blue">
                            <span className="ps-badge-dot"/>
                            {enabledCount} enabled
                        </span>
                    </div>
                </div>
                <div className="ps-card-subtitle">
                    These protections are disabled by default. Enable one at a time and test Discord after each change.
                </div>
                {error && <div className="ps-card-subtitle">{error}</div>}
                <div className="ps-privacy-toggles">
                    {EXPERIMENTS.map(experiment => {
            const titleId = `testcord-${experiment.key}-title`;
            const descriptionId = `testcord-${experiment.key}-description`;
            return (<div className="ps-toggle-row" key={experiment.key}>
                                <div className="ps-toggle-info">
                                    <span className="ps-toggle-title" id={titleId}>{experiment.title}</span>
                                    <span className="ps-toggle-desc" id={descriptionId}>{experiment.description}</span>
                                </div>
                                <Switch checked={shields[experiment.key]} disabled={!loaded} onChange={value => void setShield(experiment.key, value)} aria-labelledby={titleId} aria-describedby={descriptionId}/>
                            </div>);
        })}
                </div>
            </section>

            <section className="ps-card">
                <div className="ps-card-header">
                    <h2 className="ps-card-title-text">Testing Checklist</h2>
                </div>
                <div className="ps-card-subtitle">
                    If something breaks, disable the last experiment you enabled and restart Discord.
                </div>
                {EXPERIMENTS.map(experiment => (<div className="ps-route-card" key={experiment.key}>
                        <span className="ps-toggle-title">{experiment.title}</span>
                        <span className="ps-toggle-desc">{experiment.test}</span>
                    </div>))}
            </section>
        </>);
}
export default ExperimentalPanel;
