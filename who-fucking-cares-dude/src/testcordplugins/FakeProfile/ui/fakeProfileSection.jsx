/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@api/Styles";
import { Flex } from "@components/Flex";
import { Switch } from "@components/Switch";
import { findComponentByCodeLazy } from "@webpack";
import { Button, TextInput, Toasts, UserStore } from "@webpack/common";
import { useUsersProfileStore } from "../lib/stores/UsersProfileStore";
import { settings } from "../settings";
const CustomizationSection = findComponentByCodeLazy(".DESCRIPTION", "hasBackground:");
export const cl = classNameFactory("vc-decor-");
const STATUS_KEYS = ["fakeStatusEnabled", "fakeStatusText", "fakeStatusEmojiName", "fakeStatusEmojiId", "fakeStatusEmojiAnimated"];
function FakeStatusSection() {
    const { fakeStatusEnabled, fakeStatusText, fakeStatusEmojiName, fakeStatusEmojiId, fakeStatusEmojiAnimated } = settings.use(STATUS_KEYS);
    return (<div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                <span style={{ fontWeight: 600, fontSize: "14px" }}>Fake Custom Status</span>
                <Switch checked={fakeStatusEnabled} onChange={v => settings.store.fakeStatusEnabled = v}/>
            </div>
            {fakeStatusEnabled && (<div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <TextInput value={fakeStatusEmojiName} onChange={v => settings.store.fakeStatusEmojiName = v} placeholder="Emoji name (e.g. thonk)"/>
                    <TextInput value={fakeStatusEmojiId} onChange={v => settings.store.fakeStatusEmojiId = v} placeholder="Emoji ID (numbers only, optional)"/>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "13px" }}>Animated</span>
                        <Switch checked={fakeStatusEmojiAnimated} onChange={v => settings.store.fakeStatusEmojiAnimated = v}/>
                    </div>
                    <TextInput value={fakeStatusText} onChange={v => settings.store.fakeStatusText = v} placeholder="Status text"/>
                </div>)}
        </div>);
}
export function fakeProfileSection({ hideTitle = false, hideDivider = false, noMargin = false }) {
    const userId = UserStore.getCurrentUser().id;
    return <CustomizationSection title={!hideTitle && "fakeProfile"} hasBackground={true} hideDivider={hideDivider} className={noMargin && cl("section-remove-margin")}>
        <Flex>
            <Button onClick={async () => {
            useUsersProfileStore.getState().fetchProfileEffects();
            useUsersProfileStore.getState().fetchDecorations();
            useUsersProfileStore.getState().fetch(userId, true);
            useUsersProfileStore.getState().fetchProfileEffects();
            Toasts.show({
                message: "Successfully refetched fakeProfile!",
                id: Toasts.genId(),
                type: Toasts.Type.SUCCESS
            });
        }} size={Button.Sizes.SMALL}>
                Refetch fakeProfile
            </Button>
        </Flex>
        <FakeStatusSection />
    </CustomizationSection>;
}
