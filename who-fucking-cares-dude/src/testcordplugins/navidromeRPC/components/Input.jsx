/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TextInput, useState } from "@webpack/common";
export function Input({ initialValue, onChange, placeholder, className = "", password = false, disabled = false }) {
    const [value, setValue] = useState(initialValue || "");
    return (<>
            <TextInput placeholder={placeholder} value={value} type={password ? "password" : "text"} onChange={setValue} disabled={disabled} spellCheck={false} style={{ flex: 1 }} onBlur={() => value !== initialValue && onChange(value)} className={className}/>
        </>);
}
