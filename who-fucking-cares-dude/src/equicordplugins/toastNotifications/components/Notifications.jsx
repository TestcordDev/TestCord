/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { settings as PluginSettings } from "@equicordplugins/toastNotifications/index";
import { createRoot } from "@webpack/common";
import NotificationComponent from "./NotificationComponent";
let NotificationQueue = [];
let notificationID = 0;
let RootContainer;
let ToastContainer;
function getNotificationContainer() {
    // If the root container doesn't exist, create it.
    if (!RootContainer) {
        ToastContainer = document.createElement("div");
        ToastContainer.id = "vc-toast-notifications-container";
        document.body.append(ToastContainer);
        RootContainer = createRoot(ToastContainer);
    }
    // Keep the container's position class in sync with the user's setting.
    if (ToastContainer) {
        ToastContainer.className = `vc-toast-notifications-position-${PluginSettings.store.position ?? "bottom-left"}`;
    }
    return RootContainer;
}
export function setContainerPosition(position) {
    if (ToastContainer)
        ToastContainer.className = `vc-toast-notifications-position-${position ?? "bottom-left"}`;
}
export async function showNotification(notification) {
    const root = getNotificationContainer();
    const thisNotificationID = notificationID++;
    return new Promise(resolve => {
        const ToastNotification = (<NotificationComponent key={thisNotificationID.toString()} {...notification} onClose={() => {
                NotificationQueue = NotificationQueue.filter(n => n.key !== thisNotificationID.toString());
                notification.onClose?.();
                root.render(<>{NotificationQueue}</>);
                resolve();
            }}/>);
        // Push this notification into the stack.
        NotificationQueue.push(ToastNotification);
        // If the queue exceeds the maximum number of notifications, remove the oldest one.
        if (NotificationQueue.length > PluginSettings.store.maxNotifications)
            NotificationQueue.shift();
        root.render(<>{NotificationQueue}</>);
    });
}
/**
 * Tears down the notification root and removes the container from the DOM.
 * Called when the plugin is disabled.
 */
export function teardownNotifications() {
    NotificationQueue = [];
    RootContainer?.unmount();
    RootContainer = undefined;
    ToastContainer?.remove();
    ToastContainer = undefined;
}
