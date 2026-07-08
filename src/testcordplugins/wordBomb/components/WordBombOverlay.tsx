/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sleep } from "@utils/misc";
import { ComponentDispatch,createRoot, React, ReactDOM, useEffect, useRef, useState } from "@webpack/common";

import { HOMELANDER_MODEL_OPTIONS, LOCAL_PROVIDER_OPTIONS, SURF_MODEL_OPTIONS, SWISHAI_MODEL_OPTIONS, testcordChat } from "../../TestcordAI/aiProvider";

const DICT_URLS = [
    "https://raw.githubusercontent.com/words/an-array-of-french-words/master/index.json",
    "https://raw.githubusercontent.com/nightcordoff/dicofr/refs/heads/main/dico.txt"
];

// Some fallback words in case loading fails
const FALLBACK_WORDS = ["maison", "chat", "chien", "soleil", "pomme", "banane", "ordinateur", "clavier", "souris", "ecran", "table", "chaise", "fenetre", "porte", "voiture", "avion", "bateau", "train", "velo", "moto"];

let overlayRoot: any = null;
let overlayContainer: HTMLDivElement | null = null;

const memStorage: Record<string, string> = {};
function getSetting(key: string, def: string) {
    try { if (window.localStorage && window.localStorage.getItem(key) !== null) return window.localStorage.getItem(key)!; } catch {}
    return memStorage[key] !== undefined ? memStorage[key] : def;
}
function setSetting(key: string, val: string) {
    memStorage[key] = val;
    try { if (window.localStorage) window.localStorage.setItem(key, val); } catch {}
}

export async function toggleWordBombOverlay() {
    if (overlayContainer) {
        unmountOverlay();
    } else {
        mountOverlay();
    }
}

function mountOverlay() {
    if (document.getElementById("nc-wb-root")) return;
    overlayContainer = document.createElement("div");
    overlayContainer.id = "nc-wb-root";
    document.body.appendChild(overlayContainer);

    try {
        if (createRoot) {
            overlayRoot = createRoot(overlayContainer);
            overlayRoot.render(<WordBombOverlay />);
        } else {
            (ReactDOM as any).render(<WordBombOverlay />, overlayContainer);
        }
    } catch (e) {
        console.error("[WordBomb] Mounting error:", e);
    }
}

function unmountOverlay() {
    try { overlayRoot?.unmount(); } catch { }
    overlayContainer?.remove();
    overlayContainer = null;
    overlayRoot = null;
}

export function WordBombOverlay() {
    const [alphabet, setAlphabet] = useState<string[]>("abcdefghijklmnopqrstuvwxyz".split(""));
    const [dictionary, setDictionary] = useState<string[]>(FALLBACK_WORDS);
    const [syllable, setSyllable] = useState("");
    const [status, setStatus] = useState("Ready!");
    const [history, setHistory] = useState<{ alphabet: string[], word: string; }[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const isTypingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [badWords, setBadWords] = useState<Set<string>>(new Set());
    const [definition, setDefinition] = useState("");
    const [pos, setPos] = useState({ x: 100, y: 100 });
    const dragOffset = useRef({ x: 0, y: 0 });
    const inputRef = useRef<HTMLInputElement>(null);
    const mountedRef = useRef(true);
    const calibrationKeyRef = useRef<((e: KeyboardEvent) => void) | null>(null);
    const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const remountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Calibration removed — click is always at the dynamic center of the Discord window
    const [lps, setLps] = useState(() => parseFloat(getSetting("wb_lps", "50")));
    const [humanChance, setHumanChance] = useState(() => parseInt(getSetting("wb_humanChance", "0")));
    const [safeMode, setSafeMode] = useState(() => getSetting("wb_safeMode", "true") === "true");
    const [aiProvider, setAiProvider] = useState(() => getSetting("wb_aiProvider", "testcord"));
    const [groqModel, setGroqModel] = useState(() => getSetting("wb_groqModel", "llama-3.1-8b-instant"));
    const [homelanderModel, setHomelanderModel] = useState(() => getSetting("wb_homelanderModel", "openai/gpt-5.5"));
    const [swishAiModel, setSwishAiModel] = useState(() => getSetting("wb_swishAiModel", "gpt-5.5"));
    const [surfModel, setSurfModel] = useState(() => getSetting("wb_surfModel", "gateway-claude-opus-4-7"));
    const [theme, setTheme] = useState(() => getSetting("wb_theme", ""));
    const [themeWords, setThemeWords] = useState<Set<string>>(new Set());
    const [playMode, setPlayMode] = useState(() => getSetting("wb_playMode", "Normal"));
    const [noSpace, setNoSpace] = useState(() => getSetting("wb_noSpace", "false") === "true");
    const [isCalibrating, setIsCalibrating] = useState(false);
    const [calibratedPos, setCalibratedPos] = useState<{ x: number; y: number; } | null>(null);

    useEffect(() => () => {
        mountedRef.current = false;
        if (calibrationKeyRef.current) window.removeEventListener("keydown", calibrationKeyRef.current, true);
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
        if (remountTimerRef.current) clearTimeout(remountTimerRef.current);
    }, []);

    // Load dictionary
    useEffect(() => {
        setStatus("Loading dictionaries...");
        Promise.all(DICT_URLS.map(url => fetch(url).then(async res => {
            if (!res.ok) return [];
            if (url.endsWith(".json")) return await res.json();
            const text = await res.text();
            // Handle frequency list (word frequency) or plain list
            return text.split(/[\r\n]+/).map(line => {
                const parts = line.trim().split(/\s+/);
                return parts[0]; // Take the word, ignore frequency for now (sorted by frequency in source)
            }).filter(w => w.length > 0);
        }).catch(() => [])))
            .then(results => {
                const allWords = results.flat() as string[];
                const uniqueWords = Array.from(new Set(allWords))
                    .filter(w => {
                        // 1. Filter by length (words that are too long are often places or technical terms)
                        if (w.length < 3 || w.length > 15) return false;

                        // 2. Filter Proper Nouns: if the word starts with an uppercase letter in the source
                        // it's almost always a place name, person name, or brand.
                        if (w[0] === w[0].toUpperCase()) return false;

                        // 3. Filter abbreviations (all uppercase)
                        if (w === w.toUpperCase() && w.length > 1) return false;

                        // 4. French characters only
                        return /^[a-zœæéèêëàâäîïôöùûüç]+$/i.test(w);
                    })
                    .map(w => w.toLowerCase());

                const finalSet = Array.from(new Set(uniqueWords));

                if (finalSet.length > 0) {
                    setDictionary(finalSet);
                    setStatus(`Ready! (${finalSet.length} words)`);
                } else {
                    setDictionary(FALLBACK_WORDS);
                    setStatus("Dict. unavailable");
                }
            })
            .catch(err => {
                console.error("[WordBomb] Dictionary load error:", err);
                setStatus("Dict. error (fallback active)");
            });
    }, []);

    // Theme logic
    useEffect(() => {
        if (!theme.trim()) {
            setThemeWords(new Set());
            return;
        }
        fetch(`https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${theme}&utf8=&format=json&srlimit=1`)
            .then(r => r.json())
            .then(d => {
                if (d.query?.search?.[0]?.pageid) {
                    const pageId = d.query.search[0].pageid;
                    return fetch(`https://fr.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&pageids=${pageId}&format=json`);
                }
                throw new Error("No page");
            })
            .then(r => r.json())
            .then(d => {
                const pages = d.query?.pages;
                if (pages) {
                    const text = Object.values(pages)[0] as any;
                    if (text && text.extract) {
                        const words = text.extract.toLowerCase().match(/[a-zàâçéèêëîïôûùüÿñæœ]+/g) || [];
                        const unique = new Set<string>(words.filter((w: string) => w.length > 3));
                        setThemeWords(unique);
                    }
                }
            }).catch(() => setThemeWords(new Set()));
    }, [theme]);

    // Draggable logic
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        dragOffset.current = {
            x: e.clientX - pos.x,
            y: e.clientY - pos.y
        };
    };

    useEffect(() => {
        let rafId: number;

        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;

            // We use requestAnimationFrame to smooth the movement
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const newX = e.clientX - dragOffset.current.x;
                const newY = e.clientY - dragOffset.current.y;

                // Update the position
                setPos({ x: newX, y: newY });
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            if (rafId) cancelAnimationFrame(rafId);
        };

        if (isDragging) {
            window.addEventListener("mousemove", handleMouseMove, { passive: true });
            window.addEventListener("mouseup", handleMouseUp);
        }
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            if (rafId) cancelAnimationFrame(rafId);
        };
    }, [isDragging]);

    const startCalibrate = async () => {
        if (calibrationKeyRef.current) window.removeEventListener("keydown", calibrationKeyRef.current, true);
        setIsCalibrating(true);
        setStatus("Place your mouse on the game's text area, then press Space...");

        const onKeyDown = async (e: KeyboardEvent) => {
            if (e.code !== "Space") return;
            e.preventDefault();
            e.stopPropagation();
            window.removeEventListener("keydown", onKeyDown, true);
            calibrationKeyRef.current = null;

            try {
                // VencordNative is exposed via contextBridge under the name "VencordNative"
                // In the packaged Electron renderer, you need to go through window
                const nc = (window as any).VencordNative ?? (globalThis as any).VencordNative;
                const cursorPos = await nc?.wordBomb?.getCursorPos?.() || await nc?.worldBomb?.getCursorPos?.();
                if (!mountedRef.current) return;
                if (cursorPos && typeof cursorPos.x === "number" && typeof cursorPos.y === "number") {
                    setCalibratedPos(cursorPos);
                    setSetting("wb_calibPos", JSON.stringify(cursorPos));
                    setStatus(`✅ Calibrated: (${cursorPos.x}, ${cursorPos.y})`);
                } else {
                    // Fallback: try via ipcRenderer directly
                    const { ipcRenderer } = (window as any).require?.("electron") ?? {};
                    if (ipcRenderer) {
                        const pos = await ipcRenderer.invoke("WorldBombGetCursorPos");
                        if (!mountedRef.current) return;
                        if (pos && typeof pos.x === "number") {
                            setCalibratedPos(pos);
                            setSetting("wb_calibPos", JSON.stringify(pos));
                            setStatus(`✅ Calibrated: (${pos.x}, ${pos.y})`);
                        } else {
                            setStatus("❌ Invalid position received: " + JSON.stringify(pos));
                        }
                    } else {
                        setStatus("❌ getCursorPos unavailable (nc=" + typeof nc + ")");
                    }
                }
            } catch (err) {
                if (!mountedRef.current) return;
                setStatus("❌ Calibration error: " + String(err));
            } finally {
                if (!mountedRef.current) return;
                setIsCalibrating(false);
                focusTimerRef.current = setTimeout(() => {
                    focusTimerRef.current = null;
                    inputRef.current?.focus();
                }, 100);
            }
        };

        calibrationKeyRef.current = onKeyDown;
        window.addEventListener("keydown", onKeyDown, true);
    };

    const processSearch = (syl: string, isReroll = false) => {
        if (isTypingRef.current) return;
        const query = syl || syllable;
        if (!query || dictionary.length === 0) return;

        const sylLower = query.toLowerCase();
        // Filter words that contain the syllable and are not in the "bad words"
        let matches = dictionary.filter(w => {
            const low = w.toLowerCase();
            if (!low.includes(sylLower)) return false;
            if (badWords.has(low)) return false;
            if (noSpace && (low.includes(" ") || low.includes("-"))) return false;
            if (playMode === "Pro" && low.length < 13) return false;
            if (playMode === "Noob" && low.length > 7) return false;
            return true;
        });

        if (themeWords.size > 0) {
            const themeMatches = matches.filter(w => themeWords.has(w.toLowerCase()));
            if (themeMatches.length > 0) matches = themeMatches;
        }

        if (matches.length === 0) {
            setStatus("No words found");
            return;
        }

        // Prioritization: words that contain letters from the remaining alphabet
        const rareLetters = "zyxwvkq".split("");
        const sortedRemaining = [...alphabet].sort((a, b) => {
            const aIsRare = rareLetters.includes(a);
            const bIsRare = rareLetters.includes(b);
            if (aIsRare && !bIsRare) return -1;
            if (!aIsRare && bIsRare) return 1;
            if (aIsRare && bIsRare) return rareLetters.indexOf(a) - rareLetters.indexOf(b);
            return 0;
        });

        const computeScore = (w: string, currentMissing: string[], index: number) => {
            let score = 0;
            const found = new Set();
            for (const char of w) {
                if (currentMissing.includes(char) && !found.has(char)) {
                    score += 100; // Alphabet letters are priority #1
                    found.add(char);
                }
            }

            // Frequency score: words earlier in the dictionary (more frequent) get a bonus
            // We use a relative bonus based on the index
            const frequencyBonus = Math.max(0, 100 - (index / 1000));
            score += frequencyBonus;

            // Mode specific length adjustments
            if (playMode === "Pro") score += w.length * 5;
            else if (playMode === "Noob") score -= w.length * 10;

            if (themeWords.has(w)) score += 1000;
            return score;
        };

        let targetWord = "";
        let bestScore = -Infinity;

        for (let i = 0; i < matches.length; i++) {
            const w = matches[i];
            const s = computeScore(w, alphabet, i);
            if (s > bestScore) {
                bestScore = s;
                targetWord = w;
            }
        }

        if (!isReroll) {
            setHistory(prev => [...prev, { alphabet: [...alphabet], word: targetWord }]);
        }

        const newAlphabet = alphabet.filter(l => !targetWord.toLowerCase().includes(l));
        setAlphabet(newAlphabet.length === 0 ? "abcdefghijklmnopqrstuvwxyz".split("") : newAlphabet);

        sendWord(targetWord);
        if (!isReroll) setSyllable("");
    };

    const handleReroll = () => {
        if (history.length === 0) return;
        const last = history[history.length - 1];
        const newHistory = history.slice(0, -1);

        setBadWords(prev => new Set(prev).add(last.word.toLowerCase()));
        setAlphabet(last.alphabet);
        setHistory(newHistory);

        processSearch(syllable, true);
    };

    const sendWord = async (word: string) => {
        isTypingRef.current = true;
        setIsTyping(true);
        setStatus(`Typing: ${word}...`);

        if (safeMode) {
            setDefinition("Generating AI definition...");
            testcordChat({
                provider: aiProvider,
                groqModel,
                homelanderModel,
                swishAiModel,
                surfModel,
                temperature: 0.7,
                maxTokens: 150,
                messages: [{
                    role: "user",
                    content: `Give a very short definition (1 simple sentence) for the following word, explaining what it concretely is, without stating its grammatical type. Answer in English. Word: "${word}"`
                }],
            })
                .then(ans => setDefinition(ans.trim() || "AI could not define this word."))
                .catch(e => setDefinition(`AI definition error: ${e?.message || "request failed"}`));
        } else {
            setDefinition("");
        }

        const wbNative = (window as any).VencordNative?.wordBomb || (window as any).VencordNative?.worldBomb;

        try {
            if (wbNative?.sequence) {
                // Always -1,-1: the main process dynamically calculates the center of the window
                await wbNative.sequence(word, lps, humanChance, -1, -1);
            } else {
                // Fallback: classic Discord chat mode (not in game)
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }
                for (const char of word) {
                    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", {
                        rawText: char,
                        plainText: char
                    });
                    await sleep(30);
                }
                ComponentDispatch.dispatchToLastSubscribed("SUBMIT");
            }
            setStatus("Ready!");
        } catch (e) {
            if (!mountedRef.current) return;
            console.error("[WordBomb] Typing error:", e);
            setStatus("Typing error");
        } finally {
            if (!mountedRef.current) return;
            isTypingRef.current = false;
            setIsTyping(false);
            // Refocus the input field automatically so the user never has to use the mouse
            focusTimerRef.current = setTimeout(() => {
                focusTimerRef.current = null;
                inputRef.current?.focus();
            }, 50);
        }
    };

    return (
        <div
            className={`nc-wb-overlay ${isDragging ? "dragging" : ""}`}
            style={{
                position: "fixed",
                top: pos.y,
                left: pos.x,
                background: "#1f2937",
                color: "white",
                borderRadius: "16px",
                padding: "16px",
                width: "300px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
                pointerEvents: isTyping ? "none" : "auto",
                opacity: isTyping ? 0.7 : 1,
                zIndex: 9999
            }}
        >
            <div className="nc-wb-header" onMouseDown={handleMouseDown} style={{ cursor: "move", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
                <h3 style={{ margin: 0, fontSize: "16px" }}>🎯 WordBomb Helper</h3>
                <div className="nc-wb-close" onClick={unmountOverlay} style={{ cursor: "pointer", opacity: 0.7 }}>✕</div>
            </div>

            <div className="nc-wb-content">
                {!isSettingsOpen ? (
                    <>
                        <div className="nc-wb-alphabet" style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: "4px", marginBottom: "15px" }}>
                            {alphabet.map((l, i) => (
                                <span key={i} className="nc-wb-letter" style={{ fontSize: "10px", textAlign: "center", opacity: 0.8 }}>{l.toUpperCase()}</span>
                            ))}
                        </div>

                        <div className="nc-wb-input-container" style={{ marginBottom: "15px" }}>
                            <input
                                ref={inputRef}
                                type="text"
                                className="nc-wb-input"
                                placeholder="Syllable..."
                                value={syllable}
                                onChange={e => setSyllable(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && processSearch(syllable)}
                                style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "none", background: "#374151", color: "white" }}
                            />
                        </div>

                        <div style={{ display: "flex", gap: "8px" }}>
                            <button className="nc-wb-button" onClick={() => processSearch(syllable)} style={{ flex: 1, padding: "10px", background: "#7c3aed", border: "none", borderRadius: "8px", color: "white", cursor: "pointer" }}>
                                FIND
                            </button>
                            <button
                                style={{
                                    width: "45px",
                                    height: "45px",
                                    background: "rgba(255, 255, 255, 0.1)",
                                    border: "none",
                                    borderRadius: "12px",
                                    color: "#fff",
                                    cursor: "pointer",
                                    fontSize: "18px"
                                }}
                                onClick={handleReroll}
                                title="Reroll (`)"
                            >
                                🔄
                            </button>

                        </div>

                        {safeMode && definition && (
                            <div style={{ marginTop: "15px", fontSize: "11px", color: "#d1d5db", fontStyle: "italic", background: "#374151", padding: "8px", borderRadius: "8px", maxHeight: "80px", overflowY: "auto" }}>
                                <strong style={{ color: "#60a5fa" }}>Definition:</strong> {definition}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="nc-wb-settings">
                        <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                            <label>Speed (LPS): {lps}</label>
                            <input
                                type="range"
                                min="10"
                                max="100"
                                step="1"
                                value={lps}
                                onChange={e => {
                                    setLps(parseFloat(e.target.value));
                                    setSetting("wb_lps", e.target.value);
                                }}
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                            <label>Error (%): {humanChance}%</label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={humanChance}
                                onChange={e => {
                                    setHumanChance(parseInt(e.target.value));
                                    setSetting("wb_humanChance", e.target.value);
                                }}
                                style={{ width: "100%" }}
                            />
                        </div>
                        <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                            <label style={{ fontSize: "13px", color: "#f472b6", fontWeight: "bold" }}>Theme (Optional)</label>
                            <input
                                type="text"
                                placeholder="e.g. sex, love..."
                                value={theme}
                                onChange={e => {
                                    setTheme(e.target.value.toLowerCase().trim());
                                    setSetting("wb_theme", e.target.value.toLowerCase().trim());
                                }}
                                style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px" }}
                            />
                        </div>
                        <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                            <label style={{ fontSize: "13px", color: "#fbbf24", fontWeight: "bold" }}>Play Style</label>
                            <select
                                value={playMode}
                                onChange={e => {
                                    setPlayMode(e.target.value);
                                    setSetting("wb_playMode", e.target.value);
                                }}
                                style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px", outline: "none" }}
                            >
                                <option value="Normal">Normal</option>
                                <option value="Pro">Pro Mod (Long & Complex)</option>
                                <option value="Noob">Noob Mod (Short & Simple)</option>
                            </select>
                        </div>
                        <div className="nc-wb-setting-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", borderTop: "1px solid #4b5563", paddingTop: "10px" }}>
                            <label style={{ fontSize: "13px", color: "#ef4444", fontWeight: "bold" }}>🚫 No Spaces or Dashes</label>
                            <input
                                type="checkbox"
                                checked={noSpace}
                                onChange={e => {
                                    const { checked } = e.target;
                                    setNoSpace(checked);
                                    setSetting("wb_noSpace", String(checked));
                                }}
                                style={{ transform: "scale(1.2)" }}
                            />
                        </div>

                        <div className="nc-wb-setting-item" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", borderTop: "1px solid #4b5563", paddingTop: "10px" }}>
                            <label style={{ fontSize: "13px", color: "#60a5fa", fontWeight: "bold" }}>📚 Safe Mode (Def.)</label>
                            <input
                                type="checkbox"
                                checked={safeMode}
                                onChange={e => {
                                    const { checked } = e.target;
                                    setSafeMode(checked);
                                    setSetting("wb_safeMode", String(checked));
                                    if (checked) {
                                        remountTimerRef.current = setTimeout(() => {
                                            remountTimerRef.current = null;
                                            unmountOverlay();
                                            toggleWordBombOverlay();
                                        }, 300);
                                    }
                                }}
                                style={{ transform: "scale(1.2)" }}
                            />
                        </div>
                        <div style={{ fontSize: "10px", opacity: 0.6, marginTop: "4px", marginBottom: "15px" }}>
                            Displays the definition of the word the bot just typed to pretend you know it.
                        </div>
                        {safeMode && (
                            <>
                                <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "13px", color: "#a78bfa", fontWeight: "bold" }}>AI Provider</label>
                                    <select
                                        value={aiProvider}
                                        onChange={e => {
                                            setAiProvider(e.target.value);
                                            setSetting("wb_aiProvider", e.target.value);
                                        }}
                                        style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px", outline: "none" }}
                                    >
                                        {LOCAL_PROVIDER_OPTIONS.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}
                                    </select>
                                </div>
                                {aiProvider === "groq" && (
                                    <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                                        <label>Groq Model</label>
                                        <input value={groqModel} onChange={e => { setGroqModel(e.target.value); setSetting("wb_groqModel", e.target.value); }} style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px" }} />
                                    </div>
                                )}
                                {aiProvider === "homelander" && (
                                    <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                                        <label>Homelander Model</label>
                                        <select value={homelanderModel} onChange={e => { setHomelanderModel(e.target.value); setSetting("wb_homelanderModel", e.target.value); }} style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px" }}>
                                            {HOMELANDER_MODEL_OPTIONS.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                )}
                                {aiProvider === "swishai" && (
                                    <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                                        <label>SwishAI Model</label>
                                        <select value={swishAiModel} onChange={e => { setSwishAiModel(e.target.value); setSetting("wb_swishAiModel", e.target.value); }} style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px" }}>
                                            {SWISHAI_MODEL_OPTIONS.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                )}
                                {aiProvider === "unlimited-surf" && (
                                    <div className="nc-wb-setting-item" style={{ marginBottom: "10px" }}>
                                        <label>Unlimited Surf Model</label>
                                        <select value={surfModel} onChange={e => { setSurfModel(e.target.value); setSetting("wb_surfModel", e.target.value); }} style={{ width: "100%", padding: "6px", borderRadius: "6px", border: "none", background: "#374151", color: "white", marginTop: "5px" }}>
                                            {SURF_MODEL_OPTIONS.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                )}
                            </>
                        )}
                        <button className="nc-wb-button" style={{ width: "100%", padding: "8px", background: "#4b5563", border: "none", borderRadius: "8px", color: "white" }} onClick={() => setIsSettingsOpen(false)}>
                            BACK
                        </button>
                    </div>
                )}
            </div>

            <div className="nc-wb-footer" style={{ marginTop: "15px", paddingTop: "10px", borderTop: "1px solid #374151", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div
                    className="nc-wb-settings-btn"
                    title="Settings"
                    onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                    style={{ cursor: "pointer", fontSize: "18px" }}
                >
                    {isSettingsOpen ? "✕" : "⚙"}
                </div>
                <div className="nc-wb-status" style={{ fontSize: "10px", opacity: 0.6 }}>
                    {status} | LPS: {lps} | Human: {humanChance}%
                </div>
            </div>
        </div>
    );
}
