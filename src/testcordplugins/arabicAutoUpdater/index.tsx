/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Devs } from "@utils/constants";
import { t } from "@utils/testcordI18n";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Alerts } from "@webpack/common";

import gitHash from "~git-hash";

const logger = new Logger("ArabicAutoUpdater");
const REPO = "LOSTSTR/Testcord";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const SEEN_KEY = "testcord-last-seen-update";

let checked = false;

async function checkForUpdate() {
    if (checked) return;
    checked = true;

    try {
        const res = await fetch(API_URL, {
            headers: { Accept: "application/vnd.github+json" }
        });
        if (!res.ok) return;

        const data = await res.json();
        // The release tag is static (v1.0.0-stable); the real commit hash lives in
        // the release title "Testcord <hash>" — same source the in-client updater reads.
        const releaseName: string = data.name ?? "";
        const remoteHash = releaseName.slice(releaseName.lastIndexOf(" ") + 1);

        if (!remoteHash || remoteHash === gitHash) return;

        // Migrate old localStorage value to DataStore on first run
        const legacyValue = localStorage.getItem(SEEN_KEY);
        if (legacyValue) {
            await DataStore.set(SEEN_KEY, legacyValue);
            localStorage.removeItem(SEEN_KEY);
        }

        const lastSeen = await DataStore.get<string>(SEEN_KEY);
        if (lastSeen === remoteHash) return;

        await DataStore.set(SEEN_KEY, remoteHash);

        Alerts.show({
            title: t("تحديث جديد متاح!", "New update available!"),
            body: (
                <>
                    <p>{t("يتوفر إصدار جديد من", "A new version of")} <strong>{t("اشراق", "Testcord")}</strong>{t(" متاح.", " is available.")}</p>
                    <p>{t("الإصدار الحالي:", "Current version:")} <code>{gitHash.slice(0, 7)}</code></p>
                    <p>{t("الإصدار الجديد:", "New version:")} <code>{remoteHash}</code></p>
                    <p>{t("هل تريد التحديث الآن؟", "Do you want to update now?")}</p>
                </>
            ),
            confirmText: t("تحديث الآن", "Update now"),
            cancelText: t("لاحقاً", "Later"),
            onConfirm() {
                VencordNative.native.openExternal(RELEASES_PAGE);
            }
        });
    } catch (e) {
        logger.error("فشل فحص التحديثات:", e);
    }
}

export default definePlugin({
    name: "ArabicAutoUpdater",
    description: "Automatically checks for Testcord updates and notifies you when a new version is available",
    authors: [Devs.thororen],
    tags: ["Utility"],

    flux: {
        async CONNECTION_OPEN() {
            await checkForUpdate();
        }
    }
});
