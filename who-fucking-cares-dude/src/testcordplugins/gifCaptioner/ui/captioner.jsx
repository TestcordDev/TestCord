/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { classNameFactory } from "@utils/css";
import { useEffect, useRef, useState } from "@webpack/common";
import { FontSelector, getSelectedFont, loadGoogleFont } from "../index";
import { getLines } from "../utils/canvas";
const cl = classNameFactory("vc-gif-captioner-");
export default function Captioner({ media, onSubmit }) {
    const [text, setText] = useState("");
    const [mediaWidth, setMediaWidth] = useState(Math.max(1, media.width || 480));
    const [mediaHeight, setMediaHeight] = useState(Math.max(1, media.height || 270));
    const [size, setSize] = useState(Math.max(16, Math.round((media.width || 480) / 10)));
    const [selectedFont, setSelectedFont] = useState(getSelectedFont());
    const [fontRevision, setFontRevision] = useState(0);
    const inputRef = useRef(null);
    const canvasRef = useRef(null);
    const videoRef = useRef(null);
    const onSubmitRef = useRef(onSubmit);
    useEffect(() => {
        onSubmitRef.current = onSubmit;
    }, [onSubmit]);
    useEffect(() => {
        onSubmitRef.current(() => ({
            height: mediaHeight,
            sourceVideo: videoRef.current,
            text,
            size,
            type: "caption",
            width: mediaWidth
        }));
    }, [mediaHeight, mediaWidth, text, size, selectedFont]);
    useEffect(() => {
        if (media.width > 0)
            setMediaWidth(media.width);
        if (media.height > 0)
            setMediaHeight(media.height);
    }, [media.height, media.width]);
    useEffect(() => {
        const timeoutId = setTimeout(() => inputRef.current?.focus(), 100);
        return () => clearTimeout(timeoutId);
    }, []);
    useEffect(() => {
        void loadGoogleFont(selectedFont).then(() => {
            setFontRevision(revision => revision + 1);
        });
    }, [selectedFont]);
    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx)
            return;
        const previewText = text || "Enter caption...";
        const previewWidth = Math.max(1, mediaWidth);
        ctx.font = `${size}px ${selectedFont}`;
        const lines = getLines(ctx, previewText, previewWidth);
        const captionHeight = lines.length * size + 10;
        canvas.width = previewWidth;
        canvas.height = captionHeight;
        ctx.font = `${size}px ${selectedFont}`;
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, previewWidth, captionHeight);
        ctx.fillStyle = "black";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], previewWidth / 2, size * i + 5);
        }
    }, [fontRevision, mediaWidth, selectedFont, size, text]);
    return (<div className={cl("editor")}>
            <input ref={inputRef} className={cl("caption")} onChange={event => setText(event.target.value)} placeholder="Enter caption..."/>
            <div className={cl("range")}>
                <div>Font</div>
                <div className={cl("font-selector")}>
                    <FontSelector onSelect={font => {
            setSelectedFont(font.family);
            loadGoogleFont(font.family);
        }}/>
                </div>
            </div>
            <div className={cl("range")}>
                <div>Font size</div>
                <input type="range" min={5} max={200} value={size} onChange={event => setSize(Number.parseFloat(event.target.value))}/>
            </div>
            <div className={cl("preview-stack")}>
                <canvas ref={canvasRef} className={cl("preview-canvas")}/>
                <div className={cl("preview-media")}>
                    {media.isVideo ? (<video ref={videoRef} autoPlay loop muted playsInline src={media.url} className={cl("media-element")} onLoadedMetadata={event => {
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth > 0)
                    setMediaWidth(videoWidth);
                if (videoHeight > 0)
                    setMediaHeight(videoHeight);
            }}/>) : (<img alt="GIF preview" src={media.url} className={cl("media-element")}/>)}
                </div>
            </div>
        </div>);
}
