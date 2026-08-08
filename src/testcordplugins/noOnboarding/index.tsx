/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Devs, EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher, GuildMemberStore, RestAPI, UserStore } from "@webpack/common";

export default definePlugin({
    name: "NoOnboarding",
    description: "Bypasses Discord's onboarding process for quicker server entry.",
    tags: ["Privacy", "Utility"],
    authors: [EquicordDevs.omaw, Devs.Glitch],

    patches: [
        {
            // The onboarding screen is Suspense(GuildOnboardingPage), lazy-loaded via
            // module 123071 on demand when the screen mounts. Unlike the render gate in
            // module 202776 (a startup module that evaluates before any plugin patch
            // registers, and so can never be intercepted), this lazy factory doesn't run
            // until you actually hit onboarding — so a registered patch DOES land on it.
            //
            // The page component is `ec(e)`, which destructures {guildId} first and then
            // calls a series of hooks. Injecting an early-return right after the opening
            // brace runs before any hook, so it's rules-of-hooks safe: when you're already
            // a member, render nothing instead of the onboarding flow.
            find: "getOnboardingPromptsForOnboarding(t)),",
            replacement: {
                match: /function ec\(e\)\{/,
                replace: "function ec(e){if($self.shouldSkip(e.guildId))return null;"
            }
        }
    ],

    shouldSkip(guildId: string) {
        try {
            const me = UserStore.getCurrentUser();
            return !!me && !!guildId && GuildMemberStore.isMember(guildId, me.id);
        } catch {
            return false;
        }
    },

    _gj: null as ((e: any) => void) | null,

    handleGuildJoin(e: any) {
        // Ignore lurker/preview joins: the user isn't a member yet, so
        // GET /onboarding 404s ("Unknown Guild") and an uncaught rejection
        // can break the subsequent real join. Only bypass on a real join.
        if (e?.lurker) return;
        const guildId = e?.guildId;
        if (guildId) this.bypassOnboard(guildId);
    },

    start() {
        this._gj = this.handleGuildJoin.bind(this);
        FluxDispatcher.subscribe("GUILD_JOIN", this._gj);
    },

    stop() {
        if (this._gj) FluxDispatcher.unsubscribe("GUILD_JOIN", this._gj);
        this._gj = null;
    },

    bypassOnboard(guild_id: string) {
        RestAPI.get({ url: `/guilds/${guild_id}/onboarding` })
            .then(res => {
                const data = res.body;
                if (!data?.prompts?.length) return;

                const now = Math.floor(Date.now() / 1000);
                const prompts_seen = {};
                const responses_seen = {};
                const responses: string[] = [];

                for (const prompt of data.prompts) {
                    const options = prompt.options || [];
                    if (!options.length) continue;
                    prompts_seen[prompt.id] = now;
                    for (const opt of options) responses_seen[opt.id] = now;
                    if (prompt.required) responses.push(options[options.length - 1].id);
                }

                return RestAPI.post({
                    url: `/guilds/${guild_id}/onboarding-responses`,
                    body: {
                        onboarding_responses: responses,
                        onboarding_prompts_seen: prompts_seen,
                        onboarding_responses_seen: responses_seen,
                    }
                }).then(res => {
                    // Mirror Discord's own onboarding-submit flow: after the POST
                    // succeeds it dispatches GUILD_ONBOARDING_UPDATE_RESPONSES_SUCCESS,
                    // which updates the store the onboarding UI reads and unmounts it.
                    // Without this, the server gate clears but the screen stays up.
                    if (res?.body) {
                        FluxDispatcher.dispatch({
                            type: "GUILD_ONBOARDING_UPDATE_RESPONSES_SUCCESS",
                            guildId: guild_id,
                            options: res.body.onboarding_responses,
                            prompts_seen: res.body.onboarding_prompts_seen,
                            options_seen: res.body.onboarding_responses_seen,
                        });
                    }

                    // The onboarding render gate is:
                    //   (isFullServerPreview(id) && isOnboardingEnabled(id)) || features.has(GUILD_ONBOARDING_HAS_PROMPTS)
                    // Both preview selectors read the NEW_MEMBER impersonation entry
                    // E[guildId] in the ImpersonateStore. IMPERSONATE_STOP is the only
                    // action that deletes it, which drops the left side of the gate and
                    // unmounts the screen now that we're a real member.
                    FluxDispatcher.dispatch({
                        type: "IMPERSONATE_STOP",
                        guildId: guild_id,
                    });
                });
            })
            .catch(() => { /* not a member yet / no onboarding — ignore */ });
    }
});
