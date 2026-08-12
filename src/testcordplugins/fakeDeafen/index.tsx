import definePlugin, { OptionType } from "@utils/types";
import { TestcordDevs } from "@utils/constants";
import { definePluginSettings } from "@api/Settings";
import { Toasts, SelectedChannelStore } from "@webpack/common";
import { findByPropsLazy } from "@webpack";

const states = {
    mute: true,
    deafen: true
};

const { toggleSelfMute } = findByPropsLazy("toggleSelfMute");
const { toggleSelfDeaf } = findByPropsLazy("toggleSelfDeaf");
let updaterequired = false;

const settings = definePluginSettings({
    info: {
        description: "Modified by dot ❤️",
        type: OptionType.COMPONENT,
        component: () => null
    },
    enableFakeDeafen: {
        description: "🔇 Enable or disable fake deafen (automatically includes fake mute for realism)",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: (value) => states.deafen = value
    },
    enableFakeMute: {
        description: "🎤 Enable or disable fake mute",
        type: OptionType.BOOLEAN,
        default: true,
        onChange: (value) => states.mute = value
    },
    muteKeybind: {
        description: "⌨️ Keybind for toggling fake mute only (format: modifier+key, e.g., 'ctrl+j')",
        type: OptionType.STRING,
        default: "ctrl+j"
    },
    deafenKeybind: {
        description: "⌨️ Keybind for toggling fake deafen + fake mute (format: modifier+key, e.g., 'ctrl+l')",
        type: OptionType.STRING,
        default: "ctrl+l"
    },
    note: {
        description: "ℹ️ Note: Fake deafen will automatically enable fake mute when activated (just like real Discord behavior)",
        type: OptionType.COMPONENT,
        component: () => null
    }
});

// Parse keybind string into components
function parseKeybind(keybind: string) {
    const parts = keybind.toLowerCase().split('+');
    const modifiers = {
        ctrl: false,
        alt: false,
        shift: false,
        meta: false
    };
    let key = '';

    for (const part of parts) {
        if (part === 'ctrl') modifiers.ctrl = true;
        else if (part === 'alt') modifiers.alt = true;
        else if (part === 'shift') modifiers.shift = true;
        else if (part === 'meta' || part === 'cmd') modifiers.meta = true;
        else key = part;
    }

    return { ...modifiers, key };
}

// Check if event matches keybind
function matchesKeybind(event: KeyboardEvent, keybind: string) {
    const parsed = parseKeybind(keybind);
    return (
        event.ctrlKey === parsed.ctrl &&
        event.altKey === parsed.alt &&
        event.shiftKey === parsed.shift &&
        event.metaKey === parsed.meta &&
        event.key.toLowerCase() === parsed.key
    );
}

function toggleFakeDeafen() {
    states.deafen = !states.deafen;
    settings.store.enableFakeDeafen = states.deafen;

    // When enabling fake deafen, also enable fake mute for realism
    if (!states.deafen) {
        states.mute = false;
        settings.store.enableFakeMute = states.mute;
    }

    const statusMsg = states.deafen ? "disabled" : "enabled";
    const muteStatusMsg = !states.deafen ? " (+ fake mute)" : "";

    Toasts.show({
        message: `🔇 Fake deafen is now: ${statusMsg}${muteStatusMsg}`,
        id: "fake-deafen",
        type: states.deafen ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        options: {
            position: Toasts.Position.BOTTOM
        }
    });

    // Trigger voice state update
    updaterequired = true;
    toggleSelfDeaf();
    toggleSelfDeaf();
    // Also trigger mute update if we just enabled fake deafen
    if (!states.deafen) {
        toggleSelfMute();
        toggleSelfMute();
    }
    updaterequired = false;
}

function toggleFakeMute() {
    states.mute = !states.mute;
    settings.store.enableFakeMute = states.mute;

    Toasts.show({
        message: `🎤 Fake mute is now: ${states.mute ? "disabled" : "enabled"}`,
        id: "fake-mute",
        type: states.mute ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
        options: {
            position: Toasts.Position.BOTTOM
        }
    });

    // Trigger voice state update
    updaterequired = true;
    toggleSelfMute();
    toggleSelfMute();
    updaterequired = false;
}

function handleKeydown(e: KeyboardEvent) {
    // Prevent triggering when typing in input fields
    if (e.target && (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA' ||
        (e.target as HTMLElement).contentEditable === 'true'
    )) {
        return;
    }

    // Check for mute keybind
    if (matchesKeybind(e, settings.store.muteKeybind)) {
        e.preventDefault();
        toggleFakeMute();
        return;
    }

    // Check for deafen keybind
    if (matchesKeybind(e, settings.store.deafenKeybind)) {
        e.preventDefault();
        toggleFakeDeafen();
        return;
    }
}

export default definePlugin({
    name: "fakeDeafen (dot's one)",
    description: "Control which voice states are updated with customizable keybinds.",
    tags: ["Voice", "Privacy"],
    authors: [TestcordDevs.dot],

    state(type: string, real: boolean) {
        if (type === "mute" && !states.mute) return true;
        else if (type === "deafen" && !states.deafen) return true;
        else return real;
    },

    patches: [
        {
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+)/,
                replace: "self_mute:$self.state('mute',$1),self_deaf:$self.state('deafen',$2)"
            }
        }
    ],

    settings: settings,

    start() {
        // Initialize states from settings
        states.mute = settings.store.enableFakeMute;
        states.deafen = settings.store.enableFakeDeafen;

        // Initialize voice channel tracking
        this.lastVoiceChannelId = SelectedChannelStore.getVoiceChannelId();

        // Add event listeners
        document.addEventListener('keydown', handleKeydown);
        SelectedChannelStore.addChangeListener(this.handleVoiceChannelChange.bind(this));

        Toasts.show({
            message: `🎤 Fake Voice Plugin loaded! Use ${settings.store.muteKeybind.toUpperCase()} (mute) and ${settings.store.deafenKeybind.toUpperCase()} (deafen+mute)`,
            id: "plugin-loaded",
            type: Toasts.Type.SUCCESS,
            options: {
                position: Toasts.Position.BOTTOM,
                duration: 4000
            }
        });
    },

    stop() {
        document.removeEventListener('keydown', handleKeydown);
        SelectedChannelStore.removeChangeListener(this.handleVoiceChannelChange.bind(this));

        // Clean up tracking
        this.lastVoiceChannelId = null;

        Toasts.show({
            message: "🎤 Fake Voice Plugin stopped",
            id: "plugin-stopped",
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
    },

    handleVoiceChannelChange() {
        try {
            const currentChannelId = SelectedChannelStore.getVoiceChannelId();
            const previousChannelId = this.lastVoiceChannelId || null;

            // Update last known channel
            this.lastVoiceChannelId = currentChannelId;

            // If we just joined a voice channel
            if (!previousChannelId && currentChannelId) {
                this.handleJoinVoiceChannel(currentChannelId);
            }
            // If we switched voice channels
            else if (previousChannelId && currentChannelId && previousChannelId !== currentChannelId) {
                this.handleSwitchVoiceChannel(previousChannelId, currentChannelId);
            }
            // If we left a voice channel
            else if (previousChannelId && !currentChannelId) {
                this.handleLeaveVoiceChannel(previousChannelId);
            }
        } catch (error) {
            console.error("Error in handleVoiceChannelChange:", error);
        }
    },

    handleJoinVoiceChannel(channelId: string) {
        // Apply fake states when joining a voice channel
        setTimeout(() => {
            if (!states.mute || !states.deafen) {
                updaterequired = true;

                // Apply fake deafen if disabled
                if (!states.deafen) {
                    toggleSelfDeaf();
                    toggleSelfDeaf();
                }

                // Apply fake mute if disabled (or if fake deafen is active)
                if (!states.mute) {
                    toggleSelfMute();
                    toggleSelfMute();
                }

                updaterequired = false;
            }
        }, 500); // Small delay to ensure voice state is properly initialized
    },

    handleSwitchVoiceChannel(previousChannelId: string, currentChannelId: string) {
        // Reapply fake states when switching channels
        setTimeout(() => {
            if (!states.mute || !states.deafen) {
                updaterequired = true;

                // Reapply fake deafen if disabled
                if (!states.deafen) {
                    toggleSelfDeaf();
                    toggleSelfDeaf();
                }

                // Reapply fake mute if disabled (or if fake deafen is active)
                if (!states.mute) {
                    toggleSelfMute();
                    toggleSelfMute();
                }

                updaterequired = false;
            }
        }, 300);
    },

    handleLeaveVoiceChannel(previousChannelId: string) {
        // Reset any temporary states if needed when leaving voice
        // This ensures clean state when rejoining voice channels later

        // Optional: Reset to default states when leaving voice
        // Uncomment if you want this behavior:
        /*
        states.mute = settings.store.enableFakeMute;
        states.deafen = settings.store.enableFakeDeafen;
        */
    }
});
