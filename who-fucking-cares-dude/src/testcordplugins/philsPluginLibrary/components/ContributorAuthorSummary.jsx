/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { Flex } from "@components/Flex";
import { Text } from "@webpack/common";
import React from "react";
import { AuthorUserSummaryItem } from "../../philsPluginLibrary/components/AuthorSummaryItem";
import { openURL } from "../../philsPluginLibrary/utils";
export const ContributorAuthorSummary = ({ author, contributors }) => {
    return (<Flex style={{ gap: "0.7em" }}>
            {author &&
            <Flex style={{ justifyContent: "center", alignItems: "center", gap: "0.5em" }}>
                    <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                        Author: <a onClick={() => author.github && openURL(author.github)}>{`${author.name}`}</a>
                    </Text>
                    <AuthorUserSummaryItem authors={[author]}/>
                </Flex>}
            {(contributors && contributors.length > 0) &&
            <Flex style={{ justifyContent: "center", alignItems: "center", gap: "0.5em" }}>
                    <Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                        Contributors:
                    </Text>
                    <AuthorUserSummaryItem authors={contributors}/>
                </Flex>}
        </Flex>);
};
