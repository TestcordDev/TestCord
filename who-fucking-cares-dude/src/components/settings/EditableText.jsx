/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { React, useEffect, useRef, useState } from "@webpack/common";
export function EditableText({ value, onChange, className }) {
    const [editing, setEditing] = useState(false);
    const [tempValue, setTempValue] = useState(value);
    const inputRef = useRef(null);
    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editing]);
    return editing ? (<input ref={inputRef} className={className} value={tempValue} onChange={e => setTempValue(e.target.value)} onBlur={() => {
            setEditing(false);
            onChange(tempValue);
        }} onKeyDown={e => {
            if (e.key === "Enter") {
                setEditing(false);
                onChange(tempValue);
            }
            else if (e.key === "Escape") {
                setEditing(false);
                setTempValue(value);
            }
        }}/>) : (<BaseText className={className} onClick={() => setEditing(true)} style={{ cursor: "pointer" }}>
            {value}
        </BaseText>);
}
