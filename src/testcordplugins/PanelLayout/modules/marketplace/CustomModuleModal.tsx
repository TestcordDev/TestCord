/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModalLazy, React, Select, TextInput, useState } from "@webpack/common";

function FormField({ title, note, children }: { title: string; note?: string; children: React.ReactNode; }) {
    return (
        <Flex flexDirection="column" gap={4}>
            <BaseText size="sm" weight="semibold" style={{ color: "var(--header-primary)" }}>
                {title}
            </BaseText>
            {note && (
                <BaseText size="xs" color="text-muted" style={{ marginBottom: "2px" }}>
                    {note}
                </BaseText>
            )}
            {children}
        </Flex>
    );
}

import { CodeIcon, EyeIcon } from "../icons";
import { installCustomModule, updateCustomModule } from "../registry";
import type { CustomModuleData, CustomModuleType, ModulePosition } from "../types";

interface CustomModuleModalProps {
    modalProps: RenderModalProps;
    initialData?: CustomModuleData;
    isEditing?: boolean;
}

const DEFAULT_HTML_CODE = `<div style="padding: 8px 12px; background: rgba(88, 101, 242, 0.15); border: 1px solid rgba(88, 101, 242, 0.4); border-radius: 8px; text-align: center;">
    <div style="font-weight: 600; font-size: 13px; color: #5865f2;">Hello, {username}!</div>
    <div style="font-size: 11px; color: #aaa; margin-top: 2px;">Local time: {time}</div>
</div>`;

const DEFAULT_REACT_CODE = `function Component() {
    const user = UserStore.getCurrentUser();
    return React.createElement(Card, { variant: "primary", style: { padding: "8px 12px", textAlign: "center" } },
        React.createElement(BaseText, { size: "md", weight: "semibold" }, "Welcome " + (user ? user.username : "User") + "!"),
        React.createElement(BaseText, { size: "xs", color: "text-muted", style: { marginTop: "4px" } }, "Custom React Module Active")
    );
}`;

export function openCustomModuleModal(initialData?: CustomModuleData, isEditing = false) {
    openModalLazy(async () => props => (
        <CustomModuleModal modalProps={props} initialData={initialData} isEditing={isEditing} />
    ));
}

export function CustomModuleModal({ modalProps, initialData, isEditing }: CustomModuleModalProps) {
    const [name, setName] = useState(initialData?.name ?? "");
    const [description, setDescription] = useState(initialData?.description ?? "");
    const [author, setAuthor] = useState(initialData?.author ?? "");
    const [customType, setCustomType] = useState<CustomModuleType>(initialData?.customType ?? "html");
    const [customCode, setCustomCode] = useState(
        initialData?.customCode ?? (customType === "html" ? DEFAULT_HTML_CODE : DEFAULT_REACT_CODE)
    );
    const [customCss, setCustomCss] = useState(initialData?.customCss ?? "");
    const [position, setPosition] = useState<ModulePosition>(initialData?.position ?? "above");
    const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!name.trim()) {
            setError("Module name is required");
            return;
        }
        if (!customCode.trim()) {
            setError("Module code is required");
            return;
        }

        const data: CustomModuleData = {
            id: initialData?.id,
            name: name.trim(),
            description: description.trim(),
            author: author.trim() || "User",
            customType,
            customCode,
            customCss,
            position,
            enabled: initialData?.enabled ?? true,
            order: initialData?.order,
        };

        try {
            if (isEditing && initialData?.id) {
                await updateCustomModule(initialData.id, data);
            } else {
                await installCustomModule(data);
            }
            modalProps.onClose();
        } catch (e: any) {
            setError(e.message || "Failed to save custom module");
        }
    };

    const TAB_CSS = `
        .vc-pl-subtab {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            margin-bottom: -1px;
            cursor: pointer;
            border-radius: 6px 6px 0 0;
            border-bottom: 2px solid transparent;
            background-color: transparent !important;
            transition: background-color 0.15s ease, border-color 0.15s ease;
            user-select: none;
        }

        .vc-pl-subtab:hover {
            background-color: var(--background-modifier-hover, var(--background-mod-subtle)) !important;
        }

        .vc-pl-subtab.active,
        .vc-pl-subtab.active:hover {
            border-bottom: 2px solid var(--brand-experiment, var(--background-brand)) !important;
            background-color: transparent !important;
        }
    `;

    return (
        <Modal
            title={
                <BaseText size="lg" weight="semibold">
                    {isEditing ? "Edit Custom Module" : "Install Custom Module"}
                </BaseText>
            }
            size="lg"
            actionBarInput={
                <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
                    <Button
                        variant="secondary"
                        style={{ backgroundColor: "#174b71", color: "#fff" }}
                        onClick={() => modalProps.onClose()}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="secondary"
                        style={{ backgroundColor: "#174b71", color: "#fff" }}
                        onClick={handleSave}
                    >
                        {isEditing ? "Save Changes" : "Install Module"}
                    </Button>
                </div>
            }
            {...modalProps}
        >
            <style>{TAB_CSS}</style>
            <div className="panellayout-scrollbar" style={{ height: "460px", minHeight: "460px", maxHeight: "70vh", overflowY: "auto", paddingRight: "4px", boxSizing: "border-box" }}>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        borderBottom: "1px solid var(--background-modifier-accent, var(--border-muted))",
                        width: "100%",
                        marginBottom: "16px",
                    }}
                >
                    <div
                        onClick={() => setActiveTab("edit")}
                        className={`vc-pl-subtab ${activeTab === "edit" ? "active" : ""}`}
                    >
                        <span
                            style={{
                                display: "flex",
                                color: activeTab === "edit"
                                    ? "var(--brand-experiment, var(--background-brand))"
                                    : "var(--text-muted)",
                                transition: "color 0.15s ease",
                            }}
                        >
                            <CodeIcon size={14} />
                        </span>
                        <BaseText
                            size="md"
                            weight={activeTab === "edit" ? "semibold" : "medium"}
                            color={activeTab === "edit" ? "text-strong" : "text-muted"}
                        >
                            Editor
                        </BaseText>
                    </div>
                    <div
                        onClick={() => setActiveTab("preview")}
                        className={`vc-pl-subtab ${activeTab === "preview" ? "active" : ""}`}
                    >
                        <span
                            style={{
                                display: "flex",
                                color: activeTab === "preview"
                                    ? "var(--brand-experiment, var(--background-brand))"
                                    : "var(--text-muted)",
                                transition: "color 0.15s ease",
                            }}
                        >
                            <EyeIcon size={14} />
                        </span>
                        <BaseText
                            size="md"
                            weight={activeTab === "preview" ? "semibold" : "medium"}
                            color={activeTab === "preview" ? "text-strong" : "text-muted"}
                        >
                            Live Preview
                        </BaseText>
                    </div>
                </div>

                {error && (
                    <div
                        style={{
                            padding: "8px 12px",
                            marginBottom: "12px",
                            borderRadius: "6px",
                            background: "var(--background-message-automod, rgba(237, 66, 69, 0.1))",
                            color: "var(--text-danger, #ed4245)",
                            fontSize: "12px",
                        }}
                    >
                        {error}
                    </div>
                )}

                {activeTab === "edit" ? (
                    <Flex flexDirection="column" gap={14}>
                        <FormField title="Module Name">
                            <TextInput
                                value={name}
                                placeholder="e.g. My Custom Banner"
                                onChange={(val: string) => { setName(val); setError(null); }}
                            />
                        </FormField>

                        <FormField title="Description">
                            <TextInput
                                value={description}
                                placeholder="Brief description of your module"
                                onChange={(val: string) => setDescription(val)}
                            />
                        </FormField>

                        <Flex gap={12}>
                            <div style={{ flex: 1 }}>
                                <FormField title="Author">
                                    <TextInput
                                        value={author}
                                        placeholder="Your name or handle"
                                        onChange={(val: string) => setAuthor(val)}
                                    />
                                </FormField>
                            </div>
                            <div style={{ flex: 1 }}>
                                <FormField title="Module Type">
                                    <Select
                                        options={[
                                            { label: "HTML/CSS Widget", value: "html" },
                                            { label: "React Component (JS)", value: "react" },
                                        ]}
                                        serialize={(v: any) => v}
                                        isSelected={(v: any) => v === customType}
                                        select={(v: CustomModuleType) => {
                                            setCustomType(v);
                                            if (v === "html" && customCode === DEFAULT_REACT_CODE) {
                                                setCustomCode(DEFAULT_HTML_CODE);
                                            } else if (v === "react" && customCode === DEFAULT_HTML_CODE) {
                                                setCustomCode(DEFAULT_REACT_CODE);
                                            }
                                        }}
                                    />
                                </FormField>
                            </div>
                            <div style={{ flex: 1 }}>
                                <FormField title="Position">
                                    <Select
                                        options={[
                                            { label: "Above Profile", value: "above" },
                                            { label: "Below Profile", value: "below" },
                                        ]}
                                        serialize={(v: any) => v}
                                        isSelected={(v: any) => v === position}
                                        select={(v: ModulePosition) => setPosition(v)}
                                    />
                                </FormField>
                            </div>
                        </Flex>

                        <FormField
                            title={customType === "html" ? "HTML Code" : "React Component Code"}
                            note={
                                customType === "html"
                                    ? "Supported template variables: {username}, {time}, {date}"
                                    : "Define a Component() or render() function returning JSX. React, Button, Card, UserStore are available in scope."
                            }
                        >
                            <textarea
                                value={customCode}
                                onChange={e => { setCustomCode(e.target.value); setError(null); }}
                                rows={8}
                                style={{
                                    width: "100%",
                                    fontFamily: "monospace",
                                    fontSize: "12px",
                                    padding: "8px",
                                    borderRadius: "6px",
                                    backgroundColor: "var(--background-tertiary, #1e1f22)",
                                    color: "var(--text-normal, #dbdee1)",
                                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                                    boxSizing: "border-box",
                                    resize: "vertical",
                                }}
                            />
                        </FormField>

                        {customType === "html" && (
                            <FormField title="Custom CSS (Optional)">
                                <textarea
                                    value={customCss}
                                    onChange={e => setCustomCss(e.target.value)}
                                    rows={4}
                                    placeholder=".my-class { color: red; }"
                                    style={{
                                        width: "100%",
                                        fontFamily: "monospace",
                                        fontSize: "12px",
                                        padding: "8px",
                                        borderRadius: "6px",
                                        backgroundColor: "var(--background-tertiary, #1e1f22)",
                                        color: "var(--text-normal, #dbdee1)",
                                        border: "1px solid var(--background-modifier-accent, #3f4147)",
                                        boxSizing: "border-box",
                                        resize: "vertical",
                                    }}
                                />
                            </FormField>
                        )}
                    </Flex>
                ) : (
                    <Card variant="primary" style={{ padding: "16px", minHeight: "150px" }}>
                        <BaseText size="xs" color="text-muted" style={{ marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Preview in User Area:
                        </BaseText>
                        <div style={{ padding: "12px", backgroundColor: "var(--background-secondary, #2b2d31)", borderRadius: "8px" }}>
                            {customCss && <style>{customCss}</style>}
                            {customType === "html" ? (
                                <div
                                    dangerouslySetInnerHTML={{
                                        __html: customCode
                                            .replace(/{username}/g, "TestcordUser")
                                            .replace(/{time}/g, new Date().toLocaleTimeString())
                                            .replace(/{date}/g, new Date().toLocaleDateString()),
                                    }}
                                />
                            ) : (
                                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                    React component will be compiled and executed when saved.
                                </div>
                            )}
                        </div>
                    </Card>
                )}
            </div>

        </Modal>
    );
}
