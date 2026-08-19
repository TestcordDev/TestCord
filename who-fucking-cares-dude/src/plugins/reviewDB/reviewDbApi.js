/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Toasts } from "@webpack/common";
import { Auth, authorize, getToken, updateAuth } from "./auth";
import { settings } from "./settings";
import { showToast } from "./utils";
const API_URL = "https://manti.vendicated.dev/api/reviewdb";
export const REVIEWS_PER_PAGE = 50;
const WarningFlag = 0b00000010;
async function rdbRequest(path, options = {}) {
    const headers = {
        Accept: "application/json",
        Authorization: await getToken() ?? "",
        ...options.headers,
    };
    if (options.body) {
        headers["Content-Type"] = "application/json";
    }
    const res = await fetch(API_URL + path, {
        ...options,
        headers,
    }).catch(err => {
        showToast("Network error: Failed to connect to ReviewDB.", Toasts.Type.FAILURE);
        return null;
    });
    if (!res)
        return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const message = data?.message ?? `ReviewDB: Request failed with status ${res.status}`;
        showToast(message, Toasts.Type.FAILURE);
        return null;
    }
    return data;
}
export async function getReviews(id, { limit, offset = 0, fetchVotes = false } = {}) {
    let flags = 0;
    if (!settings.store.showWarning)
        flags |= WarningFlag;
    const params = new URLSearchParams();
    if (flags)
        params.append("flags", String(flags));
    if (offset)
        params.append("offset", String(offset));
    if (limit)
        params.append("limit", String(limit));
    const votesPromise = fetchVotes ? getReviewVotes(id).catch(() => []) : Promise.resolve([]);
    const req = await fetch(`${API_URL}/users/${id}/reviews?${params}`);
    const res = (req.ok)
        ? await req.json()
        : {
            message: req.status === 429 ? "You are sending requests too fast. Wait a few seconds and try again." : "An Error occured while fetching reviews. Please try again later.",
            reviews: [],
            updated: false,
            hasNextPage: false,
            reviewCount: 0,
            hasOptedOut: false,
        };
    if (!req.ok) {
        showToast(res.message, Toasts.Type.FAILURE);
        return {
            ...res,
            reviews: [
                {
                    id: 0,
                    comment: res.message,
                    star: 0,
                    timestamp: 0,
                    type: 3 /* ReviewType.System */,
                    sender: {
                        id: 0,
                        username: "ReviewDB",
                        profilePhoto: "https://cdn.discordapp.com/avatars/1134864775000629298/3f87ad315b32ee464d84f1270c8d1b37.png?size=256&format=webp&quality=lossless",
                        discordID: "1134864775000629298",
                        badges: []
                    }
                }
            ]
        };
    }
    if (!fetchVotes || res.reviews.length === 0)
        return res;
    const votes = await votesPromise;
    if (votes.length === 0)
        return res;
    const voteByReviewId = new Map();
    for (const vote of votes) {
        voteByReviewId.set(vote.reviewID, vote.isUpvote);
    }
    res.reviews = res.reviews.map(review => ({
        ...review,
        userVote: voteByReviewId.get(review.id) ?? null,
    }));
    return res;
}
export async function getReviewVotes(id) {
    const token = await getToken();
    if (!token)
        return [];
    const res = await rdbRequest(`/users/${id}/reviews/votes`);
    return res?.votes ?? [];
}
export async function addReview(review) {
    const token = await getToken();
    if (!token) {
        showToast("Please authorize to add a review.");
        authorize();
        return null;
    }
    const data = await rdbRequest(`/users/${review.userid}/reviews`, {
        method: "PUT",
        body: JSON.stringify(review),
    });
    if (data?.message)
        showToast(data.message);
    return data;
}
export async function deleteReview(id) {
    const data = await rdbRequest(`/users/${id}/reviews`, {
        method: "DELETE",
        body: JSON.stringify({
            reviewid: id
        })
    });
    if (data?.message)
        showToast(data.message);
    return data;
}
export async function reportReview(id) {
    const data = await rdbRequest("/reports", {
        method: "PUT",
        body: JSON.stringify({
            reviewid: id,
        })
    });
    if (data?.message)
        showToast(data.message);
}
export async function voteReview(id, isUpvote) {
    const token = await getToken();
    if (!token) {
        showToast("Please authorize to vote on reviews.");
        authorize();
        return false;
    }
    const data = await rdbRequest(`/reviews/${id}/vote`, {
        method: "POST",
        body: JSON.stringify({ isUpvote })
    });
    if (!data)
        return false;
    return true;
}
export async function deleteReviewVote(id) {
    const token = await getToken();
    if (!token) {
        showToast("Please authorize to vote on reviews.");
        authorize();
        return false;
    }
    const data = await rdbRequest(`/reviews/${id}/vote`, {
        method: "DELETE",
    });
    if (!data)
        return false;
    return true;
}
async function patchBlock(action, userId) {
    const data = await rdbRequest("/blocks", {
        method: "PATCH",
        body: JSON.stringify({
            action: action,
            discordId: userId
        })
    });
    if (!data)
        return;
    showToast(`Successfully ${action}ed user`, Toasts.Type.SUCCESS);
    if (Auth?.user?.blockedUsers) {
        const newBlockedUsers = action === "block"
            ? [...Auth.user.blockedUsers, userId]
            : Auth.user.blockedUsers.filter(id => id !== userId);
        updateAuth({ user: { ...Auth.user, blockedUsers: newBlockedUsers } });
    }
}
export const blockUser = (userId) => patchBlock("block", userId);
export const unblockUser = (userId) => patchBlock("unblock", userId);
export async function fetchBlocks() {
    return await rdbRequest("/blocks") ?? [];
}
export function getCurrentUserInfo() {
    return rdbRequest("/users", {
        method: "POST",
    });
}
export async function readNotification(id) {
    return await rdbRequest(`/notifications?id=${id}`, {
        method: "PATCH"
    });
}
