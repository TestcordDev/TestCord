/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalContent, ModalFooter, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { PluginNative } from "@utils/types";
import { Button, React, Toasts } from "@webpack/common";

import { settings } from "../../settings";
import { safeToast } from "../../utils";
import { CordCatModal } from "./CordCatModal";

const Native = VencordNative.pluginHelpers.vAnalyzer as PluginNative<typeof import("./native")>;

export async function analyzeUserWithCordCat(userId: string, username: string): Promise<void> {
    safeToast(`Querying CordCat for ${username}...`);

    const apiKey = settings.store.cordCatApiKey;
    let result;

    if (!apiKey) {
        // sometimes cordcat returns data without an apikey, but is unreliable, for some reason the request works without the apikey
        result = await Native.queryCordCat(userId);
    } else {
        result = await Native.queryCordCat(userId, apiKey);
    }

    if (result.status !== 200) {
        safeToast(`CordCat lookup failed: HTTP ${result.status}`, Toasts.Type.FAILURE);
        return;
    }

    const { data } = result;
    const statements: any[] = data.statements ?? [];
    const breachCount: number = data.breach?.resultsCount ?? 0;

    const parts: string[] = [];
    if (statements.length > 0) parts.push(`${statements.length} sanction${statements.length !== 1 ? "s" : ""}`);
    if (breachCount > 0) parts.push(`${breachCount} breach${breachCount !== 1 ? "es" : ""}`);
    const suffix = parts.length > 0 ? ` — ${parts.join(", ")}` : "";

    const title = `CordCat: ${data.userInfo?.global_name || username}${suffix}`;

    openModal(modalProps => (
        <ModalRoot {...modalProps} size={ModalSize.MEDIUM}>
            <ModalHeader>
                <span style={{ fontWeight: 700, fontSize: 16, color: "var(--white-500, #fff)" }}>{title}</span>
            </ModalHeader>
            <ModalContent>
                <CordCatModal data={data} />
            </ModalContent>
            <ModalFooter>
                <Button onClick={modalProps.onClose}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    ));
}
