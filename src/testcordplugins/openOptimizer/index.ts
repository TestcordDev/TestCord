/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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
