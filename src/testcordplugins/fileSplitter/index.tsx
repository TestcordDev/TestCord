/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { TestcordDevs } from "@utils/constants";
import {
    ModalContent,
    ModalFooter,
    ModalProps,
    openModal,
} from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import {
    Button,
    Modal,
    React,
    useState,
} from "@webpack/common";

const settings = definePluginSettings({
    chunkSize: {
        type: OptionType.NUMBER,
        description: "Chunk size in MB (1-100)",
        default: 10,
        isValid: (value: number) => value >= 1 && value <= 100,
    },
    autoRejoin: {
        type: OptionType.BOOLEAN,
        description: "Automatically join files after download",
        default: true,
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        description: "Show split progress",
        default: true,
    },
});

interface FileChunk {
    data: ArrayBuffer;
    index: number;
    total: number;
    filename: string;
}

function FileSplitterModal({ modalProps }: { modalProps: ModalProps; }) {
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [chunks, setChunks] = useState<FileChunk[]>([]);
    const [downloadLinks, setDownloadLinks] = useState<string[]>([]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setChunks([]);
            setDownloadLinks([]);
            setProgress(0);
        }
    };

    const splitFile = async () => {
        if (!file) return;

        setIsProcessing(true);
        setProgress(0);

        try {
            const chunkSizeBytes = settings.store.chunkSize * 1024 * 1024; // Convert MB to bytes
            const totalChunks = Math.ceil(file.size / chunkSizeBytes);
            const newChunks: FileChunk[] = [];

            console.log(
                `🎯 File Splitter: Splitting ${file.name} (${(
                    file.size /
                    1024 /
                    1024
                ).toFixed(2)} MB) into ${totalChunks} chunks`
            );

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSizeBytes;
                const end = Math.min(start + chunkSizeBytes, file.size);
                const chunk = file.slice(start, end);
                const arrayBuffer = await chunk.arrayBuffer();

                newChunks.push({
                    data: arrayBuffer,
                    index: i + 1,
                    total: totalChunks,
                    filename: `${file.name}.part${i + 1}`,
                });

                setProgress(((i + 1) / totalChunks) * 100);

                if (settings.store.showProgress) {
                    console.log(
                        `🎯 File Splitter: Chunk ${i + 1}/${totalChunks} created`
                    );
                }
            }

            setChunks(newChunks);
            console.log(
                `✅ File Splitter: Successfully split ${file.name} into ${totalChunks} chunks`
            );
        } catch (error) {
            console.error("❌ File Splitter: Error splitting file:", error);
        } finally {
            setIsProcessing(false);
        }
    };

    const downloadChunk = (chunk: FileChunk) => {
        const blob = new Blob([chunk.data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = chunk.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadAllChunks = () => {
        chunks.forEach(chunk => {
            setTimeout(() => downloadChunk(chunk), chunk.index * 100); // Stagger downloads
        });
    };

    const generateRejoinScript = () => {
        if (!file || chunks.length === 0) return;

        const script = `@echo off
echo Rejoining ${file.name}...
copy /b "${file.name}.part1" + "${file.name}.part2"${chunks.length > 2 ? ' + "' + file.name + '.part3"' : ""
            }${chunks.length > 3 ? ' + "' + file.name + '.part4"' : ""}${chunks.length > 4 ? ' + "' + file.name + '.part5"' : ""
            }${chunks.length > 5 ? ' + "' + file.name + '.part6"' : ""}${chunks.length > 6 ? ' + "' + file.name + '.part7"' : ""
            }${chunks.length > 7 ? ' + "' + file.name + '.part8"' : ""}${chunks.length > 8 ? ' + "' + file.name + '.part9"' : ""
            }${chunks.length > 9 ? ' + "' + file.name + '.part10"' : ""} "${file.name}"
echo File rejoined successfully!
pause`;

        const blob = new Blob([script], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `rejoin_${file.name}.bat`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    return (
        <Modal {...modalProps} size="lg" title="🔪 File Splitter">
            <ModalContent>
                <div style={{ padding: "16px" }}>
                    <BaseText size="md" style={{ marginBottom: "16px" }}>
                        Split large files into multiple parts to bypass size limits.
                    </BaseText>

                    <div style={{ marginBottom: "16px" }}>
                        <input
                            type="file"
                            onChange={handleFileSelect}
                            style={{ marginBottom: "8px" }}
                        />
                        {file && (
                            <BaseText size="sm" style={{ color: "var(--text-muted)" }}>
                                Selected file: {file.name} (
                                {(file.size / 1024 / 1024).toFixed(2)} MB)
                            </BaseText>
                        )}
                    </div>

                    {file && (
                        <div style={{ marginBottom: "16px" }}>
                            <Button
                                onClick={splitFile}
                                disabled={isProcessing}
                                color={Button.Colors.BRAND}
                            >
                                {isProcessing ? "Splitting in progress..." : "Split file"}
                            </Button>
                        </div>
                    )}

                    {isProcessing && (
                        <div style={{ marginBottom: "16px" }}>
                            <BaseText size="sm">Progress: {progress.toFixed(1)}%</BaseText>
                            <div
                                style={{
                                    width: "100%",
                                    height: "8px",
                                    backgroundColor: "var(--background-modifier-accent)",
                                    borderRadius: "4px",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        width: `${progress}%`,
                                        height: "100%",
                                        backgroundColor: "var(--brand-experiment)",
                                        transition: "width 0.3s ease",
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {chunks.length > 0 && (
                        <div>
                            <BaseText
                                size="md"
                                weight="semibold"
                                style={{ marginBottom: "12px" }}
                            >
                                Files created ({chunks.length} parts):
                            </BaseText>

                            <div style={{ marginBottom: "16px" }}>
                                <Button
                                    onClick={downloadAllChunks}
                                    color={Button.Colors.GREEN}
                                    style={{ marginRight: "8px" }}
                                >
                                    📥 Download all
                                </Button>
                                <Button
                                    onClick={generateRejoinScript}
                                    color={Button.Colors.PRIMARY}
                                    look={(Button as any).Looks.OUTLINED}
                                >
                                    🔧 Rejoin script
                                </Button>
                            </div>

                            <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                                {chunks.map(chunk => (
                                    <div
                                        key={chunk.index}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            padding: "8px",
                                            backgroundColor: "var(--background-modifier-accent)",
                                            borderRadius: "4px",
                                            marginBottom: "4px",
                                        }}
                                    >
                                        <BaseText size="sm">
                                            {chunk.filename} (
                                            {(chunk.data.byteLength / 1024 / 1024).toFixed(2)} MB)
                                        </BaseText>
                                        <Button
                                            onClick={() => downloadChunk(chunk)}
                                            size={Button.Sizes.SMALL}
                                            color={Button.Colors.PRIMARY}
                                            look={Button.Looks.LINK}
                                        >
                                            Download
                                        </Button>
                                    </div>
                                ))}
                            </div>

                            <BaseText
                                size="sm"
                                style={{ color: "var(--text-muted)", marginTop: "12px" }}
                            >
                                💡 Download all .part files and run the .bat script to
                                reconstruct the original file.
                            </BaseText>
                        </div>
                    )}
                </div>
            </ModalContent>
            <ModalFooter>
                <Flex justifyContent="flex-end">
                    <Button
                        onClick={modalProps.onClose}
                        color={Button.Colors.PRIMARY}
                        look={(Button as any).Looks.OUTLINED}
                    >
                        Close
                    </Button>
                </Flex>
            </ModalFooter>
        </Modal>
    );
}

export default definePlugin({
    name: "File Splitter",
    description:
        "Split large files into multiple parts to bypass size limits and share them easily.",
    tags: ["Utility", "Chat"],
    authors: [TestcordDevs.x2b],
    settings,

    toolboxActions: {
        "File Splitter": () => {
            openModal(modalProps => <FileSplitterModal modalProps={modalProps as any} />);
        },
    },
});
