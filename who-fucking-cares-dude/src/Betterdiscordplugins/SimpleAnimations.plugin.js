"use strict";
/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
/**
 * @name SimpleAnimations
 * @author Testcord Team
 * @version 1.0.0
 * @description Simple CSS animations for Discord - works in browser context
 * @source https://github.com/TestcordDev/Testcord
 */
module.exports = {
    start() {
        console.log("[SimpleAnimations] Starting animations!");
        // Remove existing style if any
        const existing = document.getElementById("bd-simple-animations");
        if (existing)
            existing.remove();
        // Add CSS animations
        const style = document.createElement("style");
        style.id = "bd-simple-animations";
        style.textContent = `
            /* IMPORTANT - Force animations everywhere */
            * {
                transition-timing-function: ease !important;
            }

            /* Channel list item hover - VERY obvious */
            [class*="channelItem"], .channelItem-2qjOWj, [class*="channel-"][class*="clickable"] {
                transition: all 0.2s ease !important;
            }
            [class*="channelItem"]:hover, .channelItem-2qjOWj:hover, [class*="channel-"][class*="clickable"]:hover {
                transform: translateX(8px) scale(1.02) !important;
                background-color: rgba(255,255,255,0.1) !important;
            }

            /* Server icons - obvious bounce */
            [class*="guildIcon"], .guildIcon-27yOU5, [class*="item-"][class*="guild"], [class*="wrapper-"][class*="guild"] {
                transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            }
            [class*="guildIcon"]:hover, .guildIcon-27yOY5:hover, [class*="item-"][class*="guild"]:hover {
                transform: scale(1.2) rotate(5deg) !important;
            }

            /* Emojis - big scale */
            .emoji, img[alt*=":"], img[class*="emoji"] {
                transition: transform 0.15s ease !important;
                display: inline-block !important;
            }
            .emoji:hover, img[alt*=":"]:hover, img[class*="emoji"]:hover {
                transform: scale(2) !important;
                z-index: 100 !important;
                position: relative !important;
            }

            /* Messages - swipe in from left with fade */
            @keyframes bdMessageSwipe {
                from {
                    opacity: 0.7;
                    transform: translateX(-20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }
            [class*="message-"], .message-2CShn3, [class*="messageListItem"] {
                animation: bdMessageSwipe 0.2s ease-out !important;
            }
            [class*="message-"]:hover, .message-2CShn3:hover, [class*="messageListItem"]:hover {
                opacity: 0.95 !important;
                transition: opacity 0.1s ease !important;
            }

            /* Buttons - bounce effect */
            button, [class*="button-"], .button-f2h6uQ {
                transition: all 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
            }
            button:hover, [class*="button-"]:hover, .button-f2h6uQ:hover {
                transform: scale(1.1) translateY(-2px) !important;
            }

            /* Role pills - glow and lift */
            [class*="role-"], .role-2TIOKu {
                transition: all 0.2s ease !important;
            }
            [class*="role-"]:hover, .role-2TIOKu:hover {
                transform: translateY(-3px) scale(1.05) !important;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4) !important;
                filter: brightness(1.2) !important;
            }

            /* User hover in member list */
            [class*="member-"], [class*="memberListItem"] {
                transition: all 0.15s ease !important;
            }
            [class*="member-"]:hover, [class*="memberListItem"]:hover {
                transform: translateX(5px) !important;
            }

            /* Input fields - glow on focus */
            input, textarea, [contenteditable="true"] {
                transition: all 0.2s ease !important;
            }
            input:focus, textarea:focus, [contenteditable="true"]:focus {
                box-shadow: 0 0 15px rgba(88, 101, 242, 0.5) !important;
                transform: scale(1.01) !important;
            }

            /* Smooth scroll - DISABLED because it causes glitches with channel switching */
            /* Only apply to specific scrollable areas, not globally */
            [class*="scroller-"]:hover {
                scroll-behavior: smooth !important;
            }

            /* Hover on any clickable div */
            div[role="button"]:hover, [class*="clickable"]:hover {
                filter: brightness(1.15) !important;
                transition: all 0.15s ease !important;
            }
        `;
        document.head.appendChild(style);
        console.log("[SimpleAnimations] CSS injected!");
        BdApi.Logger.info("SimpleAnimations enabled! ✨ Hover over stuff!");
        // Show a temporary notification
        const notice = document.createElement("div");
        notice.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: linear-gradient(135deg, #43b581, #3ba55c);
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            z-index: 99999;
            font-weight: bold;
            box-shadow: 0 4px 20px rgba(67, 181, 129, 0.4);
            animation: fadeIn 0.3s ease;
        `;
        notice.innerHTML =
            "🎨 SimpleAnimations Active!<br><span style='font-size:12px;opacity:0.8'>Hover over channels, emojis, servers...</span>";
        document.body.appendChild(notice);
        setTimeout(() => notice.remove(), 4000);
    },
    stop() {
        const style = document.getElementById("bd-simple-animations");
        if (style) {
            style.remove();
        }
        console.log("[SimpleAnimations] Stopped");
        BdApi.Logger.info("SimpleAnimations disabled");
    },
    getSettingsPanel() {
        const panel = document.createElement("div");
        panel.innerHTML = `
            <div style="padding: 15px; background: #2f3136; border-radius: 5px;">
                <h3 style="color: #43b581; margin-top: 0;">✨ SimpleAnimations</h3>
                <p style="color: #b9bbbe;">Browser-compatible CSS animations for Discord</p>

                <hr style="border-color: #202225; margin: 15px 0;">

                <h4 style="color: #fff;">What Gets Animated:</h4>
                <ul style="color: #b9bbbe; line-height: 1.8;">
                    <li>📍 <strong>Channels</strong> - Slide right on hover</li>
                    <li>🏰 <strong>Server Icons</strong> - Scale & rotate bounce</li>
                    <li>😀 <strong>Emojis</strong> - 2x scale on hover</li>
                    <li>💬 <strong>Messages</strong> - Slide in animation</li>
                    <li>🔘 <strong>Buttons</strong> - Bounce scale effect</li>
                    <li>🏷️ <strong>Role Pills</strong> - Lift & glow</li>
                    <li>👥 <strong>Member List</strong> - Slide on hover</li>
                    <li>⌨️ <strong>Inputs</strong> - Blue glow on focus</li>
                </ul>

                <hr style="border-color: #202225; margin: 15px 0;">

                <div style="background: #36393f; padding: 10px; border-radius: 5px; border-left: 3px solid #f04747;">
                    <strong style="color: #f04747;">⚠️ Why BetterAnimations Doesn't Work:</strong>
                    <p style="color: #b9bbbe; font-size: 13px; margin: 8px 0 0 0;">
                        BetterAnimations requires Node.js modules (fs, path, electron) that only work in
                        BetterDiscord's desktop environment. Testcord runs in the browser context where
                        these modules don't exist.
                    </p>
                </div>
            </div>
        `;
        return panel;
    },
};
