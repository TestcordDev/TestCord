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
import { TextButton } from "@components/Button";
import { Heading } from "@components/Heading";
import { getDefaultName, savedSessionsCache, saveSessionsToDataStore } from "@plugins/betterSessions/utils";
import { Modal, React, TextInput } from "@webpack/common";
export function RenameModal({ props, session, state }) {
    const [title, setTitle] = state;
    const [value, setValue] = React.useState(savedSessionsCache.get(session.id_hash)?.name ?? "");
    function onSaveClick() {
        savedSessionsCache.set(session.id_hash, { name: value, isNew: false });
        if (value !== "") {
            setTitle(`${value}*`);
        }
        else {
            setTitle(getDefaultName(session.client_info));
        }
        saveSessionsToDataStore();
        props.onClose();
    }
    return (<Modal {...props} title="Rename" actions={[
            {
                text: "Cancel",
                variant: "secondary",
                onClick: () => props.onClose()
            },
            {
                text: "Save",
                variant: "primary",
                onClick: onSaveClick
            }
        ]}>
            <div>
                <Heading tag="h5">New device name</Heading>
                <TextInput style={{ marginBottom: "10px" }} placeholder={getDefaultName(session.client_info)} value={value} onChange={setValue} onKeyDown={(e) => {
            if (e.key === "Enter") {
                onSaveClick();
            }
        }}/>
                <TextButton style={{
            paddingLeft: "1px",
            opacity: 0.6
        }} onClick={() => setValue("")}>
                    Reset Name
                </TextButton>
            </div>
        </Modal>);
}
