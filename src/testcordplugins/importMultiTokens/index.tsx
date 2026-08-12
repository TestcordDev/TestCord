/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Flex } from "@components/Flex";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Button, React, Text, TextArea } from "@webpack/common";
import { showToast, Toasts } from "@webpack/common";

const settings = definePluginSettings({
    importToTokenLogin: {
        type: OptionType.BOOLEAN,
        description: "Import tokens to Token Login Manager",
        default: true
    }
});

function parseTokens(input: string): Array<{ userId: string; token: string; }> {
    const cleaned = input.trim();
    if (!cleaned) return [];

    const tokens: Array<{ userId: string; token: string; }> = [];
    const seen = new Set<string>();

    const addToken = (raw: string) => {
        const t = raw.trim().replace(/^["']|["']$/g, "");
        if (t && !seen.has(t)) {
            seen.add(t);
            tokens.push({ userId: t.split(".")[0] ?? "Unknown", token: t });
        }
    };

    // Try 3-line format first (userId, blank, token)
    const lines = cleaned.split("\n");
    let matched3Line = false;
    if (lines.length >= 3) {
        const threeLineTokens: Array<{ userId: string; token: string; }> = [];
        const threeLineSeen = new Set<string>();
        for (let i = 0; i < lines.length; i += 3) {
            const userId = lines[i]?.trim();
            const token = lines[i + 2]?.trim().replace(/^["']|["']$/g, "");
            if (userId && token && !threeLineSeen.has(token)) {
                threeLineSeen.add(token);
                threeLineTokens.push({ userId, token });
            }
        }
        if (threeLineTokens.length > 0) {
            matched3Line = true;
            return threeLineTokens;
        }
    }

    // Comma-separated
    if (!matched3Line && cleaned.includes(",")) {
        const parts = cleaned.split(",");
        for (const part of parts) {
            addToken(part);
        }
        if (tokens.length > 0) return tokens;
    }

    // Newline-separated (one token per line)
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) addToken(trimmed);
    }

    return tokens;
}

const ImportMultiTokensComponent = () => {
    const [input, setInput] = React.useState("");
    const [importing, setImporting] = React.useState(false);

    const handleImport = async () => {
        if (!input.trim()) {
            showToast("Please paste token data", Toasts.Type.FAILURE);
            return;
        }

        setImporting(true);
        try {
            const tokens = parseTokens(input);

            if (tokens.length === 0) {
                showToast("No valid tokens found", Toasts.Type.FAILURE);
                setImporting(false);
                return;
            }

            if (settings.store.importToTokenLogin) {
                const tokenLoginPlugin = Vencord.Plugins.plugins.TokenLoginManager;
                if ((tokenLoginPlugin as any)?.tokenLoginManager) {
                    for (const { userId, token } of tokens) {
                        (tokenLoginPlugin as any).tokenLoginManager.addAccount({
                            username: `User ${userId}`,
                            token
                        });
                    }
                    showToast(`Imported ${tokens.length} token(s) to Token Login Manager`, Toasts.Type.SUCCESS);
                } else {
                    showToast("Token Login Manager not available", Toasts.Type.FAILURE);
                }
            }

            setInput("");
        } catch (error) {
            showToast("Import failed: " + error, Toasts.Type.FAILURE);
        } finally {
            setImporting(false);
        }
    };

    return (
        <div style={{ padding: "16px" }}>
            <Text variant="heading-lg/semibold" style={{ marginBottom: "12px" }}>
                Import Multiple Tokens
            </Text>
            <Text variant="text-sm/normal" style={{ marginBottom: "16px", color: "var(--text-muted)" }}>
                Supported formats: comma-separated, one per line, or 3-line format (userId, blank, token)
            </Text>
            <TextArea
                placeholder="tokens from your local storage > tokens;"
                value={input}
                onChange={setInput}
                rows={10}
                style={{ marginBottom: "12px", fontFamily: "monospace" }}
            />
            <Flex style={{ gap: "8px" }}>
                <Button
                    color={Button.Colors.BRAND}
                    onClick={handleImport}
                    disabled={importing || !input.trim()}
                >
                    {importing ? "Importing..." : "Import Tokens"}
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    onClick={() => setInput("")}
                    disabled={!input.trim()}
                >
                    Clear
                </Button>
            </Flex>
        </div>
    );
};

export default definePlugin({
    name: "ImportMultiTokens",
    description: "Import multiple user tokens into Token Login Manager",
    authors: [TestcordDevs.x2b],
    tags: ["Utility"],
    settings,

    settingsAboutComponent: () => <ImportMultiTokensComponent />
});
