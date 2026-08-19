/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TestcordRequestCoordinator } from "@api/index";
import { classNameFactory, disableStyle, enableStyle } from "@api/Styles";
import { Devs, TestcordDevs } from "@utils/constants";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import { useAwaiter } from "@utils/react";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, GuildMemberCountStore, GuildMemberStore, GuildStore, PermissionsBits, PermissionStore, RelationshipStore, RestAPI, SnowflakeUtils, Text, useEffect, UserStore, useState } from "@webpack/common";
import style from "./style.css?managed";
const cl = classNameFactory("serverpruner-");
const { leaveGuild } = findByPropsLazy("deleteGuild", "leaveGuild");
function InfoWithIcon(props) {
    const { svg, children } = props;
    return (<div className={cl("infowithicon")}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d={svg}/></svg>
            <Text color="header-primary" variant="heading-md/semibold">{children}</Text>
        </div>);
}
function ServerInfoComponent(props) {
    const { server, messages, recentMessages } = props;
    const serverIcon = server?.getIconSource("256", true)?.uri;
    return (<div className={cl("modalparent")}>
            <img src={serverIcon}></img>
            <div className={cl("info")}>
                <InfoWithIcon svg={"M249.6 471.5c10.8 3.8 22.4-4.1 22.4-15.5V78.6c0-4.2-1.6-8.4-5-11C247.4 52 202.4 32 144 32C93.5 32 46.3 45.3 18.1 56.1C6.8 60.5 0 71.7 0 83.8v370.3c0 11.9 12.8 20.2 24.1 16.5C55.6 460.1 105.5 448 144 448c33.9 0 79 14 105.6 23.5m76.8 0C353 462 398.1 448 432 448c38.5 0 88.4 12.1 119.9 22.6c11.3 3.8 24.1-4.6 24.1-16.5V83.8c0-12.1-6.8-23.3-18.1-27.6C529.7 45.3 482.5 32 432 32c-58.4 0-103.4 20-123 35.6c-3.3 2.6-5 6.8-5 11V456c0 11.4 11.7 19.3 22.4 15.5"}>{server.name}</InfoWithIcon>
                <InfoWithIcon svg={"M256 0a256 256 0 1 1 0 512a256 256 0 1 1 0-512m-24 120v136c0 8 4 15.5 10.7 20l96 64c11 7.4 25.9 4.4 33.3-6.7s4.4-25.9-6.7-33.3L280 243.2V120c0-13.3-10.7-24-24-24s-24 10.7-24 24"}>{messages} total messages</InfoWithIcon>
                <InfoWithIcon svg={"M75 75L41 41C25.9 25.9 0 36.6 0 57.9V168c0 13.3 10.7 24 24 24h110.1c21.4 0 32.1-25.9 17-41l-30.8-30.8C155 85.5 203 64 256 64c106 0 192 86 192 192s-86 192-192 192c-40.8 0-78.6-12.7-109.7-34.4c-14.5-10.1-34.4-6.6-44.6 7.9s-6.6 34.4 7.9 44.6C151.2 495 201.7 512 256 512c141.4 0 256-114.6 256-256S397.4 0 256 0C185.3 0 121.3 28.7 75 75m181 53c-13.3 0-24 10.7-24 24v104c0 6.4 2.5 12.5 7 17l72 72c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-65-65V152c0-13.3-10.7-24-24-24z"}>{recentMessages} messages in the past week</InfoWithIcon>
                <InfoWithIcon svg={"m47.6 300.4l180.7 168.7c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9l180.7-168.7c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141c-45.6-7.6-92 7.3-124.6 39.9l-12 12l-12-12c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5"}>You have {RelationshipStore.getFriendIDs().filter(e => GuildMemberStore.isMember(server.id, e)).length} friends in the server</InfoWithIcon>
                <InfoWithIcon svg={"M352 256c0 22.2-1.2 43.6-3.3 64H163.4c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64h185.3c2.2 20.4 3.3 41.8 3.3 64m28.8-64h123.1c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64H380.8c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64m112.6-32H376.7c-10-63.9-29.8-117.4-55.3-151.6c78.3 20.7 142 77.5 171.9 151.6zm-149.1 0H167.7c6.1-36.4 15.5-68.6 27-94.7c10.5-23.6 22.2-40.7 33.5-51.5C239.4 3.2 248.7 0 256 0s16.6 3.2 27.8 13.8c11.3 10.8 23 27.9 33.5 51.5c11.6 26 20.9 58.2 27 94.7m-209 0H18.6c30-74.1 93.6-130.9 172-151.6c-25.5 34.2-45.3 87.7-55.3 151.6M8.1 192h123.1c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64H8.1C2.8 299.5 0 278.1 0 256s2.8-43.5 8.1-64m186.6 254.6c-11.6-26-20.9-58.2-27-94.6h176.6c-6.1 36.4-15.5 68.6-27 94.6c-10.5 23.6-22.2 40.7-33.5 51.5c-11.2 10.7-20.5 13.9-27.8 13.9s-16.6-3.2-27.8-13.8c-11.3-10.8-23-27.9-33.5-51.5zM135.3 352c10 63.9 29.8 117.4 55.3 151.6c-78.4-20.7-142-77.5-172-151.6zm358.1 0c-30 74.1-93.6 130.9-171.9 151.6c25.5-34.2 45.2-87.7 55.3-151.6h116.7z"}>{GuildMemberCountStore.getMemberCount(server.id)} total members</InfoWithIcon>
                {PermissionStore.can(PermissionsBits.ADMINISTRATOR, server) && <InfoWithIcon svg={"M309 106c11.4-7 19-19.7 19-34c0-22.1-17.9-40-40-40s-40 17.9-40 40c0 14.4 7.6 27 19 34l-57.3 114.6c-9.1 18.2-32.7 23.4-48.6 10.7L72 160c5-6.7 8-15 8-24c0-22.1-17.9-40-40-40S0 113.9 0 136s17.9 40 40 40h.7l45.7 251.4c5.5 30.4 32 52.6 63 52.6h277.2c30.9 0 57.4-22.1 63-52.6L535.3 176h.7c22.1 0 40-17.9 40-40s-17.9-40-40-40s-40 17.9-40 40c0 9 3 17.3 8 24l-89.1 71.3c-15.9 12.7-39.5 7.5-48.6-10.7z"}>You are an administrator in this server</InfoWithIcon>}
            </div>
        </div>);
}
function PruneModal(props) {
    const joinedServers = Object.values(GuildStore.getGuilds()).filter(e => e.ownerId !== UserStore.getCurrentUser().id);
    const [index, setIndex] = useState(0);
    const [messages, setMessages] = useState("");
    const [recentMessages, setRecentMessages] = useState("");
    const [waited, setWaited] = useState(false);
    function ProcessNext(shouldLeave) {
        if (shouldLeave) {
            leaveGuild(joinedServers[index].id);
        }
        if (joinedServers[index + 1]) {
            setIndex(index + 1);
            setMessages("??");
            setRecentMessages("??");
            setWaited(false);
        }
        else {
            props.onClose();
        }
    }
    useEffect(() => {
        const timer = setTimeout(() => {
            setWaited(true);
        }, 2000);
        return () => clearTimeout(timer);
    }, [index]);
    useAwaiter(async () => {
        const srv = joinedServers[index];
        if (!srv)
            return;
        const userId = UserStore.getCurrentUser().id;
        const totalUrl = `/guilds/${srv.id}/messages/search?author_id=${userId}`;
        const recentUrl = `/guilds/${srv.id}/messages/search?author_id=${userId}&min_id=${SnowflakeUtils.fromTimestamp(Date.now() - (7 * 24 * 60 * 60 * 1000))}`;
        // The two counts are independent; with the TestcordHelper network
        // optimizations on we fire them in parallel (one RTT instead of two).
        // Default stays sequential, byte-for-byte unchanged.
        if (TestcordRequestCoordinator.networkOptimizationsEnabled()) {
            const [response, recentResponse] = await Promise.all([
                RestAPI.get({ url: totalUrl }),
                RestAPI.get({ url: recentUrl }),
            ]);
            setMessages(response.body.total_results.toString());
            setRecentMessages(recentResponse.body.total_results.toString());
        }
        else {
            const response = await RestAPI.get({ url: totalUrl });
            const recentResponse = await RestAPI.get({ url: recentUrl });
            setMessages(response.body.total_results.toString());
            setRecentMessages(recentResponse.body.total_results.toString());
        }
    }, {
        deps: [index],
        fallbackValue: null
    });
    return (<ModalRoot {...props} size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader separator={false}>
                <Text color="header-primary" variant="heading-lg/semibold" tag="h1" style={{ flexGrow: 1 }}>
                    Server Prune ({index + 1}/{joinedServers.length})
                </Text>
                <ModalCloseButton onClick={props.onClose}/>
            </ModalHeader>
            <ModalContent scrollbarType="none">
                <ServerInfoComponent server={joinedServers[index]} messages={messages} recentMessages={recentMessages}/>
                <div className={cl("buttongroup")}>
                    <Button onClick={() => ProcessNext(false)} disabled={!waited} color={Button.Colors.GREEN}>Keep</Button>
                    <Button onClick={() => ProcessNext(true)} disabled={!waited} color={Button.Colors.RED}>Leave</Button>
                </div>
            </ModalContent>
        </ModalRoot>);
}
export default definePlugin({
    name: "ServerPruner",
    description: "Adds a modal to easily prune your servers with information and stats. Right click the home button!",
    tags: ["Servers", "Utility"],
    authors: [
        Devs.Samwich,
        TestcordDevs.x2b
    ],
    onContextMenu() {
        openModal(props => <PruneModal {...props}/>);
    },
    patches: [
        {
            find: ".DISCODO_DISABLED",
            replacement: {
                match: /(onMouse.*?)(onMouse)/,
                replace: "$1onContextMenu:$self.onContextMenu,$2"
            }
        }
    ],
    start() {
        enableStyle(style);
    },
    stop() {
        disableStyle(style);
    }
});
