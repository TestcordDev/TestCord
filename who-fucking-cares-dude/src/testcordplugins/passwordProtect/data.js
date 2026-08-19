/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { DataStore } from "@api/index";
import { isChannelCurrent, reloadChannel, sha256 } from "./utils";
let data = {};
const accessedChannels = [];
export async function initData() {
    const newData = await DataStore.get("passwordProtect");
    if (newData) {
        data = newData;
    }
}
export async function saveData() {
    await DataStore.set("passwordProtect", data);
}
export function isLocked(channelId) {
    if (accessedChannels.includes(channelId))
        return false;
    return isPasswordProtected(channelId);
}
export function isPasswordProtected(channelId) {
    return data?.[channelId] !== undefined;
}
export function getPasswordHash(channelId) {
    return data?.[channelId];
}
export async function setPassword(channelId, password) {
    data[channelId] = await sha256(password);
    await saveData();
}
export async function removePassword(channelId) {
    delete data[channelId];
    await saveData();
}
export async function checkPassword(input, channelId) {
    return await sha256(input) === getPasswordHash(channelId);
}
export function accessChannel(channel) {
    accessedChannels.push(channel.id);
    if (isChannelCurrent(channel.id))
        reloadChannel();
    setTimeout(() => {
        accessedChannels.splice(accessedChannels.indexOf(channel.id), 1);
    }, 1000);
}
