/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { classNameFactory } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { React, UploadManager, useDrag, useDrop } from "@webpack/common";

const AttachmentItem = findComponentByCodeLazy(/channelId:\i,draftType:\i,upload:\i,/);
const ItemType = "DND_ATTACHMENT";
const cl = classNameFactory("vc-drag-att-");

interface UploadItem {
    id: string;
    filename?: string;
    clip?: unknown;
}

interface DragItem {
    id: string;
}

interface DraggableItemProps {
    uploadItem: UploadItem;
    moveItem: (fromId: string, toId: string) => void;
    children: React.ReactNode;
}

const DraggableItem = ({ uploadItem, moveItem, children }: DraggableItemProps) => {
    const [{ isDragging }, drag] = useDrag({
        type: ItemType,
        item: { id: uploadItem.id },
        collect: monitor => ({ isDragging: monitor.isDragging() })
    });

    const [{ isOver }, drop] = useDrop({
        accept: ItemType,
        collect: monitor => ({
            isOver: monitor.isOver()
        }),
        hover: (draggedItem: DragItem) => {
            moveItem(draggedItem.id, uploadItem.id);
        },
        drop: (draggedItem: DragItem) => {
            moveItem(draggedItem.id, uploadItem.id);
        }
    });

    return (
        <div
            key={uploadItem.id}
            ref={node => {
                drag(drop(node));
            }}
            className={
                classes(
                    cl("item"),
                    isDragging && cl("dragging"),
                    isOver && cl("drop-target")
                )
            }
        >
            {children}
        </div>
    );
};

interface DraggableListProps {
    channelId: string;
    draftType: number;
    keyboardModeEnabled: boolean;
    size: unknown;
    attachments: UploadItem[];
    ignoredId?: string;
    ignoredFilename?: string;
}

const DraggableList = ({
    channelId,
    draftType,
    keyboardModeEnabled,
    size,
    attachments,
    ignoredId,
    ignoredFilename
}: DraggableListProps) => {
    const forceUpdate = useForceUpdater();
    const ignored = ignoredId ?? ignoredFilename;
    const isIgnored = (a: UploadItem) => Boolean(ignored) && (a.id === ignored || a.filename === ignored);

    const items = attachments.filter(a => !isIgnored(a));

    const moveItem = (fromId: string, toId: string) => {
        const from = items.findIndex(item => item.id === fromId);
        const to = items.findIndex(item => item.id === toId);
        if (from === -1 || to === -1 || from === to) return;

        const nextItems = [...items];
        nextItems.splice(to, 0, ...nextItems.splice(from, 1));

        // Keep Discord's non-rendered upload entries in their original slots.
        let itemIndex = 0;
        const next = attachments.map(attachment =>
            isIgnored(attachment) ? attachment : nextItems[itemIndex++]
        );
        attachments.splice(0, attachments.length, ...next);
        UploadManager.setUploads({ uploads: next, channelId, draftType });
        forceUpdate();
    };

    return items.map(uploadItem => (
        <DraggableItem
            key={uploadItem.id}
            uploadItem={uploadItem}
            moveItem={moveItem}
        >
            <AttachmentItem
                channelId={channelId}
                upload={uploadItem}
                draftType={draftType}
                keyboardModeEnabled={keyboardModeEnabled}
                clip={uploadItem.clip}
                size={size}
            />
        </DraggableItem>
    ));
};

export default definePlugin({
    name: "ReorderAttachments",
    description: "Allows you to reorder attachments before sending them",
    authors: [{ name: "Suffocate", id: 772601756776923187n }, TestcordDevs.sirphantom89],
    tags: ["Accessibility"],
    patches: [
        {
            find: ')("attachments",',
            replacement: [
                {
                    match: /:(\i)\.map\(\i=>.{0,50}?(channelId:\i,.{0,150}?\i\.\i\.MEDIUM)},.{0,20}?\i\.id\)\)(?<=\1=(\i)\.filter\(\i=>\i\.(?:id|filename)!==(\i)\).{0,450})/,
                    replace: ":$self.DraggableList({$2,attachments:$3,ignoredId:$4})"
                }
            ]
        },
        {
            find: '"video/quicktime","video/mp4"];',
            replacement: [
                {
                    match: /"img",{src:\i,/,
                    replace: "$&draggable:false,"
                }
            ]
        }
    ],
    DraggableList
});
