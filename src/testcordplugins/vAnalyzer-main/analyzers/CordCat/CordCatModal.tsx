/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface StatementData {
    decision_provision?: string;
    category?: string;
    incompatible_content_ground?: string;
    incompatible_content_explanation?: string;
    category_specification_other?: string;
    decision_facts?: string;
    automated_detection?: string;
    application_date?: string;
    incompatible_content_illegal?: string;
}

interface BreachData {
    source: string;
    ip?: string;
    username?: string;
    discordname?: string;
    categories?: string[];
    date?: string;
}

interface UserInfo {
    id: string;
    username?: string;
    global_name?: string;
    discriminator?: string;
    avatar?: string;
    banner?: string;
    public_flags?: number;
    accent_color?: number | null;
    clan?: { tag: string; identity_guild_id: string; identity_enabled: boolean; };
    primary_guild?: { tag: string; identity_guild_id: string; identity_enabled: boolean; };
}

const TEXT_NORMAL = "var(--text-normal, var(--header-primary, #dcddde))";
const TEXT_MUTED = "var(--text-muted, var(--header-secondary, #b5bac1))";

function fmtEnum(value: string | undefined, prefix: string) {
    return (value ?? "UNKNOWN").replace(prefix, "").replace(/_/g, " ");
}

function fmtDate(value: string | undefined) {
    return value ? String(value).slice(0, 10) : "—";
}

function Tag({ children, color }: { children: React.ReactNode; color: string; }) {
    return (
        <span style={{ background: color, color: "#fff", borderRadius: 3, padding: "1px 6px", fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const }}>
            {children}
        </span>
    );
}

function Field({ label, value }: { label: string; value: string; }) {
    return (
        <div style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 2 }}>
            <span style={{ color: TEXT_MUTED, minWidth: 100, flexShrink: 0 }}>{label}</span>
            <span style={{ color: TEXT_NORMAL }}>{value}</span>
        </div>
    );
}

function SanctionCard({ s }: { s: StatementData; }) {
    return (
        <div style={{ borderLeft: "3px solid var(--status-danger)", background: "var(--background-secondary)", borderRadius: 4, padding: "8px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" as const, marginBottom: 6 }}>
                <Tag color="var(--status-danger)">{fmtEnum(s.decision_provision, "DECISION_PROVISION_")}</Tag>
                <Tag color="var(--text-warning)">{fmtEnum(s.category, "STATEMENT_CATEGORY_")}</Tag>
                {s.incompatible_content_illegal === "Yes" && <Tag color="#7b0000">ILLEGAL</Tag>}
            </div>
            {/* {s.incompatible_content_ground && <Field label="Rule broken" value={s.incompatible_content_ground} />} */}
            {s.incompatible_content_explanation && <Field label="Explanation" value={s.incompatible_content_explanation} />}
            {s.category_specification_other && <Field label="Sub-category" value={s.category_specification_other} />}
            {s.decision_facts && <Field label="Facts" value={s.decision_facts} />}
            {s.automated_detection && <Field label="Automated" value={s.automated_detection} />}
            <Field label="Applied" value={fmtDate(s.application_date)} />
        </div>
    );
}

function BreachCard({ b }: { b: BreachData; }) {
    return (
        <div style={{ borderLeft: "3px solid var(--text-warning)", background: "var(--background-secondary)", borderRadius: 4, padding: "8px 12px", marginBottom: 6 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{b.source}</div>
            {b.ip && <Field label="IP" value={b.ip} />}
            {(b.username || b.discordname) && <Field label="Username" value={(b.username || b.discordname)!} />}
            {b.categories && b.categories.length > 0 && <Field label="Categories" value={b.categories.join(", ")} />}
            <Field label="Date" value={fmtDate(b.date)} />
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode; }) {
    return (
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: TEXT_MUTED, borderBottom: "1px solid var(--background-modifier-accent)", paddingBottom: 3, marginBottom: 8, marginTop: 4 }}>
            {children}
        </div>
    );
}

export function CordCatModal({ data }: { data: any; }) {
    const u: UserInfo = data.userInfo ?? {};
    const statements: StatementData[] = data.statements ?? [];

    // Handle breach data with fallbacks
    let breachResults: any[] = [];
    let breachError: string | null = null;
    if (data.breach) {
        if (data.breach.success === false && data.breach.error) {
            breachError = `${data.breach.error.status}: ${data.breach.error.message}`;
        } else if (Array.isArray(data.breach.data?.results)) {
            breachResults = data.breach.data.results;
        } else if (Array.isArray(data.breach?.results)) {
            breachResults = data.breach.results;
        }
    }
    const breachCount: number = data.breach?.resultsCount ?? breachResults.length ?? 0;

    const avatar = u.avatar
        ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}?size=80`
        : "https://cdn.discordapp.com/embed/avatars/0.png";

    const banner = u.banner
        ? `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.${u.banner.startsWith("a_") ? "gif" : "png"}?size=480`
        : null;

    const handle = u.discriminator && u.discriminator !== "0"
        ? `${u.username}#${u.discriminator}`
        : `@${u.username}`;

    const guild = u.clan ?? u.primary_guild;
    const uniqueIPs = [...new Set(breachResults
        .map((b: any) => b.ip)
        .filter((ip: any) => typeof ip === "string" && ip.length > 0)
    )];

    return (
        <div style={{ padding: "4px 2px", color: TEXT_NORMAL }}>

            {banner && (
                <img src={banner} alt="" style={{ width: "100%", height: 80, objectFit: "cover", borderRadius: 4, marginBottom: 10 }} />
            )}

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <img src={avatar} alt="" style={{ width: 56, height: 56, borderRadius: "50%", border: "3px solid var(--background-tertiary)", flexShrink: 0 }} />
                <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--white-500, #fff)" }}>{u.global_name || u.username || "Unknown"}</div>
                    <div style={{ color: TEXT_MUTED, fontSize: 13 }}>{handle}</div>
                    <div style={{ color: TEXT_MUTED, fontSize: 11, fontFamily: "var(--font-code)" }}>{u.id}</div>
                </div>
            </div>

            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
                <Tag color={statements.length > 0 ? "var(--status-danger)" : "var(--status-positive)"}>
                    {statements.length > 0 ? `${statements.length} sanction${statements.length !== 1 ? "s" : ""}` : "No sanctions"}
                </Tag>
                <Tag color={breachCount > 0 ? "var(--text-warning)" : "var(--status-positive)"}>
                    {breachCount > 0 ? `${breachCount} breach${breachCount !== 1 ? "es" : ""}` : "No breaches"}
                </Tag>
            </div>

            <SectionTitle>User Info</SectionTitle>
            {u.global_name && <Field label="Display name" value={u.global_name} />}
            <Field label="Username" value={u.username ?? "—"} />
            <Field label="User ID" value={u.id} />
            <Field label="Public flags" value={String(u.public_flags ?? 0)} />
            {u.accent_color != null && <Field label="Accent color" value={`#${u.accent_color.toString(16).padStart(6, "0")}`} />}

            {guild && <>
                <SectionTitle>Guild Tag</SectionTitle>
                <Field label="Tag" value={`[${guild.tag}]`} />
                <Field label="Guild ID" value={guild.identity_guild_id} />
                <Field label="Enabled" value={guild.identity_enabled ? "Yes" : "No"} />
            </>}

            <SectionTitle>Sanctions ({statements.length})</SectionTitle>
            {statements.length === 0
                ? <div style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 8 }}>No sanctions on record.</div>
                : statements.map((s, i) => <SanctionCard key={i} s={s} />)
            }

            <SectionTitle>Data Breaches ({breachCount})</SectionTitle>
            {breachError ? (
                <div style={{ color: "var(--status-danger)", fontSize: 13, marginBottom: 8, padding: 8, background: "var(--background-secondary)", borderRadius: 4 }}>
                    Error fetching breach data: {breachError}
                </div>
            ) : uniqueIPs.length > 0 && (
                <div style={{ marginBottom: 8, fontSize: 13 }}>
                    <span style={{ color: TEXT_MUTED }}>Leaked IPs: </span>
                    {uniqueIPs.map((ip, i) => <code key={i} style={{ marginRight: 8 }}>{ip}</code>)}
                </div>
            )}
            {breachError ? null : breachResults.length === 0
                ? <div style={{ color: TEXT_MUTED, fontSize: 13 }}>No breach data found.</div>
                : breachResults.map((b, i) => <BreachCard key={i} b={b} />)
            }

        </div>
    );
}
