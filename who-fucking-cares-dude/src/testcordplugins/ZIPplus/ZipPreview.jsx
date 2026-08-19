/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { FolderIcon } from "@components/Icons";
import { React, useEffect, useState } from "@webpack/common";
import openFilePreview from "./FilePreview";
import { unzipBlob } from "./unzip";
// Discord-style chevron icons
const ChevronDown = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" fill="currentColor"/>
    </svg>);
const ChevronUp = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z" fill="currentColor"/>
    </svg>);
// Back arrow icon
const ArrowLeft = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" fill="currentColor"/>
    </svg>);
// File icon
const FileIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="currentColor"/>
    </svg>);
function formatSize(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(2)} KB`;
    if (n < 1024 * 1024 * 1024)
        return `${(n / 1024 / 1024).toFixed(2)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function createTreeNode(path, parent) {
    return {
        files: {},
        folders: {},
        parent,
        path
    };
}
export default function ZipPreview({ blob, name, expanded: expandedProp, onExpandedChange }) {
    const [internalExpanded, setInternalExpanded] = useState(true);
    const expanded = typeof expandedProp === "boolean" ? expandedProp : internalExpanded;
    const setExpanded = (next) => {
        if (onExpandedChange)
            onExpandedChange(next);
        if (typeof expandedProp !== "boolean")
            setInternalExpanded(next);
    };
    const [tree, setTree] = useState(null);
    const [zipName, setZipName] = useState(name ?? null);
    const [zipSize, setZipSize] = useState(null);
    useEffect(() => {
        (async () => {
            setZipSize(blob.size);
            if (!zipName) {
                if (blob instanceof File)
                    setZipName(blob.name);
            }
            const { entries, readEntry } = await unzipBlob(blob);
            const root = createTreeNode("/", null);
            for (const e of entries) {
                if (e.isDirectory)
                    continue;
                const parts = e.name.split("/").filter(Boolean);
                let cur = root;
                for (let i = 0; i < parts.length - 1; i++) {
                    const p = parts[i];
                    cur.folders[p] ??= createTreeNode(`${cur.path}${p}/`, cur);
                    cur = cur.folders[p];
                }
                cur.files[parts[parts.length - 1]] = { entry: e, read: () => readEntry(e) };
            }
            setTree(root);
        })();
    }, [blob]);
    async function openFile(name, file) {
        const ab = await file.read();
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            avif: "image/avif",
            svg: "image/svg+xml",
            bmp: "image/bmp",
            ico: "image/x-icon",
        };
        const mimeType = mimeTypes[ext] || "application/octet-stream";
        const b = new Blob([ab], { type: mimeType });
        openFilePreview(name, b, ab);
    }
    return (<div>
            <div className="zp-card">
                <div className="zp-header">
                    <div className="zp-file-icon">
                        <svg width={36} height={36} viewBox="0 0 24 24" fill="none">
                            <path d="M6 2h7l3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="var(--background-accent)"/>
                            <path d="M9 8h6v2H9zM9 11h6v2H9z" fill="var(--text-link)"/>
                        </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="zp-filename" title={zipName || name || "archive.zip"}>{zipName || name || "archive.zip"}</div>
                        <div className="zp-zipmeta">{zipSize ? formatSize(zipSize) : ""}</div>
                    </div>
                </div>

                <div className={"zp-zip-preview" + (expanded ? " expanded" : "")}>
                    {tree ? (<>
                            {tree.parent && (<div className="zp-path">
                                    <div className="zp-folder-return" onClick={() => setTree(tree.parent)}>
                                        <ArrowLeft />
                                    </div>
                                    <div className="zp-path-text">{tree.path === "/" ? "Root" : tree.path}</div>
                                </div>)}
                            {Object.keys(tree.folders).length > 0 && (<>
                                    {Object.keys(tree.folders).sort().map(name => (<div key={name} className="zp-entry-row" onClick={() => setTree(tree.folders[name])}>
                                            <div className="zp-entry-icon">
                                                <FolderIcon width={16} height={16}/>
                                            </div>
                                            <span className="zp-entry-name">{name}</span>
                                        </div>))}
                                </>)}
                            {Object.entries(tree.files).length > 0 && (<>
                                    {Object.entries(tree.files).sort(([a], [b]) => a.localeCompare(b)).map(([name, file]) => (<div key={name} className="zp-entry-row" onClick={() => openFile(name, file)}>
                                            <div className="zp-entry-icon">
                                                <FileIcon />
                                            </div>
                                            <span className="zp-entry-name">{name}</span>
                                            <span className="zp-entry-size">{formatSize(file.entry.size)}</span>
                                        </div>))}
                                </>)}
                            {Object.keys(tree.folders).length === 0 && Object.entries(tree.files).length === 0 && (<div className="zp-entry-row" style={{ cursor: "default", opacity: 0.5 }}>
                                    <span className="zp-entry-name">Empty folder</span>
                                </div>)}
                        </>) : (<div className="zp-entry-row" style={{ cursor: "default", opacity: 0.5 }}>
                            <span className="zp-entry-name">Loading...</span>
                        </div>)}
                </div>

                <div className="zp-dropdown-expander" onClick={() => setExpanded(!expanded)}>
                    {expanded ? <ChevronUp /> : <ChevronDown />}
                </div>
            </div>
        </div>);
}
