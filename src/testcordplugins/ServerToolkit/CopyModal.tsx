/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FormSwitch } from "@components/FormSwitch";
import {
    ModalContent,
    ModalFooter,
    ModalProps,
    openModal,
} from "@utils/modal";
import {
    Button,
    Forms,
    GuildStore,
    Modal,
    React,
    Select,
    Text,
    TextInput,
    useEffect,
    useMemo,
    useRef,
    UserStore,
    useState,
} from "@webpack/common";

import { type CopyOptions,runCopy } from "./copy/engine";
import { settings } from "./index";

type AnyGuild = {
    id: string;
    name: string;
    ownerId?: string;
    [k: string]: any;
};

export function openCopyModal(guild: AnyGuild) {
    openModal(props => <CopyModal modalProps={{ ...props, title: `Duplicate Server — ${guild.name}` }} guild={guild} />);
}

function CopyModal({ modalProps, guild }: { modalProps: ModalProps; guild: AnyGuild; }) {
    const me = UserStore.getCurrentUser();

    const ownedGuilds = useMemo(() => {
        const all: Record<string, AnyGuild> = (GuildStore as any).getGuilds?.() ?? {};
        return Object.values(all).filter(g => g.ownerId === me.id && g.id !== guild.id);
    }, [guild.id, me.id]);

    const [targetMode, setTargetMode] = useState<"new" | "existing">("new");
    const [newName, setNewName] = useState<string>(guild.name);
    const [existingId, setExistingId] = useState<string>(ownedGuilds[0]?.id ?? "");

    const s = settings.use([
        "defaultIncludeRoles",
        "defaultIncludeChannels",
        "defaultIncludeEmojis",
        "defaultIncludeStickers",
        "defaultIncludeWebhooks",
        "defaultIncludeServerSettings",
        "defaultIncludeOwnNickname",
        "defaultIncludeBots",
        "emojiCount",
        "stickerCount",
    ]);

    const [incRoles, setIncRoles] = useState(s.defaultIncludeRoles);
    const [incChannels, setIncChannels] = useState(s.defaultIncludeChannels);
    const [incEmojis, setIncEmojis] = useState(s.defaultIncludeEmojis);
    const [incStickers, setIncStickers] = useState(s.defaultIncludeStickers);
    const [incWebhooks, setIncWebhooks] = useState(s.defaultIncludeWebhooks);
    const [incServerSettings, setIncServerSettings] = useState(s.defaultIncludeServerSettings);
    const [incOwnNick, setIncOwnNick] = useState(s.defaultIncludeOwnNickname);
    const [incOtherNicks, setIncOtherNicks] = useState(false);
    const [incBots, setIncBots] = useState(s.defaultIncludeBots);

    const [wipeRoles, setWipeRoles] = useState(false);
    const [wipeChannels, setWipeChannels] = useState(false);
    const [wipeEmojis, setWipeEmojis] = useState(false);
    const [wipeStickers, setWipeStickers] = useState(false);
    const [confirmText, setConfirmText] = useState("");

    const [running, setRunning] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    function closeModal() {
        abortRef.current?.abort();
        modalProps.onClose();
    }

    const anyWipe = wipeRoles || wipeChannels || wipeEmojis || wipeStickers;
    const needsConfirm = targetMode === "existing" && anyWipe;
    const confirmOk = !needsConfirm || confirmText === "OVERWRITE";

    const canRun =
        !running &&
        confirmOk &&
        newName.trim().length >= 2 &&
        (targetMode === "new" ? true : !!existingId) &&
        (incRoles || incChannels || incEmojis || incStickers || incWebhooks || incServerSettings || incOwnNick || incBots);

    const append = (line: string) => setLog(prev => [...prev, line]);

    async function handleRun() {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setLog([]);
        const opts: CopyOptions = {
            source: guild,
            target: targetMode === "new"
                ? { kind: "new", name: newName.trim() }
                : { kind: "existing", guildId: existingId, name: newName.trim() },
            include: {
                roles: incRoles,
                channels: incChannels,
                emojis: incEmojis,
                stickers: incStickers,
                webhooks: incWebhooks,
                serverSettings: incServerSettings,
                ownNickname: incOwnNick,
                otherNicknames: incOtherNicks,
                bots: incBots,
            },
            wipe: {
                roles: wipeRoles,
                channels: wipeChannels,
                emojis: wipeEmojis,
                stickers: wipeStickers,
            },
            limits: {
                emojis: s.emojiCount,
                stickers: s.stickerCount,
            },
            signal: controller.signal,
            onLog: append,
        };
        try {
            await runCopy(opts);
            if (!controller.signal.aborted) append("✓ Done.");
        } catch (e: any) {
            if (!controller.signal.aborted) append(`✗ Failed: ${e?.message ?? String(e)}`);
        } finally {
            if (!controller.signal.aborted) setRunning(false);
        }
    }

    return (
        <Modal
            {...modalProps}
            onClose={closeModal}
            size="lg"
            className="guild-toolkit-modal"
            title={`Duplicate Server — ${guild.name}`}
        >
            <ModalContent className="guild-toolkit-content">
                <Forms.FormSection title="Target">
                    <div className="gt-target-toggle">
                        <Button
                            size={Button.Sizes.SMALL}
                            color={targetMode === "new" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                            className={targetMode === "new" ? "gt-mode-btn gt-selected" : "gt-mode-btn"}
                            onClick={() => setTargetMode("new")}
                        >
                            Create new server
                        </Button>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={targetMode === "existing" ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                            className={targetMode === "existing" ? "gt-mode-btn gt-selected" : "gt-mode-btn"}
                            onClick={() => setTargetMode("existing")}
                            disabled={ownedGuilds.length === 0}
                        >
                            Use existing server I own
                        </Button>
                    </div>

                    {targetMode === "new" ? (
                        <TextInput
                            placeholder="New server name"
                            value={newName}
                            onChange={setNewName}
                            maxLength={100}
                            className="gt-input"
                        />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            <Select
                                options={ownedGuilds.map(g => ({ label: g.name, value: g.id }))}
                                isSelected={(v: string) => v === existingId}
                                select={(v: string) => setExistingId(v)}
                                serialize={(v: string) => v}
                            />
                            <TextInput
                                placeholder="Overwrite server name to..."
                                value={newName}
                                onChange={setNewName}
                                maxLength={100}
                                className="gt-input"
                            />
                        </div>
                    )}
                </Forms.FormSection>

                <Forms.FormSection title="What to copy">
                    <FormSwitch value={incRoles} onChange={setIncRoles} title="Roles" />
                    <FormSwitch value={incChannels} onChange={setIncChannels} title="Channels" />
                    <FormSwitch value={incEmojis} onChange={setIncEmojis} title="Emojis" />
                    <FormSwitch value={incStickers} onChange={setIncStickers} title="Stickers" />
                    <FormSwitch value={incWebhooks} onChange={setIncWebhooks} title="Webhooks" />
                    <FormSwitch value={incServerSettings} onChange={setIncServerSettings} title="Server settings" description="Icon, banner, splash, AFK config, verification level, etc." />
                    <FormSwitch value={incOwnNick} onChange={setIncOwnNick} title="Your own nickname" description="Your nickname in the source server" />
                    <FormSwitch value={incOtherNicks} onChange={setIncOtherNicks} title="Other members' nicknames" description="Requires Manage Nicknames on the target. Members must already be in the target server." />
                    <FormSwitch value={incBots} onChange={setIncBots} title="Bot list" description="Create a #bots-list channel with invite links for all bots" />
                </Forms.FormSection>

                {targetMode === "existing" && (
                    <Forms.FormSection title="Wipe target before copying">
                        <Text style={{ color: "var(--text-danger)", marginBottom: 8 }}>
                            Destructive. Deleted items cannot be recovered.
                        </Text>
                        <FormSwitch value={wipeRoles} onChange={setWipeRoles} title="Wipe roles" description="Delete all non-managed roles below your highest role" />
                        <FormSwitch value={wipeChannels} onChange={setWipeChannels} title="Wipe channels" description="Delete all channels and categories" />
                        <FormSwitch value={wipeEmojis} onChange={setWipeEmojis} title="Wipe emojis" description="Delete all custom emojis" />
                        <FormSwitch value={wipeStickers} onChange={setWipeStickers} title="Wipe stickers" description="Delete all custom stickers" />

                        {anyWipe && (
                            <>
                                <Forms.FormText>Type <strong>OVERWRITE</strong> to confirm:</Forms.FormText>
                                <TextInput
                                    placeholder="OVERWRITE"
                                    value={confirmText}
                                    onChange={setConfirmText}
                                    className="gt-input"
                                />
                            </>
                        )}
                    </Forms.FormSection>
                )}

                {log.length > 0 && (
                    <Forms.FormSection title="Progress">
                        <div className="gt-log">
                            {log.map((line, i) => (
                                <div key={i} className="gt-log-line">{line}</div>
                            ))}
                        </div>
                    </Forms.FormSection>
                )}
            </ModalContent>

            <ModalFooter>
                <div style={{ display: "flex", gap: "12px", marginLeft: "auto" }}>
                    <Button
                        color={Button.Colors.PRIMARY}
                        look={Button.Looks.LINK}
                        onClick={closeModal}
                        disabled={running}
                    >
                        {running ? "Running…" : "Close"}
                    </Button>
                    <Button
                        color={Button.Colors.BRAND}
                        onClick={handleRun}
                        disabled={!canRun}
                    >
                        {running ? "Duplicating…" : "Start duplication"}
                    </Button>
                </div>
            </ModalFooter>
        </Modal>
    );
}
