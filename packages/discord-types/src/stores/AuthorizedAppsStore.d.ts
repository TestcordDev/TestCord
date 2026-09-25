import { FluxStore } from "..";

export interface AuthorizedAppToken {
    id: string;
    application: { id: string; parent_id?: string | null; [key: string]: unknown; };
    scopes: string[];
}

export type AuthorizedAppsFetchState = "NOT_FETCHED" | "FETCHING" | "FETCHED";

export class AuthorizedAppsStore extends FluxStore {
    getNewestTokenForApplication(applicationId: string): AuthorizedAppToken | null;
    getNewestTokens(): AuthorizedAppToken[];
    /** tokens whose application has no parent_id */
    getNewestTokensForNonChildrenApplications(): AuthorizedAppToken[];
    getFetchState(): AuthorizedAppsFetchState;
    getFetchStateForApplication(applicationId: string): AuthorizedAppsFetchState;
    /** incremented whenever a fetch state changes */
    getApplicationFetchStateVersion(): number;
}
