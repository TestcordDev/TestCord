# Duplicate Plugins Report — Testcord 2.2.8

> Auto-generated 2026-09-09 • 799 plugins scanned across `src/plugins`, `src/equicordplugins`, `src/testcordplugins`.

## Summary

| Category | Count | Action |
|---|---|---|
| Exact `definePlugin.name` duplicates (case-insensitive) | 28 groups | Merge or alias |
| Folder-name duplicates | 15 groups | Pick canonical, deprecate other |
| Near-duplicate functional clusters (>5 plugins sharing keyword) | 18 clusters | Review overlapping purpose |

Most duplicates are **Equicord ↔ Testcord mirrors** carried over when Testcord forked Equicord, or **Vencord → Equicord → Testcord** shadows. A minority are internal Testcord self-duplicates (nested folder copies).

---

## 1. Exact `name` Duplicates (28 groups)

These share the same `name:` string in `definePlugin`. Enabling one and renaming the other bricks the saved `Settings.plugins[name]` entry — the exact problem the new stable-ID system fixes.

| Name | Locations | Notes |
|---|---|---|
| `Animalese` | `equicordplugins/animalese` • `testcordplugins/animalese` | Identical fun plugin |
| `AnonymiseFileNames` | `plugins/anonymiseFileNames` • `testcordplugins/antiMoveDeco/antiGroup/anonymiseFileNames` | Nested copy inside antiGroup |
| `AntiGroup` | `testcordplugins/antiGroup` • `testcordplugins/antiMoveDeco/antiGroup` | Self-duplicate, nested folder |
| `BetterPlusReacts` | `equicordplugins/betterPlusReacts` • `testcordplugins/betterplusreacts` | Same feature, different dir casing |
| `BlockKrisp` | `equicordplugins/blockKrisp` • `testcordplugins/vc-blockKrisp` | Krisp toggle |
| `CancelFriendRequest` | `testcordplugins/cancelFriendRequest` • `testcordplugins/createTheme/CancelFriendRequest` | Stray file inside createTheme |
| `Clyde` | `equicordplugins/voiceJoinMessages` • `testcordplugins/autoClaim` • `testcordplugins/voiceJoinMessages` | All define `name: "Clyde"` — copy-paste error? |
| `CopyStatusUrls` | `equicordplugins/copyStatusUrls` • `testcordplugins/copyStatusUrls` | |
| `CustomFolderIcons` | `equicordplugins/customFolderIcons` • `testcordplugins/customFolderIcons` | |
| `CustomSounds` | `equicordplugins/customSounds` • `testcordplugins/customSounds` | |
| `ExitSounds` | `equicordplugins/exitSounds` • `testcordplugins/vencord-ExitSounds` | |
| `FriendCodes` | `equicordplugins/friendCodes` • `testcordplugins/FriendCodes` | Casing diff only |
| `InviteDefaults` | `equicordplugins/inviteDefaults` • `testcordplugins/inviteDefaults` | |
| `MessageFetchTimer` | `equicordplugins/messageFetchTimer` • `testcordplugins/MessageFetchTimer` | |
| `ShowMessageEmbeds` | `equicordplugins/showMessageEmbeds` • `testcordplugins/vc-showMessageEmbeds` | |
| `ShowMessageEmbeds` (alias) | `equicordplugins/voiceChatUtils` • `testcordplugins/vc-voiceChatUtilities` both `name: "VoiceChatUtilities"` | Second duplicate |
| `SilentTyping` | `plugins/silentTyping` • `testcordplugins/vc-silentTypingEnhanced` both claim `SilentTyping` | Should be distinct names |
| `ToneIndicators` | `equicordplugins/toneIndicators` • `testcordplugins/toneIndicators` | |
| `UserPluginInstaller` | `equicordplugins/userpluginInstaller.dev` • `testcordplugins/userpluginInstaller` | `.dev` suffix |
| `VCPanelSettings` | `equicordplugins/vcPanelSettings` • `testcordplugins/vcpanelsettings` | Casing |
| `VoiceChatUtilities` | `equicordplugins/voiceChatUtils` • `testcordplugins/vc-voiceChatUtilities` | |
| `WaitForSlot` | `equicordplugins/waitForSlot` • `testcordplugins/waitForSlot` | |
| `BetterActivities` | `equicordplugins/betterActivities` • `testcordplugins/vc-betterActivities` | |
| `AnonymiseFileNames` (extra) | See above | — |
| `⚪` (empty) | `testcordplugins/mediaDownloader.desktop` • `testcordplugins/ytdownloader` both have parsing artifact? | Investigate |
| `RTCPeerConnection` | `testcordplugins/WebCordHardened` • `testcordplugins/goofcordsec` • `testcordplugins/webRtcLeakPrevent` | Same patch purpose |
| `User` | `testcordplugins/DiscordLock` • `testcordplugins/passcodeLock` | Generic `name: "User"` — bad |
| `Guild` (artifact) | `plugins/viewRaw` / `equicordplugins/bypassStatus` report | Parser false-positive, ignore |

> **Recommended fix**: Keep the `equicordplugins/*` version as canonical for Equicord-origin plugins, keep `testcordplugins/*` for Testcord-native ones. For true mirrors (animalese, customSounds etc.), deprecate one and add `migratePluginSettings` alias in the survivor. The stable-ID system (see §4) now lets you rename `name` without migrating settings manually.

---

## 2. Folder-Name Duplicates (15 groups)

Even when `definePlugin.name` differs, having the same folder name in two plugin roots causes confusion in `~plugins` map (keyed by `name`, but `PluginMeta.folderName` is used for UI badges) and in scripts:

```
animalese               equicordplugins/animalese  ↔  testcordplugins/animalese
betterPlusReacts        equicordplugins/...         ↔  testcordplugins/betterplusreacts
copyStatusUrls
customFolderIcons
customSounds
friendCodes
inviteDefaults
messageFetchTimer
toneIndicators
vcPanelSettings
voiceJoinMessages
waitForSlot
antiGroup (self)        testcordplugins/antiGroup  ↔  testcordplugins/antiMoveDeco/antiGroup
anonymiseFileNames
cancelFriendRequest
```

---

## 3. Functional Near-Duplicates (keyword clusters)

Plugins that **do the same thing** under different names. No name collision, but feature overlap wastes bundle size and confuses users.

### Translate (9 plugins)
`plugins/translate` • `equicordplugins/messageTranslate` • `equicordplugins/translatePlus` • `testcordplugins/TranslatePremium` • `testcordplugins/autoTranslateNightcord` • `testcordplugins/idTranslater` • `testcordplugins/nativeTranslate` • `testcordplugins/aiTranslate.desktop` • `testcordplugins/surfaceTranslate`

> **Suggestion**: Keep `translate` (Vencord) + `translatePlus` (Equicord) as full-featured. Deprecate `messageTranslate` (thin wrapper) and merge `TranslatePremium` into it. `autoTranslateNightcord` can become a setting of `translate`.

### Message Logger (5)
`plugins/messageLogger` • `equicordplugins/messageLoggerEnhanced` • `testcordplugins/messageLoggerTestcord` • `testcordplugins/ReactionLogger` • `testcordplugins/gatewayLogger` (logs gateway, not messages, but grouped)

### Voice / VC (23–29)
Includes `UserVoiceShow`, `VoiceDownload`, `VoiceMessages`, `voiceButtons`, `voiceChannelLog`, `voiceChatUtils`, `voiceRejoin`, `voiceStats`, plus Testcord `vc-*` mirrors (`vc-blockKrisp`, `vc-betterActivities`, `vc-voiceChatUtilities` etc.). Consider consolidating `voiceChatUtils` + `vc-voiceChatUtilities`.

### Fake / Spoof (12)
`FakeNitro`, `FakeProfileThemes`, `fakeProfile`, `FakeUserSwitcher`, `FakeFriends`, `FakeMuteDeafen`, `FakePerm`, `FakeVoicePremium`, `Fake Accounts`, `BadgeSpoofer`, `SpoofMsgV2`, `FakeIndicators` — all spoof identity/privileges. Could be grouped under a single "SpoofSuite" with toggles.

### Auto-* (29)
`AutoDNDWhilePlaying`, `AutoJumpToMessage`, `AutoZipper`, `IdleAutoRestart`, `AutoBump`, `AutoLanguageBlock`, `AutoMessageRepeater`, `AutoThemeSwitcher`, `AutoBan`, `AutoCorrect`, `AutoReact`, `AutoMute`, `AutoDeleter`, `AutoVaporwave`, … Huge surface. Audit for overlapping timers.

### Block / Hide / No* (14 + 6 + 54)
Heavily overlapping “hide/ block / disable” space:
- `BetterBlockedUsers` vs `ClientSideBlock` vs `BlockKeywords`
- `HideAttachments` / `HideChatButtons` / `HideMessages` / `HideServers` / `hideSoap` / `HideSuggestedChannels`
- `NoBlockedMessages` vs `NoUnblockToJump` — subtle distinction but near-duplicate.

### Copy (9)
`CopyEmojiMarkdown`, `CopyFileContents`, `CopyStickerLinks`, `CopyUserURLs`, `CopyProfileColors`, `CopyStatusUrls` (×2), `CopyUserMention`, `ProfileCopyButton` — consider a unified “CopyTools”.

### Theme (9)
`ClientTheme`, `FakeProfileThemes`, `NoProfileThemes`, `ThemeAttributes`, `quickThemeSwitcher`, `themeLibrary`, `AutoThemeSwitcher`, `ThemeStore`, `CreateTheme` — theme management is fragmented.

### Other notable clusters
- **Better*** (27) — “betterX” is the most used prefix; many are quality-of-life tweaks that could be merged into `BetterDiscord`-style categories.
- **Badge** (9) — `BadgeAPI`, `ChannelBadges`, `GlobalBadges`, `ShowBadgesInChat`, `UnreadCountBadge`, `ClientSideBadges`, `MessageNitroBadge`, `BadgeSpoofer`.
- **GIF** (16) — `BetterGif*`, `GifPaste`, `TenorGifSearch`, `GifMaker`, `GifCollections`, `SaveFavoriteGIFs`, `FastGifPicker`, …
- **Channel / Server / Role** — each 12–20 plugins; e.g. `ChannelTabs` vs `ChannelBadges` vs `CleanChannelName` are distinct, but `ShowHiddenChannels` vs `ShowHiddenThings` partially overlap.

---

## 4. What the new Stable-ID System solves

Prior to 2.2.8, `Settings.plugins[plugin.name]` keyed the enabled flag. Renaming `name` (for branding, e.g. `Clyde` → `VoiceJoinMessages`) orphaned the stored `enabled: true` and disabled the plugin on next restart. Same for themes (`enabledThemes: string[]` stores the display filename).

New in 2.2.8:

- `definePlugin({ id: "stableId", name: "Display Name", … })` — `id` is the persistent key, `name` is free to change.
- `src/utils/pluginIds.ts` — registry & helper `getPluginId(plugin)`.
- `src/api/PluginManager.ts` — `isPluginEnabled`, `start*`, `stop*` now resolve via `id`.
- `src/api/Settings.ts` — auto-migrates legacy `name`-keyed entries to `id` on first run.
- Themes: identical pattern (`src/utils/themeIds.ts`, `src/api/Themes.ts`). A CSS file can declare `/* @id my-theme */` or fall back to its filename; renaming the header `name:` no longer disables the theme.
- Build (`scripts/build/common.mjs` + `scripts/utils.ts`) — `~plugins` map still keyed by `name` for runtime backwards-compat, but `PluginMeta` now carries `id` and `stableId`.

Existing installs are migrated transparently — no user action needed.

---

## 5. Recommended De-duplication Roadmap

1. **Immediate (2.2.8)** — Add `id` to every plugin that currently has an exact duplicate; add `migratePluginSettings(oldName, newId)` alias so the duplicate can be removed in 2.3 without data loss.
2. **Next minor** — Hide (not delete) the second copy via `hidden: true` or `isModified` flag, surface a deprecation notice in `pluginWarnings.ts`.
3. **Major** — Remove the deprecated folder entirely; the `id` migration will keep the survivor enabled.

---

*End of report.*
