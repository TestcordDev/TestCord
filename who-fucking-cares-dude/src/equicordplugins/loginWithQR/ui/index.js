/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./styles.css";
import { classNameFactory } from "@utils/css";
import { findComponentByCodeLazy } from "@webpack";
export var SpinnerTypes;
(function (SpinnerTypes) {
    SpinnerTypes["WANDERING_CUBES"] = "wanderingCubes";
    SpinnerTypes["CHASING_DOTS"] = "chasingDots";
    SpinnerTypes["PULSING_ELLIPSIS"] = "pulsingEllipsis";
    SpinnerTypes["SPINNING_CIRCLE"] = "spinningCircle";
    SpinnerTypes["SPINNING_CIRCLE_SIMPLE"] = "spinningCircleSimple";
    SpinnerTypes["LOW_MOTION"] = "lowMotion";
})(SpinnerTypes || (SpinnerTypes = {}));
// https://github.com/Kyuuhachi/VencordPlugins/blob/main/MessageLinkTooltip/index.tsx#L11-L33
export const Spinner = findComponentByCodeLazy('"pulsingEllipsis"');
export const cl = classNameFactory("qrlogin-");
