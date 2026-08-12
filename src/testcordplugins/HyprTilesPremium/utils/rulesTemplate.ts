/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const defaultRulesTemplate = `// HyprTiles rules file
// Supports comments and trailing commas.
{
  autoLayouts: [
    { minTiles: 1, layout: "single" },
    { minTiles: 2, layout: "columns" },
    { minTiles: 3, layout: "dwindle" },
    { minTiles: 6, layout: "grid" },
  ],

  backgroundThrottleMinutes: 5,

  rules: [
    {
      name: "Keep DMs together",
      priority: 10,
      match: { type: ["dm", "groupDm"] },
      actions: { workspace: 2, focus: true },
    },
    {
      name: "Forum threads open beside current tile",
      match: { type: "thread" },
      actions: { split: "right", focus: true },
    },
    {
      name: "Announcements stay in a tab group",
      match: { type: "announcement" },
      actions: { workspace: 3, tabGroup: "announcements", focus: false },
    },
    {
      name: "Voice channels float",
      match: { type: ["voice", "stage"] },
      actions: { float: true, focus: true },
    },
    {
      name: "Private threads become a scratchpad",
      match: { isThread: true, isPrivate: true },
      actions: { scratchpadId: "private-thread", focus: false },
    },
    {
      name: "Support channels replace the focused slot",
      match: { channelName: { regex: "^support$", flags: "i" } },
      actions: { replace: true, focus: true },
    },
    {
      name: "NSFW stays isolated",
      match: { isNSFW: true },
      actions: { workspace: 4, layoutHint: "columns", focus: false },
    },
    {
      name: "Drag drops split downward",
      match: { openedBy: "dragDrop" },
      actions: { split: "down", focus: true },
    },
  ],
}
`;
