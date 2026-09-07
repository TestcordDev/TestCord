/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import { React, useEffect, useState } from "@webpack/common";

import type { UserAreaModule } from "../types";

const QUOTES = [
    "Stay positive, work hard, make it happen.",
    "Every day is a fresh beginning.",
    "Small steps in the right direction can turn out to be the biggest step of your life.",
    "Simplicity is the ultimate sophistication.",
    "Code is like humor. When you have to explain it, it's bad.",
    "Make each day your masterpiece."
];

function QuotesComponent() {
    const [quoteIndex, setQuoteIndex] = useState(0);

    useEffect(() => {
        const randomIdx = Math.floor(Math.random() * QUOTES.length);
        setQuoteIndex(randomIdx);
    }, []);

    const nextQuote = () => {
        setQuoteIndex((quoteIndex + 1) % QUOTES.length);
    };

    return (
        <div
            className="vc-panel-quote-module"
            onClick={nextQuote}
            title="Click for next quote"
            style={{
                padding: "6px 12px",
                margin: "4px 8px",
                borderRadius: "8px",
                background: "var(--background-secondary-alt, rgba(0, 0, 0, 0.2))",
                border: "1px solid var(--background-modifier-accent, rgba(255, 255, 255, 0.05))",
                fontSize: "11px",
                fontStyle: "italic",
                color: "var(--text-muted)",
                textAlign: "center",
                cursor: "pointer",
                userSelect: "none",
                lineHeight: "1.3"
            }}
        >
            "{QUOTES[quoteIndex]}"
        </div>
    );
}

export const quotesModule: Omit<UserAreaModule, "order" | "enabled"> = {
    id: "quotes-widget",
    name: "Daily Quotes",
    description: "Displays daily motivational quotes and positive thoughts in your user area.",
    authors: [TestcordDevs.deracul],
    version: "1.0.0",
    tags: ["Utility", "Aesthetics", "Quotes"],
    icon: "💬",
    position: "above",
    render: QuotesComponent,
};
