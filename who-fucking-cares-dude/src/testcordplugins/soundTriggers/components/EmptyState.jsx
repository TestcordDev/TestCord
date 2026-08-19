/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Card } from "@components/Card";
import { Text } from "@webpack/common";
export function EmptyState(props) {
    return (<Card style={{ padding: "36px", display: "flex", justifyContent: "center" }}>
            <Text>{props.text}</Text>
        </Card>);
}
