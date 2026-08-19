/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { TextCompat } from "@components/BaseText";
import { ButtonCompat } from "@components/Button";
import { Divider } from "@components/Divider";
import { FormSwitchCompat } from "@components/FormSwitch";
import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { TooltipContainer as TooltipContainerComponent } from "@components/TooltipContainer";
import { TooltipFallback } from "@components/TooltipFallback";
import { LazyComponent } from "@utils/lazyReact";
import { filters, find, findCssClassesLazy, mapMangledCssClasses, mapMangledModuleLazy, proxyLazyWebpack, waitFor } from "@webpack";
import { waitForComponent } from "./internal";
export const Forms = {
    // TODO: Stop using this and use Heading/Paragraph directly
    FormTitle: Heading,
    FormText: Paragraph,
    /** @deprecated don't use this */
    FormSection: "section", // Backwards compat since Vesktop uses this
    /** @deprecated use `@components/Divider` */
    FormDivider: Divider, // Backwards compat since Vesktop uses this
};
// Stub for plugins that use Forms.FormText.Types
Forms.FormText.Types = {
    DESCRIPTION: "description",
    ERROR: "error",
    SUCCESS: "success",
    WARNING: "warning",
    DEFAULT: "default",
};
// TODO: Stop using this and use Paragraph/Span directly
export const Text = TextCompat;
export const Button = ButtonCompat;
/** @deprecated Use FormSwitch from Vencord */
export const Switch = FormSwitchCompat;
export const Checkbox = waitForComponent("Checkbox", filters.componentByCode('"data-toggleable-component":"checkbox'));
export const Tooltip = waitForComponent("Tooltip", m => m.prototype?.shouldShowTooltip && m.prototype.render, TooltipFallback);
/** @deprecated import from @vencord/components */
export const TooltipContainer = TooltipContainerComponent;
// FIXME: t.TextInput was for the old void components, and is not 100% correct for the mana component
export const TextInput = waitForComponent("TextInput", filters.componentByCode('setHasValue?.(""!==', '="text",'));
export const TextArea = waitForComponent("TextArea", filters.componentByCode("!0,rows:", "showRemainingCharacterCount:"));
export const Select = waitForComponent("Select", filters.componentByCode('selectionMode:"single",onSelectionChange:', "isSelected:"));
export const SearchableSelect = waitForComponent("SearchableSelect", filters.componentByCode('?"multiple":"single",required:'));
export const Slider = waitForComponent("Slider", filters.componentByCode("markDash", "this.renderMark("));
export const Popout = waitForComponent("Popout", filters.componentByCode("ref:this.ref,", "renderPopout:this.renderPopout,"));
export const Dialog = waitForComponent("Dialog", filters.componentByCode('role:"dialog",tabIndex:-1'));
export const TabBar = waitForComponent("TabBar", filters.componentByCode("ref:this.tabBarRef,className:"));
// TODO: remake this component
export const Clickable = waitForComponent("Clickable", filters.componentByCode("this.context?this.renderNonInteractive():"));
export const Avatar = waitForComponent("Avatar", filters.componentByCode(".size-1.375*"));
export const UserSummaryItem = waitForComponent("UserSummaryItem", filters.componentByCode("defaultRenderUser", "showDefaultAvatarsForNullUsers"));
export let ColorPicker = () => null;
export function setColorPicker(component) {
    ColorPicker = component;
}
export let RoleMemberPopout = () => null;
export function setRoleMemberPopout(component) {
    RoleMemberPopout = component;
}
export let NewCustomizationSection = () => null;
export function setNewCustomizationSection(component) {
    NewCustomizationSection = component;
}
export let createScroller;
export function setCreateScroller(cs) {
    createScroller = cs;
}
export let createListScroller;
waitFor(filters.byCode("getScrollerNode:", "resizeObserver:", "sectionHeight:"), m => createListScroller = m);
const listScrollerClassnames = ["thin", "auto", "fade"];
export const scrollerClasses = findCssClassesLazy("thin", "auto", "fade", "customTheme", "none");
const isListScroller = filters.byClassNames(...listScrollerClassnames);
const isNotNormalScroller = filters.byClassNames("customTheme");
export const listScrollerClasses = proxyLazyWebpack(() => {
    const mod = find(m => isListScroller(m) && !isNotNormalScroller(m), { topLevelOnly: true });
    if (!mod)
        return {};
    return mapMangledCssClasses(mod, listScrollerClassnames);
});
export const ScrollerNone = LazyComponent(() => createScroller?.(scrollerClasses.none, scrollerClasses.fade, scrollerClasses.customTheme));
export const ScrollerThin = LazyComponent(() => createScroller?.(scrollerClasses.thin, scrollerClasses.fade, scrollerClasses.customTheme));
export const ScrollerAuto = LazyComponent(() => createScroller?.(scrollerClasses.auto, scrollerClasses.fade, scrollerClasses.customTheme));
export const ListScrollerThin = LazyComponent(() => createListScroller(listScrollerClasses.thin, listScrollerClasses.fade, "", ResizeObserver));
export const ListScrollerAuto = LazyComponent(() => createListScroller(listScrollerClasses.auto, listScrollerClasses.fade, "", ResizeObserver));
export const FocusLock = waitForComponent("FocusLock", filters.componentByCode(".containerRef,{keyboardModeEnabled:"));
export let useToken;
waitFor(m => {
    if (typeof m !== "function") {
        return false;
    }
    const str = String(m);
    return str.includes(".resolve({theme:") && str.includes('"refresh-fast-follow-avatars"') && !str.includes("useMemo");
}, m => useToken = m);
export const MaskedLink = waitForComponent("MaskedLink", filters.componentByCode("MASKED_LINK)"));
export const Timestamp = waitForComponent("Timestamp", filters.componentByCode("#{intl::MESSAGE_EDITED_TIMESTAMP_A11Y_LABEL}"));
export const OAuth2AuthorizeModal = waitForComponent("OAuth2AuthorizeModal", filters.componentByCode("hasContentBackground", "nextStep", "onClose?.()"));
export const Animations = mapMangledModuleLazy(".assign({colorNames:", {
    Transition: filters.componentByCode('["items","children"]', ",null,"),
    animated: filters.byProps("div", "text")
});
