/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { proxyLazyWebpack } from "@webpack";
import { Constants, Flux, FluxDispatcher, RestAPI } from "@webpack/common";
import { BatchedRequestQueue, isAllowedHost } from "./utils";
/** Used for storing and automatically refreshing signed CDN/Media proxy urls ({@link https://docs.discord.food/reference#signed-attachment-urls}). */
export const SignedUrlsStore = proxyLazyWebpack(() => {
    class SignedUrlsStoreClass extends Flux.Store {
        static _expirationThreshold = 60 * 60 * 1000;
        _urls = new Map();
        _queue = new BatchedRequestQueue(batch => this._handleBatch(batch), {
            maxCount: 50,
            timeout: 50
        });
        __getLocalVars() {
            return { urls: this._urls, queue: this._queue };
        }
        get(url) {
            const key = URL.parse(url);
            if (!this._isValid(key))
                return null;
            const value = this._urls.get(`${this._clean(key)}`) ?? null;
            const parsed = URL.parse(value);
            if (!parsed || this._willExpire(parsed))
                this._refresh(key);
            return value;
        }
        addSigned(url) {
            const parsed = URL.parse(url);
            if (!this._isValid(parsed))
                return;
            if (this._willExpire(parsed))
                this._refresh(parsed);
            else
                this._update([[`${this._clean(parsed)}`, url]]);
        }
        _refresh(url) {
            this._queue.add(`${this._clean(url)}`);
        }
        _clean(url) {
            const clean = new URL(url);
            clean.search = "";
            clean.hash = "";
            return clean;
        }
        _isValid(url) {
            return !!(url && isAllowedHost(url.hostname));
        }
        _willExpire(url) {
            const expiryTimestamp = parseInt(url.searchParams.get("ex"), 16) * 1000;
            return isNaN(expiryTimestamp) || expiryTimestamp - SignedUrlsStoreClass._expirationThreshold < Date.now();
        }
        _update(urls) {
            let hasChanged = false;
            for (const [url, value] of urls) {
                if (!value || url === value || this._urls.get(url) === value)
                    continue;
                this._urls.set(url, value);
                hasChanged = true;
            }
            if (hasChanged)
                this.emitChange();
        }
        async _handleBatch(batch) {
            await RestAPI.post({
                url: Constants.Endpoints.ATTACHMENTS_REFRESH_URLS,
                body: { attachment_urls: batch },
                retries: 3
            }).then(({ body }) => this._update(body.refreshed_urls.map(({ original, refreshed }) => [original, refreshed])));
        }
    }
    return new SignedUrlsStoreClass(FluxDispatcher);
});
