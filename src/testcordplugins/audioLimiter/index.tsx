/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { FormSwitch } from "@components/FormSwitch";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, Forms, React, Slider } from "@webpack/common";

const configModule = findByPropsLazy("getOutputVolume");

const settings = definePluginSettings({
  // Volume limiting settings
  maxVolume: {
    type: OptionType.SLIDER,
    default: 80,
    description: "Maximum allowed volume (%)",
    markers: [50, 60, 70, 80, 90, 100],
    stickToMarkers: false,
  },
  enableVolumeLimiting: {
    type: OptionType.BOOLEAN,
    default: true,
    description: "Enable system volume limiting",
  },

  // Decibel limiting settings
  maxDecibels: {
    type: OptionType.SLIDER,
    default: -3,
    description: "Maximum allowed decibels (dB)",
    markers: [-20, -15, -10, -6, -3, 0],
    stickToMarkers: false,
  },
  enableDbLimiting: {
    type: OptionType.BOOLEAN,
    default: true,
    description: "Enable audio peak limiting (dB)",
  },

  // Display settings
  showNotifications: {
    type: OptionType.BOOLEAN,
    default: true,
    description: "Show limiting notifications",
  },
  showVisualIndicator: {
    type: OptionType.BOOLEAN,
    default: true,
    description: "Show visual indicator",
  },
});

// Global limiter state
const limiterState = {
  isActive: false,
  audioContext: null as AudioContext | null,
  gainNode: null as GainNode | null,
  analyser: null as AnalyserNode | null,
  compressor: null as DynamicsCompressorNode | null,
  currentLevel: 0,
  peakLevel: 0,
  limitingCount: 0,
  lastNotification: 0,
  rafId: 0,
  volumeTimerId: 0,
};

// Function to get current volume
function getCurrentVolume(): number {
  try {
    return configModule.getOutputVolume();
  } catch (error) {
    console.error(
      "Audio Limiter: Error getting volume:",
      error
    );
    return 0;
  }
}

// Function to set volume
function setVolume(volume: number) {
  try {
    FluxDispatcher.dispatch({
      type: "AUDIO_SET_OUTPUT_VOLUME",
      volume: Math.max(0, Math.min(200, volume)),
    });
  } catch (error) {
    console.error(
      "Audio Limiter: Error setting volume:",
      error
    );
  }
}

// Reused across frames. Allocating a fresh Uint8Array inside the rAF loop meant a
// new heap buffer 60 times a second for the entire time the limiter was running,
// which kept the GC busy for no reason.
let levelBuffer: Uint8Array<ArrayBuffer> | null = null;

// Function to analyze audio level
function analyzeAudioLevel(): number {
  if (!limiterState.analyser) return 0;

  const bufferLength = limiterState.analyser.frequencyBinCount;
  if (!levelBuffer || levelBuffer.length !== bufferLength) {
    levelBuffer = new Uint8Array(bufferLength);
  }
  const dataArray = levelBuffer;
  limiterState.analyser.getByteFrequencyData(dataArray);

  // Calculate RMS level
  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += dataArray[i] * dataArray[i];
  }
  const rms = Math.sqrt(sum / bufferLength);

  // Convert to decibels
  const db = 20 * Math.log10(rms / 255);
  return isFinite(db) ? db : -Infinity;
}

// Function to check and limit system volume
function checkAndLimitVolume() {
  if (!settings.store.enableVolumeLimiting) return;

  const currentVolume = getCurrentVolume();
  const { maxVolume } = settings.store;

  if (currentVolume > maxVolume) {
    setVolume(maxVolume);
    limiterState.limitingCount++;

    // Notification with throttling (max 1 per second)
    const now = Date.now();
    if (
      settings.store.showNotifications &&
      now - limiterState.lastNotification > 1000
    ) {
      showNotification({
        title: "Audio Limiter",
        body: `Volume limited from ${currentVolume}% to ${maxVolume}%`,
      });
      limiterState.lastNotification = now;
    }
  }
}

// Function to create the audio limiter
async function createAudioLimiter() {
  if (!settings.store.enableDbLimiting) return;

  try {
    // Create audio context
    const audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();

    // Create compressor for limiting
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = settings.store.maxDecibels;
    compressor.knee.value = 0;
    compressor.ratio.value = 20; // High ratio for strict limiting
    compressor.attack.value = 0.003; // Fast attack
    compressor.release.value = 0.1; // Fast release

    // Create gain node for final control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    // Create analyser to monitor levels
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Connect nodes
    compressor.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(audioContext.destination);

    // Update state
    limiterState.audioContext = audioContext;
    limiterState.gainNode = gainNode;
    limiterState.analyser = analyser;
    limiterState.compressor = compressor;

    // Start level monitoring
    startLevelMonitoring();

    if (settings.store.showNotifications) {
      showNotification({
        title: "Audio Limiter",
        body: `Audio limiting enabled at ${settings.store.maxDecibels} dB`,
      });
    }

    return { audioContext, gainNode, analyser, compressor };
  } catch (error) {
    console.error(
      "Audio Limiter: Error creating audio limiter:",
      error
    );
    throw error;
  }
}

// Function to monitor audio levels
function startLevelMonitoring() {
  if (!settings.store.enableDbLimiting || !limiterState.analyser) return;

  function monitorLevels() {
    if (!limiterState.isActive || !settings.store.enableDbLimiting) return;

    const currentLevel = analyzeAudioLevel();
    limiterState.currentLevel = currentLevel;

    // Update peak
    if (currentLevel > limiterState.peakLevel) {
      limiterState.peakLevel = currentLevel;
    }

    // Check if limiting is active
    if (currentLevel > settings.store.maxDecibels) {
      limiterState.limitingCount++;

      const now = Date.now();
      if (
        settings.store.showNotifications &&
        now - limiterState.lastNotification > 2000
      ) {
        showNotification({
          title: "Audio Limiter - Limiting Active",
          body: `Level: ${currentLevel.toFixed(1)} dB (limit: ${
            settings.store.maxDecibels
          } dB)`,
        });
        limiterState.lastNotification = now;
      }
    }

    // Continue monitoring
    limiterState.rafId = requestAnimationFrame(monitorLevels);
  }

  limiterState.rafId = requestAnimationFrame(monitorLevels);
}

// Function to start volume monitoring
function startVolumeMonitoring() {
  if (!settings.store.enableVolumeLimiting) return;

  limiterState.volumeTimerId = window.setInterval(checkAndLimitVolume, 100);
}

// Function to start the limiter
async function startLimiter() {
  if (limiterState.isActive) return;

  try {
    limiterState.isActive = true;

    // Start volume monitoring
    startVolumeMonitoring();

    // Create audio limiter if enabled
    if (settings.store.enableDbLimiting) {
      await createAudioLimiter();
    }

    console.log("Audio Limiter: Limiter started successfully");
  } catch (error) {
    console.error(
      "Audio Limiter: Error starting limiter:",
      error
    );
    limiterState.isActive = false;
  }
}

// Function to stop the limiter
function stopLimiter() {
  if (!limiterState.isActive) return;

  try {
    limiterState.isActive = false;

    cancelAnimationFrame(limiterState.rafId);
    limiterState.rafId = 0;
    clearInterval(limiterState.volumeTimerId);
    limiterState.volumeTimerId = 0;

    // Clean up audio context
    if (limiterState.audioContext) {
      limiterState.audioContext.close();
    }

    // Reset state
    limiterState.audioContext = null;
    limiterState.gainNode = null;
    limiterState.analyser = null;
    limiterState.compressor = null;
    limiterState.currentLevel = 0;
    limiterState.peakLevel = 0;
    limiterState.limitingCount = 0;
  } catch (error) {
    console.error("Audio Limiter: Error stopping limiter:", error);
  }
}

// Visual indicator component
function VisualIndicator() {
  const [currentLevel, setCurrentLevel] = React.useState(0);
  const [peakLevel, setPeakLevel] = React.useState(0);

  React.useEffect(() => {
    if (!settings.store.showVisualIndicator || !limiterState.isActive) return;

    const interval = setInterval(() => {
      setCurrentLevel(limiterState.currentLevel);
      setPeakLevel(limiterState.peakLevel);
    }, 50);

    return () => clearInterval(interval);
  }, [limiterState.isActive]);

  if (!settings.store.showVisualIndicator || !limiterState.isActive)
    return null;

  const maxDb = settings.store.maxDecibels;
  const currentPercent = Math.max(
    0,
    Math.min(100, ((currentLevel - maxDb + 20) / 20) * 100)
  );
  const peakPercent = Math.max(
    0,
    Math.min(100, ((peakLevel - maxDb + 20) / 20) * 100)
  );

  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        background: "rgba(0, 0, 0, 0.8)",
        color: "white",
        padding: "10px",
        borderRadius: "5px",
        fontSize: "12px",
        zIndex: 10000,
        minWidth: "200px",
      }}
    >
      <div style={{ marginBottom: "5px", fontWeight: "bold" }}>
        Audio Limiter
      </div>
      <div style={{ marginBottom: "3px" }}>
        Level: {currentLevel.toFixed(1)} dB
      </div>
      <div style={{ marginBottom: "3px" }}>Peak: {peakLevel.toFixed(1)} dB</div>
      <div style={{ marginBottom: "3px" }}>Limit: {maxDb} dB</div>
      <div style={{ marginBottom: "3px" }}>
        Limitations: {limiterState.limitingCount}
      </div>
      <div
        style={{
          width: "100%",
          height: "10px",
          background: "#333",
          borderRadius: "5px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${currentPercent}%`,
            height: "100%",
            background: currentLevel > maxDb ? "#ff4444" : "#44ff44",
            transition: "width 0.1s ease",
          }}
        />
      </div>
    </div>
  );
}

// Settings component
const _Slider = Slider as any;

function SettingsPanel() {
  return (
    <Forms.FormSection>
      <Forms.FormTitle>Limiting Settings</Forms.FormTitle>

      <Forms.FormDivider />

      <Forms.FormText>
        This plugin automatically limits output volume to avoid sounds that are
        too loud.
      </Forms.FormText>

      <Forms.FormDivider />

      <Forms.FormTitle>Maximum Volume (%)</Forms.FormTitle>
      <_Slider
        initialValue={settings.store.maxVolume}
        onValueChange={(value: any) => (settings.store.maxVolume = value)}
        min={10}
        max={100}
        markers={[50, 60, 70, 80, 90, 100]}
        stickToMarkers={false}
      />
      <Forms.FormText>
        Maximum allowed volume: {settings.store.maxVolume}%
      </Forms.FormText>

      <Forms.FormTitle>Maximum Decibels (dB)</Forms.FormTitle>
      <_Slider
        initialValue={settings.store.maxDecibels}
        onValueChange={(value: any) => (settings.store.maxDecibels = value)}
        min={-20}
        max={0}
        markers={[-20, -15, -10, -6, -3, 0]}
        stickToMarkers={false}
      />
      <Forms.FormText>
        Maximum audio level: {settings.store.maxDecibels} dB
      </Forms.FormText>

      <Forms.FormDivider />

      <FormSwitch
        title="Enable volume limiting"
        value={settings.store.enableVolumeLimiting}
        onChange={value => (settings.store.enableVolumeLimiting = value)}
      />
      <FormSwitch
        title="Enable decibel limiting"
        value={settings.store.enableDbLimiting}
        onChange={value => (settings.store.enableDbLimiting = value)}
      />
      <FormSwitch
        title="Show notifications"
        value={settings.store.showNotifications}
        onChange={value => (settings.store.showNotifications = value)}
      />
      <FormSwitch
        title="Show visual indicator"
        value={settings.store.showVisualIndicator}
        onChange={value => (settings.store.showVisualIndicator = value)}
      />

      <Forms.FormDivider />

      <Forms.FormText>
        <strong>Status:</strong> {limiterState.isActive ? "Active" : "Inactive"}
      </Forms.FormText>
      <Forms.FormText>
        <strong>Limitations applied:</strong> {limiterState.limitingCount}
      </Forms.FormText>
    </Forms.FormSection>
  );
}

export default definePlugin({
  name: "Audio Limiter",
  description:
    "Automatically limits output volume to avoid sounds that are too loud",
    tags: ["Voice", "Utility"],
  authors: [TestcordDevs.x2b],
  settings,
  settingsAboutComponent: SettingsPanel,

  start() {
    console.log("Audio Limiter: Plugin started");
    startLimiter();
  },

  stop() {
    console.log("Audio Limiter: Plugin stopped");
    stopLimiter();
  },

  patches: [
    {
      find: "AUDIO_SET_OUTPUT_VOLUME",
      replacement: {
        match: /AUDIO_SET_OUTPUT_VOLUME/,
        replace: "AUDIO_SET_OUTPUT_VOLUME_LIMITED",
      },
    },
  ],
});
