/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const LANGUAGE_ICON_MAP = {
    "c++": "cplusplus",
    "c#": "csharp",
    "f#": "fsharp",
    "q#": "qsharp",
    "objective-c": "objectivec",
    "visual basic": "visualbasic",
    "shell": "bash",
    "batchfile": "bash",
    "vim script": "vim",
    "dockerfile": "docker",
    "gdscript": "godot",
    "html": "html5",
};
export function getLanguageIconUrl(language) {
    if (!language)
        return "https://cdn.jsdelivr.net/gh/devicons/devicon@develop/icons/github/github-original.svg";
    const normalized = LANGUAGE_ICON_MAP[language.toLowerCase()] ?? language.toLowerCase().replace(/\s+/g, "");
    return `https://cdn.jsdelivr.net/gh/devicons/devicon@develop/icons/${normalized}/${normalized}-original.svg`;
}
export const PERSONAL_GROUP_KEY = "__personal__";
export function buildRepoGroups(username, personalRepos, orgs, orgRepos, avatarUrl) {
    const groups = [];
    if (personalRepos.length) {
        groups.push({ key: PERSONAL_GROUP_KEY, label: username, avatarUrl, repos: personalRepos });
    }
    for (const org of orgs) {
        const repos = orgRepos[org.login];
        if (repos?.length) {
            groups.push({ key: org.login, label: org.login, avatarUrl: org.avatar_url, repos });
        }
    }
    return groups;
}
export function sortGroups(groups, mode) {
    const personal = groups.find(g => g.key === PERSONAL_GROUP_KEY);
    const rest = groups.filter(g => g.key !== PERSONAL_GROUP_KEY);
    const sorted = [...rest].sort((a, b) => {
        return mode === "alpha"
            ? a.label.localeCompare(b.label)
            : b.repos.length - a.repos.length;
    });
    return personal ? [personal, ...sorted] : sorted;
}
