/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "../settings.css";
import { Card } from "@components/Card";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { findComponentByCodeLazy } from "@webpack";
import { ColorPicker, Slider } from "@webpack/common";
import { q } from "../utils/ui";
export function SettingsCard({ children }) {
    return (<Card variant="primary" className={q("setting")}>
            {children}
        </Card>);
}
export function SettingsHeader({ children }) {
    return (<Heading className={q("setting-header")}>
            {children}
        </Heading>);
}
export function SettingsSubheader({ children, className }) {
    return (<Heading className={q("setting-subheader", className)}>
            {children}
        </Heading>);
}
export function SettingsDescription({ children }) {
    return (<Paragraph className={q("setting-description")}>
            {children}
        </Paragraph>);
}
export function SettingsParagraph({ children, className }) {
    return (<Paragraph className={q("setting-paragraph", className)}>
            {children}
        </Paragraph>);
}
function withDimmedClass(className, dimmed) {
    if (!dimmed)
        return className;
    return [
        ...(Array.isArray(className) ? className : [className]),
        "dimmed-settings-item",
    ].filter(c => c !== undefined);
}
export function SettingsNotice({ children, className }) {
    return (<Paragraph className={q("notice-card", className)}>
            {children}
        </Paragraph>);
}
export function SettingsRow({ children, className }) {
    return (<div className={q("settings-row", className)}>
            {children}
        </div>);
}
export function SettingsRowItem({ children, className, width = "fill", }) {
    return (<div className={q("settings-row-item", width === "content" ? "settings-row-item-content" : undefined, className)}>
            {children}
        </div>);
}
export const ManaSelect = findComponentByCodeLazy('"data-mana-component":"select"');
export function SettingsSelect({ label, className, labelClassName, selectClassName, tooltip, ...props }) {
    const selectElement = (<div className={q("settings-select", className)}>
            <SettingsParagraph className={withDimmedClass(labelClassName, !!props.disabled)}>{label}</SettingsParagraph>
            <div className={q(selectClassName)}>
                <ManaSelect {...props}/>
            </div>
        </div>);
    if (tooltip) {
        return (<SettingsTooltip text={tooltip.text} position={tooltip.position} wider={tooltip.wider}>
                {selectElement}
            </SettingsTooltip>);
    }
    return selectElement;
}
function ColorPickerWithOnClose(props) {
    const LiveColorPicker = ColorPicker;
    return <LiveColorPicker {...props}/>;
}
export function SettingsColorPicker({ className, label, labelClassName, ...props }) {
    return (<>
            {label != null && <SettingsParagraph className={withDimmedClass(labelClassName, !!props.disabled)}>{label}</SettingsParagraph>}
            <div className={q("settings-color-picker", className)}>
                <ColorPickerWithOnClose {...props}/>
            </div>
        </>);
}
export function SettingsSlider({ className, disabled, label, labelClassName, maxValue = 100, minValue = 0, onChange, sliderClassName, value, }) {
    return (<div className={q("settings-slider", className)}>
            <SettingsParagraph className={withDimmedClass(labelClassName, !!disabled)}>{label}</SettingsParagraph>
            <div className={q("settings-slider-control-container")}>
                <Slider minValue={minValue} maxValue={maxValue} initialValue={value} onValueChange={onChange} className={q("settings-slider-control", sliderClassName)} disabled={disabled}/>
            </div>
        </div>);
}
const SwitchWithLabel = findComponentByCodeLazy('auxiliaryContentPosition:"under-label"');
export function SettingsSubtleSwitch(props) {
    const switchElement = (<div className={q("setting-subtle-switch", props.topSpacing ? `margin-top-${props.topSpacing}` : undefined, props.bottomSpacing ? `margin-bottom-${props.bottomSpacing}` : undefined, withDimmedClass(props.className, !!props.disabled))}>
            <SwitchWithLabel {...props}/>
        </div>);
    if (props.tooltip) {
        return (<SettingsTooltip text={props.tooltip.text} aria-label={props.tooltip.text} position={props.tooltip.position}>
                {switchElement}
            </SettingsTooltip>);
    }
    return switchElement;
}
export const TooltipPositions = ["top", "bottom", "left", "right"];
export const TooltipAligns = ["start", "center", "end"];
export const TooltipColors = ["primary", "grey", "brand", "green", "red"];
export const ManaTooltip = findComponentByCodeLazy("VoidTooltip cannot find DOM node");
function SettingsTooltip({ children, position, text, wider, className }) {
    return (<div className={q("settings-tooltip-wrapper", className)}>
            <ManaTooltip text={text} position={position} color="brand" tooltipStyle={{ maxWidth: wider ? "602px" : "350px" }} tooltipClassName={q("settings-tooltip")} tooltipPointerClassName={q("settings-tooltip-pointer")} tooltipContentClassName={q("settings-tooltip-content")} delay={50}>
                {tooltipProps => <div {...tooltipProps}>{children}</div>}
            </ManaTooltip>
        </div>);
}
export const ManaButtonVariants = ["primary", "secondary", "critical-primary", "critical-secondary", "active", "overlay-primary", "overlay-secondary", "expressive"];
export const ManaButtonSizes = ["xs", "sm", "md"];
export const ManaButton = findComponentByCodeLazy('"data-mana-component":"button"');
