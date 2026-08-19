/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { SKU_ID } from "@plugins/decor/lib/constants";
export function decorationToAsset(decoration) {
    return `${decoration.animated ? "a_" : ""}${decoration.hash}`;
}
export function decorationToAvatarDecoration(decoration) {
    return { asset: decorationToAsset(decoration), skuId: SKU_ID };
}
