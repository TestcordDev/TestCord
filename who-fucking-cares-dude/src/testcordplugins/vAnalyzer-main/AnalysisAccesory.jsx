/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { SafetyIcon } from "@components/Icons";
import { useEffect, useMemo, useState } from "@webpack/common";
import { extractDomain, flagDomain } from "./threatStore";
import { cl, pruneMap } from "./utils";
const AnalysisSetters = new Map();
// buffer results that arrive before the component is ready
const PENDING_RESULT_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_RESULTS = 2000;
const pendingResults = new Map();
function prunePendingResults(now) {
    pruneMap(pendingResults, entry => now - entry.createdAt > PENDING_RESULT_TTL_MS, MAX_PENDING_RESULTS);
}
function mergeAnalysis(prev, data) {
    if (!prev)
        return data;
    const seenMessages = new Set(prev.details.map(d => d.message));
    const newDetails = data.details.filter(d => !seenMessages.has(d.message));
    return {
        ...prev,
        details: [...prev.details, ...newDetails],
        timestamp: Date.now()
    };
}
export function handleAnalysis(messageId, data, sourceUrl) {
    if (sourceUrl) {
        const domain = extractDomain(sourceUrl);
        if (domain) {
            for (const detail of data.details) {
                if (detail.type === "malicious" || detail.type === "suspicious") {
                    flagDomain(domain, detail.type, detail.message);
                }
            }
        }
    }
    const setter = AnalysisSetters.get(messageId);
    if (setter) {
        setter(prev => mergeAnalysis(prev, data));
    }
    else {
        // component not ready yet, so we buffer it
        const now = Date.now();
        prunePendingResults(now);
        const existing = pendingResults.get(messageId);
        pendingResults.set(messageId, {
            analysis: mergeAnalysis(existing?.analysis ?? null, data),
            createdAt: now
        });
    }
}
export function flushPending(messageId, setter) {
    const pendingEntry = pendingResults.get(messageId);
    if (pendingEntry) {
        pendingResults.delete(messageId);
        setter(prev => mergeAnalysis(prev, pendingEntry.analysis));
    }
}
function normalizeSearchText(value) {
    return value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function ConnectedMembersPanel({ detail }) {
    const members = detail.discordConnectedMembers ?? [];
    const [query, setQuery] = useState("");
    const filteredMembers = useMemo(() => {
        const normalizedQuery = normalizeSearchText(query);
        if (!normalizedQuery)
            return members;
        return members.filter(member => {
            const username = normalizeSearchText(member.username);
            const activity = normalizeSearchText(member.activityName ?? "");
            const status = normalizeSearchText(member.status);
            return username.includes(normalizedQuery)
                || activity.includes(normalizedQuery)
                || status.includes(normalizedQuery);
        });
    }, [members, query]);
    return (<div className={cl("connected-members-panel")}>
            <div className={cl("connected-members-header")}>
                <span>Connected Members</span>
                <span className={cl("connected-members-count")}>
                    {filteredMembers.length}/{members.length}
                    {typeof detail.discordPresenceCount === "number" ? ` of ${detail.discordPresenceCount} online` : ""}
                </span>
            </div>
            <div className={cl("connected-members-search-wrap")}>
                <input type="text" className={cl("connected-members-search")} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search user, status or activity..."/>
            </div>
            <div className={cl("connected-members-list")}>
                {filteredMembers.length === 0 && (<div className={cl("connected-members-empty")}>
                        No members match "{query}"
                    </div>)}
                {filteredMembers.map(member => (<div key={`${member.id}-${member.username}`} className={cl("connected-member-row")}>
                        <div className={cl("connected-member-avatar-wrap")}>
                            <img src={member.avatar_url} alt={member.username} className={cl("connected-member-avatar")}/>
                            <span className={`${cl("status-dot")} ${cl(`status-${member.status.toLowerCase()}`)}`}/>
                        </div>
                        <div className={cl("connected-member-meta")}>
                            <div className={cl("connected-member-name")}>{member.username}</div>
                            {member.activityName && (<div className={cl("connected-member-activity")}>{member.activityName}</div>)}
                        </div>
                    </div>))}
            </div>
        </div>);
}
export function AnalysisAccessory({ message }) {
    const [analysis, setAnalysis] = useState(null);
    const [expanded, setExpanded] = useState(false);
    useEffect(() => {
        AnalysisSetters.set(message.id, setAnalysis);
        // clear any results that showed up too early
        flushPending(message.id, setAnalysis);
        return () => void AnalysisSetters.delete(message.id);
    }, [message.id]);
    useEffect(() => {
        if (!analysis)
            return;
        const hasWarning = analysis.details.some(d => d.type === "suspicious" || d.type === "malicious");
        if (hasWarning)
            setExpanded(true);
    }, [analysis]);
    const getColorClass = (type) => {
        switch (type) {
            case "safe": return cl("safe");
            case "suspicious": return cl("suspicious");
            case "malicious": return cl("malicious");
            default: return cl("neutral");
        }
    };
    const renderConnectedMembers = (detail) => {
        if (!detail.discordConnectedMembers?.length)
            return null;
        return <ConnectedMembersPanel detail={detail}/>;
    };
    if (!analysis)
        return null;
    if (!expanded) {
        return (<div className={`${cl("accessory")} ${cl("compact")}`} onClick={() => setExpanded(true)}>
                <SafetyIcon width={16} height={16} className={`${cl("icon")} ${cl("safe")}`}/>
            </div>);
    }
    return (<div className={cl("accessory")}>
            <SafetyIcon width={16} height={16} className={cl("icon")} onClick={() => setExpanded(false)} style={{ cursor: "pointer" }}/>
            <div className={cl("results")}>
                <strong className={cl("title")}>Security Analysis:</strong>
                {analysis.details.map((detail, i) => (<div key={i} className={`${cl("detail")} ${getColorClass(detail.type)}`}>
                        {detail.message}
                        {renderConnectedMembers(detail)}
                    </div>))}
                <button onClick={() => setAnalysis(null)} className={cl("dismiss")}>
                    Dismiss
                </button>
            </div>
        </div>);
}
