/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { React, useEffect, useRef, useState } from "@webpack/common";
import { renderSpeechbubble } from "../render/speechbubble";
export default function SpeechBubbler({ width, height, element, onSubmit }) {
    const [tipX, setTipX] = useState(width / 3);
    const [tipY, setTipY] = useState(height / 3);
    const [tipBase, setTipBase] = useState(10);
    const [enabled, setEnabled] = useState(true);
    const wrapper = useRef(null);
    const canvas = useRef(null);
    const ctx = useRef(null);
    const onSubmitRef = useRef(onSubmit);
    useEffect(() => {
        onSubmitRef.current = onSubmit;
    }, [onSubmit]);
    useEffect(() => {
        onSubmitRef.current(() => ({
            type: "speechbubble",
            tipX, tipY,
            tipBase: tipBase / 100,
            enabled,
        }));
    }, [tipX, tipY, tipBase, enabled]);
    const render = () => {
        if (!ctx.current)
            return;
        ctx.current.clearRect(0, 0, width, height);
        if (enabled) {
            renderSpeechbubble(ctx.current, width, height, tipX, tipY, tipBase / 100);
        }
    };
    const moveTip = (e) => {
        if (!canvas.current)
            return;
        const rect = canvas.current.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width * width;
        const y = (e.clientY - rect.top) / rect.height * height;
        setTipX(x);
        setTipY(y);
    };
    useEffect(render, [tipX, tipY, tipBase, enabled]);
    useEffect(() => {
        if (!wrapper.current || !canvas.current)
            return;
        wrapper.current.insertBefore(element, canvas.current);
        ctx.current = canvas.current.getContext("2d");
        render();
    }, []);
    return (<div className="gc-editor">
            <div className="gc-toggle">
                <label>
                    <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/>
                    <span>Enable Speech Bubble</span>
                </label>
            </div>
            {enabled && (<>
                    <div className="gc-range">
                        <div>Tip Base Position</div>
                        <input type="range" min={0} max={80} value={tipBase} onChange={e => setTipBase(parseFloat(e.target.value))}/>
                    </div>
                    <div className="gc-speechbubbler" ref={wrapper}>
                        <canvas width={width} height={height} onClick={moveTip} ref={canvas}/>
                    </div>
                </>)}
		</div>);
}
