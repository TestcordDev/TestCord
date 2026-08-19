/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { NoEntrySignIcon } from "@components/Icons";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { Tooltip, useEffect, useState } from "@webpack/common";
import { ensureDetection, getDetectionRecord, getDetectionTtlMs, subscribeToDetection } from "./detection";
const cl = classNameFactory("vc-detect-block-");
function useBlockState(userId, passive = false) {
    const [snapshot, setSnapshot] = useState(() => ({
        userId,
        record: getDetectionRecord(userId)
    }));
    const record = snapshot.userId === userId ? snapshot.record : getDetectionRecord(userId);
    useEffect(() => {
        const syncState = () => {
            setSnapshot({
                userId,
                record: getDetectionRecord(userId)
            });
        };
        syncState();
        return subscribeToDetection(userId, syncState);
    }, [userId]);
    useEffect(() => {
        if (!record) {
            if (!passive)
                void ensureDetection(userId);
            return;
        }
        const remainingMs = record.checkedAt + getDetectionTtlMs(record.state) - Date.now();
        if (remainingMs <= 0) {
            if (!passive)
                setSnapshot({ userId });
            return;
        }
        const timeout = window.setTimeout(() => {
            if (!passive)
                setSnapshot({ userId });
        }, remainingMs);
        return () => window.clearTimeout(timeout);
    }, [record, userId]);
    return record?.state ?? "unknown";
}
export function DetectBlockBadge({ user, isMemberList, isMessage, isProfile }) {
    if (!user)
        return null;
    const state = useBlockState(user.id, isMemberList);
    if (state !== "blockedYou")
        return null;
    return (<Tooltip text="This user has blocked you.">
            {tooltipProps => (<span {...tooltipProps} className={classes(cl("indicator"), isProfile && cl("indicator-profile"), isMessage && cl("indicator-message"), isMemberList && cl("indicator-member-list"))}>
                    <NoEntrySignIcon className={cl("icon")} width={isProfile || isMemberList ? 17 : 20} height={isProfile || isMemberList ? 17 : 20}/>
                </span>)}
        </Tooltip>);
}
