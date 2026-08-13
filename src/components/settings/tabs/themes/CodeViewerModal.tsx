/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./CodeViewerModal.css";

import { Button } from "@components/Button";
import { Paragraph } from "@components/Paragraph";
import { copyToClipboard } from "@utils/clipboard";
import { classNameFactory } from "@utils/css";
import { Modal, React, showToast, Toasts, useMemo, useRef, useState } from "@webpack/common";

const cl = classNameFactory("vc-code-viewer-");

export interface CodeViewerModalProps {
    modalProps: any;
    title: string;
    code: string;
    /** If true, the textarea is editable and a Save button is shown */
    editable?: boolean;
    /** Called with the new code when the user clicks Save */
    onSave?: (newCode: string) => Promise<void> | void;
    /** If provided, shows a "Save as Local Theme" button (for remote/marketplace code) */
    onSaveAsLocal?: (code: string) => Promise<void> | void;
}

/** Pure React CSS syntax highlighter component */
function HighlightedCode({ code }: { code: string }) {
    const lines = useMemo(() => code.split("\n"), [code]);

    const highlightLine = React.useCallback((line: string) => {
        if (!line) return "\n";

        // Regex for basic CSS tokens
        const tokenRegex = /(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(@[\w-]+)|([a-zA-Z0-9_\-*.#:[\]="'>~^$]+)(?=\s*\{)|([\w-]+)(?=\s*:)|(#[a-fA-F0-9]{3,8}|rgba?\(.*?\)|hsla?\(.*?\))|(\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|ms|s|deg)?)|([{}();,])/g;

        const elements: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = tokenRegex.exec(line)) !== null) {
            if (match.index > lastIndex) {
                elements.push(line.slice(lastIndex, match.index));
            }

            const [full, comment, stringLit, atRule, selector, prop, color, numberUnit, punct] = match;

            let className = "vc-code-token-default";
            if (comment) className = "vc-code-token-comment";
            else if (stringLit) className = "vc-code-token-string";
            else if (atRule) className = "vc-code-token-atrule";
            else if (selector) className = "vc-code-token-selector";
            else if (prop) className = "vc-code-token-property";
            else if (color) className = "vc-code-token-color";
            else if (numberUnit) className = "vc-code-token-number";
            else if (punct) className = "vc-code-token-punct";

            elements.push(
                <span key={match.index} className={className}>
                    {full}
                </span>
            );

            lastIndex = tokenRegex.lastIndex;
        }

        if (lastIndex < line.length) {
            elements.push(line.slice(lastIndex));
        }

        return elements;
    }, []);

    return (
        <pre className="vc-code-highlight-pre">
            {lines.map((line, idx) => (
                <div key={idx} className="vc-code-line">
                    {highlightLine(line)}
                </div>
            ))}
        </pre>
    );
}

export function CodeViewerModal({ modalProps, title, code, editable, onSave, onSaveAsLocal }: CodeViewerModalProps) {
    const [value, setValue] = useState(code);
    const [saving, setSaving] = useState(false);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);

    const dirty = value !== code;
    const lineCount = useMemo(() => value.split("\n").length, [value]);

    // Sync vertical scroll between textarea, line numbers gutter, and syntax highlighter layer
    const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
        const { scrollTop } = e.currentTarget;
        const { scrollLeft } = e.currentTarget;
        if (gutterRef.current) gutterRef.current.scrollTop = scrollTop;
        if (highlightRef.current) {
            highlightRef.current.scrollTop = scrollTop;
            highlightRef.current.scrollLeft = scrollLeft;
        }
    };

    const handleCopy = () => {
        copyToClipboard(value);
        showToast("Code copied to clipboard!", Toasts.Type.SUCCESS);
    };

    const handleSave = async () => {
        if (!onSave) return;
        setSaving(true);
        try {
            await onSave(value);
            showToast("Saved changes!", Toasts.Type.SUCCESS);
            modalProps.onClose();
        } catch (e: any) {
            showToast(`Failed to save: ${e?.message ?? "Unknown error"}`, Toasts.Type.FAILURE);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveAsLocal = async () => {
        if (!onSaveAsLocal) return;
        setSaving(true);
        try {
            await onSaveAsLocal(value);
            showToast("Saved as local theme!", Toasts.Type.SUCCESS);
        } catch (e: any) {
            showToast(`Failed to save: ${e?.message ?? "Unknown error"}`, Toasts.Type.FAILURE);
        } finally {
            setSaving(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        // Tab / Shift+Tab indenting
        if (e.key === "Tab") {
            e.preventDefault();
            if (!editable || !textareaRef.current) return;
            const start = textareaRef.current.selectionStart;
            const end = textareaRef.current.selectionEnd;

            if (e.shiftKey) {
                if (start === end) {
                    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
                    if (value.substring(lineStart, lineStart + 4) === "    ") {
                        const newValue = value.substring(0, lineStart) + value.substring(lineStart + 4);
                        setValue(newValue);
                        setTimeout(() => {
                            textareaRef.current?.setSelectionRange(start - 4, start - 4);
                        }, 0);
                    }
                }
            } else {
                const indentStr = "    ";
                const newValue = value.substring(0, start) + indentStr + value.substring(end);
                setValue(newValue);
                setTimeout(() => {
                    textareaRef.current?.setSelectionRange(start + 4, start + 4);
                }, 0);
            }
        }
    };

    return (
        <Modal {...modalProps} size="lg" title={title}>
            <div className={cl("body")}>
                {!editable && (
                    <Paragraph className={cl("hint")}>
                        This is a read-only preview. Use "Save as Local Theme" to keep your own editable copy.
                    </Paragraph>
                )}

                {/* Editor Container */}
                <div className="vc-code-viewer-editor-wrapper theme-dark wrap">
                    {/* Line Numbers Gutter */}
                    <div className="vc-code-viewer-gutter" ref={gutterRef}>
                        {Array.from({ length: lineCount }).map((_, i) => (
                            <div key={i + 1} className="vc-code-gutter-line">
                                {i + 1}
                            </div>
                        ))}
                    </div>

                    {/* Editor Input Area with Syntax Highlight Overlay */}
                    <div className="vc-code-viewer-code-area">
                        <div className="vc-code-viewer-highlight-layer" ref={highlightRef}>
                            <HighlightedCode code={value} />
                        </div>
                        <textarea
                            ref={textareaRef}
                            className={cl("textarea")}
                            value={value}
                            onChange={editable ? e => setValue(e.currentTarget.value) : undefined}
                            onScroll={handleScroll}
                            onKeyDown={handleKeyDown}
                            readOnly={!editable}
                            spellCheck={false}
                            wrap="soft"
                        />
                    </div>
                </div>

                {/* Footer Actions */}
                <div className={cl("actions")}>
                    <Button variant="secondary" onClick={handleCopy}>
                        Copy Code
                    </Button>
                    {onSaveAsLocal && (
                        <Button variant="secondary" onClick={handleSaveAsLocal} disabled={saving}>
                            Save as Local Theme
                        </Button>
                    )}
                    {editable && onSave && (
                        <Button variant="primary" onClick={handleSave} disabled={saving || !dirty}>
                            {saving ? "Saving..." : "Save Changes"}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
}
