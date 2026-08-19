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
import { readFileSync } from "fs";
import { access, readFile } from "fs/promises";
import { join, sep } from "path";
import { normalize as posixNormalize, sep as posixSep } from "path/posix";
import { createSourceFile, isArrayLiteralExpression, isCallExpression, isExportAssignment, isIdentifier, isObjectLiteralExpression, isPropertyAccessExpression, isPropertyAssignment, isSatisfiesExpression, isStringLiteral, isVariableStatement, ScriptTarget, SyntaxKind, isNoSubstitutionTemplateLiteral } from "typescript";
import { getPluginTarget } from "./utils.mjs";
export const devs = {};
export const equicordDevs = {};
export const testcordDevs = {};
export function getName(node) {
    return node.name && isIdentifier(node.name) ? node.name.text : undefined;
}
export function hasName(node, name) {
    return getName(node) === name;
}
export function getObjectProp(node, name) {
    const prop = node.properties.find(p => hasName(p, name));
    if (prop && isPropertyAssignment(prop))
        return prop.initializer;
    return prop;
}
export function parseDevs() {
    const file = createSourceFile("constants.ts", readFileSync("src/utils/constants.ts", "utf8"), ScriptTarget.Latest);
    for (const child of file.getChildAt(0).getChildren()) {
        if (!isVariableStatement(child))
            continue;
        const devsDeclaration = child.declarationList.declarations.find(d => hasName(d, "Devs"));
        if (!devsDeclaration?.initializer || !isCallExpression(devsDeclaration.initializer))
            continue;
        const value = devsDeclaration.initializer.arguments[0];
        if (!isSatisfiesExpression(value) || !isObjectLiteralExpression(value.expression))
            throw new Error("Failed to parse devs: not an object literal");
        for (const prop of value.expression.properties) {
            const name = prop.name.text;
            const value = isPropertyAssignment(prop) ? prop.initializer : prop;
            if (!isObjectLiteralExpression(value))
                throw new Error(`Failed to parse devs: ${name} is not an object literal`);
            devs[name] = {
                name: getObjectProp(value, "name").text,
                id: getObjectProp(value, "id").text.slice(0, -1)
            };
        }
        return;
    }
    throw new Error("Could not find Devs constant");
}
export function parseEquicordDevs() {
    const file = createSourceFile("constants.ts", readFileSync("src/utils/constants.ts", "utf8"), ScriptTarget.Latest);
    for (const child of file.getChildAt(0).getChildren()) {
        if (!isVariableStatement(child))
            continue;
        const devsDeclaration = child.declarationList.declarations.find(d => hasName(d, "EquicordDevs"));
        if (!devsDeclaration?.initializer || !isCallExpression(devsDeclaration.initializer))
            continue;
        const value = devsDeclaration.initializer.arguments[0];
        if (!isSatisfiesExpression(value) || !isObjectLiteralExpression(value.expression))
            throw new Error("Failed to parse EquicordDevs: not an object literal");
        for (const prop of value.expression.properties) {
            const name = prop.name.text;
            const value = isPropertyAssignment(prop) ? prop.initializer : prop;
            if (!isObjectLiteralExpression(value))
                throw new Error(`Failed to parse EquicordDevs: ${name} is not an object literal`);
            equicordDevs[name] = {
                name: getObjectProp(value, "name").text,
                id: getObjectProp(value, "id").text.slice(0, -1)
            };
        }
        return;
    }
    throw new Error("Could not find EquicordDevs constant");
}
export function parseTestcordDevs() {
    const file = createSourceFile("constants.ts", readFileSync("src/utils/constants.ts", "utf8"), ScriptTarget.Latest);
    for (const child of file.getChildAt(0).getChildren()) {
        if (!isVariableStatement(child))
            continue;
        const devsDeclaration = child.declarationList.declarations.find(d => hasName(d, "TestcordDevs"));
        if (!devsDeclaration?.initializer || !isCallExpression(devsDeclaration.initializer))
            continue;
        const value = devsDeclaration.initializer.arguments[0];
        if (!isSatisfiesExpression(value) || !isObjectLiteralExpression(value.expression))
            throw new Error("Failed to parse TestcordDevs: not an object literal");
        for (const prop of value.expression.properties) {
            const name = prop.name.text;
            const value = isPropertyAssignment(prop) ? prop.initializer : prop;
            if (!isObjectLiteralExpression(value))
                throw new Error(`Failed to parse TestcordDevs: ${name} is not an object literal`);
            testcordDevs[name] = {
                name: getObjectProp(value, "name").text,
                id: getObjectProp(value, "id").text.slice(0, -1)
            };
        }
        return;
    }
    throw new Error("Could not find TestcordDevs constant");
}
export async function parseFile(fileName) {
    const file = createSourceFile(fileName, await readFile(fileName, "utf8"), ScriptTarget.Latest);
    const fail = (reason) => {
        return new Error(`Invalid plugin ${fileName}, because ${reason}`);
    };
    let pluginObj = null;
    for (const node of file.getChildAt(0).getChildren()) {
        if (!isExportAssignment(node))
            continue;
        if (isCallExpression(node.expression)) {
            const call = node.expression;
            if (!isIdentifier(call.expression) || call.expression.text !== "definePlugin")
                continue;
            const arg = call.arguments[0];
            if (!isObjectLiteralExpression(arg))
                throw fail("no object literal passed to definePlugin");
            pluginObj = arg;
            break;
        }
        if (!isIdentifier(node.expression))
            continue;
        const exportName = node.expression.text;
        for (const child of file.getChildAt(0).getChildren()) {
            if (!isVariableStatement(child))
                continue;
            const declaration = child.declarationList.declarations.find(d => hasName(d, exportName));
            if (!declaration?.initializer || !isCallExpression(declaration.initializer))
                continue;
            if (!isIdentifier(declaration.initializer.expression) || declaration.initializer.expression.text !== "definePlugin")
                continue;
            const arg = declaration.initializer.arguments[0];
            if (!isObjectLiteralExpression(arg))
                throw fail("no object literal passed to definePlugin");
            pluginObj = arg;
            break;
        }
        if (pluginObj)
            break;
    }
    if (!pluginObj)
        throw fail("no default export called 'definePlugin' found");
    const data = {
        hasPatches: false,
        hasCommands: false,
        enabledByDefault: false,
        required: false,
        isModified: false,
        tags: [],
        searchTerms: [],
    };
    for (const prop of pluginObj.properties) {
        const key = getName(prop);
        const value = isPropertyAssignment(prop) ? prop.initializer : prop;
        switch (key) {
            case "name":
            case "description":
                if (!isStringLiteral(value) && !isNoSubstitutionTemplateLiteral(value))
                    throw fail(`${key} is not a string literal`);
                data[key] = value.text;
                break;
            case "patches":
                data.hasPatches = true;
                break;
            case "commands":
                data.hasCommands = true;
                if (isArrayLiteralExpression(value)) {
                    data.commands = value.elements.map((e) => {
                        if (isObjectLiteralExpression(e)) {
                            const nameProperty = e.properties.find((p) => isPropertyAssignment(p) && isIdentifier(p.name) && p.name.escapedText === "name");
                            const descriptionProperty = e.properties.find((p) => isPropertyAssignment(p) && isIdentifier(p.name) && p.name.escapedText === "description");
                            if (!nameProperty || !descriptionProperty)
                                throw fail("command missing required properties");
                            const name = isStringLiteral(nameProperty.initializer) ? nameProperty.initializer.text : "";
                            const description = isStringLiteral(descriptionProperty.initializer) ? descriptionProperty.initializer.text : "";
                            return { name, description };
                        }
                        else if (isCallExpression(e) && isIdentifier(e.expression)) {
                            const [nameArg] = e.arguments;
                            if (!isStringLiteral(nameArg))
                                throw fail("first argument must be a string");
                            return { name: nameArg.text, description: "" };
                        }
                        else if (e.kind === SyntaxKind.SpreadElement) {
                            return undefined;
                        }
                        throw fail("commands array contains invalid elements");
                    }).filter((c) => Boolean(c));
                }
                else if (isIdentifier(value)) {
                    data.commands = [];
                }
                else {
                    throw fail("commands is not an array literal or identifier");
                }
                break;
            case "authors":
                if (!isArrayLiteralExpression(value))
                    throw fail("authors is not an array literal");
                data.authors = value.elements.map(e => {
                    if (isPropertyAccessExpression(e)) {
                        const d = devs[getName(e)] || equicordDevs[getName(e)] || testcordDevs[getName(e)];
                        if (!d)
                            throw fail(`couldn't look up author ${getName(e)}`);
                        return d;
                    }
                    else if (isObjectLiteralExpression(e)) {
                        const nameProp = e.properties.find(p => hasName(p, "name"));
                        const idProp = e.properties.find(p => hasName(p, "id"));
                        if (!nameProp || !idProp)
                            throw fail("inline author object missing name or id");
                        const name = isPropertyAssignment(nameProp) ? nameProp.initializer : nameProp;
                        const id = isPropertyAssignment(idProp) ? idProp.initializer : idProp;
                        if (!isStringLiteral(name))
                            throw fail("inline author name is not a string literal");
                        if (!isStringLiteral(id) && id.kind !== SyntaxKind.BigIntLiteral)
                            throw fail("inline author id is not a literal");
                        return {
                            name: name.text,
                            id: id.kind === SyntaxKind.BigIntLiteral ? id.text.slice(0, -1) : id.text
                        };
                    }
                    else {
                        throw fail("authors array contains invalid element");
                    }
                });
                break;
            case "tags":
            case "searchTerms":
                if (!isArrayLiteralExpression(value))
                    throw fail(`${key} is not an array literal`);
                data[key] = value.elements.map(e => {
                    if (!isStringLiteral(e))
                        throw fail(`${key} array contains non-string literals`);
                    return e.text;
                });
                break;
            case "dependencies":
                if (!isArrayLiteralExpression(value))
                    throw fail("dependencies is not an array literal");
                const { elements } = value;
                if (elements.some(e => !isStringLiteral(e)))
                    throw fail("dependencies array contains non-string elements");
                data.dependencies = elements.map(e => e.text);
                break;
            case "required":
            case "isModified":
            case "enabledByDefault":
                data[key] = value.kind === SyntaxKind.TrueKeyword;
                break;
        }
    }
    if (!data.name || !data.description || !data.authors)
        throw fail("name, description or authors are missing");
    const target = getPluginTarget(fileName);
    if (target) {
        if (!["web", "browser", "discordDesktop", "vesktop", "equibop", "desktop", "dev"].includes(target))
            throw fail(`invalid target ${target}`);
        data.target = target;
    }
    data.filePath = posixNormalize(fileName)
        .split(sep)
        .join(posixSep)
        .replace(/\/index\.([jt]sx?)$/, "");
    data.dirName = posixNormalize(fileName)
        .split(sep)
        .join(posixSep)
        .replace(/\/index\.([jt]sx?)$/, "")
        .replace(/^src\/plugins\//, "")
        .replace(/^src\/equicordplugins\//, "")
        .replace(/^src\/testcordplugins\//, "");
    return [data];
}
export async function getEntryPoint(dir, dirent) {
    const base = join(dir, dirent.name);
    if (!dirent.isDirectory())
        return base;
    for (const name of ["index.ts", "index.tsx"]) {
        const full = join(base, name);
        try {
            await access(full);
            return full;
        }
        catch { }
    }
    return null;
}
export function isPluginFile({ name }) {
    if (name === "index.ts")
        return false;
    return !name.startsWith("_") && !name.startsWith(".");
}
