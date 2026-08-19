/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import "./style.css";
import { closeAllModals, Modal, openModal, React, TextInput, useEffect, useState } from "@webpack/common";
export function SimpleTextInput({ modalProps, onSelect, placeholder, info }) {
    const [inputValue, setInputValue] = useState("");
    const handleKeyDown = (e) => {
        switch (e.key) {
            case "Enter":
                onSelect(inputValue);
                closeAllModals();
                break;
            default:
                break;
        }
    };
    useEffect(() => {
        setInputValue("");
    }, []);
    return (<Modal {...modalProps} size="sm" title="Text Input">
            <div className="vc-command-palette-simple-text" onKeyDown={handleKeyDown}>
                <TextInput value={inputValue} onChange={e => setInputValue(e)} style={{ width: "30vw", borderRadius: "5px" }} placeholder={placeholder ?? "Type and press Enter"}/>
                {info && <div className="vc-command-palette-textinfo">{info}</div>}
            </div>
        </Modal>);
}
export function openSimpleTextInput(placeholder, info) {
    return new Promise(resolve => {
        openModal(modalProps => (<SimpleTextInput modalProps={modalProps} onSelect={inputValue => resolve(inputValue)} placeholder={placeholder} info={info}/>));
    });
}
