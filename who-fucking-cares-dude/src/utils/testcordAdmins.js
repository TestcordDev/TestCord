/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
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
        id: 752564054593110016n
    }
});
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
});
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
        id: 752564054593110016n
    }
});
// Lookup by ID for easy access
export const TestcordAdminsById = Object.freeze(Object.fromEntries(Object.entries(TestcordAdmins).map(([_, v]) => [v.id.toString(), v])));
export const TestcordOwnersById = Object.freeze(Object.fromEntries(Object.entries(TestcordOwners).map(([_, v]) => [v.id.toString(), v])));
export const TestcordDevelopersById = Object.freeze(Object.fromEntries(Object.entries(TestcordDevelopers).map(([_, v]) => [v.id.toString(), v])));
// Check if a user ID is a testcord admin
export function isTestcordAdmin(userId) {
    return Object.hasOwn(TestcordAdminsById, userId);
}
// Check if a user ID is a testcord owner
export function isTestcordOwner(userId) {
    return Object.hasOwn(TestcordOwnersById, userId);
}
// Check if a user ID is a testcord developer
export function isTestcordDeveloper(userId) {
    return Object.hasOwn(TestcordDevelopersById, userId);
}
// btw fuck me for making such stupid mistakes.
