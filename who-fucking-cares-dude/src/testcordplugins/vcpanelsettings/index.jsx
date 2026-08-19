/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { definePluginSettings } from "@api/Settings";
import { Link } from "@components/Link";
import { TestcordDevs } from "@utils/constants";
import { identity } from "@utils/misc";
import definePlugin from "@utils/types";
import { FluxDispatcher, Forms, MediaEngineStore, Select, Slider, Text, useState, useStateFromStores } from "@webpack/common";
import { Settings } from "../../Vencord";
function OutputVolumeComponent() {
    const outputVolume = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getOutputVolume());
    return (<>
            {Settings.plugins.VCPanelSettings.showOutputVolumeHeader && <Forms.FormTitle>Output volume</Forms.FormTitle>}
            <Slider maxValue={200} minValue={0} onValueRender={v => `${v.toFixed(0)}%`} initialValue={outputVolume} asValueChanges={volume => {
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_OUTPUT_VOLUME",
                volume
            });
        }}/>
        </>);
}
function InputVolumeComponent() {
    const inputVolume = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getInputVolume());
    return (<>
            {Settings.plugins.VCPanelSettings.showInputVolumeHeader && <Forms.FormTitle>Input volume</Forms.FormTitle>}
            <Slider maxValue={100} minValue={0} initialValue={inputVolume} asValueChanges={volume => {
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_INPUT_VOLUME",
                volume
            });
        }}/>
        </>);
}
function OutputDeviceComponent() {
    const outputDevice = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getOutputDeviceId());
    return (<>
            {Settings.plugins.VCPanelSettings.showOutputDeviceHeader && <Forms.FormTitle>Output device</Forms.FormTitle>}
            <Select options={Object.values(MediaEngineStore.getOutputDevices()).map((device /* i am NOT typing this*/) => {
            return { value: device.id, label: Settings.plugins.VCPanelSettings.showOutputDeviceHeader ? device.name : `🔊 ${device.name}` };
        })} serialize={identity} isSelected={value => value === outputDevice} select={id => {
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_OUTPUT_DEVICE",
                id
            });
        }}>

            </Select>
        </>);
}
function InputDeviceComponent() {
    const inputDevice = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getInputDeviceId());
    return (<div style={{ marginTop: "10px" }}>
            {Settings.plugins.VCPanelSettings.showInputDeviceHeader && <Forms.FormTitle>Input device</Forms.FormTitle>}
            <Select options={Object.values(MediaEngineStore.getInputDevices()).map((device /* i am NOT typing this*/) => {
            return { value: device.id, label: Settings.plugins.VCPanelSettings.showInputDeviceHeader ? device.name : `🎤 ${device.name}` };
        })} serialize={identity} isSelected={value => value === inputDevice} select={id => {
            FluxDispatcher.dispatch({
                type: "AUDIO_SET_INPUT_DEVICE",
                id
            });
        }}>

            </Select>
        </div>);
}
function VideoDeviceComponent() {
    const videoDevice = useStateFromStores([MediaEngineStore], () => MediaEngineStore.getVideoDeviceId());
    return (<div style={{ marginTop: "10px" }}>
            {Settings.plugins.VCPanelSettings.showVideoDeviceHeader && <Forms.FormTitle>Camera</Forms.FormTitle>}
            <Select options={Object.values(MediaEngineStore.getVideoDevices()).map((device /* i am NOT typing this*/) => {
            return { value: device.id, label: Settings.plugins.VCPanelSettings.showVideoDeviceHeader ? device.name : `📷 ${device.name}` };
        })} serialize={identity} isSelected={value => value === videoDevice} select={id => {
            FluxDispatcher.dispatch({
                type: "MEDIA_ENGINE_SET_VIDEO_DEVICE",
                id
            });
        }}>

            </Select>
        </div>);
}
function VoiceSettings() {
    const [showSettings, setShowSettings] = useState(Settings.plugins.VCPanelSettings.uncollapseSettingsByDefault);
    return <div style={{ marginTop: "20px" }}>
        <div style={{ marginBottom: "10px" }}>
            <Link className="vc-panelsettings-underline-on-hover" style={{ color: "var(--header-secondary)" }} onClick={() => { setShowSettings(!showSettings); }}>{!showSettings ? "► Settings" : "▼ Hide"}</Link>
        </div>

        {showSettings && <>
                {Settings.plugins.VCPanelSettings.outputVolume && <OutputVolumeComponent />}
                {Settings.plugins.VCPanelSettings.inputVolume && <InputVolumeComponent />}
                {Settings.plugins.VCPanelSettings.outputDevice && <OutputDeviceComponent />}
                {Settings.plugins.VCPanelSettings.inputDevice && <InputDeviceComponent />}
                {Settings.plugins.VCPanelSettings.camera && <VideoDeviceComponent />}
            </>}
    </div>;
}
export default definePlugin({
    name: "VCPanelSettings",
    description: "Control voice settings right from the voice panel",
    tags: ["Voice", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings: definePluginSettings({
        title1: {
            type: 6 /* OptionType.COMPONENT */,
            component: () => <Text style={{ fontWeight: "bold", fontSize: "1.27rem" }}>Appearance</Text>,
            description: ""
        },
        uncollapseSettingsByDefault: {
            type: 3 /* OptionType.BOOLEAN */,
            default: false,
            description: "Automatically uncollapse voice settings by default"
        },
        title2: {
            type: 6 /* OptionType.COMPONENT */,
            component: () => <Text style={{ fontWeight: "bold", fontSize: "1.27rem" }}>Settings to show</Text>,
            description: ""
        },
        outputVolume: {
            type: 3 /* OptionType.BOOLEAN */,
            default: true,
            description: "Show an output volume slider"
        },
        inputVolume: {
            type: 3 /* OptionType.BOOLEAN */,
            default: true,
            description: "Show an input volume slider"
        },
        outputDevice: {
            type: 3 /* OptionType.BOOLEAN */,
            default: true,
            description: "Show an output device selector"
        },
        inputDevice: {
            type: 3 /* OptionType.BOOLEAN */,
            default: true,
            description: "Show an input device selector"
        },
        camera: {
            type: 3 /* OptionType.BOOLEAN */,
            default: false,
            description: "Show a camera selector"
        },
        title3: {
            type: 6 /* OptionType.COMPONENT */,
            component: () => <Text style={{ fontWeight: "bold", fontSize: "1.27rem" }}>Headers to show</Text>,
            description: ""
        },
        showOutputVolumeHeader: {
            type: 3 /* OptionType.BOOLEAN */,
            default: true,
            description: "Show header above output volume slider"
        },
        showInputVolumeHeader: {
            type: 3 /* OptionType.BOOLEAN */,
            default: true,
            description: "Show header above input volume slider"
        },
        showOutputDeviceHeader: {
            type: 3 /* OptionType.BOOLEAN */,
            default: false,
            description: "Show header above output device selector"
        },
        showInputDeviceHeader: {
            type: 3 /* OptionType.BOOLEAN */,
            default: false,
            description: "Show header above input device selector"
        },
        showVideoDeviceHeader: {
            type: 3 /* OptionType.BOOLEAN */,
            default: false,
            description: "Show header above camera selector"
        },
    }),
    renderVoiceSettings() { return <VoiceSettings />; },
    patches: [
        {
            find: "this.renderChannelButtons()",
            replacement: {
                match: /this.renderChannelButtons\(\)/,
                replace: "this.renderChannelButtons(), $self.renderVoiceSettings()"
            }
        }
    ]
});
