/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { openPluginModal } from "@components/settings/tabs/plugins/PluginModal";
import { ModalContent, ModalFooter, ModalRoot, openModal } from "@utils/modal";
import { React } from "@webpack/common";
import Plugins from "~plugins";
function ApiKeyWarningModal({ pluginName, onClose }) {
    return (<ModalRoot transitionState={1} size="small">
            <ModalContent style={{ padding: "24px 20px 8px" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
                    <svg width={40} height={40} viewBox="0 0 24 24" fill="none">
                        <path fill="var(--status-warning)" d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/>
                    </svg>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
                        Clé API requise
                    </div>
                    <div style={{ fontSize: 14, color: "#fff", lineHeight: 1.5 }}>
                        <strong style={{ color: "#fff" }}>{pluginName}</strong> nécessite une clé API Groq pour fonctionner.
                        <br /><br />
                        Configure-la une seule fois dans les paramètres de <strong style={{ color: "#fff" }}>TestcordAI</strong>.
                    </div>
                </div>
            </ModalContent>
            <ModalFooter style={{ display: "flex", justifyContent: "center", gap: 8, padding: "12px 20px 20px" }}>
                <button style={{
            background: "var(--brand-experiment)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
        }} onClick={() => {
            onClose();
            const plugin = Plugins.TestcordAI;
            if (plugin)
                openPluginModal(plugin);
        }}>
                    Configurer TestcordAI
                </button>
                <button style={{
            background: "var(--background-modifier-hover)",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            padding: "8px 16px",
            fontSize: 14,
            cursor: "pointer",
        }} onClick={onClose}>
                    Annuler
                </button>
            </ModalFooter>
        </ModalRoot>);
}
export function showApiKeyWarning(pluginName) {
    openModal(props => (<ApiKeyWarningModal pluginName={pluginName} onClose={props.onClose}/>));
}
