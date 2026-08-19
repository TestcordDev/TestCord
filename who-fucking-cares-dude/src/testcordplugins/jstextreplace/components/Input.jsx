/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 nin0
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { TextInput, useState } from "@webpack/common";
export function Input({ initialValue, onChange, placeholder }) {
    const [value, setValue] = useState(initialValue);
    return (<TextInput placeholder={placeholder} value={value} onChange={setValue} spellCheck={false} style={{ flex: 1 }} onBlur={() => value !== initialValue && onChange(value)}/>);
}
