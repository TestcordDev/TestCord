/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getGuildAcronym } from "@utils/discord";
import { ChannelStore, GuildStore, IconUtils, PresenceStore, ReadStateStore, UserStore } from "@webpack/common";

import { getSyntheticPage, isSyntheticChannelId } from "../util/pages";
import { settings } from "../util/settings";
import { activateTab, closeTab, getActiveTabId, getMRUTabs } from "../util/store";
import { Tab } from "../util/types";

let overlay: HTMLDivElement | null = null;
let listElement: HTMLDivElement | null = null;
let countElement: HTMLSpanElement | null = null;
let rowElements: HTMLDivElement[] = [];
let allTabs: Tab[] = [];
let selectedIndex = 0;
let cancelSwitch = false;

interface TabMeta {
    title: string;
    sub: string;
    isChannelSub: boolean;
    guildName: string;
    iconUrl: string | null | undefined;
    initial: string;
    isCircle: boolean;
    channelType?: "text" | "voice" | "thread";
    svgPath?: string;
    status?: string;
    mentionCount: number;
}

const HASH_SVG_PATH = "M5.887 21a.75.75 0 0 1-.738-.588l.75-3.912H2.5a.75.75 0 0 1 0-1.5h3.633l.768-4H3.5a.75.75 0 0 1 0-1.5h3.694l.75-3.912A.75.75 0 0 1 8.682 5h.738a.75.75 0 0 1 .738.588l-.75 3.912h4l.75-3.912A.75.75 0 0 1 14.896 5h.738a.75.75 0 0 1 .738.588l-.75 3.912H19.5a.75.75 0 0 1 0 1.5h-4.133l-.768 4H18a.75.75 0 0 1 0 1.5h-3.694l-.75 3.912a.75.75 0 0 1-.738.588h-.738a.75.75 0 0 1-.738-.588l.75-3.912h-4l-.75 3.912a.75.75 0 0 1-.738.588h-.738Zm3.364-5.5h4l.768-4h-4l-.768 4Z";
const VOICE_SVG_PATH = "M11.383 3.079a1 1 0 0 0-1.09.217L6 7.589H3a1 1 0 0 0-1 1v6.822a1 1 0 0 0 1 1h3l4.293 4.293a1 1 0 0 0 1.09.217A1 1 0 0 0 12 20V4a1 1 0 0 0-.617-.921ZM14 6.842a1 1 0 0 1 1.201.236 6 6 0 0 1 0 9.844 1 1 0 0 1-1.201-1.6 4 4 0 0 0 0-6.644A1 1 0 0 1 14 6.842ZM17.438 3.08a1 1 0 0 1 1.139.75 10 10 0 0 1 0 16.34 1 1 0 1 1-1.914-.58 8 8 0 0 0 0-15.18 1 1 0 0 1 .775-1.33Z";
const THREAD_SVG_PATH = "M5.75 2a.75.75 0 0 1 .75.75V4h7a1 1 0 0 1 1 1v2.25H16a1 1 0 0 1 1 1V10h2.25a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-2.25H4.5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1H5V2.75A.75.75 0 0 1 5.75 2ZM8 18.25V19h10.75v-6.5H17v1.25a1 1 0 0 1-1 1H8Zm-2.5-4.5V15h8.75V8.5H13v1.25a1 1 0 0 1-1 1H5.5Z";

const SYNTHETIC_ICONS: Record<string, string> = {
    "__friends__": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z",
    "__nitro__": "M12 2 4 9l8 13 8-13-8-7Zm0 3.3 5.4 4.7H6.6L12 5.3Z",
    "__shop__": "M4 4h2l2.68 10.39a2 2 0 0 0 1.94 1.61h7.76a2 2 0 0 0 1.94-1.61L22 6H7",
    "__quests__": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    "__activity__": "M17 6H7c-2.2 0-4 1.8-4 4v4c0 2.2 1.8 4 4 4h10c2.2 0 4-1.8 4-4v-4c0-2.2-1.8-4-4-4Zm-7 7H8v2H7v-2H5v-1h2v-2h1v2h2v1Zm6 1a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm2-3a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z",
    "__message-requests__": "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z",
    "__library__": "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6Zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Zm-1 9-2.5-1.5L14 11V4h5v7Z",
    "__discovery__": "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm2.83 12.83L6.5 17.5l2.67-8.33L17.5 6.5l-2.67 8.33Z",
    "__icymi__": "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 11h-2V7h2v6Zm0 4h-2v-2h2v2Z"
};

function getTabMeta(tab: Tab): TabMeta {
    if (isSyntheticChannelId(tab.channelId)) {
        const page = getSyntheticPage(tab.channelId);
        return {
            title: page?.label ?? "Navigation",
            sub: "DISCORD",
            isChannelSub: true,
            guildName: "Discord",
            iconUrl: null,
            initial: (page?.label ?? "N").charAt(0).toUpperCase(),
            isCircle: false,
            svgPath: SYNTHETIC_ICONS[tab.channelId] ?? "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8Z",
            mentionCount: 0
        };
    }

    const channel = ChannelStore.getChannel(tab.channelId) as any;
    const isDM = tab.guildId === "@me";

    if (!isDM) {
        const guild = GuildStore.getGuild(tab.guildId);
        const isVoice = channel?.isVoice?.();
        const isThread = channel?.isThread?.();
        const title = channel?.name ?? "channel";
        const sub = isThread
            ? "THREAD"
            : (isVoice ? "VOICE CHANNEL" : "TEXT CHANNEL");
        const guildName = guild?.name ?? "Server";
        const initial = guild ? getGuildAcronym(guild) : "#";
        const mentionCount = settings.store.showUnreadBadges ? (ReadStateStore.getMentionCount?.(tab.channelId) ?? 0) : 0;

        return {
            title,
            sub,
            isChannelSub: true,
            guildName,
            iconUrl: null,
            initial,
            isCircle: false,
            channelType: isThread ? "thread" : (isVoice ? "voice" : "text"),
            mentionCount
        };
    }

    // Direct message / Group DM
    if (channel?.isGroupDM?.() || channel?.isMultiUserDM?.()) {
        const title = channel?.name || "Group DM";
        const sub = `${channel?.recipients?.length ?? 0} MEMBERS`;
        const guildName = "Group DM";
        const iconUrl = channel?.icon
            ? `https://${window.GLOBAL_ENV.CDN_HOST}/channel-icons/${channel.id}/${channel.icon}.webp?size=48`
            : null;
        const mentionCount = settings.store.showUnreadBadges ? (ReadStateStore.getMentionCount?.(tab.channelId) ?? 0) : 0;

        return {
            title,
            sub,
            isChannelSub: true,
            guildName: "",
            iconUrl,
            initial: title.charAt(0).toUpperCase() || "G",
            isCircle: false,
            mentionCount
        };
    }

    const recipientId = channel?.getRecipientId?.() ?? channel?.recipients?.[0] ?? channel?.rawRecipients?.[0]?.id;
    const user = recipientId ? UserStore.getUser(recipientId) : null;
    const displayName = settings.store.useDisplayNames ? (user?.globalName || user?.username) : (user?.username || user?.globalName);
    const title = displayName || "Direct Message";
    const sub = user?.username ? user.username : "";
    const iconUrl = user ? IconUtils.getUserAvatarURL(user, true, 48) : null;
    const initial = title.charAt(0).toUpperCase() || "@";
    const mentionCount = settings.store.showUnreadBadges ? (ReadStateStore.getMentionCount?.(tab.channelId) ?? 0) : 0;
    const status = recipientId ? (PresenceStore?.getStatus?.(recipientId) ?? "offline") : undefined;

    return {
        title,
        sub,
        isChannelSub: false,
        guildName: "",
        iconUrl,
        initial,
        isCircle: true,
        status,
        mentionCount
    };
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(tagName: K, text: string, className?: string) {
    const el = document.createElement(tagName);
    el.textContent = text;
    if (className) el.className = className;
    return el;
}

function createTabIcon(meta: TabMeta) {
    const wrap = document.createElement("div");
    wrap.className = "tc-chrometabs-switcher-icon-wrap";

    // Text / Voice / Thread Channel SVG (matching Screenshot 1 row 5 & 6)
    if (meta.channelType) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("class", "tc-chrometabs-switcher-hash-icon");

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const d = meta.channelType === "voice"
            ? VOICE_SVG_PATH
            : (meta.channelType === "thread" ? THREAD_SVG_PATH : HASH_SVG_PATH);
        path.setAttribute("d", d);
        path.setAttribute("fill", "currentColor");
        svg.appendChild(path);
        wrap.appendChild(svg);
        return wrap;
    }

    if (meta.iconUrl) {
        const img = document.createElement("img");
        img.className = `tc-chrometabs-switcher-icon-img ${meta.isCircle ? "tc-chrometabs-switcher-icon-circle" : "tc-chrometabs-switcher-icon-guild"}`;
        img.src = meta.iconUrl;
        img.alt = "";
        wrap.appendChild(img);

        if (meta.status) {
            const dot = document.createElement("div");
            dot.className = `tc-chrometabs-switcher-status-dot status-${meta.status}`;
            wrap.appendChild(dot);
        }
        return wrap;
    }

    if (meta.svgPath) {
        const iconDiv = document.createElement("div");
        iconDiv.className = "tc-chrometabs-switcher-icon-glyph";

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "18");
        svg.setAttribute("height", "18");
        svg.setAttribute("fill", "currentColor");

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", meta.svgPath);
        svg.appendChild(path);
        iconDiv.appendChild(svg);
        wrap.appendChild(iconDiv);
        return wrap;
    }

    const acronym = createTextElement("div", meta.initial, "tc-chrometabs-switcher-icon-acronym");
    wrap.appendChild(acronym);
    return wrap;
}

export function isChromeTabSwitcherOpen(): boolean {
    return overlay !== null;
}

export function removeChromeTabSwitcher() {
    overlay?.remove();
    overlay = null;
    listElement = null;
    countElement = null;
    rowElements = [];
    allTabs = [];
    selectedIndex = 0;
    cancelSwitch = false;
}

export function finishChromeTabSwitcher() {
    if (!overlay) return;

    const selected = allTabs[selectedIndex];
    const shouldNavigate = !cancelSwitch && selected && selected.id !== getActiveTabId();

    removeChromeTabSwitcher();
    if (shouldNavigate) {
        activateTab(selected.id);
    }
}

export function cancelChromeTabSwitcher() {
    if (!overlay) return;
    cancelSwitch = true;
    removeChromeTabSwitcher();
}

function updateSelectedRow() {
    for (let i = 0; i < rowElements.length; i++) {
        rowElements[i].classList.toggle("tc-chrometabs-switcher-row-selected", i === selectedIndex);
    }
    const selected = rowElements[selectedIndex];
    if (selected) {
        requestAnimationFrame(() => selected.scrollIntoView({ block: "nearest" }));
    }
}

function renderRows() {
    if (!listElement) return;
    listElement.replaceChildren();
    rowElements = [];

    if (allTabs.length === 0) {
        const empty = createTextElement("div", "No open tabs.", "tc-chrometabs-switcher-empty");
        listElement.appendChild(empty);
        return;
    }

    for (let i = 0; i < allTabs.length; i++) {
        const tab = allTabs[i];
        const meta = getTabMeta(tab);

        const row = document.createElement("div");
        row.className = `tc-chrometabs-switcher-row${i === selectedIndex ? " tc-chrometabs-switcher-row-selected" : ""}`;

        row.onmouseenter = () => {
            selectedIndex = i;
            updateSelectedRow();
        };

        row.onmousedown = event => {
            event.preventDefault();
            event.stopPropagation();
            removeChromeTabSwitcher();
            activateTab(tab.id);
        };

        // Icon (Left)
        row.appendChild(createTabIcon(meta));

        // Center Content: Title + Subtitle
        const content = document.createElement("div");
        content.className = "tc-chrometabs-switcher-row-content";

        const nameEl = createTextElement("span", meta.title, "tc-chrometabs-switcher-row-name");
        content.appendChild(nameEl);

        if (meta.sub) {
            const subEl = createTextElement(
                "span",
                meta.sub,
                `tc-chrometabs-switcher-row-sub${meta.isChannelSub ? " tc-sub-channel" : ""}`
            );
            content.appendChild(subEl);
        }

        row.appendChild(content);

        // Right Content: Guild Name, Mention Badge, Close Button
        const rightWrap = document.createElement("div");
        rightWrap.className = "tc-chrometabs-switcher-row-right";

        if (meta.guildName) {
            const guildEl = createTextElement("span", meta.guildName, "tc-chrometabs-switcher-row-guild");
            rightWrap.appendChild(guildEl);
        }

        if (meta.mentionCount > 0) {
            const badge = createTextElement(
                "div",
                meta.mentionCount > 99 ? "99+" : String(meta.mentionCount),
                "tc-chrometabs-switcher-unread"
            );
            rightWrap.appendChild(badge);
        }

        if (allTabs.length > 1) {
            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className = "tc-chrometabs-switcher-close-btn";
            closeBtn.textContent = "\u00d7";
            closeBtn.title = "Close tab";
            closeBtn.onmousedown = event => {
                event.preventDefault();
                event.stopPropagation();
                closeTab(tab.id);
                allTabs = allTabs.filter(t => t.id !== tab.id);
                if (allTabs.length <= 1) {
                    removeChromeTabSwitcher();
                    return;
                }
                if (countElement) {
                    countElement.textContent = `${allTabs.length} tabs`;
                }
                selectedIndex = Math.min(selectedIndex, allTabs.length - 1);
                renderRows();
            };
            rightWrap.appendChild(closeBtn);
        }

        row.appendChild(rightWrap);
        rowElements.push(row);
        listElement.appendChild(row);
    }

    updateSelectedRow();
}

function createOverlay() {
    overlay = document.createElement("div");
    overlay.className = "tc-chrometabs-switcher-overlay";
    overlay.onmousedown = event => {
        if (event.target === overlay) cancelChromeTabSwitcher();
    };

    const shell = document.createElement("div");
    shell.className = "tc-chrometabs-switcher-shell";
    shell.onmousedown = event => event.stopPropagation();

    // Clean Header: "Open Tabs" + tab count
    const header = document.createElement("div");
    header.className = "tc-chrometabs-switcher-header";

    const title = createTextElement("span", "Open Tabs", "tc-chrometabs-switcher-title");
    header.appendChild(title);

    countElement = createTextElement("span", `${allTabs.length} tabs`, "tc-chrometabs-switcher-count");
    header.appendChild(countElement);

    shell.appendChild(header);

    // Tab Rows List
    listElement = document.createElement("div");
    listElement.className = "tc-chrometabs-switcher-list";
    listElement.onwheel = event => {
        if (!listElement) return;
        const canScrollDown = listElement.scrollTop + listElement.clientHeight < listElement.scrollHeight - 1;
        const canScrollUp = listElement.scrollTop > 0;
        const wantsDown = event.deltaY > 0;
        if ((wantsDown && canScrollDown) || (!wantsDown && canScrollUp)) return;
        event.preventDefault();
        cycleChromeTabSwitcher(wantsDown ? 1 : -1);
    };
    shell.appendChild(listElement);

    // Clean Subtle Footer: <kbd>Tab</kbd> cycle • <kbd>Release Ctrl</kbd> switch • <kbd>Esc</kbd> cancel
    const footer = document.createElement("div");
    footer.className = "tc-chrometabs-switcher-footer";

    const leftHint = document.createElement("div");
    leftHint.className = "tc-chrometabs-switcher-hint";

    const kbdTab = createTextElement("kbd", "Tab", "tc-chrometabs-switcher-kbd");
    const txtTab = createTextElement("span", "cycle");
    const dot = createTextElement("span", "•", "tc-chrometabs-switcher-dot-sep");
    const kbdRel = createTextElement("kbd", "Release Ctrl", "tc-chrometabs-switcher-kbd");
    const txtRel = createTextElement("span", "switch");

    leftHint.append(kbdTab, txtTab, dot, kbdRel, txtRel);
    footer.appendChild(leftHint);

    const rightHint = document.createElement("div");
    rightHint.className = "tc-chrometabs-switcher-hint";
    const kbdEsc = createTextElement("kbd", "Esc", "tc-chrometabs-switcher-kbd");
    const txtEsc = createTextElement("span", "cancel");
    rightHint.append(kbdEsc, txtEsc);
    footer.appendChild(rightHint);

    shell.appendChild(footer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);

    renderRows();
}

export function cycleChromeTabSwitcher(direction: 1 | -1) {
    if (!overlay) {
        allTabs = getMRUTabs(settings.store.ctrlTabOrder as "mru" | "strip");
        if (allTabs.length < 2) return;

        selectedIndex = direction === 1 ? 1 : allTabs.length - 1;
        cancelSwitch = false;
        createOverlay();
    } else {
        if (allTabs.length === 0) return;
        selectedIndex = (selectedIndex + direction + allTabs.length) % allTabs.length;
        updateSelectedRow();
    }
}

export function handleSwitcherKeyDown(event: KeyboardEvent): boolean {
    if (event.key === "Escape") {
        if (!overlay) return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        cancelChromeTabSwitcher();
        return true;
    }

    if (overlay && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        finishChromeTabSwitcher();
        return true;
    }

    if (overlay) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            cycleChromeTabSwitcher(1);
            return true;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            cycleChromeTabSwitcher(-1);
            return true;
        }
    }

    if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== "Tab") return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    cycleChromeTabSwitcher(event.shiftKey ? -1 : 1);
    return true;
}

export function handleSwitcherKeyUp(event: KeyboardEvent): boolean {
    if (event.key !== "Control" || !overlay) return false;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    finishChromeTabSwitcher();
    return true;
}
