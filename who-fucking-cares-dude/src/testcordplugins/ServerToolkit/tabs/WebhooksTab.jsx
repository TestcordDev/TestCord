/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { copyWithToast } from "@utils/discord";
import { Forms, React, RestAPI, Text, useEffect, useState } from "@webpack/common";
import { logger } from "../index";
export function WebhooksTab({ guild }) {
    const [state, setState] = useState("idle");
    const [hooks, setHooks] = useState([]);
    const [err, setErr] = useState("");
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setState("loading");
            try {
                const res = await RestAPI.get({ url: `/guilds/${guild.id}/webhooks` });
                if (cancelled)
                    return;
                setHooks(res.body ?? []);
                setState("done");
            }
            catch (e) {
                if (cancelled)
                    return;
                logger.warn("Webhook fetch failed", e);
                if (e?.status === 403)
                    setState("denied");
                else {
                    setErr(e?.message ?? String(e));
                    setState("error");
                }
            }
        })();
        return () => { cancelled = true; };
    }, [guild.id]);
    return (<div className="gt-webhooks">
            <Forms.FormSection title="Webhooks">
                {state === "loading" && <Text variant="text-sm/normal">Loading…</Text>}
                {state === "denied" && (<Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>
                        You don't have Manage Webhooks permission in this server.
                    </Text>)}
                {state === "error" && (<Text variant="text-sm/normal" style={{ color: "var(--text-danger)" }}>
                        Failed: {err}
                    </Text>)}
                {state === "done" && hooks.length === 0 && (<Text variant="text-sm/normal" style={{ color: "var(--text-muted)" }}>No webhooks.</Text>)}
                {state === "done" && hooks.length > 0 && (<div className="gt-webhook-list">
                        {hooks.map(h => (<div key={h.id} className="gt-webhook-row">
                                <span className="gt-webhook-name">{h.name}</span>
                                <span className="gt-webhook-channel">→ #{h.channel_id}</span>
                                <span className="gt-webhook-id" onClick={() => copyWithToast(h.id)} style={{ cursor: "pointer", textDecoration: "underline" }}>
                                    {h.id}
                                </span>
                            </div>))}
                    </div>)}
            </Forms.FormSection>
        </div>);
}
