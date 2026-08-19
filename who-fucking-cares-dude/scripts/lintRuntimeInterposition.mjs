/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const files = [
    "src/api/PluginProfiler.ts",
    "src/testcordplugins/ClientDiagnostics/index.tsx",
    "src/testcordplugins/TestcordHelper/index.tsx",
    "src/testcordplugins/fastDiscord/index.tsx",
    "src/testcordplugins/PerformanceBoost/index.tsx",
    "src/testcordplugins/audioCenter/index.tsx",
    "src/testcordplugins/TestcordOptimizer/index.tsx",
    "src/testcordplugins/optimizerPremium/index.tsx"
];
const assignment = /(?:window|globalThis)\.(?:requestAnimationFrame|cancelAnimationFrame|fetch|ResizeObserver|requestIdleCallback|cancelIdleCallback)\s*=|EventTarget\.prototype\.(?:addEventListener|removeEventListener)\s*=|FluxDispatcher\.(?:dispatch|subscribe|unsubscribe)\s*=/;
const failures = [];
for (const file of files) {
    const lines = readFileSync(resolve(file), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
        if (assignment.test(line))
            failures.push(`${file}:${index + 1}: ${line.trim()}`);
    });
}
if (failures.length) {
    console.error("Broker-owned globals must be registered through RuntimeInterposition:\n" + failures.join("\n"));
    process.exitCode = 1;
}
