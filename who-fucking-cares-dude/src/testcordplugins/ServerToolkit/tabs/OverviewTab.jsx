/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { copyWithToast } from "@utils/discord";
import { ChannelStore, Forms, React, SnowflakeUtils, Text, UserStore } from "@webpack/common";
const VERIFICATION = ["None", "Low", "Medium", "High", "Highest"];
const NSFW_LEVEL = ["Default", "Explicit", "Safe", "Age-Restricted"];
const MFA_LEVEL = ["None", "Elevated"];
const PREMIUM_TIER = ["Tier 0", "Tier 1", "Tier 2", "Tier 3"];
function Row({ label, value, copy }) {
    return (<div className="gt-row">
            <span className="gt-row-label">{label}</span>
            <span className="gt-row-value">
                {copy ? (<span onClick={() => copyWithToast(copy)} style={{ cursor: "pointer", textDecoration: "underline" }}>
                        {value}
                    </span>) : (value)}
            </span>
        </div>);
}
export function OverviewTab({ guild }) {
    const g = guild;
    const createdAt = new Date(SnowflakeUtils.extractTimestamp(guild.id));
    const owner = UserStore.getUser(g.ownerId);
    const ownerDisplayName = owner
        ? owner.globalName ? `${owner.globalName} (@${owner.username})` : `@${owner.username}`
        : "Unknown User";
    const ownerValue = g.ownerId ? (<>
            <span>{ownerDisplayName}</span>
            {" ("}
            <span onClick={() => copyWithToast(g.ownerId)} style={{ cursor: "pointer", textDecoration: "underline" }}>
                {g.ownerId}
            </span>
            {")"}
        </>) : "?";
    const renderChannelValue = (id) => {
        const ch = ChannelStore.getChannel(id);
        const name = ch ? `#${ch.name}` : "Unknown Channel";
        return (<>
                <span>{name}</span>
                {" ("}
                <span onClick={() => copyWithToast(id)} style={{ cursor: "pointer", textDecoration: "underline" }}>
                    {id}
                </span>
                {")"}
            </>);
    };
    const features = Array.isArray(g.features)
        ? g.features
        : g.features?.length != null
            ? Array.from(g.features)
            : [];
    return (<div className="gt-overview">
            <Forms.FormSection title="Identity">
                <Row label="Name" value={guild.name}/>
                <Row label="ID" value={guild.id} copy={guild.id}/>
                <Row label="Owner" value={ownerValue}/>
                <Row label="Created" value={createdAt.toLocaleString()}/>
                {g.vanityURLCode && <Row label="Vanity" value={`discord.gg/${g.vanityURLCode}`} copy={`discord.gg/${g.vanityURLCode}`}/>}
                {g.description && <Row label="Description" value={g.description}/>}
            </Forms.FormSection>

            <Forms.FormSection title="Configuration">
                <Row label="Verification" value={VERIFICATION[g.verificationLevel] ?? g.verificationLevel}/>
                <Row label="NSFW Level" value={NSFW_LEVEL[g.nsfwLevel] ?? g.nsfwLevel}/>
                <Row label="MFA Requirement" value={MFA_LEVEL[g.mfaLevel] ?? g.mfaLevel}/>
                <Row label="Default Notifications" value={g.defaultMessageNotifications === 0 ? "All Messages" : "Only Mentions"}/>
                <Row label="Explicit Content Filter" value={["Disabled", "Members w/o roles", "All members"][g.explicitContentFilter] ?? g.explicitContentFilter}/>
                {g.afkChannelId && <Row label="AFK Channel" value={renderChannelValue(g.afkChannelId)}/>}
                {g.afkTimeout != null && <Row label="AFK Timeout" value={`${g.afkTimeout}s`}/>}
                {g.systemChannelId && <Row label="System Channel" value={renderChannelValue(g.systemChannelId)}/>}
                {g.rulesChannelId && <Row label="Rules Channel" value={renderChannelValue(g.rulesChannelId)}/>}
                {g.publicUpdatesChannelId && <Row label="Public Updates Channel" value={renderChannelValue(g.publicUpdatesChannelId)}/>}
                <Row label="Preferred Locale" value={g.preferredLocale ?? "?"}/>
            </Forms.FormSection>

            <Forms.FormSection title="Boost">
                <Row label="Premium Tier" value={PREMIUM_TIER[g.premiumTier] ?? g.premiumTier}/>
                <Row label="Boost Count" value={g.premiumSubscriberCount ?? 0}/>
                {g.premiumProgressBarEnabled != null && <Row label="Progress Bar" value={g.premiumProgressBarEnabled ? "On" : "Off"}/>}
            </Forms.FormSection>

            <Forms.FormSection title={`Features (${features.length})`}>
                {features.length === 0 ? (<Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>No features</Text>) : (<div className="gt-feature-grid">
                        {features.map(f => (<span key={f} className="gt-feature-pill">{f}</span>))}
                    </div>)}
            </Forms.FormSection>
        </div>);
}
