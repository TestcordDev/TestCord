import { FluxStore } from "..";

export class SpellCheckStore extends FluxStore {
    hasLearnedWord(word: string): boolean;
    /** returns the first learned word found as a whole word in text */
    findLearnedWordIn(text: string): string | null;
    isEnabled(): boolean;
}
