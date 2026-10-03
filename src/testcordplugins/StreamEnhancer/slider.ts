/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function sliderChoices(markers: readonly number[], min: number, max: number) {
    return [...new Set(markers.map(Math.round).filter(value => value >= min && value <= max))].sort((a, b) => a - b);
}

export function nearestChoice(value: number, choices: readonly number[]) {
    return choices.reduce((best, next, index) => Math.abs(next - value) < Math.abs(choices[best] - value) ? index : best, 0);
}

export function choiceAt(position: number, choices: readonly number[]) {
    return choices[Math.max(0, Math.min(choices.length - 1, Math.round(position)))];
}

export function showChoiceLabel(index: number, count: number) {
    return index === count - 1 || index % Math.max(1, Math.ceil((count - 1) / 4)) === 0;
}

export function badgeSize(height: number) {
    height = Math.max(144, Math.min(34560, Math.round(height)));
    return { spoofBadgeHeight: height, spoofBadgeWidth: Math.round(height * 16 / 9) };
}
