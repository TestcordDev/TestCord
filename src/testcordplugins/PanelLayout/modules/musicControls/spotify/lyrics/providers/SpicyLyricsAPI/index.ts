/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LyricsData, LyricWord, Provider, SyncedLyric } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";

type Source = "spicy_lyrics" | "apple_music" | "spotify" | "unknown";

interface Contributor {
    id: string;
    username: string;
    url: string;
    avatar?: string;
    hasProfileBanner?: boolean;
}

interface Attribution {
    Uploader: Contributor;
    Maker?: Contributor;
}

interface Syllable {
    Text: string;
    StartTime?: number;
    EndTime?: number;
    IsPartOfWord?: boolean;
    TransliteratedText?: string;
}

interface VocalGroup {
    Syllables: Syllable[];
    StartTime?: number;
    EndTime?: number;
    TransliteratedText?: string;
    TranslatedText?: string;
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface SyllableLine {
    Type: "Vocal";
    OppositeAligned?: boolean;
    Lead: VocalGroup;
    Background?: VocalGroup[];
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface LineLine {
    Type: "Vocal";
    OppositeAligned?: boolean;
    Text: string;
    StartTime?: number;
    EndTime?: number;
    TransliteratedText?: string;
    TranslatedText?: string;
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface StaticLine {
    Text: string;
    TransliteratedText?: string;
    TranslatedText?: string;
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface SyllableLyrics {
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    HasTransliterations?: true;
    HasTranslations?: true;
    Type: "Syllable";
    StartTime?: number;
    EndTime?: number;
    Content: SyllableLine[];
}

interface LineLyrics {
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    HasTransliterations?: true;
    HasTranslations?: true;
    Type: "Line";
    StartTime?: number;
    EndTime?: number;
    Content: LineLine[];
}

interface StaticLyrics {
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    HasTransliterations?: true;
    HasTranslations?: true;
    Type: "Static";
    Lines: StaticLine[];
}

type Lyrics = SyllableLyrics | LineLyrics | StaticLyrics;

interface SpicyLyricsAPIResp {
    Body: Lyrics;
    Status: number;
    Type: string;
}

interface SpicyLyricsAPIError {
    Body?: {
        error?: string;
        message?: string;
    };
    Status: number;
    Type: string;
}

function buildWords(syllables: Syllable[], getText: (syllable: Syllable) => string | undefined = s => s.Text): LyricWord[] {
    const words: LyricWord[] = [];

    syllables.forEach(syllable => {
        const piece = (getText(syllable) ?? "").trim();
        if (!piece) return;

        console.warn(`syllable: text: ${syllable.Text}, IsPartOfWord: ${syllable.IsPartOfWord}`);

        words.push({
            text: syllable.IsPartOfWord ? piece : piece + " ",
            startTime: syllable.StartTime ?? 0,
            endTime: syllable.EndTime ?? syllable.StartTime ?? 0,
            IsPartOfWord: syllable.IsPartOfWord ?? false
        });
    });

    return words;
}

function joinWordsText(words: LyricWord[]): string {
    return words.map(w => w.text).join("").trim();
}

function fromSyllableLine(line: SyllableLine): SyncedLyric | null {
    if (line.Type !== "Vocal" || !line.Lead) return null;

    const words = buildWords(line.Lead.Syllables ?? []);
    const text = joinWordsText(words);

    return {
        time: line.Lead.StartTime ?? 0,
        text: (text === "" || text === "♪") ? null : text,
        words: words.length ? words : undefined
    };
}

function fromLineLine(line: LineLine): SyncedLyric | null {
    if (line.Type !== "Vocal") return null;

    const text = (line.Text ?? "").trim();
    return {
        time: line.StartTime ?? 0,
        text: (text === "" || text === "♪") ? null : text
    };
}

function fromStaticLine(line: StaticLine, index: number): SyncedLyric {
    const text = (line.Text ?? "").trim();
    return {
        time: index,
        text: (text === "" || text === "♪") ? null : text
    };
}

function fromSyllableLineRomanized(line: SyllableLine): SyncedLyric | null {
    if (line.Type !== "Vocal" || !line.Lead) return null;

    const words = buildWords(line.Lead.Syllables ?? [], s => s.TransliteratedText ?? s.Text);
    const text = joinWordsText(words);

    return {
        time: line.Lead.StartTime ?? 0,
        text: (text === "" || text === "♪") ? null : text,
        words: words.length ? words : undefined
    };
}

function fromLineLineRomanized(line: LineLine): SyncedLyric | null {
    if (line.Type !== "Vocal") return null;

    const text = (line.TransliteratedText ?? line.Text ?? "").trim();
    return {
        time: line.StartTime ?? 0,
        text: (text === "" || text === "♪") ? null : text
    };
}

function fromStaticLineRomanized(line: StaticLine, index: number): SyncedLyric {
    const text = (line.TransliteratedText ?? line.Text ?? "").trim();
    return {
        time: index,
        text: (text === "" || text === "♪") ? null : text
    };
}
function hasAnyTransliteratedText(body: Lyrics): boolean {
    switch (body.Type) {
        case "Syllable":
            return body.Content.some(line =>
                line.Type === "Vocal" && (
                    !!line.Lead?.Syllables?.some(s => !!s.TransliteratedText) ||
                    !!line.Background?.some(bg => bg.Syllables?.some(s => !!s.TransliteratedText))
                )
            );
        case "Line":
            return body.Content.some(line => line.Type === "Vocal" && !!line.TransliteratedText);
        case "Static":
            return body.Lines.some(line => !!line.TransliteratedText);
        default:
            return false;
    }
}

function buildSpicyRomanizedLyrics(body: Lyrics): SyncedLyric[] | null {
    if (!hasAnyTransliteratedText(body)) return null;

    let lines: SyncedLyric[];

    switch (body.Type) {
        case "Syllable":
            lines = body.Content.map(fromSyllableLineRomanized).filter((l): l is SyncedLyric => l !== null);
            break;
        case "Line":
            lines = body.Content.map(fromLineLineRomanized).filter((l): l is SyncedLyric => l !== null);
            break;
        case "Static":
            lines = body.Lines.map(fromStaticLineRomanized);
            break;
        default:
            return null;
    }

    return lines.length >= 2 ? lines : null;
}

export async function getLyricsSpicyLyrics(trackId: string, apiKey: string): Promise<LyricsData | null> {
    try {
        const resp = await fetch(`https://api.spicylyrics.org/v1/lyrics/${trackId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        console.warn("[Spicy Lyrics] is ", resp);

        if (!resp.ok) {
            const errBody = await resp.json().catch(() => null) as SpicyLyricsAPIError | null;
            console.warn(
                "[Spicy Lyrics] request failed",
                resp.status,
                errBody?.Body?.error ?? resp.statusText,
                errBody?.Body?.message ?? ""
            );
            return null;
        }

        const data = await resp.json() as SpicyLyricsAPIResp;
        const body = data.Body;
        if (!body) return null;

        let lines: SyncedLyric[];

        switch (body.Type) {
            case "Syllable":
                lines = body.Content.map(fromSyllableLine).filter((l): l is SyncedLyric => l !== null);
                break;
            case "Line":
                lines = body.Content.map(fromLineLine).filter((l): l is SyncedLyric => l !== null);
                break;
            case "Static":
                lines = body.Lines.map(fromStaticLine);
                break;
            default:
                return null;
        }

        if (lines.length < 2) return null;

        if (body.Type !== "Static" && lines[0].time === 0 && lines[lines.length - 1].time === 0) return null;

        const spicyRomanizedLines = buildSpicyRomanizedLyrics(body);

        return {
            useLyric: Provider.SpicyLyrics,
            lyricsVersions: {
                [Provider.SpicyLyrics]: lines,
                ...(spicyRomanizedLines ? { [Provider.SpicyRomanized]: spicyRomanizedLines } : {})
            }
        };
    } catch (e) {
        console.error("[Spicy Lyrics]: ", e);
        return null;
    }
}
