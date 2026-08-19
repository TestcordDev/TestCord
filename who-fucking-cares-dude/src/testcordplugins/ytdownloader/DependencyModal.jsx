/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { closeModal, ModalCloseButton, ModalContent, ModalHeader, ModalRoot } from "@utils/modal";
import { Button, useEffect, useState } from "@webpack/common";
export function DependencyModal({ props, options: { key, checkytdlp, checkdeno } }) {
    const checking = <span>Checking...</span>;
    const installed = <span style={{ color: "green" }}>Installed!</span>;
    const notInstalled = (color) => <span style={{ color }}>Not installed.</span>;
    const [ytdlpStatus, setYtdlpStatus] = useState(checking);
    const [denoStatus, setDenoStatus] = useState(checking);
    useEffect(() => {
        checkytdlp().then(v => v ? setYtdlpStatus(installed) : setYtdlpStatus(notInstalled("red")));
        checkdeno().then(v => v ? setDenoStatus(installed) : setDenoStatus(notInstalled("red")));
    }, []);
    return (<ModalRoot {...props} size={"medium" /* ModalSize.MEDIUM */}>
            <ModalHeader>
                <BaseText size="lg" weight="semibold" style={{ flexGrow: 1 }}>YTdownloader: Missing dependencies</BaseText>
                <ModalCloseButton onClick={() => closeModal(key)}/>
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "16px 0" }}>
                    <BaseText size="md">
                        The YTdownloader plugin requires <strong>yt-dlp</strong> and <strong>deno</strong> to be installed on your system.
                        <br /><br />
                        <strong>Tutorial:</strong>
                        <ul style={{ listStyleType: "disc", marginLeft: "1rem", marginBottom: "10px" }}>
                            <li>
                                <strong>yt-dlp:</strong> It is recommended to install yt-dlp using Python.
                                <br />
                                <a href="https://github.com/yt-dlp/yt-dlp/wiki/Installation" target="_blank" rel="noreferrer">Click here for yt-dlp installation guide (Python recommended)</a>
                            </li>
                            <li>
                                <strong>deno:</strong> Install deno via the official installer.
                                <br />
                                <a href="https://deno.land/manual/getting_started/installation" target="_blank" rel="noreferrer">Click here for Deno installation guide</a>
                            </li>
                        </ul>
                        <em>Note: Make sure both are added to your system PATH. You may need to restart Discord after installing.</em>
                    </BaseText>
                    <div style={{
            marginTop: "16px",
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gridTemplateRows: "repeat(2, 1fr)",
            columnGap: "16px",
            rowGap: "8px"
        }}>
                        <div style={{ gridArea: "1 / 1 / 2 / 2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <BaseText size="md" weight="bold">
                                yt-dlp status: {ytdlpStatus}
                            </BaseText>
                        </div>
                        <Button onClick={async () => {
            setYtdlpStatus(checking);
            setYtdlpStatus(await checkytdlp() ? installed : notInstalled("red"));
        }} style={{ gridArea: "1 / 2 / 2 / 3" }}>
                            Check again
                        </Button>
                        <div style={{ gridArea: "2 / 1 / 3 / 2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <BaseText size="md" weight="bold">
                                Deno status: {denoStatus}
                            </BaseText>
                        </div>
                        <Button onClick={async () => {
            setDenoStatus(checking);
            setDenoStatus(await checkdeno() ? installed : notInstalled("red"));
        }} style={{ gridArea: "2 / 2 / 3 / 3" }}>
                            Check again
                        </Button>
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>);
}
