/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const deferredPattern = /\b(activity|subText|botText|clanTag)\b/;

export default definePlugin({
	name: "OpenOptimizer",
	description: "Ports OpenAsar's optimizer code.",
    tags: ["Developers", "Utility"],
	authors: [{ name: "S€th", id: 1273447359417942128n }],
	methods: ["removeChild", "appendChild"],
	timeouts: [] as ReturnType<typeof setTimeout>[],
	start() {
		this.timeouts.length = 0;
		for (const method of this.methods as (keyof Element)[]) {
			this[`_${method}`] = Element.prototype[method];
			// @ts-ignore
			Element.prototype[method] = this.optimize(Element.prototype[method]);
		}
	},
	stop() {
		for (const t of this.timeouts) clearTimeout(t);
		this.timeouts.length = 0;
		for (const method of this.methods as (keyof Element)[]) {
			// @ts-ignore
			Element.prototype[method] = this[`_${method}`];
		}
	},

	optimize: (orig: Function) =>
		// @ts-ignore
		function (this: Element, ...args: any[]) {
			const el = args[0];
			if (el && typeof el.className === "string" && deferredPattern.test(el.className))
				// @ts-ignore
				return setTimeout(() => orig.apply(this, args), 100);

			// @ts-ignore
			return orig.apply(this, args);
		},
});
