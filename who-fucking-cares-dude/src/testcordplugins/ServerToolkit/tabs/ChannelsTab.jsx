/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { copyWithToast } from "@utils/discord";
import { ChannelStore, Forms, React, TextInput, useMemo, useState } from "@webpack/common";
const TYPE_LABEL = {
    0: "text", 2: "voice", 4: "category", 5: "announcement",
    10: "ann-thread", 11: "pub-thread", 12: "priv-thread",
    13: "stage", 14: "directory", 15: "forum", 16: "media",
};
export function ChannelsTab({ guild }) {
    const [filter, setFilter] = useState("");
    const [collapsedCats, setCollapsedCats] = useState({});
    const channels = useMemo(() => {
        const all = ChannelStore.getMutableGuildChannelsForGuild?.(guild.id) ?? {};
        return Object.values(all);
    }, [guild.id]);
    const grouped = useMemo(() => {
        const cats = channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position);
        const nonCats = channels.filter((c) => c.type !== 4);
        const orphans = nonCats.filter((c) => !c.parent_id && !c.parentId);
        const byCat = new Map();
        for (const c of nonCats) {
            const pid = c.parent_id ?? c.parentId;
            if (!pid)
                continue;
            if (!byCat.has(pid))
                byCat.set(pid, []);
            byCat.get(pid).push(c);
        }
        for (const arr of byCat.values())
            arr.sort((a, b) => a.position - b.position);
        orphans.sort((a, b) => a.position - b.position);
        return { cats, byCat, orphans };
    }, [channels]);
    const matches = (c) => !filter || c.name?.toLowerCase().includes(filter.toLowerCase()) || c.id?.includes(filter);
    const toggleCat = (catId) => {
        setCollapsedCats(prev => ({
            ...prev,
            [catId]: !prev[catId]
        }));
    };
    const renderChannel = (c) => {
        if (!matches(c))
            return null;
        const type = TYPE_LABEL[c.type];
        const hasType = !!type;
        return (<div key={c.id} className={`gt-channel-row ${hasType ? "gt-has-type" : "gt-no-type"}`}>
                {hasType && <span className="gt-channel-type">{type}</span>}
                <span className="gt-channel-name" onClick={() => copyWithToast(c.name)} style={{ cursor: "pointer" }}>
                    {c.name}
                </span>
                <span className="gt-channel-id" onClick={() => copyWithToast(c.id)} style={{ cursor: "pointer" }}>
                    {c.id}
                </span>
            </div>);
    };
    return (<div className="gt-channels">
            <Forms.FormSection title={`Channels (${channels.length})`}>
                <TextInput placeholder="Filter channels…" value={filter} onChange={setFilter} className="gt-input gt-search"/>
                <div className="gt-channel-tree">
                    {grouped.orphans.map(renderChannel)}
                    {grouped.cats.map(cat => {
            const isCollapsed = collapsedCats[cat.id];
            const childChannels = grouped.byCat.get(cat.id) ?? [];
            const visibleChildren = childChannels.filter(matches);
            return (<div key={cat.id} className="gt-channel-cat">
                                <div className="gt-channel-cat-header" onClick={() => toggleCat(cat.id)} style={{ cursor: "pointer" }}>
                                    <span>
                                        {isCollapsed ? "▶ " : "▼ "}
                                        {(cat.name ?? "").toUpperCase()}
                                        {` (${visibleChildren.length})`}
                                    </span>
                                    <span className="gt-channel-id" onClick={e => {
                    e.stopPropagation();
                    copyWithToast(cat.id);
                }} style={{ cursor: "pointer" }}>
                                        {cat.id}
                                    </span>
                                </div>
                                <div className={`gt-cat-children gt-collapsible-content ${isCollapsed ? "gt-collapsed" : ""}`}>
                                    {childChannels.map(renderChannel)}
                                </div>
                            </div>);
        })}
                </div>
            </Forms.FormSection>
        </div>);
}
