/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export * from "./providers";

/** @deprecated Use providers.ts directly */
import { getProvider, providerMap, providers, randomString } from "./providers";
export { getProvider, providerMap, providers, randomString };
