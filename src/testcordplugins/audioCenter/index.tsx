/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { RuntimeInterposition, RuntimeInterpositionPriority } from "@api/RuntimeInterposition";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { identity } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import {
    Button,
    FluxDispatcher,
    Forms,
    React,
    Select,
} from "@webpack/common";

const configModule = findByPropsLazy("getOutputVolume");

const settings = definePluginSettings({
    // Audio mixer settings
    enabled: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Enable audio center",
    },
    primaryDevice: {
        type: OptionType.COMPONENT,
        component: () => <PrimaryDeviceSelector />,
        description: "Primary audio device (microphone)",
    },
    secondaryDevice: {
        type: OptionType.COMPONENT,
        component: () => <SecondaryDeviceSelector />,
        description: "Secondary audio device (music, etc.)",
    },
    primaryVolume: {
        type: OptionType.SLIDER,
        default: 100,
        description: "Primary device volume (%)",
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false,
    },
    secondaryVolume: {
        type: OptionType.SLIDER,
        default: 50,
        description: "Secondary device volume (%)",
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false,
    },

    // Virtual device settings
    virtualDeviceName: {
        type: OptionType.STRING,
        default: "AudioCenter - Virtual Output",
        description: "Virtual device name",
    },
    autoSetAsOutput: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Automatically set as Discord output device",
    },

    // General settings
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show notifications",
    },
});

// Global variables
let selectedPrimaryDevice = "";
let selectedSecondaryDevice = "";

// Restore closures for every global monkey-patch installed at runtime
const _patchRestores: Array<() => void> = [];
let _injected = false;

// Audio mixer state
interface AudioMixerState {
    isActive: boolean;
    audioContext: AudioContext | null;
    primaryStream: MediaStream | null;
    secondaryStream: MediaStream | null;
    primaryGain: GainNode | null;
    secondaryGain: GainNode | null;
    destination: MediaStreamAudioDestinationNode | null;
    mixedStream: MediaStream | null;
}

let mixerState: AudioMixerState = {
    isActive: false,
    audioContext: null,
    primaryStream: null,
    secondaryStream: null,
    primaryGain: null,
    secondaryGain: null,
    destination: null,
    mixedStream: null,
};

// Virtual device state
let virtualOutputDevice = {
    id: "audioCenter-virtual-output",
    name: "AudioCenter - Virtual Output",
    isActive: false,
    audioContext: null as AudioContext | null,
    destination: null as MediaStreamAudioDestinationNode | null,
    gainNode: null as GainNode | null,
};
let virtualAudioElement: HTMLAudioElement | null = null;

function clearVirtualAudioElement() {
    if (!virtualAudioElement) return;
    virtualAudioElement.pause();
    virtualAudioElement.srcObject = null;
    virtualAudioElement.removeAttribute("src");
    virtualAudioElement.load();
    virtualAudioElement = null;
}

// Function to inject virtual device into Discord
function injectVirtualDevice() {
    try {
        console.log("AudioCenter: Injecting virtual device...");

        if (_injected) return;
        _injected = true;

        // Intercept Discord's getInputDevices function
        if (configModule && configModule.getInputDevices) {
            const wrappedGetInputDevices = configModule.getInputDevices;
            const originalGetInputDevices =
                configModule.getInputDevices.bind(configModule);
            _patchRestores.push(() => { configModule.getInputDevices = wrappedGetInputDevices; });

            configModule.getInputDevices = () => {
                const originalDevices = originalGetInputDevices();

                // Add virtual device to Discord list
                const virtualDevice = {
                    id: "virtual-audio-center",
                    name: "AudioCenter - Virtual Mixer",
                    type: "audioinput",
                };

                // Create a new object with the virtual device added
                const devicesWithVirtual = {
                    ...originalDevices,
                    "virtual-audio-center": virtualDevice,
                };

                console.log("AudioCenter: Virtual device added to Discord list");

                return devicesWithVirtual;
            };

            console.log(
                "AudioCenter: configModule.getInputDevices intercepted successfully"
            );
        } else {
            console.error(
                "AudioCenter: configModule or getInputDevices not available"
            );
        }

        // Intercept Discord dispatcher to handle virtual device selection
        _patchRestores.push(RuntimeInterposition.register({
            owner: "AudioCenter",
            hook: "fluxDispatch",
            priority: RuntimeInterpositionPriority.BEHAVIOR,
            wrap: next => async action => {
                // If it's a virtual input device selection
                if (
                    action.type === "AUDIO_SET_INPUT_DEVICE" &&
                    action.id === "virtual-audio-center"
                ) {
                    console.log("AudioCenter: Virtual device selected");

                    // Start mixing if not already active
                    if (
                        !mixerState.isActive &&
                        selectedPrimaryDevice &&
                        selectedSecondaryDevice
                    ) {
                        startAudioMixing();
                    }
                }

                return next.call(FluxDispatcher, action);
            }
        }));

        // Add necessary patches
        patchDiscordComponents();
        addDirectPatch();
        createGlobalFunction();

        console.log("AudioCenter: Virtual device injected successfully");
    } catch (error) {
        console.error(
            "AudioCenter: Error injecting virtual device into Discord:",
            error
        );
    }
}

// Function to patch Discord components
function patchDiscordComponents() {
    try {
        console.log("AudioCenter: Patching Discord components...");

        // Use a more direct approach by intercepting Discord modules
        const { findByPropsLazy } = Vencord.Webpack;

        // Find the module that contains device management functions
        const AudioDeviceModule = findByPropsLazy(
            "getInputDevices",
            "getOutputDevices"
        );
        if (AudioDeviceModule) {
            // Intercept getInputDevices if not already done
            if (
                AudioDeviceModule.getInputDevices &&
                AudioDeviceModule.getInputDevices !== configModule.getInputDevices
            ) {
                const wrappedAudioGetInputDevices = AudioDeviceModule.getInputDevices;
                const originalGetInputDevices =
                    AudioDeviceModule.getInputDevices.bind(AudioDeviceModule);
                _patchRestores.push(() => { AudioDeviceModule.getInputDevices = wrappedAudioGetInputDevices; });

                AudioDeviceModule.getInputDevices = () => {
                    const devices = originalGetInputDevices();

                    // Add virtual device
                    const virtualDevice = {
                        id: "virtual-audio-center",
                        name: "AudioCenter - Virtual Mixer",
                        type: "audioinput",
                    };

                    const devicesWithVirtual = {
                        ...devices,
                        "virtual-audio-center": virtualDevice,
                    };

                    return devicesWithVirtual;
                };
            }
        }

        console.log("AudioCenter: Discord components patched");
    } catch (error) {
        console.error("AudioCenter: Error patching Discord components:", error);
    }
}

// Function to add a direct patch
function addDirectPatch() {
    try {
        console.log("AudioCenter: Adding direct patch...");

        // Use Vencord's patch API
        const { Patcher } = (Vencord as any);

        // Directly patch device selection components
        const patchHandle = Patcher.addPatch({
            plugin: "AudioCenter",
            patches: [
                {
                    find: "getInputDevices",
                    replacement: {
                        match: /getInputDevices\(\)/g,
                        replace: "getInputDevicesWithVirtual()",
                    },
                },
            ],
        });

        if (patchHandle && typeof patchHandle.unpatch === "function") {
            _patchRestores.push(() => patchHandle.unpatch());
        }

        console.log("AudioCenter: Direct patch added");
    } catch (error) {
        console.error("AudioCenter: Error adding direct patch:", error);
    }
}

// Function to create a global function
function createGlobalFunction() {
    try {
        console.log("AudioCenter: Creating global function...");

        // Create a global function that Discord can use
        _patchRestores.push(() => { delete (window as any).getInputDevicesWithVirtual; });
        (window as any).getInputDevicesWithVirtual = () => {
            const originalDevices = configModule.getInputDevices();

            const virtualDevice = {
                id: "virtual-audio-center",
                name: "AudioCenter - Virtual Mixer",
                type: "audioinput",
            };

            const devicesWithVirtual = {
                ...originalDevices,
                "virtual-audio-center": virtualDevice,
            };

            return devicesWithVirtual;
        };

        console.log("AudioCenter: Global function created");
    } catch (error) {
        console.error("AudioCenter: Error creating global function:", error);
    }
}

// Function to get the list of input audio devices
function getInputDevices() {
    try {
        console.log("AudioCenter: Attempting to get input devices...");
        const devices = Object.values(configModule.getInputDevices());
        console.log("AudioCenter: Input devices obtained:", devices.length);
        console.log("AudioCenter: Detailed devices:", devices);

        return devices;
    } catch (error) {
        console.error("AudioCenter: Error getting input devices:", error);
        return [];
    }
}

// Function to create virtual input device
async function createVirtualInputDevice() {
    try {
        console.log("AudioCenter: Starting virtual input device creation...");

        const audioContext = new AudioContext();
        console.log("AudioCenter: Audio context created:", audioContext.state);

        const destination = audioContext.createMediaStreamDestination();
        console.log("AudioCenter: Destination created:", destination);

        const gainNode = audioContext.createGain();
        gainNode.gain.value = 1.0;
        console.log(
            "AudioCenter: Gain node created with value:",
            gainNode.gain.value
        );

        gainNode.connect(destination);
        console.log("AudioCenter: Gain connected to destination");

        virtualOutputDevice = {
            ...virtualOutputDevice,
            isActive: true,
            audioContext,
            destination,
            gainNode,
        };

        // Create a virtual input stream
        const virtualInputStream = destination.stream;
        console.log(
            "AudioCenter: Virtual input stream created:",
            virtualInputStream
        );

        // Expose the stream as an input device via a custom API
        if (window.navigator && window.navigator.mediaDevices && !(navigator.mediaDevices.getUserMedia as any)._audioCenterPatched) {
            // Create a custom function to get the virtual stream
            const wrappedGetUserMedia = navigator.mediaDevices.getUserMedia;
            const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
                navigator.mediaDevices
            );
            _patchRestores.push(() => { navigator.mediaDevices.getUserMedia = wrappedGetUserMedia; });

            navigator.mediaDevices.getUserMedia = async constraints => {
                console.log("AudioCenter: getUserMedia called with:", constraints);

                // If it's a request for the virtual device
                if (
                    constraints?.audio &&
                    typeof constraints.audio === "object" &&
                    (constraints.audio as MediaTrackConstraints).deviceId === "virtual-audio-center"
                ) {
                    console.log("AudioCenter: Returning virtual stream");
                    return virtualInputStream;
                }

                // Otherwise, use the original function
                return originalGetUserMedia(constraints);
            };
            (navigator.mediaDevices.getUserMedia as any)._audioCenterPatched = true;
        }

        console.log("AudioCenter: Virtual input device created successfully");
        return { audioContext, destination, gainNode, virtualInputStream };
    } catch (error) {
        console.error("AudioCenter: Error creating virtual input device:", error);
        throw error;
    }
}

// Function to set virtual device as Discord output
function setVirtualDeviceAsOutput() {
    try {
        console.log("AudioCenter: Attempting to set virtual device as output...");

        if (!virtualOutputDevice.isActive || !virtualOutputDevice.destination) {
            console.error(
                "AudioCenter: Virtual device not active or destination missing"
            );
            return;
        }

        const virtualStream = virtualOutputDevice.destination.stream;
        console.log("AudioCenter: Virtual stream obtained:", virtualStream);

        clearVirtualAudioElement();
        const audioElement = new Audio();
        virtualAudioElement = audioElement;
        audioElement.srcObject = virtualStream;
        console.log("AudioCenter: Audio element created with virtual stream");

        audioElement
            .play()
            .then(() => {
                console.log("AudioCenter: Virtual stream playing");
            })
            .catch(error => {
                console.error("AudioCenter: Error playing stream:", error);
            });

        console.log("AudioCenter: Browser capabilities:");
        console.log(
            "- setSinkId support (HTMLAudioElement):",
            "setSinkId" in HTMLAudioElement.prototype
        );
        console.log(
            "- setSinkId support (AudioContext):",
            "setSinkId" in AudioContext.prototype
        );

        if ("setSinkId" in HTMLAudioElement.prototype) {
            console.log("AudioCenter: Attempting to set sinkId...");
            audioElement
                .setSinkId(virtualOutputDevice.id)
                .then(() => {
                    console.log("AudioCenter: SinkId set successfully");
                })
                .catch(error => {
                    console.error("AudioCenter: Error setting sinkId:", error);
                });
        }

        if (
            virtualOutputDevice.audioContext &&
            "setSinkId" in AudioContext.prototype
        ) {
            console.log("AudioCenter: Attempting to set sinkId on audio context...");
            (virtualOutputDevice.audioContext as any)
                .setSinkId(virtualOutputDevice.id)
                .then(() => {
                    console.log("AudioCenter: SinkId set on audio context successfully");
                })
                .catch(error => {
                    console.error(
                        "AudioCenter: Error setting sinkId on audio context:",
                        error
                    );
                });
        }

        console.log("AudioCenter: Virtual device set as output");

        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter",
                body: "Virtual device set as Discord output",
            });
        }
    } catch (error) {
        console.error("AudioCenter: Error setting virtual device:", error);
    }
}

// Function to create audio context and mix sources
async function createAudioMixer(
    primaryDeviceId: string,
    secondaryDeviceId: string
) {
    try {
        console.log("AudioCenter: Starting mixer creation...");

        await createVirtualInputDevice();

        if (!virtualOutputDevice.isActive || !virtualOutputDevice.audioContext) {
            throw new Error("Unable to create virtual device");
        }

        const { audioContext } = virtualOutputDevice;
        console.log(
            "AudioCenter: Virtual device audio context used:",
            audioContext.state
        );

        const primaryGain = audioContext.createGain();
        const secondaryGain = audioContext.createGain();
        console.log("AudioCenter: Gain nodes created");

        console.log("AudioCenter: Requesting access to audio devices...");
        const primaryStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: primaryDeviceId,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        console.log("AudioCenter: Primary stream obtained:", primaryStream);

        const secondaryStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: secondaryDeviceId,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        console.log("AudioCenter: Secondary stream obtained:", secondaryStream);

        const primarySource = audioContext.createMediaStreamSource(primaryStream);
        const secondarySource =
            audioContext.createMediaStreamSource(secondaryStream);
        console.log("AudioCenter: Audio sources created");

        primarySource.connect(primaryGain);
        secondarySource.connect(secondaryGain);
        console.log("AudioCenter: Sources connected to gain nodes");

        primaryGain.connect(virtualOutputDevice.gainNode!);
        secondaryGain.connect(virtualOutputDevice.gainNode!);
        console.log("AudioCenter: Gain nodes connected to virtual device");

        primaryGain.gain.value = settings.store.primaryVolume / 100;
        secondaryGain.gain.value = settings.store.secondaryVolume / 100;
        console.log("AudioCenter: Volumes configured:", {
            primary: primaryGain.gain.value,
            secondary: secondaryGain.gain.value,
        });

        if (settings.store.autoSetAsOutput) {
            console.log("AudioCenter: Automatic output setting enabled");
            setVirtualDeviceAsOutput();
        }

        return {
            audioContext,
            destination: virtualOutputDevice.destination,
            primaryGain,
            secondaryGain,
            primaryStream,
            secondaryStream,
            mixedStream: virtualOutputDevice.destination!.stream,
        };
    } catch (error) {
        console.error("AudioCenter: Error creating mixer:", error);
        throw error;
    }
}

// Function to start mixing
async function startAudioMixing() {
    console.log("AudioCenter: Attempting to start mixing...");

    if (mixerState.isActive) {
        console.log("AudioCenter: Mixing is already active");
        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter",
                body: "Audio mixing is already active",
            });
        }
        return;
    }

    if (!selectedPrimaryDevice || !selectedSecondaryDevice) {
        console.error("AudioCenter: Devices not selected");
        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter - Error",
                body: "Please select both audio devices",
            });
        }
        return;
    }

    try {
        console.log("AudioCenter: Creating mixer...");
        const mixer = await createAudioMixer(
            selectedPrimaryDevice,
            selectedSecondaryDevice
        );

        mixerState = {
            isActive: true,
            ...mixer,
        };
        console.log("AudioCenter: Mixer state updated:", mixerState);

        console.log("AudioCenter: Mixing started successfully");
        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter",
                body: "Audio mixing started successfully",
            });
        }
    } catch (error) {
        console.error("AudioCenter: Error starting:", error);
        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter - Error",
                body: "Unable to start audio mixing",
            });
        }
    }
}

// Function to stop mixing
function stopAudioMixing() {
    if (!mixerState.isActive) {
        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter",
                body: "Audio mixing is not active",
            });
        }
        return;
    }

    try {
        if (mixerState.primaryStream) {
            mixerState.primaryStream.getTracks().forEach(track => track.stop());
        }
        if (mixerState.secondaryStream) {
            mixerState.secondaryStream.getTracks().forEach(track => track.stop());
        }

        if (mixerState.audioContext) {
            mixerState.audioContext.close();
        }

        stopVirtualOutputDevice();

        mixerState = {
            isActive: false,
            audioContext: null,
            primaryStream: null,
            secondaryStream: null,
            primaryGain: null,
            secondaryGain: null,
            destination: null,
            mixedStream: null,
        };

        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter",
                body: "Audio mixing stopped",
            });
        }
    } catch (error) {
        console.error("AudioCenter: Error stopping:", error);
    }
}

// Function to stop virtual device
function stopVirtualOutputDevice() {
    try {
        clearVirtualAudioElement();
        if (virtualOutputDevice.audioContext) {
            virtualOutputDevice.audioContext.close();
        }

        virtualOutputDevice = {
            id: "audioCenter-virtual-output",
            name: "AudioCenter - Virtual Output",
            isActive: false,
            audioContext: null,
            destination: null,
            gainNode: null,
        };

        console.log("AudioCenter: Virtual device stopped");
    } catch (error) {
        console.error("AudioCenter: Error stopping virtual device:", error);
    }
}

// Full diagnostic function
async function runFullDiagnostic() {
    console.log("=== AUDIO CENTER FULL DIAGNOSTIC ===");

    try {
        // 1. Check browser capabilities
        console.log("1. Checking browser capabilities:");
        console.log("- User Agent:", navigator.userAgent);
        console.log("- navigator.mediaDevices:", !!navigator.mediaDevices);
        console.log(
            "- getUserMedia support:",
            !!navigator.mediaDevices?.getUserMedia
        );
        console.log(
            "- AudioContext support:",
            !!window.AudioContext || !!window.webkitAudioContext
        );
        console.log(
            "- MediaStreamAudioDestinationNode support:",
            !!window.MediaStreamAudioDestinationNode
        );
        console.log(
            "- setSinkId support (HTMLAudioElement):",
            "setSinkId" in HTMLAudioElement.prototype
        );
        console.log(
            "- setSinkId support (AudioContext):",
            "setSinkId" in AudioContext.prototype
        );
        console.log(
            "- Virtual device injected:",
            navigator.mediaDevices?.enumerateDevices
                ?.toString()
                .includes("virtual-audio-center") || false
        );

        // 2. Check permissions
        console.log("2. Checking permissions:");
        if (navigator.permissions) {
            try {
                const micPermission = await navigator.permissions.query({
                    name: "microphone" as PermissionName,
                });
                console.log("- Microphone permission:", micPermission.state);
            } catch (error) {
                console.error("- Microphone permission error:", error);
            }
        }

        // 3. List system devices
        console.log("3. System devices:");
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                console.log("- Total number of devices:", devices.length);

                const audioInputs = devices.filter(d => d.kind === "audioinput");
                const audioOutputs = devices.filter(d => d.kind === "audiooutput");

                console.log("- Audio input devices:", audioInputs.length);
                audioInputs.forEach((device, index) => {
                    console.log(
                        `  ${index}: ${device.label || "Unnamed"} (${device.deviceId})`
                    );
                });

                console.log("- Audio output devices:", audioOutputs.length);
                audioOutputs.forEach((device, index) => {
                    console.log(
                        `  ${index}: ${device.label || "Unnamed"} (${device.deviceId})`
                    );
                });
            } catch (error) {
                console.error("- Error enumerating devices:", error);
            }
        }

        // 4. Check Discord configModule
        console.log("4. Discord configuration module:");
        console.log("- configModule:", configModule);
        console.log(
            "- getInputDevices available:",
            typeof configModule.getInputDevices
        );
        console.log(
            "- getOutputDevices available:",
            typeof configModule.getOutputDevices
        );
        console.log(
            "- getInputDeviceId available:",
            typeof configModule.getInputDeviceId
        );
        console.log(
            "- getOutputDeviceId available:",
            typeof configModule.getOutputDeviceId
        );

        // 5. Test audio context creation
        console.log("5. Testing audio context creation:");
        try {
            const testContext = new AudioContext();
            console.log("- Audio context created successfully");
            console.log("- State:", testContext.state);
            console.log("- Sample rate:", testContext.sampleRate);
            console.log("- Base latency:", testContext.baseLatency);

            const testDestination = testContext.createMediaStreamDestination();
            console.log("- Destination created successfully");
            console.log("- Stream:", testDestination.stream);
            console.log("- Tracks:", testDestination.stream.getAudioTracks());

            const testGain = testContext.createGain();
            console.log("- Gain node created successfully");
            console.log("- Gain value:", testGain.gain.value);

            testContext.close();
            console.log("- Test context closed");
        } catch (error) {
            console.error("- Error testing audio context:", error);
        }

        // 6. Test device access
        console.log("6. Testing device access:");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const testStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                    },
                });
                console.log("- Microphone access successful");
                testStream.getTracks().forEach(track => track.stop());
            } catch (error) {
                console.log("- Microphone permissions not granted (normal)");
            }
        }

        console.log("=== END OF DIAGNOSTIC ===");

        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter",
                body: "Full diagnostic completed - Check console for details",
            });
        }
    } catch (error) {
        console.error("Error during diagnostic:", error);
        if (settings.store.showNotifications) {
            showNotification({
                title: "AudioCenter - Error",
                body: "Error during diagnostic - Check console",
            });
        }
    }
}

// Primary device selector component
function PrimaryDeviceSelector() {
    const [devices, setDevices] = React.useState<any[]>([]);

    React.useEffect(() => {
        function loadDevices() {
            try {
                console.log("AudioCenter: Loading devices for primary selector...");
                const inputDevices = getInputDevices();
                setDevices(inputDevices);
                console.log(
                    "AudioCenter: Devices loaded in primary selector:",
                    inputDevices.length
                );

                if (!selectedPrimaryDevice && inputDevices.length > 0) {
                    selectedPrimaryDevice = (inputDevices[0] as any).id;
                    console.log(
                        "AudioCenter: Default primary device set:",
                        selectedPrimaryDevice
                    );
                }
            } catch (error) {
                console.error("AudioCenter: Error loading devices:", error);
            }
        }

        loadDevices();
    }, []);

    return (
        <Select
            options={devices.map((device: any) => ({
                value: device.id,
                label: `🎤 ${device.name}`,
            }))}
            serialize={identity}
            isSelected={value => value === selectedPrimaryDevice}
            select={id => {
                console.log("AudioCenter: Primary device selected:", id);
                selectedPrimaryDevice = id;
            }}
        />
    );
}

// Secondary device selector component
function SecondaryDeviceSelector() {
    const [devices, setDevices] = React.useState<any[]>([]);

    React.useEffect(() => {
        function loadDevices() {
            try {
                console.log("AudioCenter: Loading devices for secondary selector...");
                const inputDevices = getInputDevices();
                setDevices(inputDevices);
                console.log(
                    "AudioCenter: Devices loaded in secondary selector:",
                    inputDevices.length
                );

                if (!selectedSecondaryDevice && inputDevices.length > 1) {
                    selectedSecondaryDevice = (inputDevices[1] as any).id;
                    console.log(
                        "AudioCenter: Default secondary device set:",
                        selectedSecondaryDevice
                    );
                }
            } catch (error) {
                console.error("AudioCenter: Error loading devices:", error);
            }
        }

        loadDevices();
    }, []);

    return (
        <Select
            options={devices.map((device: any) => ({
                value: device.id,
                label: `🎵 ${device.name}`,
            }))}
            serialize={identity}
            isSelected={value => value === selectedSecondaryDevice}
            select={id => {
                console.log("AudioCenter: Secondary device selected:", id);
                selectedSecondaryDevice = id;
            }}
        />
    );
}

// Status display component
function StatusDisplay() {
    const [mixerActive, setMixerActive] = React.useState(mixerState.isActive);
    const [virtualActive, setVirtualActive] = React.useState(
        virtualOutputDevice.isActive
    );

    React.useEffect(() => {
        const interval = setInterval(() => {
            setMixerActive(mixerState.isActive);
            setVirtualActive(virtualOutputDevice.isActive);
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div
            style={{
                marginTop: "15px",
                padding: "15px",
                backgroundColor: "#2f3136",
                borderRadius: "4px",
                border: "1px solid #40444b",
            }}
        >
            <Forms.FormTitle>Component Status</Forms.FormTitle>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                    marginTop: "10px",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                        style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: mixerActive ? "#43b581" : "#ed4245",
                        }}
                    />
                    <span style={{ fontSize: "12px", color: "#b9bbbe" }}>
                        Audio Mixer
                    </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                        style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: virtualActive ? "#43b581" : "#ed4245",
                        }}
                    />
                    <span style={{ fontSize: "12px", color: "#b9bbbe" }}>
                        Virtual Device
                    </span>
                </div>
            </div>
        </div>
    );
}

export default definePlugin({
    name: "AudioCenter",
    description:
        "Complete audio center: mixing, virtual device, limiting and diagnostics",
    tags: ["Voice", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    settingsAboutComponent: () => (
        <div>
            <h3>AudioCenter</h3>
            <p>
                Complete audio center that combines all audio features into one plugin.
            </p>
            <p>
                <strong>Features:</strong>
            </p>
            <ul>
                <li>
                    🎵 <strong>Audio Mixer</strong> : Mixes two audio sources in real time
                </li>
                <li>
                    🔊 <strong>Virtual Device</strong> : Creates a virtual output device
                </li>
                <li>
                    🔍 <strong>Diagnostics</strong> : Built-in diagnostic tool
                </li>
            </ul>
            <p>
                <strong>Advantages:</strong>
            </p>
            <ul>
                <li>Everything centralized in one plugin</li>
                <li>Unified and intuitive interface</li>
                <li>Detailed logs for debugging</li>
                <li>Compatible with all audio devices</li>
            </ul>
        </div>
    ),

    settingsPanel: () => (
        <div style={{ padding: "20px" }}>
            <h2 style={{ marginBottom: "20px" }}>AudioCenter</h2>
            <p style={{ marginBottom: "20px", color: "#b9bbbe" }}>
                Complete audio center that combines mixing, virtual device and
                diagnostics. All audio features are now centralized in this plugin.
            </p>

            <StatusDisplay />

            {/* Mixer controls */}
            <div style={{ marginTop: "20px" }}>
                <Forms.FormTitle>Mixer Controls</Forms.FormTitle>
                <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                    <Button
                        onClick={startAudioMixing}
                        disabled={mixerState.isActive}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: mixerState.isActive ? "#ccc" : "#5865f2",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: mixerState.isActive ? "not-allowed" : "pointer",
                        }}
                    >
                        Start Mixing
                    </Button>

                    <Button
                        onClick={stopAudioMixing}
                        disabled={!mixerState.isActive}
                        style={{
                            padding: "8px 16px",
                            backgroundColor: !mixerState.isActive ? "#ccc" : "#ed4245",
                            color: "white",
                            border: "none",
                            borderRadius: "4px",
                            cursor: !mixerState.isActive ? "not-allowed" : "pointer",
                        }}
                    >
                        Stop Mixing
                    </Button>
                </div>
            </div>

            {/* Diagnostics */}
            <div style={{ marginTop: "20px" }}>
                <Forms.FormTitle>Diagnostics</Forms.FormTitle>
                <Button
                    onClick={runFullDiagnostic}
                    style={{
                        padding: "10px 20px",
                        backgroundColor: "#5865f2",
                        color: "white",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        marginTop: "10px",
                    }}
                >
                    Run Full Diagnostic
                </Button>
            </div>

            {/* Instructions */}
            <div
                style={{
                    marginTop: "20px",
                    padding: "15px",
                    backgroundColor: "#2f3136",
                    borderRadius: "4px",
                    border: "1px solid #40444b",
                }}
            >
                <h3 style={{ marginBottom: "10px", color: "#ffffff" }}>
                    Instructions:
                </h3>
                <ol style={{ color: "#b9bbbe", paddingLeft: "20px" }}>
                    <li>Select your input devices in the settings above</li>
                    <li>Adjust volumes according to your needs</li>
                    <li>Start mixing to begin</li>
                    <li>Use diagnostics if you encounter problems</li>
                </ol>
            </div>
        </div>
    ),

    start() {
        console.log("AudioCenter: Plugin started");

        // Inject virtual device into device list
        injectVirtualDevice();

        console.log("AudioCenter: Checking audio permissions...");

        // Check permissions
        if (navigator.permissions) {
            navigator.permissions
                .query({ name: "microphone" as PermissionName })
                .then(result => {
                    console.log("AudioCenter: Microphone permission:", result.state);
                })
                .catch(error => {
                    console.error(
                        "AudioCenter: Error checking microphone permissions:",
                        error
                    );
                });
        }

        // Check browser capabilities
        console.log("AudioCenter: Browser capabilities:");
        console.log("- navigator.mediaDevices:", !!navigator.mediaDevices);
        console.log(
            "- getUserMedia support:",
            !!navigator.mediaDevices?.getUserMedia
        );
        console.log(
            "- AudioContext support:",
            !!window.AudioContext || !!window.webkitAudioContext
        );
        console.log(
            "- MediaStreamAudioDestinationNode support:",
            !!window.MediaStreamAudioDestinationNode
        );

        // List available devices
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices
                .enumerateDevices()
                .then(devices => {
                    console.log("AudioCenter: System devices detected:", devices.length);
                    devices.forEach((device, index) => {
                        console.log(`AudioCenter: System device ${index}:`, {
                            deviceId: device.deviceId,
                            kind: device.kind,
                            label: device.label,
                            groupId: device.groupId,
                        });
                    });
                })
                .catch(error => {
                    console.error("AudioCenter: Error enumerating devices:", error);
                });
        }
    },

    stop() {
        stopAudioMixing();
        stopVirtualOutputDevice();
        while (_patchRestores.length) {
            const restore = _patchRestores.pop();
            try { restore?.(); } catch { }
        }
        _injected = false;
        console.log("AudioCenter: Plugin stopped");
    },
});
