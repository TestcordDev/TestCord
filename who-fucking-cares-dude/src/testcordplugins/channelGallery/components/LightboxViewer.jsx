/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { findByPropsLazy } from "@webpack";
import { Button, React, useEffect } from "@webpack/common";
const jumper = findByPropsLazy("jumpToMessage");
function preload(url) {
    const img = new Image();
    img.src = url;
}
export function LightboxViewer(props) {
    const { items, index, channelId, onClose, onChangeIndex } = props;
    const item = items[index];
    const url = item?.url;
    const hasPrev = index > 0;
    const hasNext = index < items.length - 1;
    const prevIndex = hasPrev ? index - 1 : index;
    const nextIndex = hasNext ? index + 1 : index;
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
            else if (e.key === "ArrowLeft" && hasPrev) {
                e.preventDefault();
                onChangeIndex(prevIndex);
            }
            else if (e.key === "ArrowRight" && hasNext) {
                e.preventDefault();
                onChangeIndex(nextIndex);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [hasNext, hasPrev, nextIndex, onChangeIndex, onClose, prevIndex]);
    // Preload neighbors for smoother navigation.
    useEffect(() => {
        const prev = items[prevIndex];
        const next = items[nextIndex];
        if (prev?.url)
            preload(prev.url);
        if (next?.url)
            preload(next.url);
    }, [items, nextIndex, prevIndex]);
    if (!item || !url)
        return null;
    const jump = () => {
        try {
            jumper.jumpToMessage({
                channelId,
                messageId: item.messageId,
                flash: true,
                jumpType: "INSTANT"
            });
        }
        finally {
            props.onOpenMessage();
        }
    };
    return (<div style={{
            position: "relative",
            height: "100%",
            width: "100%",
            background: "var(--background-primary)"
        }}>
            <div style={{
            position: "absolute",
            top: 12,
            right: 12,
            display: "flex",
            gap: 8,
            zIndex: 2
        }}>
                <Button size={Button.Sizes.SMALL} onClick={jump}>
                    Open message
                </Button>
                <Button size={Button.Sizes.SMALL} onClick={onClose}>
                    Close
                </Button>
            </div>

            <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24
        }}>
                {/* Click zones for prev/next (match Discord viewer UX) */}
                <div onClick={() => hasPrev && onChangeIndex(prevIndex)} style={{
            position: "absolute",
            inset: 0,
            width: "50%",
            cursor: hasPrev ? "w-resize" : "default",
            pointerEvents: hasPrev ? "auto" : "none"
        }}/>
                <div onClick={() => hasNext && onChangeIndex(nextIndex)} style={{
            position: "absolute",
            inset: 0,
            left: "50%",
            width: "50%",
            cursor: hasNext ? "e-resize" : "default",
            pointerEvents: hasNext ? "auto" : "none"
        }}/>
                <img src={url} alt={item.filename ?? "Image"} style={{
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            borderRadius: 12,
            background: "var(--background-secondary)"
        }}/>
            </div>

            <div style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2
        }}>
                <Button size={Button.Sizes.SMALL} disabled={!hasPrev} onClick={() => hasPrev && onChangeIndex(prevIndex)}>
                    Prev
                </Button>
            </div>
            <div style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            zIndex: 2
        }}>
                <Button size={Button.Sizes.SMALL} disabled={!hasNext} onClick={() => hasNext && onChangeIndex(nextIndex)}>
                    Next
                </Button>
            </div>
        </div>);
}
