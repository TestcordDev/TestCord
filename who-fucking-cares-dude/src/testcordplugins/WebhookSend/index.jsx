/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { HeaderBarButton } from "@api/HeaderBar";
import { DataStore } from "@api/index";
import { FormSwitch } from "@components/FormSwitch";
import { TestcordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, Forms, React, showToast, TabBar, TextArea, TextInput, Toasts, useEffect, useRef, useState } from "@webpack/common";
const WEBHOOK_HISTORY_KEY = "WebhookSend_history";
const MAX_HISTORY = 20;
const cl = classNameFactory("vc-webhooksend-");
function getNative() {
    const native = VencordNative?.pluginHelpers?.WebhookSend;
    if (!native)
        throw new Error("WebhookSend requires desktop support. Please restart the client.");
    return native;
}
function WebhookIcon(props) {
    return (<svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...props}>
            <path d="M10.5 4a6.5 6.5 0 0 0-6.36 5.14 4.5 4.5 0 0 0 .36 8.99h2v-2h-2a2.5 2.5 0 1 1 .31-4.98l1.03-.13.11-1.04A4.5 4.5 0 0 1 14.9 9.5a3.5 3.5 0 1 1 .6 6.95H13v2h2.5a5.5 5.5 0 0 0 .74-10.95A6.5 6.5 0 0 0 10.5 4Zm.5 7 4 4h-3v5h-2v-5H7l4-4Z"/>
        </svg>);
}
async function loadHistory() {
    return await DataStore.get(WEBHOOK_HISTORY_KEY) ?? [];
}
async function saveHistory(url, name) {
    const normalizedUrl = url.trim();
    const history = await loadHistory();
    const existing = history.find(e => e.url === normalizedUrl);
    const next = [
        { url: normalizedUrl, name: name ?? existing?.name, addedAt: Date.now() },
        ...history.filter(e => e.url !== normalizedUrl)
    ].slice(0, MAX_HISTORY);
    await DataStore.set(WEBHOOK_HISTORY_KEY, next);
    return next;
}
async function removeHistoryEntry(url) {
    const history = await loadHistory();
    const next = history.filter(e => e.url !== url);
    await DataStore.set(WEBHOOK_HISTORY_KEY, next);
    return next;
}
function parseJson(value, label) {
    const trimmed = value.trim();
    if (!trimmed)
        return;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        throw new Error(`${label} must be valid JSON.`);
    }
}
function parseColor(colorStr) {
    const trimmed = colorStr.trim();
    if (!trimmed)
        return undefined;
    if (/^0x[0-9a-fA-F]+$/.test(trimmed))
        return parseInt(trimmed, 16);
    if (/^[0-9]+$/.test(trimmed))
        return parseInt(trimmed, 10);
    return undefined;
}
function EmbedEditor({ embed, onChange, onRemove, index }) {
    const [expanded, setExpanded] = useState(index === 0);
    const fieldCount = embed.fields?.length ?? 0;
    const summary = embed.title || embed.description?.slice(0, 50) || `Embed ${index + 1}`;
    return (<div className={cl("embed-card")}>
            <div className={cl("embed-header")} onClick={() => setExpanded(!expanded)}>
                <span className={cl("embed-expand-icon")}>{expanded ? "▼" : "▶"}</span>
                <span className={cl("embed-title")}>{summary}</span>
                {fieldCount > 0 && <span className={cl("embed-badge")}>{fieldCount} field{fieldCount !== 1 ? "s" : ""}</span>}
                <Button size={Button.Sizes.MIN} color={Button.Colors.RED} look={Button.Looks.LINK} onClick={e => { e.stopPropagation(); onRemove(); }}>
                    Remove
                </Button>
            </div>

            {expanded && (<div className={cl("embed-body")}>
                    <div className={cl("embed-row")}>
                        <TextInput value={embed.title ?? ""} placeholder="Title" onChange={v => onChange({ ...embed, title: v || undefined })}/>
                        <TextInput value={embed.url ?? ""} placeholder="URL" onChange={v => onChange({ ...embed, url: v || undefined })}/>
                    </div>
                    <TextArea value={embed.description ?? ""} placeholder="Description" rows={3} onChange={v => onChange({ ...embed, description: v || undefined })}/>
                    <div className={cl("embed-row")}>
                        <TextInput value={embed.color != null ? String(embed.color) : ""} placeholder="Color (decimal or 0xhex)" onChange={v => onChange({ ...embed, color: parseColor(v) })}/>
                        <TextInput value={embed.timestamp ?? ""} placeholder="ISO timestamp" onChange={v => onChange({ ...embed, timestamp: v || undefined })}/>
                    </div>

                    <Forms.FormTitle tag="h5" className={cl("section-title")}>Author</Forms.FormTitle>
                    <div className={cl("embed-row")}>
                        <TextInput value={embed.author?.name ?? ""} placeholder="Author name" onChange={v => onChange({
                ...embed,
                author: { ...embed.author, name: v || undefined }
            })}/>
                        <TextInput value={embed.author?.url ?? ""} placeholder="Author URL" onChange={v => onChange({
                ...embed,
                author: { ...embed.author, url: v || undefined }
            })}/>
                        <TextInput value={embed.author?.icon_url ?? ""} placeholder="Author icon URL" onChange={v => onChange({
                ...embed,
                author: { ...embed.author, icon_url: v || undefined }
            })}/>
                    </div>

                    <Forms.FormTitle tag="h5" className={cl("section-title")}>Footer</Forms.FormTitle>
                    <div className={cl("embed-row")}>
                        <TextInput value={embed.footer?.text ?? ""} placeholder="Footer text" onChange={v => onChange({
                ...embed,
                footer: { ...embed.footer, text: v }
            })}/>
                        <TextInput value={embed.footer?.icon_url ?? ""} placeholder="Footer icon URL" onChange={v => onChange({
                ...embed,
                footer: { ...embed.footer, icon_url: v || undefined }
            })}/>
                    </div>

                    <Forms.FormTitle tag="h5" className={cl("section-title")}>Images</Forms.FormTitle>
                    <div className={cl("embed-row")}>
                        <TextInput value={embed.image?.url ?? ""} placeholder="Image URL" onChange={v => onChange({
                ...embed,
                image: v ? { url: v } : undefined
            })}/>
                        <TextInput value={embed.thumbnail?.url ?? ""} placeholder="Thumbnail URL" onChange={v => onChange({
                ...embed,
                thumbnail: v ? { url: v } : undefined
            })}/>
                    </div>

                    <Forms.FormTitle tag="h5" className={cl("section-title")}>Fields</Forms.FormTitle>
                    {embed.fields?.map((field, i) => (<div key={i} className={cl("field-row")}>
                            <TextInput value={field.name} placeholder="Name" className={cl("field-name")} onChange={v => {
                    const fields = [...(embed.fields ?? [])];
                    fields[i] = { ...fields[i], name: v };
                    onChange({ ...embed, fields });
                }}/>
                            <TextInput value={field.value} placeholder="Value" className={cl("field-value")} onChange={v => {
                    const fields = [...(embed.fields ?? [])];
                    fields[i] = { ...fields[i], value: v };
                    onChange({ ...embed, fields });
                }}/>
                            <FormSwitch title="" value={field.inline ?? false} onChange={v => {
                    const fields = [...(embed.fields ?? [])];
                    fields[i] = { ...fields[i], inline: v };
                    onChange({ ...embed, fields });
                }} hideBorder className={cl("field-inline-switch")}/>
                            <Button size={Button.Sizes.MIN} color={Button.Colors.RED} look={Button.Looks.LINK} onClick={() => {
                    const fields = embed.fields?.filter((_, j) => j !== i);
                    onChange({ ...embed, fields: fields?.length ? fields : undefined });
                }}>
                                ✕
                            </Button>
                        </div>))}
                    <Button size={Button.Sizes.SMALL} look={Button.Looks.LINK} onClick={() => onChange({
                ...embed,
                fields: [...(embed.fields ?? []), { name: "", value: "", inline: false }]
            })}>
                        + Add field
                    </Button>
                </div>)}
        </div>);
}
function MessageTab({ content, setContent, username, setUsername, avatarUrl, setAvatarUrl, tts, setTts }) {
    return (<div className={cl("tab-content")}>
            <TextArea value={content} placeholder="Message content (up to 2000 characters)" rows={6} onChange={setContent}/>
            <Forms.FormTitle tag="h5" className={cl("section-title")}>Overrides</Forms.FormTitle>
            <TextInput value={username} placeholder="Username override" onChange={setUsername}/>
            <TextInput value={avatarUrl} placeholder="Avatar URL override" onChange={setAvatarUrl}/>
            <FormSwitch title="Text-to-speech" description="Send as a TTS message" value={tts} onChange={setTts}/>
        </div>);
}
function EmbedsTab({ embeds, setEmbeds }) {
    const fileInputRef = useRef(null);
    function importJson() {
        const input = fileInputRef.current;
        if (!input)
            return;
        input.click();
    }
    function handleFileImport(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result);
                if (Array.isArray(parsed)) {
                    setEmbeds(parsed);
                }
                else if (typeof parsed === "object" && parsed !== null) {
                    setEmbeds([parsed]);
                }
                showToast("Embeds imported.", Toasts.Type.SUCCESS);
            }
            catch {
                showToast("Invalid JSON file.", Toasts.Type.FAILURE);
            }
        };
        reader.readAsText(file);
        e.target.value = "";
    }
    return (<div className={cl("tab-content")}>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleFileImport}/>
            <div className={cl("embed-actions")}>
                <Button size={Button.Sizes.SMALL} onClick={() => setEmbeds([...embeds, { fields: [] }])}>
                    + Add embed
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={importJson}>
                    Import JSON
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={() => {
            const json = JSON.stringify(embeds, null, 2);
            navigator.clipboard.writeText(json);
            showToast("Copied to clipboard.", Toasts.Type.SUCCESS);
        }}>
                    Export JSON
                </Button>
            </div>
            {embeds.map((embed, i) => (<EmbedEditor key={i} index={i} embed={embed} onChange={updated => {
                const next = [...embeds];
                next[i] = updated;
                setEmbeds(next);
            }} onRemove={() => setEmbeds(embeds.filter((_, j) => j !== i))}/>))}
            {embeds.length === 0 && (<div className={cl("empty-state")}>
                    No embeds yet. Click "Add embed" or import a JSON file.
                </div>)}
        </div>);
}
function MentionsTab({ allowedMentionsJson, setAllowedMentionsJson }) {
    return (<div className={cl("tab-content")}>
            <Forms.FormText className={cl("mentions-hint")}>
                Leave empty to allow all mentions. Use JSON to restrict what can be mentioned.
            </Forms.FormText>
            <Forms.FormTitle tag="h5" className={cl("section-title")}>Quick Presets</Forms.FormTitle>
            <div className={cl("preset-row")}>
                <Button size={Button.Sizes.SMALL} onClick={() => setAllowedMentionsJson("")}>
                    Allow all
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={() => setAllowedMentionsJson(JSON.stringify({ parse: [] }))}>
                    Block all
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={() => setAllowedMentionsJson(JSON.stringify({ parse: ["users", "roles"] }))}>
                    Users & roles only
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={() => setAllowedMentionsJson(JSON.stringify({ parse: ["users"] }))}>
                    Users only
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={() => setAllowedMentionsJson(JSON.stringify({ parse: ["roles"] }))}>
                    Roles only
                </Button>
            </div>
            <Forms.FormTitle tag="h5" className={cl("section-title")}>Custom JSON</Forms.FormTitle>
            <TextArea value={allowedMentionsJson} placeholder={'{"parse": ["users"], "replied_user": true}'} rows={6} onChange={setAllowedMentionsJson}/>
        </div>);
}
function SettingsTab({ threadName, setThreadName, threadId, setThreadId, appliedTags, setAppliedTags, flags, setFlags, withComponents, setWithComponents }) {
    return (<div className={cl("tab-content")}>
            <Forms.FormTitle tag="h5" className={cl("section-title")}>Thread Options</Forms.FormTitle>
            <TextInput value={threadId} placeholder="Thread ID (send to existing thread)" onChange={setThreadId}/>
            <TextInput value={threadName} placeholder="Thread name (create new thread in forum/media channels)" onChange={setThreadName}/>
            <TextInput value={appliedTags} placeholder="Applied tags (comma-separated tag IDs for forum channels)" onChange={setAppliedTags}/>

            <Forms.FormTitle tag="h5" className={cl("section-title")}>Message Flags</Forms.FormTitle>
            <FormSwitch title="Suppress embeds" description="Hide embeds in the sent message" value={(flags & 4) !== 0} onChange={v => setFlags(v ? flags | 4 : flags & ~4)}/>
            <FormSwitch title="Suppress notifications" description="Send silently without pinging anyone" value={(flags & 16384) !== 0} onChange={v => setFlags(v ? flags | 16384 : flags & ~16384)}/>

            <Forms.FormTitle tag="h5" className={cl("section-title")}>Components</Forms.FormTitle>
            <FormSwitch title="Enable components" description="Respect the components field (requires with_components query param)" value={withComponents} onChange={setWithComponents}/>

            <Forms.FormTitle tag="h5" className={cl("section-title")}>Raw JSON Override</Forms.FormTitle>
            <Forms.FormText className={cl("mentions-hint")}>
                Provide additional payload fields as JSON. These are merged with the form fields above.
            </Forms.FormText>
        </div>);
}
function WebhookSendModal({ rootProps }) {
    const [history, setHistory] = useState([]);
    const [currentTab, setCurrentTab] = useState(0 /* Tabs.Message */);
    const [webhookUrl, setWebhookUrl] = useState("");
    const [content, setContent] = useState("");
    const [username, setUsername] = useState("");
    const [avatarUrl, setAvatarUrl] = useState("");
    const [tts, setTts] = useState(false);
    const [embeds, setEmbeds] = useState([]);
    const [allowedMentionsJson, setAllowedMentionsJson] = useState("");
    const [threadId, setThreadId] = useState("");
    const [threadName, setThreadName] = useState("");
    const [appliedTags, setAppliedTags] = useState("");
    const [flags, setFlags] = useState(0);
    const [withComponents, setWithComponents] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [rawJsonOverride, setRawJsonOverride] = useState("");
    useEffect(() => {
        loadHistory().then(setHistory).catch(() => { });
    }, []);
    async function onDeleteHistory(url) {
        setHistory(await removeHistoryEntry(url));
    }
    async function onSend() {
        const trimmedUrl = webhookUrl.trim();
        if (!trimmedUrl) {
            showToast("Webhook URL is required.", Toasts.Type.FAILURE);
            return;
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(trimmedUrl);
        }
        catch {
            showToast("Webhook URL is invalid.", Toasts.Type.FAILURE);
            return;
        }
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            showToast("Webhook URL must use HTTP or HTTPS.", Toasts.Type.FAILURE);
            return;
        }
        if (!parsedUrl.pathname.includes("/api/webhooks/")) {
            showToast("This does not look like a Discord webhook URL.", Toasts.Type.FAILURE);
            return;
        }
        let embedsParsed;
        try {
            embedsParsed = embeds.filter(e => e.title || e.description || e.fields?.length);
        }
        catch {
            showToast("Invalid embed data.", Toasts.Type.FAILURE);
            return;
        }
        let allowedMentions;
        try {
            allowedMentions = parseJson(allowedMentionsJson, "Allowed mentions");
        }
        catch (e) {
            showToast(e instanceof Error ? e.message : "Invalid allowed mentions JSON.", Toasts.Type.FAILURE);
            return;
        }
        let rawOverride;
        try {
            rawOverride = parseJson(rawJsonOverride, "Raw JSON override");
        }
        catch (e) {
            showToast(e instanceof Error ? e.message : "Invalid raw JSON.", Toasts.Type.FAILURE);
            return;
        }
        if (!content.trim() && !embedsParsed?.length) {
            showToast("Add content or at least one embed.", Toasts.Type.FAILURE);
            return;
        }
        const payload = {};
        if (content.trim())
            payload.content = content.trim();
        if (username.trim())
            payload.username = username.trim();
        if (avatarUrl.trim())
            payload.avatar_url = avatarUrl.trim();
        if (tts)
            payload.tts = true;
        if (embedsParsed?.length)
            payload.embeds = embedsParsed;
        if (allowedMentions)
            payload.allowed_mentions = allowedMentions;
        if (threadName.trim())
            payload.thread_name = threadName.trim();
        if (appliedTags.trim())
            payload.applied_tags = appliedTags.split(",").map(t => t.trim()).filter(Boolean);
        if (flags)
            payload.flags = flags;
        if (withComponents)
            payload.with_components = true;
        if (threadId.trim()) {
            parsedUrl.searchParams.set("thread_id", threadId.trim());
        }
        if (withComponents) {
            parsedUrl.searchParams.set("with_components", "true");
        }
        parsedUrl.searchParams.set("wait", "true");
        const finalPayload = { ...payload, ...rawOverride };
        setIsSending(true);
        try {
            const { status, data } = await getNative().sendWebhook(parsedUrl.toString(), JSON.stringify(finalPayload));
            if (status < 200 || status >= 300) {
                let detail = "";
                try {
                    const parsed = JSON.parse(data);
                    detail = parsed.message ?? data;
                }
                catch {
                    detail = data;
                }
                throw new Error(detail || `Webhook request failed with status ${status}.`);
            }
            setHistory(await saveHistory(trimmedUrl, username.trim() || undefined));
            showToast("Webhook sent successfully.", Toasts.Type.SUCCESS);
            rootProps.onClose();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown webhook error.";
            showToast(message, Toasts.Type.FAILURE);
        }
        finally {
            setIsSending(false);
        }
    }
    return (<ModalRoot {...rootProps} size={"large" /* ModalSize.LARGE */} className={cl("modal")}>
            <ModalHeader>
                <div className={cl("header")}>
                    <WebhookIcon className={cl("header-icon")}/>
                    <span className={cl("header-text")}>Send Webhook</span>
                </div>
                <ModalCloseButton onClick={rootProps.onClose}/>
            </ModalHeader>

            <ModalContent>
                {history.length > 0 && (<div className={cl("history-section")}>
                        <Forms.FormTitle tag="h5" className={cl("history-title")}>Saved Webhooks</Forms.FormTitle>
                        <div className={cl("history-list")}>
                            {history.map(entry => {
                let host;
                try {
                    host = new URL(entry.url).host;
                }
                catch {
                    host = entry.url;
                }
                return (<div key={entry.url} className={cl("history-item")}>
                                        <Button size={Button.Sizes.SMALL} className={cl("history-btn")} onClick={() => setWebhookUrl(entry.url)}>
                                            {entry.name ? `${entry.name} (${host})` : host}
                                        </Button>
                                        <Button size={Button.Sizes.MIN} color={Button.Colors.RED} look={Button.Looks.LINK} onClick={() => onDeleteHistory(entry.url)}>
                                            ✕
                                        </Button>
                                    </div>);
            })}
                        </div>
                    </div>)}

                <div className={cl("url-section")}>
                    <TextInput value={webhookUrl} placeholder="Webhook URL (https://discord.com/api/webhooks/...)" onChange={setWebhookUrl}/>
                </div>

                <TabBar type="top" look="brand" className={cl("tab-bar")} selectedItem={currentTab} onItemSelect={setCurrentTab}>
                    <TabBar.Item id={0 /* Tabs.Message */}>Message</TabBar.Item>
                    <TabBar.Item id={1 /* Tabs.Embeds */}>Embeds ({embeds.length})</TabBar.Item>
                    <TabBar.Item id={2 /* Tabs.Mentions */}>Mentions</TabBar.Item>
                    <TabBar.Item id={3 /* Tabs.Settings */}>Settings</TabBar.Item>
                </TabBar>

                {currentTab === 0 /* Tabs.Message */ && (<MessageTab content={content} setContent={setContent} username={username} setUsername={setUsername} avatarUrl={avatarUrl} setAvatarUrl={setAvatarUrl} tts={tts} setTts={setTts}/>)}
                {currentTab === 1 /* Tabs.Embeds */ && (<EmbedsTab embeds={embeds} setEmbeds={setEmbeds}/>)}
                {currentTab === 2 /* Tabs.Mentions */ && (<MentionsTab allowedMentionsJson={allowedMentionsJson} setAllowedMentionsJson={setAllowedMentionsJson}/>)}
                {currentTab === 3 /* Tabs.Settings */ && (<SettingsTab threadName={threadName} setThreadName={setThreadName} threadId={threadId} setThreadId={setThreadId} appliedTags={appliedTags} setAppliedTags={setAppliedTags} flags={flags} setFlags={setFlags} withComponents={withComponents} setWithComponents={setWithComponents}/>)}
            </ModalContent>

            <ModalFooter>
                <Button color={Button.Colors.PRIMARY} disabled={isSending} onClick={onSend}>
                    {isSending ? "Sending..." : "Send Webhook"}
                </Button>
                <Button color={Button.Colors.TRANSPARENT} look={Button.Looks.LINK} onClick={rootProps.onClose}>
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>);
}
function WebhookSendButton() {
    return (<HeaderBarButton icon={WebhookIcon} tooltip="Send Webhook" onClick={() => openModal(props => <WebhookSendModal rootProps={props}/>)}/>);
}
export default definePlugin({
    name: "WebhookSend",
    description: "Send Discord webhooks from a tabbed modal with visual embed builder and saved history.",
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],
    headerBarButton: {
        icon: WebhookIcon,
        render: WebhookSendButton,
        priority: 100,
    },
});
