/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { showApiKeyWarning } from "@utils/apiKeyWarning";
import definePlugin, { OptionType } from "@utils/types";
import { ComponentDispatch, MediaEngineStore, React, showToast, Toasts, useEffect, useRef, useState } from "@webpack/common";

import { getGroqKey } from "../TestcordAI/groqManager";

// ── Settings ──────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    location: {
        type: OptionType.SELECT,
        description: "Where to show the button",
        options: [
            { label: "Chat bar", value: "chatbar", default: true },
            { label: "Header bar", value: "headerbar" },
            { label: "Channel toolbar", value: "channeltoolbar" },
            { label: "Disabled", value: "disabled" },
        ],
        restartNeeded: true,
    },
    language: {
        type: OptionType.SELECT,
        description: "Transcription language. Auto-detect may occasionally hallucinate English.",
        options: [
            { label: "French (Français)", value: "fr", default: true },
            { label: "English (Anglais)", value: "en" },
            { label: "Spanish (Español)", value: "es" },
            { label: "German (Deutsch)", value: "de" },
            { label: "Italian (Italiano)", value: "it" },
            { label: "Portuguese (Português)", value: "pt" },
            { label: "Auto-detect", value: "" }
        ],
        restartNeeded: false,
    },
    chunkSeconds: {
        type: OptionType.SLIDER,
        description: "Audio segment duration (seconds). Shorter = more reactive but less precise.",
        markers: [1, 2, 3, 5, 8, 10],
        default: 2,
        restartNeeded: false,
    },
});

// ── SVG Icon ──────────────────────────────────────────────────────────────────

const DictationIcon: React.FC<{ recording?: boolean; processing?: boolean; height?: string | number; width?: string | number; className?: string; }> = ({ recording = false, processing = false, height = 20, width = 20, className }) => (
    <svg
        aria-hidden="true"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
        width={width}
        height={height}
        fill="none"
        viewBox="0 0 24 24"
        className={className}
        style={{ color: processing ? "var(--text-warning)" : recording ? "var(--status-danger)" : "currentColor" }}
    >
        <path fill="currentColor" d="M5.04 12c-.37 0-.7.34-.58.7A8 8 0 0 0 11 17.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-11.56 2.27.62.62 0 0 0-.7-.35c-.23.05-.47.08-.7.08Z" />
        <path fill="currentColor" d="M8 9.94V10a4 4 0 0 0 8 0V6a4 4 0 0 0-4.53-3.97c-.4.06-.47.58-.21.9A3.22 3.22 0 0 1 9.9 8l-1.16.43a.5.5 0 0 0-.3.3L8.01 9.9 8 9.94Z" />
        <path fill="currentColor" d="m9.2 3.86-.46-.17-.91-.34a2 2 0 0 1-1.18-1.18L6.14.79a1.21 1.21 0 0 0-2.28 0l-.5 1.38a2 2 0 0 1-1.19 1.18l-1.38.51a1.21 1.21 0 0 0 0 2.28l1.38.5a2 2 0 0 1 1.18 1.19l.51 1.38a1.21 1.21 0 0 0 2.28 0l.5-1.38a2 2 0 0 1 1.19-1.18L8 6.59l1.2-.45a1.21 1.21 0 0 0 0-2.28Z" />
    </svg>
);

// ── Transcription ─────────────────────────────────────────────────────────────

function insertText(text: string) {
    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
        rawText: text,
        plainText: text,
    });
}

async function transcribe(blob: Blob): Promise<string> {
    const language = settings.store.language?.trim() || undefined;

    const apiKey = await getGroqKey();

    if (!apiKey) {
        throw new Error("API key missing — Configure your key in Settings → TestcordAI");
    }

    const form = new FormData();
    form.append("file", blob, "audio.webm");
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "text");
    // Prompt to guide Whisper towards the selected language and avoid "Thank you" hallucinations
    form.append("prompt", "This is a voice dictation. Do not translate. Do not generate text if there is only silence.");
    if (language) form.append("language", language);

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Groq API ${res.status}: ${body.slice(0, 120)}`);
    }

    const text = await res.text();
    return text.trim();
}

// ── Chat Bar Button ───────────────────────────────────────────────────────────

const VoiceDictationButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [recording, setRecording] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const activeRef = useRef(false);
    const chunksRef = useRef<Blob[]>([]);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => () => { stopDictation(); }, []);

    async function startDictation() {
        const apiKey = await getGroqKey();
        if (!apiKey) {
            showApiKeyWarning("VoiceDictation");
            return;
        }

        setErrorMsg(null);
        activeRef.current = true;

        // Helper to map Discord input device to real WebAudio device
        async function getRealInputDeviceId(discordId: string): Promise<string> {
            if (!discordId || discordId === "default") return "default";
            try {
                const devs = MediaEngineStore.getInputDevices();
                const selected = devs[discordId];
                if (!selected || !selected.name) return "default";

                let webDevs = await navigator.mediaDevices.enumerateDevices();
                // trigger permissions if empty labels
                if (webDevs.some(d => d.kind === "audioinput" && !d.label)) {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    stream.getTracks().forEach(t => t.stop());
                    webDevs = await navigator.mediaDevices.enumerateDevices();
                }

                let match = webDevs.find(d => d.kind === "audioinput" && d.deviceId === discordId);

                if (!match) {
                    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
                    const normSelected = normalize(selected.name);

                    match = webDevs.find(d => {
                        if (d.kind !== "audioinput" || !d.label) return false;
                        const normLabel = normalize(d.label);
                        return normLabel.includes(normSelected) || normSelected.includes(normLabel);
                    });
                }

                if (match) {
                    console.log(`[VoiceDictation] Mapped Discord device "${selected.name}" to WebAudio deviceId "${match.deviceId}"`);
                    showToast(`Dictation: Using mic "${match.label || selected.name}"`, Toasts.Type.SUCCESS);
                    return match.deviceId;
                } else {
                    showToast(`Dictation: Could not map "${selected.name}", using default`, Toasts.Type.FAILURE);
                }
            } catch (err) {
                console.error("[VoiceDictation] Error mapping device ID:", err);
                showToast("Dictation: Error mapping device", Toasts.Type.FAILURE);
            }
            return "default";
        }

        // Open microphone
        let stream: MediaStream;
        try {
            const discordDeviceId = MediaEngineStore.getInputDeviceId();
            const realDeviceId = await getRealInputDeviceId(discordDeviceId);

            try {
                // First attempt: with the specific deviceId (works if permission is ok)
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: realDeviceId && realDeviceId !== "default"
                        ? { deviceId: { exact: realDeviceId } }
                        : true
                });
            } catch (firstErr: any) {
                if (firstErr.name === "NotAllowedError" || firstErr.name === "PermissionDeniedError") {
                    // Fallback: permission not yet granted, request without deviceId
                    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                } else {
                    throw firstErr;
                }
            }
            streamRef.current = stream;
        } catch (e: any) {
            const msg = e.name === "NotAllowedError" || e.name === "PermissionDeniedError"
                ? "Microphone permission denied — check permissions in Discord settings"
                : "Mic unavailable: " + e.message;
            setErrorMsg(msg);
            activeRef.current = false;
            return;
        }

        // Choose audio format
        const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
            .find(m => MediaRecorder.isTypeSupported(m)) ?? "";

        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
        recorderRef.current = recorder;
        chunksRef.current = [];

        recorder.ondataavailable = e => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorder.start();
        setRecording(true);

        // Flush and transcribe at regular intervals
        const chunkMs = (settings.store.chunkSeconds ?? 5) * 1000;
        timerRef.current = setInterval(() => flushAndTranscribe(), chunkMs);
    }

    async function flushAndTranscribe() {
        if (!recorderRef.current || recorderRef.current.state !== "recording") return;

        // Stop briefly to get a complete blob
        recorderRef.current.stop();

        await new Promise<void>(resolve => {
            recorderRef.current!.onstop = () => resolve();
        });

        const chunks = [...chunksRef.current];
        chunksRef.current = [];

        if (chunks.length === 0 || !activeRef.current) {
            // Restart if still active
            if (activeRef.current && streamRef.current) restartRecorder();
            return;
        }

        const mimeType = recorderRef.current?.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: mimeType });

        // Debug log
        console.log("[VoiceDictation] Blob size:", blob.size);

        if (blob.size < 500) {
            if (activeRef.current) restartRecorder();
            return; // Silence / too short
        }

        setProcessing(true);
        try {
            const text = await transcribe(blob);
            // Debug log
            console.log("[VoiceDictation] Transcribed text:", text);
            if (text && text.length > 0) {
                // Filter common Whisper hallucinations (silence → phantom text)
                const t = text.trim();
                const isHallucination =
                    // Simple exact patterns
                    /^(merci|thanks?|thank you|music|♪|🎵|\.\.\.|\.\s*)+$/i.test(t) ||
                    // Subtitling / subtitles
                    /sous[- ]?titr/i.test(t) ||
                    // Radio-Canada, SRC, etc.
                    /radio[- ]?canada|société radio/i.test(t) ||
                    // "Thanks for watching", etc.
                    /merci .*(regard|écouter|suivi)|thanks? .*watch/i.test(t) ||
                    // "Transcription by...", "Transcribed by..."
                    /transcri(ption|t)\s*(par|by)/i.test(t) ||
                    // Repetitive text (same word/syllable 3+ times)
                    /^(.{1,15})\1{2,}$/i.test(t.replace(/\s+/g, "")) ||
                    // Too short and punctuation only
                    /^[\s.,!?…\-–—]+$/.test(t);
                if (!isHallucination) insertText(text + " ");
            }
        } catch (e: any) {
            console.error("[VoiceDictation] Transcription error:", e);
            setErrorMsg(e.message.slice(0, 100));
        } finally {
            setProcessing(false);
        }

        if (activeRef.current) restartRecorder();
    }

    function restartRecorder() {
        if (!streamRef.current || !activeRef.current) return;
        try {
            const mimeType = recorderRef.current?.mimeType;
            const recorder = new MediaRecorder(
                streamRef.current,
                mimeType ? { mimeType } : {}
            );
            recorderRef.current = recorder;
            chunksRef.current = [];
            recorder.ondataavailable = e => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.start();
        } catch (e) {
            console.error("[VoiceDictation] Restart error:", e);
        }
    }

    function stopDictation() {
        activeRef.current = false;

        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (recorderRef.current?.state === "recording") {
            recorderRef.current.stop();
        }
        recorderRef.current = null;
        chunksRef.current = [];

        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setRecording(false);
        setProcessing(false);
    }

    function toggle() {
        if (recording) {
            // Flush immediate transcription on stop
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            flushAndTranscribe().finally(() => {
                stopDictation();
            });
        }
        else startDictation();
    }

    if (!isMainChat || settings.store.location !== "chatbar") return null;

    const tooltip = errorMsg || (processing
        ? "Transcribing..."
        : recording
            ? "Stop dictation"
            : "Voice dictation");

    return (
        <ChatBarButton tooltip={tooltip} onClick={toggle}>
            <DictationIcon recording={recording} processing={processing} />
        </ChatBarButton>
    );
};

// ── Plugin ────────────────────────────────────────────────────────────────────

export default definePlugin({
    name: "VoiceDictation",
    description: "Real-time voice dictation via Groq Whisper (free). API key shared with TestcordAI.",
    authors: [{ name: "User", id: 0n }],
    tags: ["Voice", "Utility"],
    dependencies: ["ChatInputButtonAPI", "HeaderBarAPI"],
    settings,

    chatBarButton: {
        icon: DictationIcon as any,
        render: VoiceDictationButton,
    },

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("VoiceDictation", () => (
                <HeaderBarButton
                    icon={() => <DictationIcon />}
                    tooltip="Voice Dictation"
                    onClick={() => {
                        showToast("Use the chat bar button for voice dictation", Toasts.Type.FAILURE);
                    }}
                />
            ), 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("VoiceDictation", () => (
                <ChannelToolbarButton
                    icon={() => <DictationIcon />}
                    tooltip="Voice Dictation"
                    onClick={() => {
                        showToast("Use the chat bar button for voice dictation", Toasts.Type.FAILURE);
                    }}
                />
            ), 5);
        }
    },

    stop() {
        removeHeaderBarButton("VoiceDictation");
        removeChannelToolbarButton("VoiceDictation");
    },
});
