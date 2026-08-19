/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Devs } from "@utils/constants";
import { t } from "@utils/testcordI18n";
import definePlugin from "@utils/types";
import { React, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";
// HypeSquad house flags on the user object (1<<6, 1<<7, 1<<8).
const HOUSE_FLAGS = { 1: 64, 2: 128, 3: 256 };
const HOUSES = [
    { id: 1, name: "Bravery", icon: "https://cdn.discordapp.com/badge-icons/8a88d63823d8a71cd5e390baa45efa02.png" },
    { id: 2, name: "Brilliance", icon: "https://cdn.discordapp.com/badge-icons/011940fd013da3f7fb926e4a1cd2e618.png" },
    { id: 3, name: "Balance", icon: "https://cdn.discordapp.com/badge-icons/3aa41de486fa12454c3761e8e223442e.png" }
];
/**
 * Changes the HypeSquad house through Discord's own /hypesquad/online endpoint.
 * We go through RestAPI, which attaches the session's authorization for us — the
 * raw account token is never read or handled by this plugin.
 */
export async function changeHypeSquadHouse(houseId) {
    const name = HOUSES.find(h => h.id === houseId)?.name ?? t("لا شيء", "None");
    try {
        showToast(t("جارٍ تحديث دار HypeSquad…", "Updating HypeSquad house…"), Toasts.Type.MESSAGE);
        if (houseId === 0)
            await RestAPI.del({ url: "/hypesquad/online" });
        else
            await RestAPI.post({ url: "/hypesquad/online", body: { house_id: houseId } });
        showToast(houseId === 0
            ? t("تم مغادرة HypeSquad وإزالة الشارة.", "Left HypeSquad and removed the badge.")
            : t(`تم تحديث دار HypeSquad: ${name}!`, `HypeSquad House updated: ${name}!`), Toasts.Type.SUCCESS);
        setTimeout(() => location.reload(), 600);
    }
    catch (err) {
        showToast(t(`تعذّر تغيير الدار: ${err?.message ?? err}`, `Failed to change house: ${err?.message ?? err}`), Toasts.Type.FAILURE);
    }
}
function currentHouse() {
    const flags = UserStore.getCurrentUser()?.flags ?? 0;
    for (const [id, flag] of Object.entries(HOUSE_FLAGS))
        if (flags & flag)
            return +id;
    return 0;
}
export function HypeSquadSelectComponent() {
    const [selectedHouse, setSelectedHouse] = React.useState(currentHouse);
    const handleClick = (id) => {
        if (selectedHouse === id)
            return;
        setSelectedHouse(id);
        changeHypeSquadHouse(id);
    };
    const handleLeave = () => {
        setSelectedHouse(0);
        changeHypeSquadHouse(0);
    };
    return (<div style={{ marginTop: 14, marginBottom: 14, width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ color: "var(--header-primary, #f2f3f5)", fontWeight: 700, textTransform: "uppercase", fontSize: "12px", letterSpacing: "0.04em", margin: 0 }}>
                    {t("دار HypeSquad", "HypeSquad House")}
                </h3>
                <button onClick={handleLeave} style={{
            padding: "6px 12px",
            borderRadius: "6px",
            background: selectedHouse === 0 ? "rgba(237, 66, 69, 0.25)" : "rgba(237, 66, 69, 0.12)",
            color: "#ed4245",
            border: selectedHouse === 0 ? "1px solid #ed4245" : "1px solid rgba(237, 66, 69, 0.3)",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "all 0.15s ease",
            outline: "none"
        }} onMouseEnter={e => { e.currentTarget.style.background = "#ed4245"; e.currentTarget.style.color = "#ffffff"; }} onMouseLeave={e => {
            e.currentTarget.style.background = selectedHouse === 0 ? "rgba(237, 66, 69, 0.25)" : "rgba(237, 66, 69, 0.12)";
            e.currentTarget.style.color = "#ed4245";
        }}>
                    {t("إزالة الشارة (مغادرة)", "Leave (Remove Badge)")}
                </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                {HOUSES.map(h => {
            const isSelected = selectedHouse === h.id;
            return (<button key={h.id} onClick={() => handleClick(h.id)} style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                    padding: "10px 12px", borderRadius: "8px",
                    background: isSelected
                        ? "var(--background-secondary-alt, rgba(255, 255, 255, 0.12))"
                        : "var(--background-secondary, rgba(255, 255, 255, 0.05))",
                    border: isSelected ? "1.5px solid var(--brand-500, #5865f2)" : "1px solid rgba(255, 255, 255, 0.08)",
                    boxShadow: isSelected ? "0 0 12px rgba(88, 101, 242, 0.35)" : "none",
                    cursor: "pointer", transition: "all 0.18s cubic-bezier(0.16, 1, 0.3, 1)", outline: "none"
                }} onMouseEnter={e => {
                    if (!isSelected) {
                        e.currentTarget.style.background = "rgba(255, 255, 255, 0.09)";
                        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.18)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                    }
                }} onMouseLeave={e => {
                    if (!isSelected) {
                        e.currentTarget.style.background = "var(--background-secondary, rgba(255, 255, 255, 0.05))";
                        e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.08)";
                        e.currentTarget.style.transform = "translateY(0)";
                    }
                }}>
                            <img src={h.icon} alt={h.name} style={{ width: 22, height: 22, filter: isSelected ? "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" : "grayscale(0.15)" }}/>
                            <span style={{ fontSize: "13px", fontWeight: isSelected ? 700 : 600, color: isSelected ? "#ffffff" : "var(--text-muted, #b5bac1)", letterSpacing: "0.01em" }}>
                                {h.name}
                            </span>
                        </button>);
        })}
            </div>
        </div>);
}
export default definePlugin({
    name: "HypeSquadChanger",
    description: "Change your HypeSquad house (Bravery, Brilliance, Balance) or leave HypeSquad, from the plugin settings. Uses Discord's own endpoint through the authenticated RestAPI — your token is never read.",
    authors: [Devs.Ven],
    settingsAboutComponent: HypeSquadSelectComponent
});
