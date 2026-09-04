/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface TestcordAdmin {
    name: string;
    id: bigint;
    github?: string;
}

export const TestcordAdmins = Object.freeze({
    x2b: {
        name: "x2b",
        id: 996137713432530976n
    },
    x2b2: {
        name: "0gfm",
        id: 209389868080562176n
    },
    nnenaza: {
        name: "nnenaza",
        id: 1485706082080002140n
    },
    mixiruri: {
        name: "mixiruri",
        id: 1467863852782850160n
    },
    xxx: {
        name: "xxx",
        id: 1491847142367822026n
    },
    kiara: {
        name: "kiara",
        id: 1501441039418785933n
    },
    DemonBoobs: {
        name: "DemonBoobs",
        id: 569582579829964850n
    },
    mixi: {
        name: "mixi",
        id: 1517005377214873672n
    },
    dxrx99: {
        name: "dxrx99",
        id: 1464279455844274188n
    },
    Aviv: {
        name: "Aviv",
        id: 752564054593110016n,
        github: "ZimbaZombie"
    }
} satisfies Record<string, TestcordAdmin>);

export const TestcordOwners = Object.freeze({
    x2b: {
        name: "x2b",
        id: 996137713432530976n
    },
    nnenaza: {
        name: "nnenaza",
        id: 1485706082080002140n
    },
    mixiruri: {
        name: "mixiruri",
        id: 1467863852782850160n
    },
    xxx: {
        name: "xxx", // vro gota banned fr
        id: 1491847142367822026n
    },
    kiara: {
        name: "kiara",
        id: 1501441039418785933n
    },
    DemonBoobs: {
        name: "DemonBoobs",
        id: 569582579829964850n
    },
    mixi: {
        name: "mixi",
        id: 1517005377214873672n
    },
    dxrx99: {
        name: "dxrx99",
        id: 1464279455844274188n
    }
} satisfies Record<string, TestcordAdmin>);

export const TestcordDevelopers = Object.freeze({
    x2b: {
        name: "x2b",
        id: 996137713432530976n
    },
    x2b2: {
        name: "0gfm",
        id: 209389868080562176n
    },
    nnenaza: {
        name: "nnenaza",
        id: 1485706082080002140n
    },
    mixiruri: {
        name: "mixiruri",
        id: 1467863852782850160n
    },
    xxx: {
        name: "xxx",
        id: 1491847142367822026n
    },
    kiara: {
        name: "kiara",
        id: 1501441039418785933n
    },
    DemonBoobs: {
        name: "DemonBoobs",
        id: 569582579829964850n
    },
    racify: {
        name: "racify",
        id: 1186067973547495498n
    },
    mixi: {
        name: "mixi",
        id: 1517005377214873672n
    },
    dxrx99: {
        name: "dxrx99",
        id: 1464279455844274188n
    },
    Aviv: {
        name: "Aviv",
        id: 752564054593110016n,
        github: "ZimbaZombie"
    },
    reid: {
        name: "reid",
        id: 1069127117247361085n
    }
} satisfies Record<string, TestcordAdmin>);

export const TestcordArtists = Object.freeze({
    grandesorciere: {
        name: "grandesorciere",
        id: 756967256180654090n
    }
} satisfies Record<string, TestcordAdmin>);

// Lookup by ID for easy access
export const TestcordAdminsById = Object.freeze(Object.fromEntries(
    Object.entries(TestcordAdmins).map(([_, v]) => [v.id.toString(), v] as const)
)) as Record<string, TestcordAdmin>;

export const TestcordOwnersById = Object.freeze(Object.fromEntries(
    Object.entries(TestcordOwners).map(([_, v]) => [v.id.toString(), v] as const)
)) as Record<string, TestcordAdmin>;

export const TestcordDevelopersById = Object.freeze(Object.fromEntries(
    Object.entries(TestcordDevelopers).map(([_, v]) => [v.id.toString(), v] as const)
)) as Record<string, TestcordAdmin>;

export const TestcordArtistsById = Object.freeze(Object.fromEntries(
    Object.entries(TestcordArtists).map(([_, v]) => [v.id.toString(), v] as const)
)) as Record<string, TestcordAdmin>;

// Check if a user ID is a testcord admin
export function isTestcordAdmin(userId: string): boolean {
    return Object.hasOwn(TestcordAdminsById, userId);
}

// Check if a user ID is a testcord owner
export function isTestcordOwner(userId: string): boolean {
    return Object.hasOwn(TestcordOwnersById, userId);
}

// Check if a user ID is a testcord developer
export function isTestcordDeveloper(userId: string): boolean {
    return Object.hasOwn(TestcordDevelopersById, userId);
}

// Check if a user ID is a testcord artist
export function isTestcordArtist(userId: string): boolean {
    return Object.hasOwn(TestcordArtistsById, userId);
}

// btw fuck me for making such stupid mistakes.
