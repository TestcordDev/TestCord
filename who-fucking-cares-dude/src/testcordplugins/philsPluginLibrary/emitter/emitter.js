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
export class Emitter {
    static events = [];
    static addListener(emitter, type, event, fn, plugin) {
        emitter[type](event, fn);
        const emitterEvent = {
            emitter,
            event,
            fn,
            plugin: plugin
        };
        this.events.push(emitterEvent);
        return () => this.removeListener(emitterEvent);
    }
    static isTypedEmitter(emitter) {
        return typeof emitter.off === "function";
    }
    static removeListener(emitterEvent) {
        if (this.isTypedEmitter(emitterEvent.emitter)) {
            emitterEvent.emitter.off(emitterEvent.event, emitterEvent.fn);
        }
        else {
            emitterEvent.emitter.removeListener(emitterEvent.event, emitterEvent.fn);
        }
        this.events = this.events.filter(emitterEvent_ => emitterEvent_ !== emitterEvent);
    }
    static removeAllListeners(plugin) {
        if (!plugin) {
            this.events.forEach(emitterEvent => this.removeListener(emitterEvent));
        }
        else {
            this.events.forEach(emitterEvent => plugin === emitterEvent.plugin && this.removeListener(emitterEvent));
        }
    }
}
