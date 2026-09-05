/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { CodeBlock } from "@components/CodeBlock";
import { copyWithToast, openImageModal } from "@utils/discord";
import { ModalContent, openModal } from "@utils/modal";
import { saveFile } from "@utils/web";
import { Modal, React, useMemo } from "@webpack/common";

const CopyIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
        <path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" />
    </svg>
);

const DownloadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
        <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
    </svg>
);

function getLanguageFromExtension(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    const langMap: Record<string, string> = {
        js: "javascript",
        jsx: "javascript",
        ts: "typescript",
        tsx: "typescript",
        py: "python",
        rb: "ruby",
        java: "java",
        c: "c",
        cpp: "cpp",
        cs: "csharp",
        go: "go",
        rs: "rust",
        php: "php",
        html: "html",
        css: "css",
        scss: "scss",
        sass: "sass",
        less: "less",
        json: "json",
        xml: "xml",
        yaml: "yaml",
        yml: "yaml",
        md: "markdown",
        sql: "sql",
        sh: "bash",
        bash: "bash",
        ps1: "powershell",
        r: "r",
        kt: "kotlin",
        swift: "swift",
        lua: "lua",
        diff: "diff",
        patch: "diff",
    };

    return langMap[ext] || "";
}

interface TextFileModalProps {
    blob: Blob;
    buffer: ArrayBuffer;
    name: string;
    onClose: () => void;
    transitionState: number;
}

interface PreviewActionButtonProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}

function PreviewActionButton({ icon, label, onClick }: PreviewActionButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={label}
            style={{
                background: "var(--background-floating)",
                border: "1px solid var(--background-modifier-accent)",
                borderRadius: "4px",
                padding: "4px 6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                color: "var(--interactive-normal)",
                fontSize: "12px",
                gap: "4px",
            }}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

function TextFileModal({ name, blob, buffer, transitionState, onClose }: TextFileModalProps) {
    const text = useMemo(() => {
        try {
            return new TextDecoder().decode(new Uint8Array(buffer));
        } catch {
            return null;
        }
    }, [buffer]);

    const language = useMemo(() => getLanguageFromExtension(name), [name]);

    const handleCopy = () => {
        if (text) copyWithToast(text, "Text copied to clipboard!");
    };

    const handleDownload = () => {
        saveFile(new File([blob], name, { type: blob.type || "application/octet-stream" }));
    };

    return (
        <Modal transitionState={transitionState} onClose={onClose} size="lg" title={name}>
            <ModalContent style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "8px",
                    flexWrap: "wrap"
                }}>
                    {text && (
                        <PreviewActionButton
                            icon={<CopyIcon />}
                            label="Copy"
                            onClick={handleCopy}
                        />
                    )}
                    <PreviewActionButton
                        icon={<DownloadIcon />}
                        label="Download"
                        onClick={handleDownload}
                    />
                </div>

                {text ? (
                    language ? (
                        <div style={{
                            background: "var(--background-secondary)",
                            borderRadius: "8px",
                            border: "2px solid var(--background-modifier-accent)",
                            overflow: "hidden",
                            maxHeight: "50vh",
                            width: "100%",
                        }}>
                            <div style={{ overflow: "auto", maxHeight: "50vh" }}>
                                <CodeBlock lang={language} content={text} />
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            background: "var(--background-secondary)",
                            borderRadius: "8px",
                            border: "2px solid var(--background-modifier-accent)",
                            padding: "16px",
                            maxHeight: "50vh",
                            overflow: "auto",
                            overflowX: "auto",
                            width: "100%",
                        }}>
                            <pre style={{
                                whiteSpace: "pre",
                                wordBreak: "normal",
                                margin: 0,
                                fontFamily: "monospace",
                                fontSize: "14px",
                                lineHeight: "1.5",
                                color: "var(--header-primary)",
                            }}>{text}</pre>
                        </div>
                    )
                ) : (
                    <div style={{
                        background: "var(--background-secondary)",
                        borderRadius: "8px",
                        border: "2px solid var(--background-modifier-accent)",
                        color: "var(--text-muted)",
                        textAlign: "center",
                        padding: "20px",
                        width: "100%",
                    }}>
                        Cannot preview this binary file
                    </div>
                )}
            </ModalContent>
        </Modal>
    );
}

export default function openFilePreview(name: string, blob: Blob, buffer: ArrayBuffer) {
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const images = ["png", "jpg", "jpeg", "gif", "webp", "avif"];

    if (images.includes(ext)) {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = typeof reader.result === "string" ? reader.result : "";
            if (!dataUrl) return;

            openImageModal({
                url: dataUrl,
                original: dataUrl,
                width: 1920,
                height: 1080,
            });
        };
        reader.readAsDataURL(blob);
        return;
    }

    openModal(props => (
        <TextFileModal
            name={name}
            blob={blob}
            buffer={buffer}
            transitionState={props.transitionState}
            onClose={props.onClose}
        />
    ));
}
