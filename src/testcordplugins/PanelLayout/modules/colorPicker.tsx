/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Flex } from "@components/Flex";
import { React } from "@webpack/common";

export function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
    return "#" + [r, g, b].map(v => clamp(v).toString(16).padStart(2, "0")).join("");
}

export function hexToRgb(hex: string): [number, number, number] {
    const cleaned = hex.replace("#", "").trim();
    if (cleaned.length === 3) {
        return [
            parseInt(cleaned[0] + cleaned[0], 16),
            parseInt(cleaned[1] + cleaned[1], 16),
            parseInt(cleaned[2] + cleaned[2], 16),
        ];
    }
    if (cleaned.length === 6) {
        return [
            parseInt(cleaned.slice(0, 2), 16) || 0,
            parseInt(cleaned.slice(2, 4), 16) || 0,
            parseInt(cleaned.slice(4, 6), 16) || 0,
        ];
    }
    return [0, 0, 0];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    s /= 100; v /= 100;
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rgb: [number, number, number];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

export function isValidHex(v: string): boolean {
    return /^#?[0-9a-fA-F]{6}$/.test(v.trim());
}

export const COLOR_PRESETS = [
    "#EB459E", "#ED4245", "#FEE75C",
    "#57F287", "#00C7D9", "#FFFFFF", "#23272A",
];

export function ColorPickerPanel({ value, onChange, preset }: { value: string; onChange: (hex: string) => void; preset: string; }) {
    const validValue = isValidHex(value) ? (value.startsWith("#") ? value : `#${value}`) : (preset || "#ffffff");
    const hsvRef = React.useRef<[number, number, number]>(rgbToHsv(...hexToRgb(validValue)));
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);
    const [hexInput, setHexInput] = React.useState(validValue.toUpperCase());
    const svRef = React.useRef<HTMLDivElement>(null);
    const hueRef = React.useRef<HTMLDivElement>(null);
    const draggingRef = React.useRef<"sv" | "hue" | null>(null);

    React.useEffect(() => {
        if (draggingRef.current) return;
        const col = isValidHex(value) ? (value.startsWith("#") ? value : `#${value}`) : (preset || "#ffffff");
        hsvRef.current = rgbToHsv(...hexToRgb(col));
        setHexInput(col.toUpperCase());
        forceUpdate();
    }, [value, preset]);

    const commit = (h: number, s: number, v: number) => {
        hsvRef.current = [h, s, v];
        const hex = rgbToHex(...hsvToRgb(h, s, v));
        setHexInput(hex.toUpperCase());
        onChange(hex);
        forceUpdate();
    };

    const fromSvPointer = (clientX: number, clientY: number) => {
        const rect = svRef.current!.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        commit(hsvRef.current[0], x * 100, (1 - y) * 100);
    };

    const fromHuePointer = (clientX: number) => {
        const rect = hueRef.current!.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        commit(x * 360, hsvRef.current[1], hsvRef.current[2]);
    };

    React.useEffect(() => {
        const onMove = (e: MouseEvent) => {
            if (draggingRef.current === "sv") fromSvPointer(e.clientX, e.clientY);
            else if (draggingRef.current === "hue") fromHuePointer(e.clientX);
        };
        const onUp = () => { draggingRef.current = null; };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
    }, []);

    const [h, s, v] = hsvRef.current;

    return (
        <div
            style={{
                marginTop: "10px", padding: "12px", borderRadius: "10px",
                background: "var(--background-secondary, var(--background-base-lower))",
                border: "1px solid var(--background-modifier-accent, var(--border-muted))",
            }}
            onMouseDown={e => e.stopPropagation()}
        >
            <div
                ref={svRef}
                onMouseDown={e => { draggingRef.current = "sv"; fromSvPointer(e.clientX, e.clientY); }}
                style={{
                    position: "relative", width: "100%", height: "120px", borderRadius: "8px",
                    cursor: "crosshair", userSelect: "none",
                    background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, rgba(255,255,255,0)), hsl(${h}, 100%, 50%)`,
                }}
            >
                <div style={{
                    position: "absolute", left: `${s}%`, top: `${100 - v}%`,
                    width: "14px", height: "14px", borderRadius: "50%",
                    transform: "translate(-50%, -50%)",
                    border: "2px solid white", boxShadow: "0 0 0 1px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.4)",
                    background: validValue, pointerEvents: "none",
                }} />
            </div>

            <div
                ref={hueRef}
                onMouseDown={e => { draggingRef.current = "hue"; fromHuePointer(e.clientX); }}
                style={{
                    position: "relative", width: "100%", height: "12px", borderRadius: "6px",
                    marginTop: "10px", cursor: "pointer", userSelect: "none",
                    background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
                }}
            >
                <div style={{
                    position: "absolute", left: `${(h / 360) * 100}%`, top: "50%",
                    width: "8px", height: "16px", borderRadius: "3px",
                    transform: "translate(-50%, -50%)",
                    border: "2px solid white", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                    background: `hsl(${h}, 100%, 50%)`, pointerEvents: "none",
                }} />
            </div>

            <Flex alignItems="center" gap={8} style={{ marginTop: "10px" }}>
                <div style={{
                    width: "28px", height: "28px", borderRadius: "6px", flexShrink: 0,
                    background: validValue, border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                }} />
                <input
                    value={hexInput}
                    onChange={e => {
                        const val = e.target.value;
                        setHexInput(val);
                        if (isValidHex(val)) {
                            const hex = val.startsWith("#") ? val : `#${val}`;
                            hsvRef.current = rgbToHsv(...hexToRgb(hex));
                            onChange(hex.toLowerCase());
                            forceUpdate();
                        }
                    }}
                    onBlur={() => {
                        if (!isValidHex(hexInput)) {
                            setHexInput(validValue.toUpperCase());
                        }
                    }}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    spellCheck={false}
                    style={{
                        flex: 1, height: "28px", padding: "0 8px", borderRadius: "6px",
                        border: "1px solid var(--background-modifier-accent, var(--border-muted))",
                        background: "var(--background-secondary-alt, var(--background-mod-subtle))",
                        color: "var(--text-default)", fontFamily: "var(--font-code, monospace)",
                        fontSize: "12px", textTransform: "uppercase",
                    }}
                />
            </Flex>

            <Flex gap={6} style={{ marginTop: "10px", flexWrap: "wrap" }}>
                {preset && (
                    <div
                        key={preset}
                        onClick={() => {
                            hsvRef.current = rgbToHsv(...hexToRgb(preset));
                            setHexInput(preset.toUpperCase());
                            onChange(preset);
                            forceUpdate();
                        }}
                        title={`Preset: ${preset}`}
                        style={{
                            width: "20px", height: "20px", borderRadius: "5px", cursor: "pointer",
                            background: preset,
                            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)",
                        }}
                    />
                )}

                {COLOR_PRESETS.map(p => (
                    <div
                        key={p}
                        onClick={() => {
                            hsvRef.current = rgbToHsv(...hexToRgb(p));
                            setHexInput(p.toUpperCase());
                            onChange(p);
                            forceUpdate();
                        }}
                        title={p}
                        style={{
                            width: "20px", height: "20px", borderRadius: "5px", cursor: "pointer",
                            background: p,
                        }}
                    />
                ))}
            </Flex>
        </div>
    );
}

export function ColorRow({
    label,
    value,
    onChange,
    onBlur,
    preset,
    onReset,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
    preset: string;
    onReset?: () => void;
}) {
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const close = () => {
        setOpen(false);
        onBlur?.({} as React.FocusEvent<HTMLInputElement>);
    };

    const handleRealtimeChange = (newHex: string) => {
        onChange(newHex);
        onBlur?.({} as React.FocusEvent<HTMLInputElement>);
    };

    React.useEffect(() => {
        if (!open) return;
        const onDocMouseDown = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
        };
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
        document.addEventListener("mousedown", onDocMouseDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("mousedown", onDocMouseDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    const displayColor = value || preset || "transparent";

    return (
        <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
            <Flex justifyContent="space-between" alignItems="center">
                <BaseText size="md" weight="medium" color="text-default">{label}</BaseText>
                {onReset && value && value !== preset && (
                    <span
                        onClick={e => {
                            e.stopPropagation();
                            onReset();
                        }}
                        style={{
                            fontSize: "12px",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            textDecoration: "underline",
                        }}
                    >
                        Reset
                    </span>
                )}
            </Flex>
            <Flex
                alignItems="center" gap={10}
                onClick={() => (open ? close() : setOpen(true))}
                style={{ cursor: "pointer" }}
            >
                <div style={{
                    position: "relative", width: "44px", height: "36px", flexShrink: 0,
                    borderRadius: "8px", overflow: "hidden", background: displayColor,
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
                    transition: "border-color 0.15s ease",
                }} />
                <BaseText
                    size="sm" weight="medium" color="text-muted"
                    style={{
                        fontFamily: "var(--font-code, monospace)",
                        background: "var(--background-secondary-alt, var(--background-mod-subtle))",
                        borderRadius: "6px", padding: "6px 10px", textTransform: "uppercase",
                    }}
                >
                    {value || (preset ? `${preset} (Default)` : "None")}
                </BaseText>
            </Flex>
            {open && <ColorPickerPanel value={value || preset} onChange={handleRealtimeChange} preset={preset} />}
        </div>
    );
}
