/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { ModalContent, ModalFooter, ModalHeader, ModalRoot } from "@utils/modal";
import { Button, Forms, TextArea, useState } from "@webpack/common";
import { classFactory, settings } from "../index";
import { failToast, getUniqueTriggers, successToast, triggersAreUnique, validateAndFormatTrigger } from "../util";
export function ImportModal(props) {
    const [textArea, setTextArea] = useState("");
    return (<ModalRoot {...props}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Import</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <div style={{ padding: "10px" }}>
                    <TextArea rows={10} onChange={setTextArea} value={textArea}/>
                </div>
            </ModalContent>
            <ModalFooter className={classFactory("modal-footer")}>
                <Button onClick={() => {
            try {
                const triggers = JSON.parse(textArea);
                const validationResults = triggers.map(validateAndFormatTrigger);
                for (const result of validationResults) {
                    if (result.error) {
                        failToast(result.message);
                        return;
                    }
                }
                if (!triggersAreUnique(triggers)) {
                    failToast("Error: Sound triggers must be unique.");
                    return;
                }
                settings.store.soundTriggers = triggers;
                successToast("Sound triggers successfully imported.");
                props.onClose();
            }
            catch (e) {
                new Logger("SoundTriggers").error(e);
                failToast("Invalid JSON, please try again.");
            }
        }}>
                    Import (Overwrite)
                </Button>
                <Button onClick={() => {
            try {
                const triggers = JSON.parse(textArea);
                const validationResults = triggers.map(validateAndFormatTrigger);
                for (const result of validationResults) {
                    if (result.error) {
                        failToast(result.message);
                        return;
                    }
                }
                const merged = getUniqueTriggers([...triggers, ...settings.store.soundTriggers]);
                settings.store.soundTriggers = merged;
                successToast("Sound triggers successfully imported.");
                props.onClose();
            }
            catch (e) {
                new Logger("SoundTriggers").error(e);
                failToast("Invalid JSON, please try again.");
            }
        }}>
                    Import (Merge)
                </Button>
            </ModalFooter>

        </ModalRoot>);
}
