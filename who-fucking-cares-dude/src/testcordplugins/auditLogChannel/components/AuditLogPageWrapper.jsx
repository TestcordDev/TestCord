/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useAwaiter } from "@utils/react";
import { extractAndLoadChunksLazy, findByPropsLazy } from "@webpack";
import AuditLogPage from "./AuditLogPage";
const loadClassesRegex = /(?:(?:Promise\.all\(\[)?([A-Za-z_$][\w$]*\.e\("?[^)]+?"?\)[^\]]*?)(?:\]\))?|Promise\.resolve\(\))\.then\([A-Za-z_$][\w$]*\.bind\([A-Za-z_$][\w$]*,"?([^)]+?)"?\)\)(?=.{0,30}"ChannelsAndRolesPage")/;
const loadClasses = extractAndLoadChunksLazy(['"ChannelsAndRolesPage"'], loadClassesRegex);
const loaderClasses = findByPropsLazy("loader", "fullWidth");
const { Spinner } = findByPropsLazy("Spinner");
export default function AuditLogPageWrapper(props) {
    const [success, , pending] = useAwaiter(async () => {
        await loadClasses();
        return true;
    });
    return !success || pending ? <div className={loaderClasses.loader}>
        <Spinner />
    </div> : <AuditLogPage {...props}/>;
}
