/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Flex } from "@components/Flex";
import { Text } from "@webpack/common";
import { cl } from "../utils/constants";
export function SettingsSection({ title, children, className }) {
    return <Flex flexDirection="column" className={className} style={{ gap: "0.4em" }}>
        <Text className={cl("settings-header")}>
            {title}
        </Text>
        {children}
    </Flex>;
}
export function SettingsRow({ children }) {
    return <>
        <Flex flexDirection="row" style={{ gap: "0.2em", marginLeft: "0", marginRight: "0" }}>
            <Flex flexDirection="row" className={cl("first-row")}>
                {children}
            </Flex>
        </Flex>
    </>;
}
