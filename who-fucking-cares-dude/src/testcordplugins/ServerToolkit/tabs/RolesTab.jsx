/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { copyWithToast } from "@utils/discord";
import { Forms, GuildRoleStore, PermissionsBits, React, TextInput, useMemo, useState } from "@webpack/common";
import { PERM_LABELS } from "./PermissionsTab";
export function RolesTab({ guild }) {
    const [filter, setFilter] = useState("");
    const [selectedRoleId, setSelectedRoleId] = useState(null);
    const roles = useMemo(() => {
        const rolesObj = GuildRoleStore.getRolesSnapshot(guild.id) ?? {};
        return Object.values(rolesObj);
    }, [guild.id]);
    const sorted = useMemo(() => {
        return [...roles].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    }, [roles]);
    const filtered = sorted.filter(r => !filter || r.name?.toLowerCase().includes(filter.toLowerCase()) || r.id?.includes(filter));
    return (<div className="gt-roles">
            <Forms.FormSection title={`Roles (${roles.length})`}>
                <TextInput placeholder="Filter roles by name or ID…" value={filter} onChange={setFilter} className="gt-input gt-search"/>
                <div className="gt-role-list">
                    {filtered.map(r => {
            const colorHex = r.colorString || (r.color ? `#${r.color.toString(16).padStart(6, "0")}` : "#949ba4");
            const isSelected = selectedRoleId === r.id;
            // Calculate enabled permissions
            const rolePerms = BigInt(r.permissions ?? 0);
            const isAdmin = (rolePerms & BigInt(PermissionsBits?.ADMINISTRATOR ?? 0x8n)) !== 0n;
            const enabledPerms = Object.entries(PERM_LABELS).filter(([key]) => {
                const bit = PermissionsBits?.[key];
                return bit != null && (rolePerms & BigInt(bit)) !== 0n;
            });
            return (<div key={r.id} className={`gt-role-item-wrap ${isSelected ? "active" : ""}`}>
                                <div className="gt-role-row" onClick={() => setSelectedRoleId(isSelected ? null : r.id)} style={{ cursor: "pointer" }}>
                                    <span className="gt-role-dot clickable" style={{ background: colorHex }} onClick={e => {
                    e.stopPropagation();
                    copyWithToast(colorHex);
                }} title={`Click to copy: ${colorHex}`}/>
                                    <span className="gt-role-name" style={{ color: colorHex ?? undefined }}>
                                         {r.name}
                                    </span>
                                    <span className="gt-role-copy-btn" onClick={e => {
                    e.stopPropagation();
                    copyWithToast(r.name);
                }} title={`Copy name: ${r.name}`} style={{ cursor: "pointer", opacity: 0.6, fontSize: 11 }}>
                                        📋
                                    </span>
                                    <span className="gt-role-meta" onClick={e => e.stopPropagation()}>
                                        {r.hoist && <span className="gt-pill">hoist</span>}
                                        {r.mentionable && <span className="gt-pill">mention</span>}
                                        {r.managed && <span className="gt-pill">managed</span>}
                                        {r.tags?.bot_id && <span className="gt-pill">bot</span>}
                                        {r.tags?.premium_subscriber !== undefined && <span className="gt-pill">booster</span>}
                                        <span className="gt-role-id" onClick={() => copyWithToast(r.id)} style={{ cursor: "pointer", textDecoration: "underline" }}>
                                            {r.id}
                                        </span>
                                    </span>
                                </div>
                                <div className={`gt-role-perms-box gt-collapsible-content ${isSelected ? "" : "gt-collapsed"}`}>
                                    <div className="gt-role-perms-title">
                                        {isAdmin ? "Administrator (All Permissions Granted)" : "Enabled Permissions:"}
                                    </div>
                                    {!isAdmin && enabledPerms.length === 0 ? (<div className="gt-role-perm-none">None</div>) : !isAdmin ? (<div className="gt-role-perms-grid">
                                            {enabledPerms.map(([key, label]) => (<span key={key} className="gt-pill gt-pill-good">
                                                    {label}
                                                </span>))}
                                        </div>) : null}
                                </div>
                            </div>);
        })}
                </div>
            </Forms.FormSection>
        </div>);
}
