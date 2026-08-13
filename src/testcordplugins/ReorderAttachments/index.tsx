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

interface DragItem {
    id: string;
}

const DraggableItem = ({ uploadItem, moveItem, children }) => {
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

const DraggableList = ({ channelId, draftType, keyboardModeEnabled, size, attachments, ignoredFilename }) => {
    const forceUpdate = useForceUpdater();

    const items = attachments.filter(a => a.filename !== ignoredFilename);

    const moveItem = (fromId: string, toId: string) => {
        const from = items.findIndex(item => item.id === fromId);
        const to = items.findIndex(item => item.id === toId);
        if (from === -1 || to === -1 || from === to) return;

        const nextItems = [...items];
        nextItems.splice(to, 0, ...nextItems.splice(from, 1));

        // Keep Discord's non-rendered upload entries in their original slots.
        let itemIndex = 0;
        const next = attachments.map(attachment =>
            attachment.filename === ignoredFilename ? attachment : nextItems[itemIndex++]
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
                    match: /:(\i).map\(\i=>[\s\S]*?(channelId:\i,[\s\S]*?\i\.\i\.MEDIUM)},\i\.id\)\)(?<=\1=(\i)\.filter\(\i=>\i\.filename!==(\i)[\s\S]*?)/,
                    replace: ":$self.DraggableList({$2,attachments:$3,ignoredFilename:$4})"
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
