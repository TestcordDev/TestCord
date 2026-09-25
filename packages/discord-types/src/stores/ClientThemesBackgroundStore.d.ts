import { FluxStore } from "..";

export interface GradientPreset {
    id: number;
    [key: string]: unknown;
}

export class ClientThemesBackgroundStore extends FluxStore {
    get gradientPreset(): GradientPreset | undefined;
    /** true while previewing a theme the user can't use */
    get isPreview(): boolean;
    get isCoachmark(): boolean;
    get mobilePendingThemeIndex(): number | undefined;
    /** css linear-gradient for the current preset, or null if none */
    getLinearGradient(): string | null;
}
