import { FluxStore } from "..";

export interface PrivateChannelSortEntry {
    channelId: string;
    lastMessageId: string;
    isFavorite: boolean;
    isRequest: boolean;
}

export class PrivateChannelSortStore extends FluxStore {
    getPrivateChannelIds(): string[];
    /** returns [favorites, others], both sorted by last message */
    getSortedChannels(): [PrivateChannelSortEntry[], PrivateChannelSortEntry[]];
    /** returns a map of channel ids to last message ids */
    serializeForOverlay(): Record<string, string>;
}
