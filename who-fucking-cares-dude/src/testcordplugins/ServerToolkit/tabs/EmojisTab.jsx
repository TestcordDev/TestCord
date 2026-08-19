/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { copyWithToast } from "@utils/discord";
import { EmojiStore, Forms, React, Text, useMemo } from "@webpack/common";
export function EmojisTab({ guild }) {
    const emojis = useMemo(() => {
        const e = EmojiStore.getGuilds?.()?.[guild.id]?.emojis
            ?? EmojiStore.getDisambiguatedEmojiContext?.(guild.id)?.getById
            ?? [];
        return Array.isArray(e) ? e : Object.values(e ?? {});
    }, [guild.id]);
    const stickers = useMemo(() => {
        return guild.stickers ?? [];
    }, [guild.id]);
    const animated = emojis.filter((e) => e.animated);
    const stat = emojis.filter((e) => !e.animated);
    const renderEmoji = (e) => {
        const url = `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}?size=48&quality=lossless`;
        return (<div key={e.id} className="gt-emoji" title={`:${e.name}: — ${e.id}`} onClick={() => copyWithToast(`<${e.animated ? "a" : ""}:${e.name}:${e.id}>`)}>
                <img src={url} alt={e.name}/>
                <span className="gt-emoji-name">:{e.name}:</span>
            </div>);
    };
    return (<div className="gt-emojis">
            <Forms.FormSection title={`Static Emojis (${stat.length})`}>
                <div className="gt-emoji-grid">{stat.map(renderEmoji)}</div>
            </Forms.FormSection>

            <Forms.FormSection title={`Animated Emojis (${animated.length})`}>
                <div className="gt-emoji-grid">{animated.map(renderEmoji)}</div>
            </Forms.FormSection>

            <Forms.FormSection title={`Stickers (${stickers.length})`}>
                {stickers.length === 0 ? (<Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>No stickers</Text>) : (<div className="gt-sticker-grid">
                        {stickers.map((s) => (<div key={s.id} className="gt-sticker" title={s.description ?? s.name} onClick={() => copyWithToast(s.id)}>
                                <img src={`https://media.discordapp.net/stickers/${s.id}.png?size=160`} alt={s.name}/>
                                <span className="gt-sticker-name">{s.name}</span>
                            </div>))}
                    </div>)}
            </Forms.FormSection>
        </div>);
}
