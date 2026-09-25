import { FluxStore } from "..";

export class UserProfileSettingsStore extends FluxStore {
    get selectedGuildId(): string | undefined;
    getPendingChanges(guildId?: string): Record<string, any>;
    getFormState(): unknown;
    getErrors(guildId?: string): Record<string, unknown>;
    getTryItOutChanges(): Record<string, unknown>;
    hasTryItOutChanges(): boolean;
    /** true if any pending change exists for the user or any guild */
    hasUnsavedChanges(): boolean;
    /** true if there are pending changes for the user or the selected guild */
    showNotice(): boolean;
    /** false if a pending bio is over the length limit */
    canSubmit(): boolean;
}
