/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { OpenExternalIcon } from "@components/Icons";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Message, MessageAttachment } from "@vencord/discord-types";
import { Tooltip, useEffect, useMemo, useRef, useState } from "@webpack/common";

import managedStyle from "./styles.css?managed";

const Native = VencordNative.pluginHelpers.PdfViewer as PluginNative<typeof import("./native")>;
const logger = new Logger("PdfViewer");

const PDFJS_VERSION = "3.11.174";
const PDFJS_LIB = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

const settings = definePluginSettings({
    maxFileSizeMb: {
        type: OptionType.SLIDER,
        description: "Max preview size (MB)",
        markers: [5, 10, 25, 50, 100],
        stickToMarkers: true,
        default: 25,
    },
    cacheEntries: {
        type: OptionType.SLIDER,
        description: "Recently opened PDFs to cache",
        markers: [0, 1, 3, 5, 10],
        stickToMarkers: true,
        default: 3,
        onChange: () => trimCache(),
    },
});

type PdfPage = {
    pageNumber: number;
    getViewport(o: { scale: number; }): { width: number; height: number; };
    render(o: { canvasContext: CanvasRenderingContext2D; viewport: any; }): { promise: Promise<void>; cancel(): void; };
};
type PdfDoc = { numPages: number; getPage(n: number): Promise<PdfPage>; destroy(): Promise<void>; };
type PdfLib = { GlobalWorkerOptions: { workerSrc: string; }; getDocument(o: any): { promise: Promise<PdfDoc>; }; };

declare global {
    interface Window { pdfjsLib?: PdfLib; }
}

const cache = new Map<string, Uint8Array>();
let cacheBytes = 0;

function maxBytes() {
    return settings.store.maxFileSizeMb * 1024 * 1024;
}

function trimCache() {
    const maxCacheBytes = maxBytes() * settings.store.cacheEntries;
    while (cache.size > settings.store.cacheEntries || cacheBytes > maxCacheBytes) {
        const k = cache.keys().next().value;
        if (!k) break;
        cacheBytes -= cache.get(k)?.byteLength ?? 0;
        cache.delete(k);
    }
}

function setCache(key: string, bytes: Uint8Array) {
    const existing = cache.get(key);
    if (existing) cacheBytes -= existing.byteLength;
    cache.set(key, bytes);
    cacheBytes += bytes.byteLength;
    trimCache();
}

let pdfjsPromise: Promise<PdfLib> | null = null;
function loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return pdfjsPromise ??= new Promise<PdfLib>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = PDFJS_LIB;
        s.async = true;
        s.onload = () => {
            if (!window.pdfjsLib) return reject(new Error("Failed to load PDF.js"));
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
            resolve(window.pdfjsLib);
        };
        s.onerror = () => {
            pdfjsPromise = null;
            reject(new Error("Failed to load PDF.js"));
        };
        document.head.appendChild(s);
    });
}

async function loadBytes(att: MessageAttachment) {
    const key = `${att.id}:${att.url}`;
    let bytes: Uint8Array;
    const hit = cache.get(key);
    if (hit) {
        cache.delete(key);
        cache.set(key, hit);
        bytes = hit;
    } else {
        bytes = await Native.fetchPdf(att.url, maxBytes()) as Uint8Array;
        if (bytes.byteLength > maxBytes()) throw new Error("PDF exceeds size limit");

        if (settings.store.cacheEntries > 0) {
            setCache(key, bytes);
        }
    }
    // pdf.js transfers (detaches) the buffer when opening it, so hand it a
    // fresh copy and keep the cached master intact for the next open.
    return new Uint8Array(bytes);
}

function fmtSize(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function IconBtn({ label, active, disabled, onClick, children }: {
    label: string;
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <Tooltip text={label}>
            {tt => (
                <button
                    {...tt}
                    aria-label={label}
                    aria-pressed={active}
                    className={`vc-pdfViewer-button${active ? " vc-pdfViewer-button-active" : ""}`}
                    disabled={disabled}
                    type="button"
                    onClick={e => {
                        e.stopPropagation();
                        if (!disabled) onClick();
                    }}
                >
                    {children}
                </button>
            )}
        </Tooltip>
    );
}

const svgProps = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
} as const;

const EyeOpen = () => (
    <svg {...svgProps}>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);
const EyeClosed = () => (
    <svg {...svgProps}>
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <path d="m2 2 20 20" />
    </svg>
);
const ZoomIn = () => (
    <svg {...svgProps}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3M11 8v6M8 11h6" />
    </svg>
);
const ZoomOut = () => (
    <svg {...svgProps}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3M8 11h6" />
    </svg>
);
const FitWidth = () => (
    <svg {...svgProps}>
        <path d="M4 5v14M20 5v14M8 12h8m-5-3-3 3 3 3m2-6 3 3-3 3" />
    </svg>
);

function Spinner() {
    return <span aria-hidden className="vc-pdfViewer-spinner" />;
}

function PageView({ page, scale, n, w, h, render }: {
    page: PdfPage | null;
    scale: number;
    n: number;
    w: number;
    h: number;
    render: boolean;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const lastKey = useRef<string>("");

    const { width, height } = useMemo(() => {
        if (!page) return { width: w * scale, height: h * scale };
        const v = page.getViewport({ scale });
        return { width: v.width, height: v.height };
    }, [page, scale, w, h]);

    useEffect(() => {
        if (!canvas.current || !page || !render) return;
        const key = `${n}@${scale.toFixed(3)}`;
        if (lastKey.current === key) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const v = page.getViewport({ scale: scale * dpr });
        const c = canvas.current;
        c.width = v.width | 0;
        c.height = v.height | 0;
        c.style.width = `${v.width / dpr}px`;
        c.style.height = `${v.height / dpr}px`;

        const ctx = c.getContext("2d");
        if (!ctx) return;

        const task = page.render({ canvasContext: ctx, viewport: v });
        let cancelled = false;
        task.promise.then(
            () => { if (!cancelled) lastKey.current = key; },
            err => {
                if (cancelled || err?.name === "RenderingCancelledException") return;
                logger.error(`Failed to render page ${n}`, err);
            }
        );

        return () => {
            cancelled = true;
            try { task.cancel(); } catch { }
        };
    }, [page, scale, render, n]);

    return (
        <div className="vc-pdfViewer-page" data-page-number={n} style={{ width, height }}>
            {render ? <canvas ref={canvas} /> : <div className="vc-pdfViewer-pagePlaceholder"><Spinner /></div>}
            <div aria-hidden className="vc-pdfViewer-pageBadge">page {n}</div>
        </div>
    );
}

function PdfView({ bytes }: { bytes: Uint8Array; }) {
    const [doc, setDoc] = useState<PdfDoc | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [sizes, setSizes] = useState<Array<{ w: number; h: number; }>>([]);
    const [pages, setPages] = useState(new Map<number, PdfPage>());
    const [visible, setVisible] = useState(new Set<number>([1]));
    const [scale, setScale] = useState<number | null>(null);
    const [containerW, setContainerW] = useState(0);
    const container = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancel = false;
        let ref: PdfDoc | null = null;

        (async () => {
            try {
                const lib = await loadPdfjs();
                if (cancel) return;

                const d = await lib.getDocument({
                    data: bytes,
                    isEvalSupported: false,
                    disableAutoFetch: true,
                    disableStream: true,
                }).promise;

                if (cancel) {
                    d.destroy().catch(() => { });
                    return;
                }
                ref = d;
                setDoc(d);

                const first = await d.getPage(1);
                if (cancel) return;
                const v = first.getViewport({ scale: 1 });
                setSizes(Array.from({ length: d.numPages }, () => ({ w: v.width, h: v.height })));
                setPages(new Map([[1, first]]));
            } catch (e: any) {
                if (cancel) return;
                logger.error("Failed to open PDF", e);
                const msg = e?.message ?? String(e);
                setErr(/password/i.test(msg) ? "This PDF is password-protected" : msg);
            }
        })();

        return () => {
            cancel = true;
            ref?.destroy().catch(() => { });
        };
    }, [bytes]);

    useEffect(() => {
        if (!container.current) return;
        const c = container.current;
        const update = () => setContainerW(c.clientWidth);
        update();
        const ro = new ResizeObserver(update);
        ro.observe(c);
        return () => ro.disconnect();
    }, [sizes.length]);

    useEffect(() => {
        if (!doc || !sizes.length || !container.current) return;
        const io = new IntersectionObserver(entries => {
            setVisible(prev => {
                const next = new Set(prev);
                let dirty = false;
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    const n = Number((e.target as HTMLElement).dataset.pageNumber);
                    for (let i = n - 1; i <= n + 1; i++) {
                        if (i >= 1 && i <= doc.numPages && !next.has(i)) {
                            next.add(i);
                            dirty = true;
                        }
                    }
                }
                return dirty ? next : prev;
            });
        }, { root: container.current, rootMargin: "200px 0px" });

        for (const el of container.current.querySelectorAll<HTMLElement>(".vc-pdfViewer-page")) io.observe(el);
        return () => io.disconnect();
    }, [doc, sizes.length]);

    useEffect(() => {
        if (!doc) return;
        let cancel = false;
        const need = [...visible].filter(n => !pages.has(n));
        if (!need.length) return;

        (async () => {
            const got: Array<[number, PdfPage]> = [];
            for (const n of need) {
                try {
                    const p = await doc.getPage(n);
                    if (cancel) return;
                    got.push([n, p]);
                } catch (e) {
                    logger.error(`Failed to load page ${n}`, e);
                }
            }
            if (cancel || !got.length) return;
            setPages(prev => {
                const next = new Map(prev);
                for (const [n, p] of got) next.set(n, p);
                return next;
            });
            setSizes(prev => prev.map((s, i) => {
                const found = got.find(([n]) => n === i + 1);
                if (!found) return s;
                const v = found[1].getViewport({ scale: 1 });
                return { w: v.width, h: v.height };
            }));
        })();

        return () => { cancel = true; };
    }, [visible, doc]);

    const effectiveScale = useMemo(() => {
        if (scale != null) return scale;
        if (!sizes.length || containerW <= 0) return 1;
        return Math.max(0.25, Math.min(3, (containerW - 32) / sizes[0].w));
    }, [scale, sizes, containerW]);

    if (err) return <div className="vc-pdfViewer-centeredState vc-pdfViewer-error"><span>Couldn't open PDF: {err}</span></div>;
    if (!doc) return <div className="vc-pdfViewer-centeredState"><Spinner /><span>Opening PDF…</span></div>;

    return (
        <div className="vc-pdfViewer-document">
            <div className="vc-pdfViewer-toolbar">
                <span className="vc-pdfViewer-pageCount">
                    {doc.numPages} {doc.numPages === 1 ? "page" : "pages"}
                </span>
                <span className="vc-pdfViewer-toolbarSpacer" />
                <IconBtn label="Zoom out" onClick={() => setScale(s => {
                    const b = s ?? effectiveScale;
                    return [...ZOOMS].reverse().find(z => z < b - 0.001) ?? b;
                })}><ZoomOut /></IconBtn>
                <span className="vc-pdfViewer-zoomLabel">{Math.round(effectiveScale * 100)}%</span>
                <IconBtn label="Zoom in" onClick={() => setScale(s => {
                    const b = s ?? effectiveScale;
                    return ZOOMS.find(z => z > b + 0.001) ?? b;
                })}><ZoomIn /></IconBtn>
                <IconBtn label="Fit width" active={scale == null} onClick={() => setScale(null)}><FitWidth /></IconBtn>
            </div>
            <div className="vc-pdfViewer-pages" ref={container}>
                {sizes.map((s, i) => (
                    <PageView
                        key={i + 1}
                        n={i + 1}
                        w={s.w}
                        h={s.h}
                        scale={effectiveScale}
                        page={pages.get(i + 1) ?? null}
                        render={visible.has(i + 1) && pages.has(i + 1)}
                    />
                ))}
            </div>
        </div>
    );
}

function PdfBody({ attachment }: { attachment: MessageAttachment; }) {
    const [bytes, setBytes] = useState<Uint8Array | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancel = false;
        setBytes(null);
        setErr(null);

        loadBytes(attachment).then(
            b => { if (!cancel) setBytes(b); },
            e => {
                logger.error("Failed to fetch PDF", e);
                if (!cancel) setErr(e?.message ?? "Failed to load");
            }
        );

        return () => { cancel = true; };
    }, [attachment.id, attachment.url, retry]);

    if (err) return (
        <div className="vc-pdfViewer-centeredState vc-pdfViewer-error">
            <span>Couldn't load PDF: {err}</span>
            <button
                className="vc-pdfViewer-textButton"
                type="button"
                onClick={e => { e.stopPropagation(); setRetry(n => n + 1); }}
            >
                Retry
            </button>
        </div>
    );

    if (!bytes) return <div className="vc-pdfViewer-centeredState"><Spinner /><span>Loading PDF…</span></div>;
    return <PdfView bytes={bytes} />;
}

const MAX_FILE_SIZE_KEYS = ["maxFileSizeMb"] as const;

function Preview({ attachment }: { attachment: MessageAttachment; }) {
    const { maxFileSizeMb } = settings.use(MAX_FILE_SIZE_KEYS);
    const tooLarge = attachment.size > maxFileSizeMb * 1024 * 1024;
    const [open, setOpen] = useState(false);

    return (
        <div className="vc-pdfViewer-shell" onClick={e => e.stopPropagation()}>
            <div className="vc-pdfViewer-fileBar">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                    <path d="M14 2v6h6M9 13h6M9 17h6" />
                </svg>
                <div className="vc-pdfViewer-fileMeta">
                    <span className="vc-pdfViewer-fileName" title={attachment.filename}>{attachment.filename}</span>
                    <span className="vc-pdfViewer-fileSize">
                        PDF · {fmtSize(attachment.size)}
                        {tooLarge && <span className="vc-pdfViewer-fileWarn"> · over {maxFileSizeMb} MB limit</span>}
                    </span>
                </div>

                <IconBtn
                    active={open}
                    disabled={tooLarge}
                    label={tooLarge ? `Preview disabled — over ${maxFileSizeMb} MB` : open ? "Hide preview" : "Preview PDF"}
                    onClick={() => setOpen(o => !o)}
                >
                    {open ? <EyeClosed /> : <EyeOpen />}
                </IconBtn>

                <IconBtn label="Open in browser" onClick={() => VencordNative.native.openExternal(attachment.url)}>
                    <OpenExternalIcon height={18} width={18} />
                </IconBtn>
            </div>

            {open && <PdfBody attachment={attachment} />}
        </div>
    );
}

const SafePreview = ErrorBoundary.wrap(Preview, { noop: true });

function isPdf(att: MessageAttachment) {
    return att.content_type === "application/pdf" || (att.filename?.toLowerCase().endsWith(".pdf") ?? false);
}

export default definePlugin({
    name: "PdfViewer",
    description: "Preview PDF attachments inline without downloading them first",
    authors: [{ name: "vp9", id: 0n }, { name: "semon009", id: 0n }],
    tags: ["Media", "Utility", "Chat"],
    managedStyle,
    settings,

    renderMessageAccessory({ message }) {
        const msg = message as Message;
        const pdfs = msg?.attachments?.filter(isPdf);
        if (!pdfs?.length) return null;

        return (
            <div className="vc-pdfViewer-stack">
                {pdfs.map(att => <SafePreview attachment={att} key={att.id} />)}
            </div>
        );
    },

    stop() {
        cache.clear();
        cacheBytes = 0;
    },
});
