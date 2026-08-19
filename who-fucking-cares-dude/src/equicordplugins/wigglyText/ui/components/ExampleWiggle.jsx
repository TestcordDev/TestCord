/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export default function ExampleWiggle({ wiggle, children }) {
    return children.split("").map((x, i) => (<span key={i}>
            <span className={`wiggle-inner wiggle-inner-${wiggle}`} style={{
            animationDelay: `${(i * 25) % 1200}ms`,
        }}>
                {x}
            </span>
        </span>));
}
