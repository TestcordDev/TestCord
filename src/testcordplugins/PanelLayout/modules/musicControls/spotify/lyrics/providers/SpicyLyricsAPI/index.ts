/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LyricsData, LyricWord, Provider, SyncedLyric } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";

/** Which catalogue answered. `spicy_lyrics` is a community sync; `apple_music` and `spotify` are the commercial catalogues. Branch on this rather than on the track: the same track can be answered by a different source tomorrow, and that is a feature rather than a breaking change. */
type Source = "spicy_lyrics" | "apple_music" | "spotify" | "unknown";

interface Contributor {
    id: string;
    /** Display name where one is set, otherwise the username. */
    username: string;
    /** The contributor's public profile page. Derived from `id`, so it is stable for as long as the account is, and it is the link a credit line should point at. */
    url: string;
    /** Avatar URL. Absent when the contributor has none. */
    avatar?: string;
    hasProfileBanner?: boolean;
}

/** Present only when `source` is `spicy_lyrics` (a community sync). Credit the uploader, and the maker when one is given. `Maker` is omitted entirely rather than sent empty when there is no distinct maker, so an absent key means 'do not render a maker credit' rather than 'render an empty one'. */
interface Attribution {
    Uploader: Contributor;
    Maker?: Contributor;
}

/** One syllable, with its own timing. Consecutive syllables belonging to the same word are joined by `IsPartOfWord`. */
interface Syllable {
    /** The syllable text, without trailing whitespace. */
    Text: string;
    /** Seconds from the start of the track. */
    StartTime?: number;
    /** Seconds from the start of the track. */
    EndTime?: number;
    /** True when the next syllable continues the same word, so no space is inserted between them. */
    IsPartOfWord?: boolean;
    /** A romanisation of the text, when the source carries one. */
    TransliteratedText?: string;
}

/** A timed group of syllables: either the lead vocal of a line, or one background phrase within it. A whole-group `TransliteratedText` and the per-syllable ones can both be present; prefer the syllable-level values when you are rendering word by word. */
interface VocalGroup {
    Syllables: Syllable[];
    /** Seconds from the start of the track. */
    StartTime?: number;
    /** Seconds from the start of the track. */
    EndTime?: number;
    /** A romanisation of the text, when the source carries one. */
    TransliteratedText?: string;
    /** A translation of the text, when the source carries one. */
    TranslatedText?: string;
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
    HasTranslations?: true;
}

/** One line of a word-level sync. */
interface SyllableLine {
    Type: "Vocal";
    /** True when this line belongs to a secondary singer and should be rendered on the opposite side. */
    OppositeAligned?: boolean;
    Lead: VocalGroup;
    /** Background vocals sung over this line. Absent when the line has none. */
    Background?: VocalGroup[];
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
    HasTranslations?: true;
}

/** One line of a line-level sync. */
interface LineLine {
    Type: "Vocal";
    OppositeAligned?: boolean;
    /** The full line. Background vocals, if any, are appended in parentheses. */
    Text: string;
    /** Seconds from the start of the track. */
    StartTime?: number;
    /** Seconds from the start of the track. */
    EndTime?: number;
    /** A romanisation of the text, when the source carries one. */
    TransliteratedText?: string;
    /** A translation of the text, when the source carries one. */
    TranslatedText?: string;
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
    HasTranslations?: true;
}

/** One line of an untimed sync. */
interface StaticLine {
    Text: string;
    /** A romanisation of the text, when the source carries one. */
    TransliteratedText?: string;
    /** A translation of the text, when the source carries one. */
    TranslatedText?: string;
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
    HasTranslations?: true;
}

/** A word-level sync: every syllable carries its own timing. */
interface SyllableLyrics {
    /** The Spotify track id this sync belongs to. */
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
    HasTranslations?: true;
    Type: "Syllable";
    StartTime?: number;
    EndTime?: number;
    Content: SyllableLine[];
}

/** A line-level sync: each line is timed, the words within it are not. */
interface LineLyrics {
    /** The Spotify track id this sync belongs to. */
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
    HasTranslations?: true;
    Type: "Line";
    StartTime?: number;
    EndTime?: number;
    Content: LineLine[];
}

/** An untimed sync: plain lines with no timing information at all. */
interface StaticLyrics {
    /** The Spotify track id this sync belongs to. */
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    /** Present and `true` when this element, or something inside it, carries a transliteration. */
    HasTransliterations?: true;
    /** Present and `true` when this element, or something inside it, carries a translation. */
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

function buildWords(syllables: Syllable[]): LyricWord[] {
    const words: LyricWord[] = [];

    syllables.forEach((syllable, i) => {
        const piece = (syllable.Text ?? "").trim();
        if (!piece) return;

        const continuesPrevious = i > 0 && syllables[i - 1].IsPartOfWord === true;

        if (continuesPrevious && words.length) {
            const last = words[words.length - 1];
            last.text += piece;
            last.endTime = syllable.EndTime ?? last.endTime;
        } else {
            words.push({
                text: piece,
                startTime: syllable.StartTime ?? 0,
                endTime: syllable.EndTime ?? syllable.StartTime ?? 0
            });
        }
    });

    return words;
}

function fromSyllableLine(line: SyllableLine): SyncedLyric | null {
    if (line.Type !== "Vocal" || !line.Lead) return null;

    const words = buildWords(line.Lead.Syllables ?? []);
    const text = words.map(w => w.text).join(" ").trim();

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

export async function getLyricsSpicyLyrics(trackId: string, apiKey: string): Promise<LyricsData | null> {
    try {
        const resp = await fetch(`https://api.spicylyrics.org/v1/lyrics/${trackId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
        });

        console.info("[Spicy Lyrics] is ", resp);

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

        return {
            useLyric: Provider.SpicyLyrics,
            lyricsVersions: {
                "Spicy Lyrics": lines
            }
        };
    } catch (e) {
        console.info("[Spicy Lyrics]: ", e);
        return null;
    }
}
