/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Button } from "@components/Button";
import { Divider } from "@components/Divider";
import { HeadingPrimary, HeadingSecondary } from "@components/Heading";
import { Margins } from "@utils/margins";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalRoot } from "@utils/modal";
import { RestAPI, SearchableSelect, useEffect, useMemo, useRef, useState } from "@webpack/common";
const DEFAULT_MESSAGES = [
    "t'as pute d'yemma",
    "ta chienne d'yemma sale suceuse de bite",
    "mechante tchoupeuse que t'es w'Allah",
    "t'es un geek un ptn de nerd",
    "hm ?",
    "SUCEUSE DE BEUTEU",
    "TU KIFF ?",
    "AU FOND DTA GE-GOR",
    "DE PTITE SUCEUSE",
    "SALE CHINNE",
    "GRANDE LANGUEUSE",
    "TA SAINTE PUTE DE MERE",
    "ENFANT DE CATIN",
    "ENFANT DE VIOLE",
    "TA PTITE SOEUR LA CATIN D'CHIENNE",
    "sale ptite chienne t'as pute d'yemma qui se soumet a moi",
    "je vais te hmak ta chienne d'yemma sale suceuse de bite",
    "mechante tchoupeuse que t'es w'Allah tu sais rien faire",
    "t'es un geek un ptn de nerd sale chienne t'es immonde",
];
const DELAY_OPTIONS = [
    { label: "0ms", value: "0" },
    { label: "50ms", value: "50" },
    { label: "100ms", value: "100" },
    { label: "250ms", value: "250" },
    { label: "500ms", value: "500" },
    { label: "1s", value: "1000" },
    { label: "2s", value: "2000" },
    { label: "5s", value: "5000" },
];
function makeNonce() {
    const DISCORD_EPOCH = 1420070400000n;
    const nowMs = BigInt(Date.now());
    const tsPart = (nowMs - DISCORD_EPOCH) << 22n;
    const rndPart = BigInt(Math.floor(Math.random() * 0x3FFFFF));
    return String(tsPart | rndPart);
}
export function FloodModal({ channel, rootProps, onRunningChange }) {
    const [messages, setMessages] = useState(DEFAULT_MESSAGES);
    const [fileName, setFileName] = useState(null);
    const [delayMs, setDelayMs] = useState("500");
    const [shuffle, setShuffle] = useState(true);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState("");
    const timerRef = useRef(null);
    const indexRef = useRef(0);
    const runningRef = useRef(false);
    const delayOptions = useMemo(() => DELAY_OPTIONS, []);
    useEffect(() => { onRunningChange(running); }, [running]);
    useEffect(() => {
        return () => {
            runningRef.current = false;
            if (timerRef.current)
                clearTimeout(timerRef.current);
        };
    }, []);
    function startFlood() {
        if (runningRef.current || messages.length === 0)
            return;
        runningRef.current = true;
        indexRef.current = 0;
        setRunning(true);
        setStatus("En cours...");
        scheduleNext();
    }
    function stopFlood() {
        runningRef.current = false;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        setRunning(false);
        setStatus("Stopped");
    }
    function scheduleNext(extraDelay = 0) {
        const ms = Number(delayMs);
        const delay = Math.max(0, (ms > 0 ? ms : 50) + extraDelay);
        timerRef.current = setTimeout(tick, delay);
    }
    async function tick() {
        if (!runningRef.current || messages.length === 0) {
            stopFlood();
            return;
        }
        const idx = shuffle
            ? Math.floor(Math.random() * messages.length)
            : indexRef.current % messages.length;
        indexRef.current++;
        try {
            const response = await RestAPI.post({
                url: `/channels/${channel.id}/messages`,
                body: { content: messages[idx], nonce: makeNonce(), tts: false }
            });
            if (response.status === 429) {
                setStatus("Rate limited — waiting...");
                if (runningRef.current)
                    scheduleNext(1000);
                return;
            }
            setStatus(`Sent: ${++indexRef.current - 1}`);
        }
        catch {
            setStatus("Network error...");
        }
        if (runningRef.current)
            scheduleNext();
    }
    function handleFileLoad() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".txt";
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = e => {
                const lines = (e.target?.result)
                    .split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length > 0) {
                    setMessages(lines);
                    setFileName(`${file.name} (${lines.length} phrases)`);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
    return (<ModalRoot {...rootProps}>
            <ModalHeader className="vc-flood-modal-header">
                <HeadingPrimary className="vc-flood-modal-title">Flood Panel</HeadingPrimary>
                <ModalCloseButton onClick={rootProps.onClose}/>
            </ModalHeader>

            <ModalContent className="vc-flood-modal-content">

                {/* Messages source */}
                <HeadingSecondary className={Margins.bottom8}>Messages source</HeadingSecondary>
                <div className="vc-flood-file-info">
                    {fileName ?? `Default (${messages.length} phrases)`}
                </div>
                <div className={`vc-flood-file-row ${Margins.bottom16}`}>
                    <Button variant="secondary" size="small" onClick={handleFileLoad}>
                        Load .txt
                    </Button>
                    <Button variant="secondary" size="small" onClick={() => { setMessages(DEFAULT_MESSAGES); setFileName(null); }}>
                        Default
                    </Button>
                </div>

                <Divider className={Margins.bottom16}/>

                {/* Delay */}
                <HeadingSecondary className={Margins.bottom8}>Delay between messages</HeadingSecondary>
                <div className={Margins.bottom16}>
                    <SearchableSelect options={delayOptions} value={delayOptions.find(o => o.value === delayMs)?.value} placeholder="Choose a delay" maxVisibleItems={8} closeOnSelect={true} onChange={(v) => setDelayMs(v)}/>
                </div>

                {/* Status */}
                {status !== "" && (<div className="vc-flood-status">
                        {running && <div className="vc-flood-spinner"/>}
                        <span className={running ? "vc-flood-status-active" : "vc-flood-status-idle"}>
                            {status}
                        </span>
                    </div>)}

            </ModalContent>

            <ModalFooter className="vc-flood-modal-footer">
                <Button variant={running ? "dangerPrimary" : "positive"} size="medium" onClick={running ? stopFlood : startFlood}>
                    {running ? "Stop flood" : "Start flood"}
                </Button>
                <Button variant="secondary" size="medium" onClick={rootProps.onClose}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>);
}
