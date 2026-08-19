/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordDevs } from "@utils/constants";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { GuildMemberStore, GuildStore, Menu, React, showToast, Text, Toasts, useMemo, UserStore, useState, } from "@webpack/common";
// ─── Utility ──────────────────────────────────────────────────────────────────
function getMutualMembers(guildAId, guildBId) {
    const membersA = new Set(Object.values(GuildMemberStore.getMembers(guildAId) ?? {}).map((m) => m.userId));
    const membersB = Object.values(GuildMemberStore.getMembers(guildBId) ?? {}).map((m) => m.userId);
    return membersB.filter(id => membersA.has(id));
}
// ─── Modal ────────────────────────────────────────────────────────────────────
function MutualMembersModal({ guildAId, guildBId, modalProps }) {
    const guildA = GuildStore.getGuild(guildAId);
    const guildB = GuildStore.getGuild(guildBId);
    const mutualIds = useMemo(() => getMutualMembers(guildAId, guildBId), [guildAId, guildBId]);
    const members = useMemo(() => mutualIds.map(id => {
        const user = UserStore.getUser(id);
        return {
            id,
            username: user?.globalName ?? user?.username ?? id,
            discriminator: user?.discriminator ?? "0",
            bot: user?.bot ?? false,
            avatar: user?.avatar
                ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.png?size=32`
                : `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`,
        };
    }).sort((a, b) => a.username.localeCompare(b.username)), [mutualIds]);
    const [search, setSearch] = useState("");
    const [showBots, setShowBots] = useState(false);
    const filtered = members.filter(m => {
        if (!showBots && m.bot)
            return false;
        return m.username.toLowerCase().includes(search.toLowerCase());
    });
    const styles = {
        header: {
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: "16px 16px 0",
        },
        title: {
            fontSize: 18,
            fontWeight: 700,
            color: "var(--white-500, #fff)",
        },
        subtitle: {
            fontSize: 13,
            color: "var(--text-muted, #a0a0a0)",
        },
        controls: {
            display: "flex",
            gap: 8,
            padding: "12px 16px",
            alignItems: "center",
        },
        searchInput: {
            flex: 1,
            background: "var(--input-background)",
            border: "1px solid var(--input-border)",
            borderRadius: 4,
            padding: "6px 10px",
            color: "var(--text-normal)",
            fontSize: 14,
            outline: "none",
        },
        botToggle: {
            background: showBots ? "var(--brand-experiment)" : "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderRadius: 4,
            padding: "6px 10px",
            color: showBots ? "#fff" : "var(--text-muted)",
            fontSize: 12,
            cursor: "pointer",
            whiteSpace: "nowrap",
        },
        list: {
            overflowY: "auto",
            maxHeight: 380,
            padding: "0 16px 8px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
        },
        row: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 8px",
            borderRadius: 6,
            cursor: "default",
            transition: "background 0.1s",
        },
        avatar: {
            width: 32,
            height: 32,
            borderRadius: "50%",
            flexShrink: 0,
        },
        nameWrap: {
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
        },
        name: {
            fontSize: 14,
            fontWeight: 500,
            color: "var(--white-500, #fff)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
        },
        botBadge: {
            fontSize: 10,
            color: "var(--brand-experiment)",
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: "uppercase",
        },
        empty: {
            textAlign: "center",
            color: "var(--text-muted)",
            padding: "32px 0",
            fontSize: 14,
        },
        countBadge: {
            background: "var(--background-secondary)",
            borderRadius: 10,
            padding: "2px 8px",
            fontSize: 12,
            color: "var(--text-muted)",
            marginLeft: 6,
        },
        footer: {
            padding: "12px 16px",
            borderTop: "1px solid var(--background-modifier-accent)",
        },
    };
    return (<ModalRoot {...modalProps} size="small">
            <ModalHeader>
                <div style={styles.header}>
                    <span style={styles.title}>
                        Mutual Members
                        <span style={styles.countBadge}>{filtered.length}</span>
                    </span>
                    <span style={styles.subtitle}>
                        {guildA?.name ?? guildAId} ∩ {guildB?.name ?? guildBId}
                    </span>
                </div>
            </ModalHeader>
            <ModalContent>
                <div style={styles.controls}>
                    <input style={styles.searchInput} placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)}/>
                    <button style={styles.botToggle} onClick={() => setShowBots(v => !v)}>
                        {showBots ? "Hide Bots" : "Show Bots"}
                    </button>
                </div>

                <div style={styles.list}>
                    {filtered.length === 0 ? (<div style={styles.empty}>
                            {members.length === 0
                ? "No cached members found. Scroll through both servers first."
                : "No members match your search."}
                        </div>) : (filtered.map(m => (<div key={m.id} style={styles.row} onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                <img style={styles.avatar} src={m.avatar} alt=""/>
                                <div style={styles.nameWrap}>
                                    <span style={styles.name}>{m.username}</span>
                                    {m.bot && <span style={styles.botBadge}>BOT</span>}
                                </div>
                            </div>)))}
                </div>
            </ModalContent>
            <ModalFooter>
                <Text variant="text-xs/normal" color="text-muted">
                    Results are based on cached members. Open the member list in both servers for best results.
                </Text>
            </ModalFooter>
        </ModalRoot>);
}
// ─── Guild Picker Modal ───────────────────────────────────────────────────────
function GuildPickerModal({ fixedGuildId, modalProps }) {
    const allGuilds = Object.values(GuildStore.getGuilds());
    const [guildA, setGuildA] = useState(fixedGuildId ?? "");
    const [guildB, setGuildB] = useState("");
    const [search, setSearch] = useState("");
    const [manualIdA, setManualIdA] = useState("");
    const [manualIdB, setManualIdB] = useState("");
    const [useManual, setUseManual] = useState(false);
    const [openDropdown, setOpenDropdown] = useState(null);
    const filteredGuilds = allGuilds.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
    const s = {
        root: { padding: "0 16px 16px" },
        title: { fontSize: 18, fontWeight: 700, color: "#fff", padding: "16px 16px 8px" },
        row: { display: "flex", gap: 10, marginBottom: 10 },
        label: { fontSize: 12, color: "#aaa", marginBottom: 4, display: "block" },
        toggle: {
            background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderRadius: 4, padding: "6px 10px",
            color: "#aaa", fontSize: 12, cursor: "pointer", marginBottom: 10,
        },
        btn: {
            width: "100%", padding: "10px 0",
            background: "var(--brand-experiment)", color: "#fff",
            border: "none", borderRadius: 4, fontSize: 14, fontWeight: 600, cursor: "pointer",
            marginTop: 4,
        },
        input: {
            width: "100%", background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderRadius: 4, padding: "6px 10px", color: "#fff", fontSize: 14,
            boxSizing: "border-box",
        },
        dropBtn: {
            width: "100%", background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderRadius: 4, padding: "6px 10px", color: "#fff",
            fontSize: 14, cursor: "pointer", textAlign: "left",
            display: "flex", justifyContent: "space-between", alignItems: "center",
        },
        dropList: {
            background: "var(--background-secondary)",
            border: "1px solid var(--background-modifier-accent)",
            borderRadius: 4, maxHeight: 150, overflowY: "auto",
            width: "100%", marginTop: 2, marginBottom: 4,
        },
        dropItem: {
            padding: "7px 10px", color: "#fff", cursor: "pointer", fontSize: 14,
        },
    };
    function CustomDropdown({ value, onChange, which }) {
        const isOpen = openDropdown === which;
        const selected = allGuilds.find(g => g.id === value);
        return (<div>
                <button style={s.dropBtn} onClick={() => setOpenDropdown(isOpen ? null : which)}>
                    <span>{selected ? selected.name : "— pick server —"}</span>
                    <span>{isOpen ? "▲" : "▼"}</span>
                </button>
                {isOpen && (<div style={s.dropList}>
                        {filteredGuilds.map((g) => (<div key={g.id} style={s.dropItem} onMouseEnter={e => (e.currentTarget.style.background = "var(--background-modifier-hover)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")} onClick={() => { onChange(g.id); setOpenDropdown(null); }}>
                                {g.name}
                            </div>))}
                    </div>)}
            </div>);
    }
    function compare() {
        const idA = useManual ? manualIdA.trim() : guildA;
        const idB = useManual ? manualIdB.trim() : guildB;
        if (!idA || !idB) {
            showToast("Please select or enter both servers.", Toasts.Type.FAILURE);
            return;
        }
        if (idA === idB) {
            showToast("Please pick two different servers.", Toasts.Type.FAILURE);
            return;
        }
        openModal(p => <MutualMembersModal guildAId={idA} guildBId={idB} modalProps={p}/>);
    }
    return (<ModalRoot {...modalProps} size="small">
            <ModalHeader>
                <span style={s.title}>Compare Servers</span>
            </ModalHeader>
            <ModalContent>
                <div style={s.root}>
                    <button style={s.toggle} onClick={() => setUseManual(v => !v)}>
                        {useManual ? "← Use dropdowns" : "Enter server IDs manually →"}
                    </button>

                    {useManual ? (<>
                            <label style={s.label}>Server A ID</label>
                            <div style={{ marginBottom: 10 }}>
                                <input style={s.input} placeholder="000000000000000000" value={manualIdA} onChange={e => setManualIdA(e.target.value)}/>
                            </div>
                            <label style={s.label}>Server B ID</label>
                            <div style={{ marginBottom: 10 }}>
                                <input style={s.input} placeholder="000000000000000000" value={manualIdB} onChange={e => setManualIdB(e.target.value)}/>
                            </div>
                        </>) : (<>
                            <input style={{ ...s.input, marginBottom: 8 }} placeholder="Search your servers..." value={search} onChange={e => setSearch(e.target.value)}/>
                            <div style={s.row}>
                                <div style={{ flex: 1 }}>
                                    <label style={s.label}>Server A</label>
                                    <CustomDropdown value={guildA} onChange={setGuildA} which="A"/>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={s.label}>Server B</label>
                                    <CustomDropdown value={guildB} onChange={setGuildB} which="B"/>
                                </div>
                            </div>
                        </>)}

                    <button style={s.btn} onClick={compare}>Compare Members</button>
                </div>
            </ModalContent>
        </ModalRoot>);
}
// ─── Context menu patch ───────────────────────────────────────────────────────
const ctxMenuPatch = (children, props) => {
    if (!props.guild)
        return;
    children.splice(1, 0, <Menu.MenuItem id="vc-mutual-server-members" label="Mutual Server Members" action={() => openModal(mProps => <GuildPickerModal fixedGuildId={props.guild.id} modalProps={mProps}/>)}/>);
};
// ─── Plugin ───────────────────────────────────────────────────────────────────
export default definePlugin({
    name: "MutualServerMembers",
    description: "Compare two servers you're in and see which members are in both. Right-click a server, use dropdowns, or enter IDs manually.",
    tags: ["Servers", "Utility"],
    authors: [TestcordDevs.nnenaza],
    contextMenus: {
        "guild-context": ctxMenuPatch,
    },
});
