/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { useEffect, useRef, useState } from "@webpack/common";
/**
 * A wrapper component that uses IntersectionObserver to cull off-screen React subtrees.
 * When off-screen (beyond rootMargin), children are unmounted to free CPU/GPU rendering resources.
 */
export function ViewportCull({ children, minHeight = 100, rootMargin = "0px", placeholder, className, style, enabled = true, }) {
    const containerRef = useRef(null);
    const [isVisible, setIsVisible] = useState(true);
    const [recordedHeight, setRecordedHeight] = useState(null);
    useEffect(() => {
        if (!enabled) {
            setIsVisible(true);
            return;
        }
        const element = containerRef.current;
        if (!element)
            return;
        // Create IntersectionObserver
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
            }
            else {
                // Save last rendered height to prevent layout shift when unmounting
                if (element.clientHeight > 0) {
                    setRecordedHeight(element.clientHeight);
                }
                setIsVisible(false);
            }
        }, { rootMargin });
        observer.observe(element);
        return () => observer.disconnect();
    }, [enabled, rootMargin]);
    if (!enabled) {
        return <>{children}</>;
    }
    const currentMinHeight = recordedHeight != null ? `${recordedHeight}px` : (typeof minHeight === "number" ? `${minHeight}px` : minHeight);
    return (<div ref={containerRef} className={className} style={{
            minHeight: isVisible ? undefined : currentMinHeight,
            contain: isVisible ? undefined : "layout paint",
            ...style,
        }}>
            {isVisible ? children : (placeholder ?? null)}
        </div>);
}
export default ViewportCull;
