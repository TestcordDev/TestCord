/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";
import { DateUtils, Timestamp } from "@webpack/common";
const MessageClasses = findCssClassesLazy("separator", "latin24CompactTimeStamp");
function Sep(props) {
    return <i className={MessageClasses.separator} aria-hidden={true} {...props}/>;
}
function ReplyTimestamp({ referencedMessage, baseMessage, }) {
    if (referencedMessage.state !== 0 /* ReferencedMessageState.LOADED */)
        return null;
    const refTimestamp = referencedMessage.message.timestamp;
    const baseTimestamp = baseMessage.timestamp;
    return (<Timestamp className="vc-reply-timestamp" compact={DateUtils.isSameDay(refTimestamp, baseTimestamp)} timestamp={refTimestamp} isInline={false}>
            <Sep>[</Sep>
            {DateUtils.isSameDay(refTimestamp, baseTimestamp)
            ? DateUtils.dateFormat(refTimestamp, "LT")
            : DateUtils.calendarFormat(refTimestamp)}
            <Sep>]</Sep>
        </Timestamp>);
}
export default definePlugin({
    name: "ReplyTimestamp",
    description: "Shows a timestamp on replied-message previews",
    tags: ["Chat", "Appearance"],
    authors: [Devs.Kyuuhachi],
    patches: [
        {
            // Same find as in ValidReply
            find: "#{intl::REPLY_QUOTE_MESSAGE_NOT_LOADED}",
            replacement: {
                match: /\.onClickReply,.+?}\),(?=\i,\i,\i\])/,
                replace: "$&$self.ReplyTimestamp(arguments[0]),"
            }
        }
    ],
    ReplyTimestamp: ErrorBoundary.wrap(ReplyTimestamp, { noop: true }),
});
