/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { addChannelToolbarButton, addHeaderBarButton, ChannelToolbarButton, HeaderBarButton, removeChannelToolbarButton, removeHeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Clickable, Popout, React } from "@webpack/common";

const logger = new Logger("BetterFormattingRedux");

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
    enableWrapperSyntax: {
        type: OptionType.BOOLEAN,
        description: "Convert wrapper syntax (e.g. ^^text^^) to Unicode on send",
        default: true,
    },
    showButton: {
        type: OptionType.BOOLEAN,
        description: "Show the formatting button in the chat bar",
        default: true,
    },
});

const SlateUtils = findByPropsLazy("getSelectedText");
const Transforms = findByPropsLazy("insertNodes", "textToText");

function getSlateEditor(): any {
    try {
        const el = document.querySelector("[class*='channelTextArea'] [class*='textArea']");
        if (!el) return null;
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
        if (!fiberKey) return null;
        let node = (el as any)[fiberKey];
        while (node) {
            const sn = node.stateNode;
            if (sn && typeof sn === "object" && sn.constructor?.name !== "Object") {
                if (sn.ref?.current?.getSlateEditor) {
                    return sn.ref.current.getSlateEditor();
                }
            }
            node = node.return;
        }
        return null;
    } catch {
        return null;
    }
}

function focusEditor() {
    try {
        const el = document.querySelector("[class*='channelTextArea'] [class*='textArea']");
        (el as HTMLElement)?.focus();
    } catch { /* */ }
}

const replaceList = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}";
const superscriptList = " !\"#$%&'⁽⁾*⁺,⁻./⁰¹²³⁴⁵⁶⁷⁸⁹:;<⁼>?@ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾQᴿˢᵀᵁᵛᵂˣʸᶻ[\\]^_`ᵃᵇᶜᵈᵉᶠᵍʰĩʲᵏˡᵐⁿᵒᵖᑫʳˢᵗᵘᵛʷˣʸᶻ{|}";
const smallCapsList = " !\"#$%&'()*+,-./0123456789:;<=>?@ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ[\\]^_`ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ{|}";
const fullwidthList = "　！＂＃＄％＆＇（）＊＋，－．／０１２３４５６７８９：；＜＝＞？＠ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ［＼］＾＿｀ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ｛｜｝";
const upsidedownList = " ¡\"#$%℘,)(*+'-˙/0ƖᄅƐㄣϛ9ㄥ86:;>=<¿@∀qƆpƎℲפHIſʞ˥WNOԀQɹS┴∩ΛMXλZ]\\[^‾,ɐqɔpǝɟƃɥᴉɾʞlɯuodbɹsʇnʌʍxʎz}|{";
const leetList = " !\"#$%&'()*+,-./0123456789:;<=>?@48CD3FG#IJK1MN0PQЯ57UVWXY2[\\]^_`48cd3fg#ijk1mn0pqЯ57uvwxy2{|}";
const thiccList = "　!\"#$%&'()*+,-./0123456789:;<=>?@卂乃匚刀乇下厶卄工丁长乚从ん口尸㔿尺丂丅凵リ山乂丫乙[\\]^_`卂乃匚刀乇下厶卄工丁长乚从ん口尸㔿尺丂丅凵リ山乂丫乙{|}";

function mapChars(list: string, text: string): string {
    return text.split("").map(char => {
        const i = replaceList.indexOf(char);
        return i !== -1 ? list[i] : char;
    }).join("");
}

function wrapOrUnwrap(wrapper: string, text: string): string {
    if (text.startsWith(wrapper) && text.endsWith(wrapper))
        return text.slice(wrapper.length, -wrapper.length);
    return `${wrapper}${text}${wrapper}`;
}

function mapLines(prefix: string, text: string): string {
    return text.split("\n").map(l => l.startsWith(prefix) ? l.slice(prefix.length) : `${prefix}${l}`).join("\n");
}

type FormatTag =
    | "bold" | "italic" | "underline" | "strikethrough" | "spoiler"
    | "code" | "codeblock" | "blockquote" | "list"
    | "superscript" | "smallcaps" | "fullwidth" | "upsidedown"
    | "varied" | "1337" | "thicc" | "uppercase" | "lowercase" | "firstcaps";

interface FormatDef { tag: FormatTag; icon: string; tooltip: string; }

const FORMATS: FormatDef[] = [
    { tag: "bold", icon: "B", tooltip: "Bold" },
    { tag: "italic", icon: "I", tooltip: "Italic" },
    { tag: "underline", icon: "U", tooltip: "Underline" },
    { tag: "strikethrough", icon: "S̶", tooltip: "Strikethrough" },
    { tag: "spoiler", icon: "!", tooltip: "Spoiler" },
    { tag: "code", icon: "<>", tooltip: "Inline Code" },
    { tag: "codeblock", icon: "{ }", tooltip: "Codeblock" },
    { tag: "blockquote", icon: "»", tooltip: "Blockquote" },
    { tag: "list", icon: "•", tooltip: "Bullet List" },
    { tag: "superscript", icon: "x²", tooltip: "Superscript" },
    { tag: "smallcaps", icon: "SC", tooltip: "Small Caps" },
    { tag: "fullwidth", icon: "Ｆ", tooltip: "Fullwidth" },
    { tag: "upsidedown", icon: "∩", tooltip: "Upside Down" },
    { tag: "varied", icon: "V", tooltip: "Varied Caps" },
    { tag: "1337", icon: "13", tooltip: "Leet Speak" },
    { tag: "thicc", icon: "丅", tooltip: "Extra Thicc" },
    { tag: "uppercase", icon: "AA", tooltip: "UPPERCASE" },
    { tag: "lowercase", icon: "aa", tooltip: "lowercase" },
    { tag: "firstcaps", icon: "Aa", tooltip: "First Caps" },
];

function formatText(tag: FormatTag, text: string): string {
    switch (tag) {
        case "bold": return wrapOrUnwrap("**", text);
        case "italic": return wrapOrUnwrap("*", text);
        case "underline": return wrapOrUnwrap("__", text);
        case "strikethrough": return wrapOrUnwrap("~~", text);
        case "spoiler": return wrapOrUnwrap("||", text);
        case "code": return wrapOrUnwrap("`", text);
        case "codeblock":
            if (text.startsWith("```") && text.endsWith("```")) return text.slice(3, -3).trim();
            return `\`\`\`\n${text}\n\`\`\``;
        case "blockquote": return mapLines("> ", text);
        case "list": return mapLines("- ", text);
        case "superscript": return mapChars(superscriptList, text);
        case "smallcaps": return mapChars(smallCapsList, text);
        case "fullwidth": return mapChars(fullwidthList, text);
        case "upsidedown": return mapChars(upsidedownList, text).split("").reverse().join("");
        case "varied": return text.split("").map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join("");
        case "1337": return mapChars(leetList, text);
        case "thicc": return mapChars(thiccList, text);
        case "uppercase": return text.toUpperCase();
        case "lowercase": return text.toLowerCase();
        case "firstcaps": return text.split(" ").map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
        default: return text;
    }
}

function applyToSlate(tag: FormatTag): void {
    const slate = getSlateEditor();
    if (!slate?.selection) {
        logger.debug("No slate editor or selection");
        return;
    }
    const selectedText = SlateUtils.getSelectedText(slate) ?? "";
    if (!selectedText) return;

    const formatted = formatText(tag, selectedText);

    Transforms.delete(slate, { at: slate.selection });
    Transforms.insertText(slate, formatted);

    focusEditor();
}

function ToolbarPopout({ closePopout }: { closePopout: () => void; }) {
    const handleFormat = (tag: FormatTag) => {
        applyToSlate(tag);
        closePopout();
        setTimeout(focusEditor, 50);
    };

    return (
        <div className="bfr-toolbar" style={{ background: "#2b2d31", border: "1px solid #1e1f22", borderRadius: 8, padding: 8, display: "flex", flexWrap: "wrap", gap: 2, maxWidth: 420 }}>
            {FORMATS.map(f => (
                <Clickable
                    key={f.tag}
                    className="bfr-toolbar-btn"
                    onClick={() => handleFormat(f.tag)}
                    aria-label={f.tooltip}
                >
                    <span className="bfr-toolbar-btn-label">{f.icon}</span>
                    <span className="bfr-toolbar-btn-tooltip">{f.tooltip}</span>
                </Clickable>
            ))}
        </div>
    );
}

const FormatIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24">
        <text x="3" y="18" fontSize="16" fontWeight="bold" fill="currentColor" fontFamily="Arial, sans-serif">Aa</text>
    </svg>
);

const FORMAT_BUTTON_KEYS = ["showButton"] as const;

const FormatButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { showButton } = settings.use(FORMAT_BUTTON_KEYS);
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLDivElement>(null);

    if (!isMainChat || !showButton || settings.store.location !== "chatbar") return null;

    return (
        <div ref={buttonRef} style={{ display: "inline-flex", alignItems: "center" }}>
            <Popout
                position="top"
                align="center"
                spacing={8}
                animation={Popout.Animation.NONE}
                shouldShow={open}
                onRequestClose={() => setOpen(false)}
                targetElementRef={buttonRef}
                renderPopout={() => <ToolbarPopout closePopout={() => setOpen(false)} />}
            >
                {(_, { isShown }) => (
                    <ChatBarButton
                        tooltip={isShown ? "" : "Text Formatting"}
                        onClick={() => setOpen(v => !v)}
                    >
                        <FormatIcon />
                    </ChatBarButton>
                )}
            </Popout>
        </div>
    );
};

function HeaderFormatButton() {
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLDivElement>(null);

    return (
        <div ref={buttonRef} style={{ display: "inline-flex", alignItems: "center" }}>
            <Popout
                position="bottom"
                align="center"
                spacing={8}
                animation={Popout.Animation.NONE}
                shouldShow={open}
                onRequestClose={() => setOpen(false)}
                targetElementRef={buttonRef}
                renderPopout={() => <ToolbarPopout closePopout={() => setOpen(false)} />}
            >
                {(_, { isShown }) => (
                    <HeaderBarButton
                        icon={FormatIcon}
                        tooltip={isShown ? null : "Text Formatting"}
                        onClick={() => setOpen(v => !v)}
                    />
                )}
            </Popout>
        </div>
    );
}

function ChannelFormatButton() {
    const [open, setOpen] = React.useState(false);
    const buttonRef = React.useRef<HTMLDivElement>(null);

    return (
        <div ref={buttonRef} style={{ display: "inline-flex", alignItems: "center" }}>
            <Popout
                position="bottom"
                align="center"
                spacing={8}
                animation={Popout.Animation.NONE}
                shouldShow={open}
                onRequestClose={() => setOpen(false)}
                targetElementRef={buttonRef}
                renderPopout={() => <ToolbarPopout closePopout={() => setOpen(false)} />}
            >
                {(_, { isShown }) => (
                    <ChannelToolbarButton
                        icon={FormatIcon}
                        tooltip={isShown ? null : "Text Formatting"}
                        onClick={() => setOpen(v => !v)}
                    />
                )}
            </Popout>
        </div>
    );
}

const wrapperMap: Record<string, (text: string) => string> = {
    "^^": text => mapChars(superscriptList, text),
    "%%": text => mapChars(smallCapsList, text),
    "##": text => mapChars(fullwidthList, text),
    "&&": text => mapChars(upsidedownList, text).split("").reverse().join(""),
    "==": text => text.split("").map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join(""),
    "++": text => mapChars(leetList, text),
    "$$": text => mapChars(thiccList, text),
    "--": text => text.split(" ").map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w).join(" "),
    ">>": text => text.toUpperCase(),
    "<<": text => text.toLowerCase(),
};

const WRAPPER_REGEX = /\^^(.+?)\^\^|%%(.+?)%%|##(.+?)##|&&(.+?)&&|==(.+?)==|\+\+(.+?)\+\+|\$\$(.+?)\$\$|--(.+?)--|>>(.+?)>>|<<(.+?)<</g;
const wrapperKeys = Object.keys(wrapperMap);

function transformSendTime(text: string): string {
    const escapes: string[] = [];
    const SENTINEL = "\u0000";
    let prepared = text.replace(/\\\^\\\^|\\%%|\\##|\\&&|\\==|\\\+\\\+|\\\$\$|\\--|\\>>|\\<</g, m => {
        escapes.push(m.slice(1));
        return SENTINEL;
    });
    prepared = prepared.replace(WRAPPER_REGEX, (...args) => {
        for (let i = 1; i <= wrapperKeys.length; i++) {
            if (args[i] !== undefined) return wrapperMap[wrapperKeys[i - 1]](args[i]);
        }
        return args[0];
    });
    let escapeIdx = 0;
    return prepared.replace(new RegExp(SENTINEL, "g"), () => escapes[escapeIdx++] ?? "");
}

export default definePlugin({
    name: "BetterFormattingRedux",
    description: "Adds a formatting toolbar to the chat bar with text styling options.",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b, EquicordDevs.omaw],
    dependencies: ["ChatInputButtonAPI", "MessageEventsAPI", "HeaderBarAPI"],
    settings,

    onBeforeMessageSend(_, message) {
        if (!settings.store.enableWrapperSyntax || !message.content) return;
        message.content = transformSendTime(message.content);
    },

    chatBarButton: {
        icon: FormatIcon,
        render: FormatButton,
    },

    start() {
        const { location } = settings.store;
        if (location === "headerbar") {
            addHeaderBarButton("BetterFormattingRedux", HeaderFormatButton, 5);
        } else if (location === "channeltoolbar") {
            addChannelToolbarButton("BetterFormattingRedux", ChannelFormatButton, 5);
        }
    },

    stop() {
        removeHeaderBarButton("BetterFormattingRedux");
        removeChannelToolbarButton("BetterFormattingRedux");
    },
});
