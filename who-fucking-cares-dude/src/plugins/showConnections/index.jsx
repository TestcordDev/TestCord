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
import "./styles.css";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { CopyIcon, LinkIcon } from "@components/Icons";
import OpenInAppPlugin from "@plugins/openInApp";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import definePlugin from "@utils/types";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { Tooltip, useEffect, UserProfileStore, useState } from "@webpack/common";
import { VerifiedIcon } from "./VerifiedIcon";
const useLegacyPlatformType = findByCodeLazy(".TWITTER_LEGACY:");
const platforms = findByPropsLazy("isSupported", "getByUrl");
const getProfileThemeProps = findByCodeLazy(".getPreviewThemeColors", "primaryColor:");
const getSpacingPx = (spacing) => (spacing ?? 0 /* Spacing.COMPACT */) * 2 + 4;
const settings = definePluginSettings({
    iconSize: {
        type: 1 /* OptionType.NUMBER */,
        description: "Icon size (px)",
        default: 32
    },
    iconSpacing: {
        type: 4 /* OptionType.SELECT */,
        description: "Icon margin",
        default: 1 /* Spacing.COZY */,
        options: [
            { label: "Compact", value: 0 /* Spacing.COMPACT */ },
            { label: "Cozy", value: 1 /* Spacing.COZY */ }, // US Spelling :/
            { label: "Roomy", value: 2 /* Spacing.ROOMY */ }
        ]
    },
    showGithubOrgs: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show GitHub organizations the user is a member of",
        default: true
    },
    showOnModal: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show connected accounts in the full-size profile modal",
        default: true
    }
});
async function fetchGithubOrgs(username) {
    try {
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/orgs`);
        if (!res.ok)
            return [];
        return await res.json();
    }
    catch {
        return [];
    }
}
function GithubOrgIcons({ username, size, iconSrc }) {
    const [orgs, setOrgs] = useState([]);
    useEffect(() => {
        let cancelled = false;
        fetchGithubOrgs(username).then(data => {
            if (!cancelled)
                setOrgs(data);
        });
        return () => { cancelled = true; };
    }, [username]);
    if (!orgs.length)
        return null;
    return (<>
            {orgs.map(org => (<Tooltip text={org.login} key={org.login}>
                    {tooltipProps => (<a {...tooltipProps} className="vc-user-connection" href={`https://github.com/${org.login}`} target="_blank" rel="noreferrer">
                            <img src={iconSrc} alt={org.login} style={{ width: size, height: size }}/>
                        </a>)}
                </Tooltip>))}
        </>);
}
const profilePopoutComponent = ErrorBoundary.wrap((props) => (<ConnectionsComponent {...props} id={props.user.id} theme={getProfileThemeProps(props).theme}/>), { noop: true });
function ConnectionsComponent({ id, theme }) {
    const profile = UserProfileStore.getUserProfile(id);
    if (!profile)
        return null;
    const connections = profile.connectedAccounts;
    if (!connections?.length)
        return null;
    return (<Flex gap={getSpacingPx(settings.store.iconSpacing)} flexWrap="wrap">
            {connections.map(connection => <CompactConnectionComponent connection={connection} theme={theme} key={connection.id}/>)}
        </Flex>);
}
function CompactConnectionComponent({ connection, theme }) {
    const platform = platforms.get(useLegacyPlatformType(connection.type));
    const url = platform.getPlatformUserUrl?.(connection);
    const img = (<img aria-label={connection.name} src={theme === "light" ? platform.icon.lightSVG : platform.icon.darkSVG} style={{
            width: settings.store.iconSize,
            height: settings.store.iconSize
        }}/>);
    const TooltipIcon = url ? LinkIcon : CopyIcon;
    return (<>
            <Tooltip text={<span className="vc-sc-tooltip">
                        <span className="vc-sc-connection-name">{connection.name}</span>
                        {connection.verified && <VerifiedIcon />}
                        <TooltipIcon height={16} width={16} className="vc-sc-tooltip-icon"/>
                    </span>} key={connection.id}>
                {tooltipProps => url
            ? <a {...tooltipProps} className="vc-user-connection" href={url} target="_blank" rel="noreferrer" onClick={e => {
                    if (isPluginEnabled(OpenInAppPlugin.name)) {
                        // handleLink will .preventDefault() if applicable
                        OpenInAppPlugin.handleLink(e.currentTarget, e);
                    }
                }}>
                            {img}
                        </a>
            : <button {...tooltipProps} className="vc-user-connection" onClick={() => {
                    if (connection.type === "xbox") {
                        VencordNative.native.openExternal(`https://www.xbox.com/en-US/play/user/${encodeURIComponent(connection.name)}`);
                    }
                    else {
                        copyWithToast(connection.name);
                    }
                }}>
                            {img}
                        </button>}
            </Tooltip>
            {connection.type === "github" && settings.store.showGithubOrgs && (<GithubOrgIcons username={connection.name} size={settings.store.iconSize} iconSrc={theme === "light" ? platform.icon.lightSVG : platform.icon.darkSVG}/>)}
        </>);
}
export default definePlugin({
    name: "ShowConnections",
    description: "Show connected accounts in user popouts",
    tags: ["Friends", "Appearance"],
    authors: [Devs.TheKodeToad],
    settings,
    patches: [
        {
            find: "UserProfileAccountPopout",
            replacement: {
                match: /\(0,\i\.jsx\)\(\i\.A,\{user:(\i),widgets:(\i)\?\.widgets,onOpenUserProfileModal:\i\}\)/,
                replace: "$&,$self.profilePopoutComponent({user:$1,displayProfile:$2})"
            }
        },
        {
            find: ",applicationRoleConnection:",
            predicate: () => settings.store.showOnModal,
            replacement: {
                match: /\i\.length>0.{0,250}locale:\i\}\)\}\)/,
                replace: "$self.profilePopoutComponent(arguments[0]),",
            }
        },
        {
            find: ".MODAL_V2,onClose:",
            predicate: () => settings.store.showOnModal,
            replacement: {
                match: /!\i&&\(\i\|\|\i\).{0,250}profileAppConnections\}\)\}\)/,
                replace: "$self.profilePopoutComponent(arguments[0]),",
            }
        }
    ],
    profilePopoutComponent,
});
