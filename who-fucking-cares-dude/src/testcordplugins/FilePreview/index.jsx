/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { addMessagePopoverButton, removeMessagePopoverButton } from "@api/MessagePopover";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Toasts } from "@webpack/common";
const googleExtensions = ["pdf"];
const officeExtensions = ["ppt", "pptx", "doc", "docx", "xls", "xlsx", "odt"];
const objectExtensions = ["stl", "obj", "vf", "vsj", "vsb", "3mf"];
const googleViewer = (url) => `https://drive.google.com/viewerng/viewer?embedded=true&url=${encodeURIComponent(url)}`;
const officeViewer = (url) => `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(url)}`;
const objectViewer = (url) => `https://www.viewstl.com/?embedded&url=${encodeURIComponent(url)}`;
const FileViewerIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 5c-7.633 0-11 7-11 7s3.367 7 11 7 11-7 11-7-3.367-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>
    </svg>);
const settings = definePluginSettings({
    forceGoogleProvider: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Force using Google Docs Viewer for all supported files.",
        default: false,
    },
});
export default definePlugin({
    name: "FileViewer",
    description: "View PDF and Office files directly inside Discord messages.",
    tags: ["Media", "Utility"],
    authors: [
        { name: "AGreenPig", id: 427179231164760066n },
        TestcordDevs.x2b
    ],
    settings,
    start() {
        addMessagePopoverButton("FileViewer", (msg) => {
            const attachments = msg.attachments ?? [];
            if (attachments.length === 0)
                return;
            const file = attachments[0];
            const url = file.url?.toLowerCase();
            if (!url)
                return;
            const isGoogle = googleExtensions.some(ext => url.endsWith(ext));
            const isOffice = officeExtensions.some(ext => url.endsWith(ext));
            const isObject = objectExtensions.some(ext => url.endsWith(ext));
            if (!isGoogle && !isOffice && !isObject)
                return;
            const tooBig = file.size > 10485760; // 10 MB
            const viewUrl = isObject
                ? objectViewer(file.url)
                : settings.store.forceGoogleProvider || isGoogle
                    ? googleViewer(file.url)
                    : officeViewer(file.url);
            return {
                label: "Preview File",
                icon: FileViewerIcon,
                message: msg,
                onClick: () => {
                    const iframe = document.createElement("iframe");
                    iframe.src = viewUrl;
                    iframe.style.width = "90%";
                    iframe.style.height = "70vh";
                    iframe.style.border = "none";
                    iframe.style.borderRadius = "8px";
                    iframe.style.display = "block";
                    iframe.style.margin = "2em auto";
                    iframe.className = "eqc-fileviewer";
                    const modal = document.createElement("div");
                    modal.style.position = "fixed";
                    modal.style.top = "0";
                    modal.style.left = "0";
                    modal.style.width = "100%";
                    modal.style.height = "100%";
                    modal.style.background = "rgba(0,0,0,0.7)";
                    modal.style.zIndex = "9999";
                    modal.onclick = () => modal.remove();
                    modal.appendChild(iframe);
                    document.body.appendChild(modal);
                    if (tooBig) {
                        Toasts.show({
                            id: Toasts.genId(),
                            message: "Warning: File is over 10MB. The preview may fail to load.",
                            type: "FAILURE",
                        });
                    }
                },
            };
        }, FileViewerIcon);
    },
    stop() {
        removeMessagePopoverButton("FileViewer");
    },
});
