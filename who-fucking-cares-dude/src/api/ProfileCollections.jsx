/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { useEffect, UserStore, useState } from "@webpack/common";
const logger = new Logger("ProfileCollectionAPI");
const profileCollections = new Map();
const profileCollectionListeners = new Set();
/**
 * Adds a collection to the user profile panel.
 *
 * @param id - Unique identifier for the collection (e.g., "my-plugin-profile-collection")
 * @param render - Function that returns the collection JSX. Receives the full profile props object.
 * @param priority - Higher values appear first. Default: 0
 *
 * @example
 * addProfileCollection("my-collection", (props) => (
 *     <div>Custom content for {props.user.id}</div>
 * ));
 */
export function addProfileCollection(id, render, priority = 0) {
    profileCollections.set(id, { render, priority });
    profileCollectionListeners.forEach(listener => listener());
}
/**
 * Removes a collection from the user profile panel.
 *
 * @param id - The identifier used when adding the collection
 */
export function removeProfileCollection(id) {
    profileCollections.delete(id);
    profileCollectionListeners.forEach(listener => listener());
}
function ProfileCollections({ props }) {
    const [, forceUpdate] = useState(0);
    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        profileCollectionListeners.add(listener);
        return () => { profileCollectionListeners.delete(listener); };
    }, []);
    return Array.from(profileCollections)
        .sort(([, a], [, b]) => b.priority - a.priority)
        .map(([id, { render: Collection }]) => (<ErrorBoundary noop key={id} onError={e => logger.error(`Failed to render profile collection: ${id}`, e.error)}>
                <Collection {...props} user={props.user ?? props.currentUser}/>
            </ErrorBoundary>));
}
/** @internal Injected by ProfileCollectionAPI patch (do NOT call directly) */
export function renderProfileCollections(props) {
    return <ProfileCollections props={props}/>;
}
/** @internal Injected where Discord only exposes a user ID. */
export function renderProfileCollectionsForUser(userId, isSideBar = false) {
    const user = UserStore.getUser(userId);
    return user ? <ProfileCollections props={{ user, isSideBar }}/> : null;
}
