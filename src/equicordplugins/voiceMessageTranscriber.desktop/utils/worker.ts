/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DataStore } from "@api/index";
import { lodash } from "@webpack/common";

const workerCode = `
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;
env.useBrowserCache = false;

const pendingRequests = new Map();

self.addEventListener('message', (event) => {
    const { type, id, response, error, headers } = event.data;

    if (type === 'fetch_response') {
        const resolver = pendingRequests.get(id);
        if (resolver) {
            pendingRequests.delete(id);
            if (error) {
                resolver.reject(new Error(error));
            } else {
                const res = new Response(response, {
                    headers: headers || { 'Content-Type': 'application/octet-stream' }
                });
                resolver.resolve(res);
            }
        }
    } else if (type === 'run') {
        runTranscription(event.data);
    }
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
    const url = input.toString();
    if (url.includes('huggingface.co') || url.includes('cdn.jsdelivr.net')) {
         const id = Math.random().toString(36).substring(7);
         return new Promise((resolve, reject) => {
             pendingRequests.set(id, { resolve, reject });
             self.postMessage({ type: 'fetch_request', url, id });
         });
    }
    return originalFetch(input, init);
};

let transcriber = null;

async function compressionRatio(text) {
    const bytes = new TextEncoder().encode(text);
    if (!bytes.length) return 0;
    const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return bytes.length / compressed.byteLength;
}

async function runTranscription({ audio, model, quantized, language, task }) {
    try {
        if (!transcriber) {
            self.postMessage({ type: 'status', status: 'loading' });
            transcriber = await pipeline('automatic-speech-recognition', model, {
                quantized: quantized,
                progress_callback: (data) => {
                    self.postMessage({ type: 'progress', data });
                }
            });
        }

        self.postMessage({ type: 'status', status: 'transcribing' });

        const time_precision =
            transcriber.processor.feature_extractor.config.chunk_length /
            transcriber.model.config.max_source_positions;

        let chunks_to_process;

        function chunk_callback(chunk) {
            let last = chunks_to_process[chunks_to_process.length - 1];

            Object.assign(last, chunk);
            last.finalised = true;

            if (!chunk.is_last) {
                chunks_to_process.push({
                    tokens: [],
                    finalised: false,
                });
            }
        }

        function callback_function(item) {
            let last = chunks_to_process[chunks_to_process.length - 1];

            last.tokens = [...item[0].output_token_ids];

            let data = transcriber.tokenizer._decode_asr(chunks_to_process, {
                time_precision: time_precision,
                return_timestamps: true,
                force_full_sequences: false,
            });

            self.postMessage({
                type: 'partial',
                output: {
                    text: data[0],
                    chunks: data[1].chunks
                }
            });
        }

        async function transcribe(extraOptions) {
            chunks_to_process = [{ tokens: [], finalised: false }];
            return transcriber(audio, {
                top_k: 0,
                do_sample: false,
                chunk_length_s: 30,
                stride_length_s: 5,
                return_timestamps: true,
                callback_function,
                chunk_callback,
                language,
                task: task === "translate" ? "translate" : undefined,
                ...extraOptions
            });
        }

        let output = await transcribe();

        if (await compressionRatio(output.text) > 2.4) {
            output = await transcribe({ no_repeat_ngram_size: 4 });
        }

        self.postMessage({ type: 'complete', output });

    } catch (e) {
        self.postMessage({ type: 'error', error: e.toString() });
    }
}
`;

export interface TranscriptionChunk {
    timestamp: [number, number];
    text: string;
}

export interface TranscriptionResult {
    text: string;
    chunks: TranscriptionChunk[];
}

export class TranscriptionWorker {
    private worker: Worker;
    private onStatus: (status: string) => void;
    private onComplete: (output: TranscriptionResult) => void;
    private onError: (error: unknown) => void;
    private onPartial: (output: TranscriptionResult) => void;

    constructor(
        onStatus: (status: string) => void,
        onComplete: (output: TranscriptionResult) => void,
        onError: (error: unknown) => void,
        onPartial: (output: TranscriptionResult) => void
    ) {
        this.onStatus = onStatus;
        this.onComplete = onComplete;
        this.onError = onError;
        this.onPartial = onPartial;

        const blob = new Blob([workerCode], { type: "text/javascript" });
        const objectUrl = URL.createObjectURL(blob);
        this.worker = new Worker(objectUrl, { type: "module" });
        URL.revokeObjectURL(objectUrl);
        this.worker.onmessage = this.handleMessage.bind(this);
    }

    private getMimeType(url: string): string {
        if (url.endsWith(".wasm")) return "application/wasm";
        if (url.endsWith(".json")) return "application/json";
        if (url.endsWith(".onnx")) return "application/octet-stream";
        return "application/octet-stream";
    }

    private async handleMessage(event: MessageEvent) {
        const { type, id, url, status, output, error } = event.data;

        switch (type) {
            case "fetch_request":
                try {
                    const cachedData = await DataStore.get(`VoiceMessageTranscriber_${url}`);

                    if (cachedData && lodash.isArrayBuffer(cachedData)) {
                        this.worker.postMessage({
                            type: "fetch_response",
                            id,
                            response: cachedData,
                            headers: {
                                "Content-Length": cachedData.byteLength.toString(),
                                "Content-Type": this.getMimeType(url)
                            }
                        });
                    } else {
                        const res = await fetch(url);
                        if (!res.ok) throw new Error("Failed to fetch " + url);

                        const buffer = await res.arrayBuffer();
                        await DataStore.set(`VoiceMessageTranscriber_${url}`, buffer);

                        this.worker.postMessage({
                            type: "fetch_response",
                            id,
                            response: buffer,
                            headers: {
                                "Content-Length": res.headers.get("Content-Length") || buffer.byteLength.toString(),
                                "Content-Type": this.getMimeType(url)
                            }
                        });
                    }
                } catch (err) {
                    this.worker.postMessage({
                        type: "fetch_response",
                        id,
                        error: String(err)
                    });
                }
                break;
            case "status":
                this.onStatus(status);
                break;
            case "complete":
                this.onComplete(output);
                break;
            case "partial":
                this.onPartial(output);
                break;
            case "error":
                this.onError(error);
                break;
        }
    }

    public run(audio: Float32Array, model: string, quantized: boolean = true, language?: string, task?: string) {
        this.worker.postMessage({
            type: "run",
            audio,
            model,
            quantized,
            language,
            task
        });
    }

    public terminate() {
        this.worker.terminate();
    }
}
