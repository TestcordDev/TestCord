/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./patch-worker";
import * as monaco from "monaco-editor/esm/vs/editor/editor.main.js";
const BASE = "/vendor/monaco/vs";
self.MonacoEnvironment = {
    getWorkerUrl(_moduleId, label) {
        const path = label === "css" ? "/language/css/css.worker.js" : "/editor/editor.worker.js";
        return new URL(BASE + path, baseUrl).toString();
    }
};
getCurrentCss().then(css => {
    const editor = monaco.editor.create(document.getElementById("container"), {
        value: css,
        language: "css",
        theme: getTheme(),
    });
    editor.onDidChangeModelContent(() => setCss(editor.getValue()));
    window.addEventListener("resize", () => {
        // make monaco re-layout
        editor.layout();
    });
});
