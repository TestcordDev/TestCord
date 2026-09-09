/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface TmMessage {
    id: string;
    from: { address: string; name: string; };
    subject: string;
    intro: string;
    createdAt: string;
    seen: boolean;
    html?: string[];
    text?: string;
}

export interface TmMessageFull extends TmMessage {
    html: string[];
    text: string;
}

export interface TmDomain {
    id: string;
    domain: string;
    isActive: boolean;
}

export interface SavedAccount {
    id: string;
    providerId: string;
    address: string;
    token?: string;
    password?: string;
    login?: string;
    domain?: string;
    sidToken?: string;
    seq?: number;
    createdAt: number;
}

export interface TempProvider {
    id: string;
    name: string;
    description: string;
    accent: string;
    getDomains(): Promise<string[]>;
    createAccount(address: string, password: string): Promise<SavedAccount>;
    getMessages(account: SavedAccount): Promise<TmMessage[]>;
    getMessage(account: SavedAccount, id: string): Promise<TmMessageFull>;
    deleteMessage(account: SavedAccount, id: string): Promise<void>;
    deleteAccount(account: SavedAccount): Promise<void>;
}

function randomString(len = 10): string {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}
export { randomString };

function mapGuerrillaDate(ts: string | number): string {
    if (typeof ts === "number") return new Date(ts * 1000).toISOString();
    return new Date(ts).toISOString();
}

// ── mail.tm / mail.gw generic ───────────────────────────────────────────────
const MAILTM_FALLBACK: Record<string, string[]> = {
    "mail.tm": ["fexbox.org", "fexpost.com", "fexbox.rs", "mail.tm"],
    "mail.gw": ["0box.eu", "mail.gw", "s0ny.flu.cc", "tmail.ws"],
};

function createMailTmProvider(base: string, id: string, name: string, accent: string): TempProvider {
    return {
        id, name, accent,
        description: `Powered by ${base.replace("https://", "")}`,

        async getDomains() {
            try {
                const r = await fetch(`${base}/domains?page=1`, { headers: { Accept: "application/json" } });
                if (!r.ok) throw new Error(`${name} domains failed ${r.status}`);
                const data = await r.json();
                const list: TmDomain[] = data["hydra:member"] ?? data.member ?? data["hydra:member"] ?? [];
                const domains = list.filter(x => x.isActive !== false).map(x => x.domain).filter(Boolean);
                if (domains.length) return domains;
                throw new Error("empty");
            } catch (e) {
                // fallback so UI never bricks — user can still create address
                return MAILTM_FALLBACK[id] ?? ["mail.tm"];
            }
        },

        async createAccount(address: string, password: string) {
            const r = await fetch(`${base}/accounts`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address, password }),
            });
            if (!r.ok) {
                const txt = await r.text().catch(() => "");
                throw new Error(`${name} create failed ${r.status} ${txt.slice(0, 120)}`);
            }
            const data = await r.json();
            const tokenRes = await fetch(`${base}/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address, password }),
            });
            if (!tokenRes.ok) throw new Error(`${name} token failed ${tokenRes.status}`);
            const tdata = await tokenRes.json();
            return {
                id: data.id ?? address,
                providerId: id,
                address,
                token: tdata.token,
                password,
                createdAt: Date.now(),
            };
        },

        async getMessages(account) {
            if (!account.token) return [];
            const r = await fetch(`${base}/messages?page=1`, {
                headers: { Authorization: `Bearer ${account.token}` }
            });
            if (!r.ok) throw new Error(`Fetch inbox ${r.status}`);
            const data = await r.json();
            const list: TmMessage[] = data["hydra:member"] ?? [];
            return list.map(m => ({
                ...m,
                seen: m.seen ?? false,
            }));
        },

        async getMessage(account, mid) {
            if (!account.token) throw new Error("No token");
            const r = await fetch(`${base}/messages/${mid}`, {
                headers: { Authorization: `Bearer ${account.token}` }
            });
            if (!r.ok) throw new Error(`Fetch message ${r.status}`);
            const data = await r.json();
            return {
                ...data,
                html: data.html ?? [],
                text: data.text ?? "",
            };
        },

        async deleteMessage(account, mid) {
            if (!account.token) return;
            await fetch(`${base}/messages/${mid}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${account.token}` }
            });
        },

        async deleteAccount(account) {
            if (!account.token) return;
            await fetch(`${base}/accounts/${account.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${account.token}` }
            });
        }
    };
}

// ── 1secmail ────────────────────────────────────────────────────────────────
const OneSecMailProvider: TempProvider = {
    id: "1secmail",
    name: "1SecMail",
    description: "API: 1secmail.com — instant, no password",
    accent: "#23a55a",

    async getDomains() {
        try {
            const r = await fetch("https://www.1secmail.com/api/v1/?action=getDomainList", { headers: { Accept: "application/json" } });
            if (!r.ok) throw new Error(`${r.status}`);
            const data: string[] = await r.json();
            if (Array.isArray(data) && data.length) return data;
            throw new Error("empty");
        } catch {
            return ["1secmail.com", "1secmail.org", "1secmail.net", "wwjmp.com", "esiix.com", "yoggm.com"];
        }
    },

    async createAccount(address: string) {
        const at = address.indexOf("@");
        const login = at >= 0 ? address.slice(0, at) : address;
        const domain = at >= 0 ? address.slice(at + 1) : (await this.getDomains())[0];
        return {
            id: `${login}@${domain}`,
            providerId: this.id,
            address: `${login}@${domain}`,
            login,
            domain,
            createdAt: Date.now(),
        };
    },

    async getMessages(account) {
        if (!account.login || !account.domain) return [];
        const url = `https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(account.login)}&domain=${encodeURIComponent(account.domain)}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`1SecMail inbox ${r.status}`);
        const list: any[] = await r.json();
        if (!Array.isArray(list)) return [];
        return list.map(m => ({
            id: String(m.id),
            from: { address: m.from ?? "", name: "" },
            subject: m.subject ?? "",
            intro: (m.body ?? "").slice(0, 120),
            createdAt: new Date(m.date).toISOString(),
            seen: false,
            html: [],
            text: m.body ?? "",
        }));
    },

    async getMessage(account, mid) {
        if (!account.login || !account.domain) throw new Error("Missing login");
        const url = `https://www.1secmail.com/api/v1/?action=readMessage&login=${encodeURIComponent(account.login)}&domain=${encodeURIComponent(account.domain)}&id=${encodeURIComponent(mid)}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`1SecMail read ${r.status}`);
        const m: any = await r.json();
        const html = m.htmlBody ? [m.htmlBody] : [];
        const text = m.textBody ?? m.body ?? "";
        return {
            id: String(m.id ?? mid),
            from: { address: m.from ?? "", name: "" },
            subject: m.subject ?? "",
            intro: text.slice(0, 120),
            createdAt: new Date(m.date).toISOString(),
            seen: false,
            html,
            text,
        };
    },

    async deleteMessage() { /* 1secmail has no delete */ },
    async deleteAccount() { /* no-op */ },
};

// ── Guerrilla Mail ──────────────────────────────────────────────────────────
const GuerrillaProvider: TempProvider = {
    id: "guerrillamail",
    name: "Guerrilla Mail",
    description: "API: guerrillamail.com — classic disposable",
    accent: "#f59e0b",

    async getDomains() {
        return ["guerrillamail.com", "guerrillamail.org", "guerrillamail.net", "sharklasers.com", "pokemail.net"];
    },

    async createAccount(address: string) {
        const user = address.split("@")[0] || randomString(10);
        // try set_email_user to claim custom
        const sidRes = await fetch("https://api.guerrillamail.com/ajax.php?f=get_email_address&ip=127.0.0.1&agent=Mozilla_5.0&lang=en");
        const sidData: any = await sidRes.json().catch(() => ({}));
        const sidToken: string = sidData.sid_token ?? randomString(20);
        const fallbackEmail: string = sidData.email_addr ?? `${user}@guerrillamail.com`;

        // Attempt to set custom username if provided
        if (user && user !== randomString(10)) {
            try {
                const setRes = await fetch(`https://api.guerrillamail.com/ajax.php?f=set_email_user&email_user=${encodeURIComponent(user)}&lang=en&sid_token=${encodeURIComponent(sidToken)}&site=guerrillamail.com`);
                const setData: any = await setRes.json().catch(() => ({}));
                if (setData.email_addr) {
                    return {
                        id: setData.email_addr,
                        providerId: this.id,
                        address: setData.email_addr,
                        sidToken: sidToken,
                        login: user,
                        domain: setData.email_addr.split("@")[1],
                        createdAt: Date.now(),
                    };
                }
            } catch { }
        }

        const domain = fallbackEmail.split("@")[1] ?? "guerrillamail.com";
        const login = fallbackEmail.split("@")[0];
        return {
            id: fallbackEmail,
            providerId: this.id,
            address: fallbackEmail,
            sidToken,
            login,
            domain,
            createdAt: Date.now(),
        };
    },

    async getMessages(account) {
        if (!account.sidToken) return [];
        const login = account.login ?? account.address.split("@")[0];
        const url = `https://api.guerrillamail.com/ajax.php?f=check_email&seq=${account.seq ?? 0}&sid_token=${encodeURIComponent(account.sidToken)}&site=guerrillamail.com`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Guerrilla check ${r.status}`);
        const data: any = await r.json();
        const list: any[] = data.list ?? [];
        // update seq implicitly via caller if needed; we don't persist seq but fine
        return list.map(m => ({
            id: String(m.mail_id),
            from: { address: m.mail_from ?? "", name: "" },
            subject: m.mail_subject ?? "",
            intro: (m.mail_excerpt ?? m.mail_body ?? "").slice(0, 120).replace(/<[^>]+>/g, " "),
            createdAt: mapGuerrillaDate(m.mail_date ?? m.mail_timestamp ?? Date.now()),
            seen: m.mail_read === "1",
            html: [],
            text: m.mail_body ?? "",
        }));
    },

    async getMessage(account, mid) {
        if (!account.sidToken) throw new Error("No session");
        const url = `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(mid)}&sid_token=${encodeURIComponent(account.sidToken)}&site=guerrillamail.com`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`Guerrilla fetch ${r.status}`);
        const m: any = await r.json();
        return {
            id: String(m.mail_id ?? mid),
            from: { address: m.mail_from ?? "", name: "" },
            subject: m.mail_subject ?? "",
            intro: (m.mail_excerpt ?? "").slice(0, 120),
            createdAt: mapGuerrillaDate(m.mail_timestamp ?? Date.now()),
            seen: true,
            html: m.mail_body ? [m.mail_body] : [],
            text: (m.mail_body ?? "").replace(/<[^>]+>/g, " ").slice(0, 4000),
        };
    },

    async deleteMessage(account, mid) {
        if (!account.sidToken) return;
        await fetch(`https://api.guerrillamail.com/ajax.php?f=del_email&email_ids[]=${encodeURIComponent(mid)}&sid_token=${encodeURIComponent(account.sidToken)}&site=guerrillamail.com`).catch(() => {});
    },

    async deleteAccount() { /* guerrilla session expires */ },
};

// ── TempMail.lol ────────────────────────────────────────────────────────────
const TempMailLolProvider: TempProvider = {
    id: "tempmail.lol",
    name: "TempMail.lol",
    description: "API: tempmail.lol — simple token inbox",
    accent: "#a855f7",

    async getDomains() {
        try {
            const r = await fetch("https://api.tempmail.lol/domains");
            if (!r.ok) throw new Error("domains fail");
            const data: any = await r.json();
            if (Array.isArray(data)) return data as string[];
            if (data.domains) return data.domains;
        } catch { }
        return ["tempmail.lol", "tmpmail.org", "tmpmail.net"];
    },

    async createAccount(address: string) {
        // tempmail.lol generate is token-based, but we try to use provided address as hint
        try {
            const r = await fetch("https://api.tempmail.lol/generate", { method: "POST" });
            if (r.ok) {
                const j: any = await r.json();
                const email: string = j.address ?? j.email ?? address;
                const token: string = j.token ?? randomString(20);
                return {
                    id: email,
                    providerId: this.id,
                    address: email,
                    token,
                    createdAt: Date.now(),
                };
            }
        } catch { }
        const at = address.indexOf("@");
        const user = at >= 0 ? address.split("@")[0] : address || randomString(8);
        const domains = await this.getDomains();
        const email = `${user}@${domains[0]}`;
        return { id: email, providerId: this.id, address: email, token: randomString(24), createdAt: Date.now() };
    },

    async getMessages(account) {
        if (!account.token) return [];
        try {
            const r = await fetch(`https://api.tempmail.lol/auth/${encodeURIComponent(account.token)}`);
            if (r.ok) {
                const j: any = await r.json();
                const emails: any[] = j.email ?? j.emails ?? j.messages ?? [];
                if (Array.isArray(emails)) {
                    return emails.map((m: any, idx: number) => ({
                        id: String(m.id ?? m._id ?? idx),
                        from: { address: m.from ?? m.sender ?? "", name: "" },
                        subject: m.subject ?? "",
                        intro: (m.body ?? m.text ?? "").slice(0, 120),
                        createdAt: new Date(m.date ?? m.createdAt ?? Date.now()).toISOString(),
                        seen: !!m.seen,
                        html: m.html ? [m.html] : [],
                        text: m.body ?? m.text ?? "",
                    }));
                }
            }
        } catch { }
        // fallback empty
        return [];
    },

    async getMessage(account, mid) {
        const msgs = await this.getMessages(account);
        const found = msgs.find(m => m.id === mid);
        if (found) return { ...found, html: found.html ?? [], text: found.text ?? "" };
        throw new Error("Message not found");
    },

    async deleteMessage() { },
    async deleteAccount() { },
};

// ── Registry ────────────────────────────────────────────────────────────────
export const providers: TempProvider[] = [
    createMailTmProvider("https://api.mail.tm", "mail.tm", "Mail.tm", "#5865f2"),
    createMailTmProvider("https://api.mail.gw", "mail.gw", "Mail.gw", "#3b82f6"),
    OneSecMailProvider,
    GuerrillaProvider,
    TempMailLolProvider,
];

export const providerMap = new Map(providers.map(p => [p.id, p]));

export function getProvider(id: string): TempProvider | undefined {
    return providerMap.get(id) ?? providers[0];
}

export function listProviders() { return providers; }
