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
import { Logger } from "@utils/Logger";
if (IS_DEV || IS_REPORTER) {
    var traces = {};
    var logger = new Logger("Tracer", "#FFD166");
}
export const beginTrace = !(IS_DEV || IS_REPORTER) ? () => { } :
    function beginTrace(name, ...args) {
        if (name in traces) {
            throw new Error(`Trace ${name} already exists!`);
        }
        traces[name] = [performance.now(), args];
    };
export const finishTrace = !(IS_DEV || IS_REPORTER) ? () => 0 :
    function finishTrace(name) {
        const end = performance.now();
        const [start, args] = traces[name];
        delete traces[name];
        const totalTime = end - start;
        logger.debug(`${name} took ${totalTime}ms`, args);
        return totalTime;
    };
function noopTracerWithResults(name, f, mapper) {
    return function (...args) {
        return [f.apply(this, args), 0];
    };
}
function noopTracer(name, f, mapper) {
    return f;
}
export const traceFunctionWithResults = !(IS_DEV || IS_REPORTER)
    ? noopTracerWithResults
    : function traceFunctionWithResults(name, f, mapper) {
        return function (...args) {
            const traceName = mapper?.(...args) ?? name;
            beginTrace(traceName, ...arguments);
            try {
                return [f.apply(this, args), finishTrace(traceName)];
            }
            catch (e) {
                finishTrace(traceName);
                throw e;
            }
        };
    };
export const traceFunction = !(IS_DEV || IS_REPORTER)
    ? noopTracer
    : function traceFunction(name, f, mapper) {
        return function (...args) {
            const traceName = mapper?.(...args) ?? name;
            beginTrace(traceName, ...arguments);
            try {
                return f.apply(this, args);
            }
            finally {
                finishTrace(traceName);
            }
        };
    };
