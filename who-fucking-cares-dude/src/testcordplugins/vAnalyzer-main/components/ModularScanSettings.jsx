/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import { Flex } from "@components/Flex";
import { HeadingSecondary, HeadingTertiary } from "@components/Heading";
import { Margins } from "@components/margins";
import { Paragraph } from "@components/Paragraph";
import { Switch } from "@components/Switch";
import { React, Select, TextArea, TextInput, useEffect, useState } from "@webpack/common";
import { addModule, deleteModule, getModules, updateModule } from "../modularScanStore";
import { truncateUrl } from "../utils";
export default function ModularScanSettings() {
    const [modules, setModules] = useState([]);
    const [editing, setEditing] = useState(null);
    useEffect(() => {
        getModules().then(setModules);
    }, []);
    const saveEdit = async () => {
        if (!editing || !editing.name || !editing.url)
            return;
        const module = {
            id: editing.id ?? Math.random().toString(36).slice(2, 10),
            name: editing.name,
            type: editing.type || "file",
            method: editing.method || "POST",
            url: editing.url,
            headers: editing.headers || {},
            bodyType: editing.bodyType || "none",
            fileField: editing.fileField || "file",
            extraFields: editing.extraFields || {},
            jsonTemplate: editing.jsonTemplate || "{ \"file\": \"{{fileUrl}}\" }",
            autoScan: editing.autoScan ?? false,
            filter: editing.filter ?? { type: "none", pattern: "" },
            ...editing
        };
        if (editing.id) {
            await updateModule(module);
        }
        else {
            await addModule(module);
        }
        setEditing(null);
        setModules(await getModules());
    };
    const handleDelete = async (id) => {
        await deleteModule(id);
        setModules(await getModules());
    };
    if (editing) {
        let headingLabel;
        if (editing.id) {
            headingLabel = "Edit Module";
        }
        else {
            headingLabel = "Add Module";
        }
        const currentFilter = editing.filter ?? { type: "none", pattern: "" };
        return (<Card className={Margins.top8}>
                <HeadingSecondary>{headingLabel}</HeadingSecondary>

                <Flex flexDirection="column" gap={12} className={Margins.top16}>
                    <section>
                        <HeadingTertiary>Name</HeadingTertiary>
                        <TextInput value={editing.name || ""} onChange={(v) => setEditing({ ...editing, name: v })} placeholder="My Custom Scanner"/>
                    </section>

                    <Flex gap={12}>
                        <section style={{ flex: 1 }}>
                            <HeadingTertiary>Type</HeadingTertiary>
                            <Select options={[
                { label: "File", value: "file" },
                { label: "URL", value: "url" }
            ]} isSelected={v => v === (editing.type || "file")} select={v => setEditing({ ...editing, type: v })} serialize={v => v}/>
                        </section>
                        <section style={{ flex: 1 }}>
                            <HeadingTertiary>Method</HeadingTertiary>
                            <Select options={[
                { label: "POST", value: "POST" },
                { label: "GET", value: "GET" },
                { label: "PUT", value: "PUT" }
            ]} isSelected={v => v === (editing.method || "POST")} select={v => setEditing({ ...editing, method: v })} serialize={v => v}/>
                        </section>
                    </Flex>

                    <section>
                        <HeadingTertiary>URL (Placeholders: {"{{fileUrl}}, {{fileName}}, {{url}}"})</HeadingTertiary>
                        <TextInput value={editing.url || ""} onChange={(v) => setEditing({ ...editing, url: v })} placeholder="https://my-api.com/scan"/>
                    </section>

                    <section>
                        <HeadingTertiary>Body Type</HeadingTertiary>
                        <Select options={[
                { label: "Multipart Form Data", value: "multipart" },
                { label: "JSON", value: "json" },
                { label: "None", value: "none" }
            ]} isSelected={v => v === (editing.bodyType || "none")} select={v => setEditing({ ...editing, bodyType: v })} serialize={v => v}/>
                    </section>

                    {editing.bodyType === "multipart" && (<section>
                            <HeadingTertiary>File Form Field</HeadingTertiary>
                            <TextInput value={editing.fileField || "file"} onChange={(v) => setEditing({ ...editing, fileField: v })} placeholder="file"/>
                        </section>)}

                    {editing.bodyType === "json" && (<section>
                            <HeadingTertiary>JSON Template</HeadingTertiary>
                            <TextArea value={editing.jsonTemplate || ""} onChange={(v) => setEditing({ ...editing, jsonTemplate: v })} rows={3} placeholder='{ "url": "{{url}}" }'/>
                        </section>)}

                    <section>
                        <Flex alignItems="center" gap={8}>
                            <Switch checked={editing.autoScan ?? false} onChange={(v) => setEditing({ ...editing, autoScan: v })}/>
                            <div>
                                <HeadingTertiary>Auto-Scan</HeadingTertiary>
                                <Paragraph size="sm" style={{ color: "var(--text-muted)" }}>
                                    Run this module automatically when a new message with a matching URL/file is received
                                </Paragraph>
                            </div>
                        </Flex>
                    </section>

                    {editing.autoScan && (<Card style={{ padding: "12px", background: "var(--background-secondary)" }}>
                            <HeadingTertiary>Auto-Scan Filter</HeadingTertiary>
                            <Paragraph size="sm" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                                Only auto-scan URLs/files that match this filter. Set to "None" to scan everything.
                            </Paragraph>
                            <Select options={[
                    { label: "None (scan all)", value: "none" },
                    { label: "URL contains (literal text)", value: "contains" },
                    { label: "URL matches (regex)", value: "regex" }
                ]} isSelected={v => v === currentFilter.type} select={v => setEditing({
                    ...editing,
                    filter: { ...currentFilter, type: v }
                })} serialize={v => v}/>
                            {currentFilter.type !== "none" && (() => {
                    let placeholder;
                    if (currentFilter.type === "contains") {
                        placeholder = "ex malware-bazaar.com";
                    }
                    else {
                        placeholder = "ex \\.exe$|\\.dll$";
                    }
                    return (<TextInput value={currentFilter.pattern} onChange={(v) => setEditing({
                            ...editing,
                            filter: { ...currentFilter, pattern: v }
                        })} placeholder={placeholder} style={{ marginTop: "8px" }}/>);
                })()}
                        </Card>)}

                    <Flex className={Margins.top8}>
                        <Button onClick={saveEdit}>Save</Button>
                        <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                    </Flex>
                </Flex>
            </Card>);
    }
    return (<section className={Margins.top16}>
            <Flex justifyContent="space-between" alignItems="center">
                <HeadingSecondary>Modular Scan Configurations</HeadingSecondary>
                <Button onClick={() => setEditing({})}>+ Add Module</Button>
            </Flex>
            <Paragraph className={Margins.top8} color={"header-secondary"}>
                Define your own custom endpoints to analyze files or URLs. Use placeholders like <code>{"{{fileUrl}}"}</code> or <code>{"{{url}}"}</code> in your templates.
            </Paragraph>

            <Flex flexDirection="column" gap={8} className={Margins.top16}>
                {modules.length === 0 ? (<Card style={{ textAlign: "center", opacity: 0.5, border: "2px dashed var(--background-modifier-accent)" }}>
                        No modules configured.
                    </Card>) : (modules.map(m => (<Card key={m.id}>
                            <Flex justifyContent="space-between" alignItems="center">
                                <div>
                                    <Paragraph weight="bold">{m.name}</Paragraph>
                                    <Paragraph size="sm" style={{ color: "var(--text-muted)" }}>
                                        {m.method} {truncateUrl(m.url, 50)}
                                        {m.autoScan && " | Auto"}
                                        {m.filter?.type !== "none" && m.filter?.pattern && ` | Filter: ${m.filter.type}`}
                                    </Paragraph>
                                </div>
                                <Flex gap={8}>
                                    <Button size="small" variant="secondary" onClick={() => setEditing(m)}>Edit</Button>
                                    <Button size="small" variant="dangerPrimary" onClick={() => handleDelete(m.id)}>Delete</Button>
                                </Flex>
                            </Flex>
                        </Card>)))}
            </Flex>
        </section>);
}
