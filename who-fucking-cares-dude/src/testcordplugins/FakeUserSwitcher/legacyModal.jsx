/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot } from "@utils/modal";
import { Button, Forms, IconUtils, showToast, Text, TextInput, Toasts, UserStore, useState } from "@webpack/common";
import { clearTarget, getCachedTarget, loadTarget, logger, resolveTargetUserId, setEnabled, settings } from "./data";
const ID_RE = /^\d{17,20}$/;
export function FakeUserProfileModal({ modalProps }) {
    const initial = getCachedTarget();
    const [value, setValue] = useState(initial?.id ?? settings.store.targetId ?? "");
    const [busy, setBusy] = useState(false);
    const [enabled, setEnabledLocal] = useState(settings.store.spoofActive);
    const [fakeMessages, setFakeMessages] = useState(settings.store.fakeMessages);
    const [sendRealToo, setSendRealToo] = useState(settings.store.sendRealToo);
    const [spoofBadges, setSpoofBadges] = useState(settings.store.spoofBadges);
    const [spoofActivities, setSpoofActivities] = useState(settings.store.spoofActivities);
    const [target, setTarget] = useState(initial);
    async function apply() {
        const input = value.trim();
        const id = resolveTargetUserId(input);
        if (!id) {
            showToast("Enter a valid Discord user ID or cached username.", Toasts.Type.FAILURE);
            return;
        }
        const me = UserStore.getCurrentUser();
        if (me && me.id === id) {
            showToast("You cannot spoof as yourself!", Toasts.Type.FAILURE);
            return;
        }
        setBusy(true);
        try {
            const next = await loadTarget(id);
            setTarget(next);
            settings.store.manualMode = false;
            setEnabled(true);
            setEnabledLocal(true);
            showToast(`Spoofing as ${next.user.username}.`, Toasts.Type.SUCCESS);
        }
        catch (e) {
            logger.error("apply failed", e);
            showToast(e?.message || "Failed to load that user.", Toasts.Type.FAILURE);
        }
        finally {
            setBusy(false);
        }
    }
    function clear() {
        clearTarget();
        settings.store.manualMode = false;
        setTarget(null);
        setEnabledLocal(false);
        setValue("");
        showToast("Cleared spoof target.", Toasts.Type.MESSAGE);
    }
    function toggle(v) {
        if (v && !target) {
            showToast("Pick a target user first.", Toasts.Type.FAILURE);
            return;
        }
        setEnabled(v);
        setEnabledLocal(v);
    }
    return (<ModalRoot {...modalProps} size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>Fake User Profile (Legacy)</Text>
                <ModalCloseButton onClick={modalProps.onClose}/>
            </ModalHeader>
            <ModalContent>
                <Forms.FormText className={Margins.bottom8}>
                    Pick a user by ID. Your client will visually treat you as them: avatar, banner, badges, bio, pronouns, decorations, activities, name. Messages you send can be replaced with a local fake from the target user.
                </Forms.FormText>

                <Forms.FormTitle>Target user ID</Forms.FormTitle>
                <Flex style={{ alignItems: "center", gap: 8 }} className={Margins.bottom16}>
                    <div style={{ flexGrow: 1 }}>
                        <TextInput placeholder="123456789012345678" value={value} onChange={setValue} autoFocus/>
                    </div>
                    <Button onClick={apply} disabled={busy || !value.trim()}>
                        {busy ? "Loading..." : "Apply"}
                    </Button>
                </Flex>

                {target && (<Flex style={{ alignItems: "center", gap: 12 }} className={Margins.bottom16}>
                        <img src={IconUtils.getUserAvatarURL(target.user, true, 64)} alt="" width={48} height={48} style={{ borderRadius: "50%" }}/>
                        <div>
                            <Text variant="text-md/semibold">{target.user.globalName ?? target.user.username}</Text>
                            <Text variant="text-sm/normal" style={{
                opacity: 0.7,
                cursor: "pointer",
                display: "block",
                width: "fit-content",
                lineHeight: 1
            }} onClick={() => {
                navigator.clipboard.writeText(target.id);
                showToast("Copied ID to clipboard", Toasts.Type.SUCCESS);
            }} title="Click to copy ID">
                                @{target.user.username} · {target.id}
                            </Text>
                        </div>
                    </Flex>)}

                <FormSwitch value={enabled} onChange={toggle} description="Enable the visual spoof. The user area button toggles the same setting." title="Spoof active"/>

                <FormSwitch value={fakeMessages} onChange={v => { settings.store.fakeMessages = v; setFakeMessages(v); }} description="When you send a message, post a local fake one as the target instead of really sending it." title="Fake outgoing messages"/>

                <FormSwitch value={sendRealToo} onChange={v => { settings.store.sendRealToo = v; setSendRealToo(v); }} description="Also send the real message in addition to the local fake. Off keeps it client-side only." disabled={!fakeMessages} title="Send real message too"/>

                <FormSwitch value={spoofBadges} onChange={v => { settings.store.spoofBadges = v; setSpoofBadges(v); }} description="Mirror the target's badges onto your client-side profile." title="Spoof badges"/>

                <FormSwitch value={spoofActivities} onChange={v => { settings.store.spoofActivities = v; setSpoofActivities(v); }} description="Mirror the target's connected accounts and game collection." hideBorder title="Spoof activities and connections"/>
            </ModalContent>
            <ModalFooter>
                <Flex style={{ gap: 8 }}>
                    <Button color={Button.Colors.RED} onClick={clear} disabled={!target}>Clear</Button>
                    <Button color={Button.Colors.PRIMARY} onClick={modalProps.onClose}>Close</Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>);
}
