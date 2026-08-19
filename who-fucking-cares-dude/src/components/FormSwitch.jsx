/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./FormSwitch.css";
import { classes } from "@utils/misc";
import { Flex } from "./Flex";
import { Span } from "./Span";
import { Switch } from "./Switch";
export function FormSwitch({ onChange, title, value, description, disabled, className, hideBorder }) {
    return (<div className={classes("vc-form-switch-container", hideBorder && "vc-form-switch-no-border")}>
            <label className={classes("vc-form-switch", className, disabled && "vc-form-switch-disabled")}>
                <div className="vc-form-switch-text">
                    <Flex flexDirection="column" gap="4px">
                        <Span size="md" weight="medium" color="text-strong">{title}</Span>
                        {description && <Span size="sm" color="text-subtle">{description}</Span>}
                    </Flex>
                </div>
                <div className="vc-form-switch-control">
                    <Switch checked={value} onChange={onChange} disabled={disabled}/>
                </div>
            </label>
        </div>);
}
export function FormSwitchCompat({ note, children, ...restProps }) {
    return <FormSwitch title={children ?? ""} description={note} {...restProps}/>;
}
