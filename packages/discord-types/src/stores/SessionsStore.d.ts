import { Activity, FluxStore } from "..";

export interface Session {
    sessionId: string;
    status: string;
    active: boolean;
    activities: Activity[];
    hiddenActivities?: Activity[];
    clientInfo: {
        version: number;
        os: string;
        client: string;
    };
}

export class SessionsStore extends FluxStore {
    getSessions(): Record<string, Session>;
    /** session for the current connection */
    getSession(): Session | null | undefined;
    getSessionById(sessionId: string): Session | undefined;
    getActiveSession(): Session | undefined;
    /** activities from the active session on another device */
    getRemoteActivities(): Activity[];
    getHiddenActivities(): Activity[];
    getRemoteApplicationActivity(applicationId: string | null | undefined): Activity | null | undefined;
}
