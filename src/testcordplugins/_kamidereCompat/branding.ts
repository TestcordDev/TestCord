/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const BRAND_NAME = "Illegalcord";

const brandIconSvg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">',
    '<rect width="128" height="128" rx="28" fill="#1f2230"/>',
    '<path d="M34 28h16v72H34zM78 28h16v72H78zM50 56h28v16H50z" fill="#f1f4ff"/>',
    '<circle cx="64" cy="64" r="50" fill="none" stroke="#5865f2" stroke-width="8"/>',
    "</svg>",
].join("");

export const BRAND_ICON_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(brandIconSvg)}`;
