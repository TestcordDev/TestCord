/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./settings.css";
import { DataStore } from "@api/index";
import { isPluginEnabled } from "@api/PluginManager";
import { Divider } from "@components/Divider";
import { Heading } from "@components/Heading";
import { resolveError } from "@components/settings/tabs/plugins/components/Common";
import { debounce } from "@shared/debounce";
import { classNameFactory } from "@utils/css";
import { useAwaiter } from "@utils/react";
import { Button, Select, showToast, Text, TextInput, Toasts, useState } from "@webpack/common";
import CustomRPCPlugin, { setRpc, settings } from ".";
const cl = classNameFactory("vc-customRPC-settings-");
const PRESETS_KEY = "CustomRPC_presets";
const makeValidator = (maxLength, isRequired = false) => (value) => {
    if (isRequired && !value)
        return "This field is required.";
    if (value.length > maxLength)
        return `Must be not longer than ${maxLength} characters.`;
    return true;
};
const maxLength128 = makeValidator(128);
function isAppIdValid(value) {
    if (!/^\d{16,21}$/.test(value))
        return "Must be a valid Discord ID.";
    return true;
}
const updateRPC = debounce(() => {
    setRpc(true);
    if (isPluginEnabled(CustomRPCPlugin.name))
        setRpc();
});
function isStreamLinkDisabled() {
    return settings.store.type !== 1 /* ActivityType.STREAMING */;
}
function isStreamLinkValid(value) {
    if (!isStreamLinkDisabled() && !/https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\/\w+/.test(value))
        return "Streaming link must be a valid URL.";
    if (value && value.length > 512)
        return "Streaming link must be not longer than 512 characters.";
    return true;
}
function parseNumber(value) {
    return value ? parseInt(value, 10) : 0;
}
function isNumberValid(value) {
    if (isNaN(value))
        return "Must be a number.";
    if (value < 0)
        return "Must be a positive number.";
    return true;
}
function isUrlValid(value) {
    if (value && !/^https?:\/\/.+/.test(value))
        return "Must be a valid URL.";
    return true;
}
function isImageKeyValid(value) {
    if (/https?:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(value))
        return "Don't use a Discord link. Use an Imgur image link instead.";
    if (/https?:\/\/(?!i\.)?imgur\.com\//.test(value))
        return "Imgur link must be a direct link to the image (e.g. https://i.imgur.com/...). Right click the image and click 'Copy image address'";
    if (/https?:\/\/(?!media\.)?tenor\.com\//.test(value))
        return "Tenor link must be a direct link to the image (e.g. https://media.tenor.com/...). Right click the GIF and click 'Copy image address'";
    return true;
}
function PairSetting(props) {
    const [left, right] = props.data;
    return (<div className={cl("pair")}>
            <SingleSetting {...left}/>
            <SingleSetting {...right}/>
        </div>);
}
function SingleSetting({ settingsKey, label, disabled, isValid, transform }) {
    const [state, setState] = useState(settings.store[settingsKey] ?? "");
    const [error, setError] = useState(null);
    function handleChange(newValue) {
        if (transform)
            newValue = transform(newValue);
        const valid = isValid?.(newValue) ?? true;
        setState(newValue);
        setError(resolveError(valid));
        if (valid === true) {
            settings.store[settingsKey] = newValue;
            updateRPC();
        }
    }
    return (<div className={cl("single", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <TextInput type="text" placeholder={"Enter a value"} value={state} onChange={handleChange} disabled={disabled}/>
            {error && <Text className={cl("error")} variant="text-sm/normal">{error}</Text>}
        </div>);
}
function SelectSetting({ settingsKey, label, options, disabled }) {
    return (<div className={cl("single", { disabled })}>
            <Heading tag="h5">{label}</Heading>
            <Select placeholder={"Select an option"} options={options} maxVisibleItems={5} closeOnSelect={true} select={v => {
            settings.store[settingsKey] = v;
            updateRPC();
        }} isSelected={v => v === settings.store[settingsKey]} serialize={v => String(v)} isDisabled={disabled}/>
        </div>);
}
function getCurrentConfig() {
    const { config, ...rpcConfig } = settings.store;
    return rpcConfig;
}
function PresetSettings({ onLoad }) {
    const [storedPresets] = useAwaiter(async () => await DataStore.get(PRESETS_KEY) ?? [], { fallbackValue: [] });
    const [changedPresets, setChangedPresets] = useState(null);
    const [presetName, setPresetName] = useState("");
    const [selectedPreset, setSelectedPreset] = useState("");
    const presets = changedPresets ?? storedPresets;
    async function savePreset() {
        const name = presetName.trim();
        if (!name)
            return;
        const nextPresets = [
            ...presets.filter(preset => preset.name !== name),
            { name, config: getCurrentConfig() }
        ].sort((a, b) => a.name.localeCompare(b.name));
        await DataStore.set(PRESETS_KEY, nextPresets);
        setChangedPresets(nextPresets);
        setSelectedPreset(name);
        showToast(`Saved preset ${name}.`, Toasts.Type.SUCCESS);
    }
    function loadPreset() {
        const preset = presets.find(preset => preset.name === selectedPreset);
        if (!preset)
            return;
        Object.assign(settings.store, preset.config);
        onLoad();
        updateRPC();
        showToast(`Loaded preset ${preset.name}.`, Toasts.Type.SUCCESS);
    }
    async function deletePreset() {
        const nextPresets = presets.filter(preset => preset.name !== selectedPreset);
        if (nextPresets.length === presets.length)
            return;
        await DataStore.set(PRESETS_KEY, nextPresets);
        setChangedPresets(nextPresets);
        setSelectedPreset("");
        showToast(`Deleted preset ${selectedPreset}.`, Toasts.Type.SUCCESS);
    }
    return (<div className={cl("presets")}>
            <Heading tag="h5">Presets</Heading>
            <div className={cl("preset-create")}>
                <TextInput type="text" placeholder="Preset name" value={presetName} onChange={setPresetName}/>
                <Button disabled={!presetName.trim()} onClick={savePreset}>Save</Button>
            </div>
            {presets.length ? (<div className={cl("preset-actions")}>
                    <Select placeholder="Select a preset" options={presets.map(preset => ({ label: preset.name, value: preset.name }))} closeOnSelect={true} select={setSelectedPreset} isSelected={value => value === selectedPreset} serialize={String}/>
                    <Button disabled={!selectedPreset} onClick={loadPreset}>Load</Button>
                    <Button color={Button.Colors.RED} disabled={!selectedPreset} onClick={deletePreset}>Delete</Button>
                </div>) : (<Text variant="text-sm/normal">No saved presets yet.</Text>)}
        </div>);
}
function RPCFields() {
    const { type, timestampMode } = settings.use(["type", "timestampMode"]);
    return (<>
            <SelectSetting settingsKey="type" label="Activity Type" options={[
            {
                label: "Playing",
                value: 0 /* ActivityType.PLAYING */,
                default: true
            },
            {
                label: "Streaming",
                value: 1 /* ActivityType.STREAMING */
            },
            {
                label: "Listening",
                value: 2 /* ActivityType.LISTENING */
            },
            {
                label: "Watching",
                value: 3 /* ActivityType.WATCHING */
            },
            {
                label: "Competing",
                value: 5 /* ActivityType.COMPETING */
            }
        ]}/>

            <PairSetting data={[
            { settingsKey: "appID", label: "Application ID", isValid: isAppIdValid },
            { settingsKey: "appName", label: "Application Name", isValid: makeValidator(128, true) },
        ]}/>

            <PairSetting data={[
            { settingsKey: "details", label: "Detail (line 1)", isValid: maxLength128 },
            { settingsKey: "detailsURL", label: "Detail URL", isValid: isUrlValid },
        ]}/>

            <PairSetting data={[
            { settingsKey: "state", label: "State (line 2)", isValid: maxLength128 },
            { settingsKey: "stateURL", label: "State URL", isValid: isUrlValid },
        ]}/>

            <SingleSetting settingsKey="streamLink" label="Stream Link (Twitch or YouTube, only if activity type is Streaming)" disabled={type !== 1 /* ActivityType.STREAMING */} isValid={isStreamLinkValid}/>

            <PairSetting data={[
            {
                settingsKey: "partySize",
                label: "Party Size",
                transform: parseNumber,
                isValid: isNumberValid,
                disabled: type !== 0 /* ActivityType.PLAYING */,
            },
            {
                settingsKey: "partyMaxSize",
                label: "Maximum Party Size",
                transform: parseNumber,
                isValid: isNumberValid,
                disabled: type !== 0 /* ActivityType.PLAYING */,
            },
        ]}/>

            <Divider />

            <PairSetting data={[
            { settingsKey: "imageBig", label: "Large Image URL/Key", isValid: isImageKeyValid },
            { settingsKey: "imageBigTooltip", label: "Large Image Text", isValid: maxLength128 },
        ]}/>
            <SingleSetting settingsKey="imageBigURL" label="Large Image clickable URL" isValid={isUrlValid}/>

            <PairSetting data={[
            { settingsKey: "imageSmall", label: "Small Image URL/Key", isValid: isImageKeyValid },
            { settingsKey: "imageSmallTooltip", label: "Small Image Text", isValid: maxLength128 },
        ]}/>
            <SingleSetting settingsKey="imageSmallURL" label="Small Image clickable URL" isValid={isUrlValid}/>

            <Divider />

            <PairSetting data={[
            { settingsKey: "buttonOneText", label: "Button1 Text", isValid: makeValidator(31) },
            { settingsKey: "buttonOneURL", label: "Button1 URL", isValid: isUrlValid },
        ]}/>
            <PairSetting data={[
            { settingsKey: "buttonTwoText", label: "Button2 Text", isValid: makeValidator(31) },
            { settingsKey: "buttonTwoURL", label: "Button2 URL", isValid: isUrlValid },
        ]}/>

            <Divider />

            <SelectSetting settingsKey="timestampMode" label="Timestamp Mode" options={[
            {
                label: "None",
                value: 0 /* TimestampMode.NONE */,
                default: true
            },
            {
                label: "Since discord open",
                value: 1 /* TimestampMode.NOW */
            },
            {
                label: "Same as your current time (not reset after 24h)",
                value: 2 /* TimestampMode.TIME */
            },
            {
                label: "Custom",
                value: 3 /* TimestampMode.CUSTOM */
            }
        ]}/>

            <PairSetting data={[
            {
                settingsKey: "startTime",
                label: "Start Timestamp (in milliseconds)",
                transform: parseNumber,
                isValid: isNumberValid,
                disabled: timestampMode !== 3 /* TimestampMode.CUSTOM */,
            },
            {
                settingsKey: "endTime",
                label: "End Timestamp (in milliseconds)",
                transform: parseNumber,
                isValid: isNumberValid,
                disabled: timestampMode !== 3 /* TimestampMode.CUSTOM */,
            },
        ]}/>
        </>);
}
export function RPCSettings() {
    const [formVersion, setFormVersion] = useState(0);
    return (<div className={cl("root")}>
            <PresetSettings onLoad={() => setFormVersion(version => version + 1)}/>
            <Divider />
            <RPCFields key={formVersion}/>
        </div>);
}
