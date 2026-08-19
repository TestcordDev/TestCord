/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { Logger } from "@utils/Logger";
import { inflateSync } from "fflate";
const logger = new Logger("MetadataScanner");
// EXIF tags database
const EXIF_TAGS = {
    0x010E: "ImageDescription",
    0x010F: "Make",
    0x0110: "Model",
    0x0112: "Orientation",
    0x011A: "XResolution",
    0x011B: "YResolution",
    0x0128: "ResolutionUnit",
    0x0131: "Software",
    0x0132: "DateTime",
    0x013B: "Artist",
    0x013C: "HostComputer",
    0x8298: "Copyright",
    0x829A: "ExposureTime",
    0x829D: "FNumber",
    0x8822: "ExposureProgram",
    0x8827: "ISOSpeedRatings",
    0x9003: "DateTimeOriginal",
    0x9004: "DateTimeDigitized",
    0x9201: "ShutterSpeedValue",
    0x9202: "ApertureValue",
    0x9203: "BrightnessValue",
    0x9204: "ExposureBiasValue",
    0x9205: "MaxApertureValue",
    0x9206: "SubjectDistance",
    0x9207: "MeteringMode",
    0x9208: "LightSource",
    0x9209: "Flash",
    0x920A: "FocalLength",
    0x927C: "MakerNote",
    0x9286: "UserComment",
    0xA001: "ColorSpace",
    0xA002: "PixelXDimension",
    0xA003: "PixelYDimension",
    0xA405: "FocalLengthIn35mmFilm",
    0xA432: "LensSpecification",
    0xA433: "LensMake",
    0xA434: "LensModel",
    // GPS tags
    0x0001: "GPSLatitudeRef",
    0x0002: "GPSLatitude",
    0x0003: "GPSLongitudeRef",
    0x0004: "GPSLongitude",
    0x0005: "GPSAltitudeRef",
    0x0006: "GPSAltitude",
    0x0007: "GPSTimeStamp",
    0x0008: "GPSSatellites",
    0x0009: "GPSStatus",
    0x001D: "GPSDateStamp",
};
export function getString(view, offset, length) {
    const chars = [];
    for (let i = 0; i < length; i++) {
        if (offset + i >= view.byteLength)
            break;
        const char = view.getUint8(offset + i);
        if (char === 0)
            break;
        chars.push(String.fromCharCode(char));
    }
    return chars.join("");
}
export function parseGPSCoordinate(rationalArray, ref) {
    if (!rationalArray || rationalArray.length < 3)
        return null;
    const getVal = (item) => {
        if (typeof item === "number")
            return item;
        if (item && typeof item === "object" && item.denominator !== 0) {
            return item.numerator / item.denominator;
        }
        return 0;
    };
    const deg = getVal(rationalArray[0]);
    const min = getVal(rationalArray[1]);
    const sec = getVal(rationalArray[2]);
    let dd = deg + (min / 60) + (sec / 3600);
    if (ref === "S" || ref === "W") {
        dd = -dd;
    }
    return dd;
}
export function parseStableDiffusionParams(rawParams) {
    const lines = rawParams.split("\n");
    const result = { prompt: "" };
    let state = "prompt";
    const promptLines = [];
    const negLines = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("Negative prompt:")) {
            state = "negative";
            negLines.push(trimmed.substring(16).trim());
        }
        else if (trimmed.match(/^(Steps:|Seed:|CFG scale:|Sampler:)/)) {
            state = "params";
            const pairs = trimmed.split(",");
            const other = {};
            for (const pair of pairs) {
                const parts = pair.split(":");
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    const val = parts.slice(1).join(":").trim();
                    if (key === "Steps")
                        result.steps = val;
                    else if (key === "Sampler")
                        result.sampler = val;
                    else if (key === "CFG scale")
                        result.cfgScale = val;
                    else if (key === "Seed")
                        result.seed = val;
                    else if (key === "Size")
                        result.size = val;
                    else if (key === "Model hash")
                        result.modelHash = val;
                    else if (key === "Model")
                        result.model = val;
                    else
                        other[key] = val;
                }
            }
            if (Object.keys(other).length > 0)
                result.other = other;
        }
        else {
            if (state === "prompt") {
                promptLines.push(line);
            }
            else if (state === "negative") {
                negLines.push(line);
            }
        }
    }
    result.prompt = promptLines.join("\n").trim();
    if (negLines.length > 0) {
        result.negativePrompt = negLines.join("\n").trim();
    }
    return result;
}
export function parseTiffAt(view, tiffOffset) {
    const tags = {};
    try {
        if (tiffOffset + 8 > view.byteLength)
            return tags;
        const endian = view.getUint16(tiffOffset);
        const isLittle = endian === 0x4949; // "II"
        if (endian !== 0x4949 && endian !== 0x4D4D)
            return tags;
        const signature = view.getUint16(tiffOffset + 2, isLittle);
        if (signature !== 0x002A)
            return tags;
        const ifdOffset = view.getUint32(tiffOffset + 4, isLittle);
        const typeSizes = {
            1: 1, // BYTE
            2: 1, // ASCII
            3: 2, // SHORT
            4: 4, // LONG
            5: 8, // RATIONAL
            7: 1, // UNDEFINED
            9: 4, // SLONG
            10: 8, // SRATIONAL
        };
        const parseIFD = (offset) => {
            const currentTags = {};
            if (offset <= 0 || offset + 2 > view.byteLength)
                return currentTags;
            const numEntries = view.getUint16(tiffOffset + offset, isLittle);
            for (let i = 0; i < numEntries; i++) {
                const entryOffset = tiffOffset + offset + 2 + i * 12;
                if (entryOffset + 12 > view.byteLength)
                    break;
                const tag = view.getUint16(entryOffset, isLittle);
                const type = view.getUint16(entryOffset + 2, isLittle);
                const count = view.getUint32(entryOffset + 4, isLittle);
                const valOffset = view.getUint32(entryOffset + 8, isLittle);
                const size = typeSizes[type] || 1;
                const dataSize = size * count;
                const valueAddr = dataSize <= 4 ? (entryOffset + 8) : (tiffOffset + valOffset);
                if (valueAddr + dataSize > view.byteLength)
                    continue;
                let value = null;
                if (type === 2) {
                    value = getString(view, valueAddr, count).trim();
                }
                else if (type === 3) {
                    if (count === 1) {
                        value = view.getUint16(valueAddr, isLittle);
                    }
                    else {
                        const arr = [];
                        for (let j = 0; j < count; j++) {
                            arr.push(view.getUint16(valueAddr + j * 2, isLittle));
                        }
                        value = arr;
                    }
                }
                else if (type === 4) {
                    if (count === 1) {
                        value = view.getUint32(valueAddr, isLittle);
                    }
                    else {
                        const arr = [];
                        for (let j = 0; j < count; j++) {
                            arr.push(view.getUint32(valueAddr + j * 4, isLittle));
                        }
                        value = arr;
                    }
                }
                else if (type === 5) {
                    if (count === 1) {
                        const num = view.getUint32(valueAddr, isLittle);
                        const den = view.getUint32(valueAddr + 4, isLittle);
                        value = den === 0 ? num : num / den;
                    }
                    else {
                        const arr = [];
                        for (let j = 0; j < count; j++) {
                            const num = view.getUint32(valueAddr + j * 8, isLittle);
                            const den = view.getUint32(valueAddr + j * 8 + 4, isLittle);
                            arr.push({ numerator: num, denominator: den, value: den === 0 ? num : num / den });
                        }
                        value = arr;
                    }
                }
                else if (type === 9) {
                    if (count === 1) {
                        value = view.getInt32(valueAddr, isLittle);
                    }
                    else {
                        const arr = [];
                        for (let j = 0; j < count; j++) {
                            arr.push(view.getInt32(valueAddr + j * 4, isLittle));
                        }
                        value = arr;
                    }
                }
                else if (type === 10) {
                    if (count === 1) {
                        const num = view.getInt32(valueAddr, isLittle);
                        const den = view.getInt32(valueAddr + 4, isLittle);
                        value = den === 0 ? num : num / den;
                    }
                    else {
                        const arr = [];
                        for (let j = 0; j < count; j++) {
                            const num = view.getInt32(valueAddr + j * 8, isLittle);
                            const den = view.getInt32(valueAddr + j * 8 + 4, isLittle);
                            arr.push({ numerator: num, denominator: den, value: den === 0 ? num : num / den });
                        }
                        value = arr;
                    }
                }
                else {
                    if (count === 1) {
                        value = view.getUint8(valueAddr);
                    }
                    else {
                        value = new Uint8Array(view.buffer, valueAddr, count);
                    }
                }
                const tagName = EXIF_TAGS[tag] || `Tag_0x${tag.toString(16).toUpperCase()}`;
                currentTags[tagName] = value;
                if (tag === 0x8769 && typeof valOffset === "number") {
                    const subTags = parseIFD(valOffset);
                    Object.assign(currentTags, subTags);
                }
                else if (tag === 0x8825 && typeof valOffset === "number") {
                    const subTags = parseIFD(valOffset);
                    Object.assign(currentTags, subTags);
                }
            }
            return currentTags;
        };
        return parseIFD(ifdOffset);
    }
    catch (e) {
        logger.error("Error parsing TIFF structure", e);
        return tags;
    }
}
export function parseMetadata(buffer, name, mimeType, size) {
    const view = new DataView(buffer);
    const result = {
        fileInfo: { name, size, mimeType },
        rawTags: {}
    };
    try {
        if (view.byteLength > 4 && view.getUint16(0) === 0xFFD8) {
            let offset = 2;
            while (offset < view.byteLength - 1) {
                if (view.getUint8(offset) !== 0xFF) {
                    offset++;
                    continue;
                }
                while (offset < view.byteLength && view.getUint8(offset) === 0xFF) {
                    offset++;
                }
                if (offset >= view.byteLength)
                    break;
                const marker = view.getUint8(offset);
                offset++;
                if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
                    continue;
                }
                if (offset + 2 > view.byteLength)
                    break;
                const length = view.getUint16(offset);
                if (length < 2) {
                    break;
                }
                if (marker === 0xE1) { // APP1 - Exif
                    if (offset + length <= view.byteLength) {
                        const header = getString(view, offset + 2, 6);
                        if (header === "Exif\0\0") {
                            const parsedExif = parseTiffAt(view, offset + 8);
                            result.exif = parsedExif;
                            Object.assign(result.rawTags, parsedExif);
                        }
                    }
                    break;
                }
                offset += length;
            }
        }
        else if (view.byteLength > 12 && view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57454250) { // RIFF WEBP
            let offset = 12;
            while (offset < view.byteLength - 8) {
                const type = getString(view, offset, 4);
                const chunkSize = view.getUint32(offset + 4, true);
                const dataAddr = offset + 8;
                if (type === "EXIF") {
                    const parsedExif = parseTiffAt(view, dataAddr);
                    result.exif = parsedExif;
                    Object.assign(result.rawTags, parsedExif);
                }
                else if (type === "VP8X") {
                    if (dataAddr + 10 <= view.byteLength) {
                        const width = 1 + (view.getUint8(dataAddr + 4) | (view.getUint8(dataAddr + 5) << 8) | (view.getUint8(dataAddr + 6) << 16));
                        const height = 1 + (view.getUint8(dataAddr + 7) | (view.getUint8(dataAddr + 8) << 8) | (view.getUint8(dataAddr + 9) << 16));
                        result.webpVP8X = { width, height };
                        result.fileInfo.dimensions = `${width} × ${height}`;
                    }
                }
                else if (type === "VP8 ") {
                    if (dataAddr + 10 <= view.byteLength) {
                        const isKeyFrame = (view.getUint8(dataAddr) & 1) === 0;
                        if (isKeyFrame) {
                            const startCode1 = view.getUint8(dataAddr + 3);
                            const startCode2 = view.getUint8(dataAddr + 4);
                            const startCode3 = view.getUint8(dataAddr + 5);
                            if (startCode1 === 0x9D && startCode2 === 0x01 && startCode3 === 0x2A) {
                                const widthVal = (view.getUint8(dataAddr + 7) << 8) | view.getUint8(dataAddr + 6);
                                const heightVal = (view.getUint8(dataAddr + 9) << 8) | view.getUint8(dataAddr + 8);
                                const width = widthVal & 0x3FFF;
                                const height = heightVal & 0x3FFF;
                                if (!result.fileInfo.dimensions) {
                                    result.fileInfo.dimensions = `${width} × ${height}`;
                                }
                            }
                        }
                    }
                }
                else if (type === "VP8L") {
                    if (dataAddr + 5 <= view.byteLength && view.getUint8(dataAddr) === 0x2F) {
                        const val = view.getUint32(dataAddr + 1, true);
                        const width = (val & 0x3FFF) + 1;
                        const height = ((val >> 14) & 0x3FFF) + 1;
                        if (!result.fileInfo.dimensions) {
                            result.fileInfo.dimensions = `${width} × ${height}`;
                        }
                    }
                }
                offset += 8 + ((chunkSize + 1) & ~1);
            }
        }
        else if (view.byteLength > 8 && view.getUint8(0) === 0x89 && view.getUint8(1) === 0x50 && view.getUint8(2) === 0x4E && view.getUint8(3) === 0x47) {
            let offset = 8;
            const chunks = [];
            while (offset < view.byteLength - 12) {
                const length = view.getUint32(offset, false);
                const type = getString(view, offset + 4, 4);
                const dataAddr = offset + 8;
                if (dataAddr + length > view.byteLength)
                    break;
                if (type === "IHDR") {
                    const width = view.getUint32(dataAddr, false);
                    const height = view.getUint32(dataAddr + 4, false);
                    result.fileInfo.dimensions = `${width} × ${height}`;
                }
                else if (type === "tEXt") {
                    let kwLen = 0;
                    while (kwLen < length && view.getUint8(dataAddr + kwLen) !== 0) {
                        kwLen++;
                    }
                    const keyword = getString(view, dataAddr, kwLen);
                    const text = getString(view, dataAddr + kwLen + 1, length - kwLen - 1);
                    chunks.push({ keyword, text, compressed: false });
                    result.rawTags[keyword] = text;
                    if (keyword === "parameters") {
                        result.sdParams = parseStableDiffusionParams(text);
                    }
                }
                else if (type === "zTXt") {
                    let kwLen = 0;
                    while (kwLen < length && view.getUint8(dataAddr + kwLen) !== 0) {
                        kwLen++;
                    }
                    const keyword = getString(view, dataAddr, kwLen);
                    const compMethod = view.getUint8(dataAddr + kwLen + 1);
                    if (compMethod === 0) {
                        try {
                            const compBytes = new Uint8Array(view.buffer, view.byteOffset + dataAddr + kwLen + 2, length - kwLen - 2);
                            const decompBytes = inflateSync(compBytes);
                            const text = new TextDecoder("utf-8").decode(decompBytes);
                            chunks.push({ keyword, text, compressed: true });
                            result.rawTags[keyword] = text;
                            if (keyword === "parameters") {
                                result.sdParams = parseStableDiffusionParams(text);
                            }
                        }
                        catch (e) {
                            logger.error("Failed to inflate zTXt chunk", e);
                        }
                    }
                }
                else if (type === "iTXt") {
                    let kwLen = 0;
                    while (kwLen < length && view.getUint8(dataAddr + kwLen) !== 0) {
                        kwLen++;
                    }
                    const keyword = getString(view, dataAddr, kwLen);
                    const compFlag = view.getUint8(dataAddr + kwLen + 1);
                    const compMethod = view.getUint8(dataAddr + kwLen + 2);
                    const langOffset = dataAddr + kwLen + 3;
                    let langLen = 0;
                    while (langOffset + langLen < view.byteLength && view.getUint8(langOffset + langLen) !== 0) {
                        langLen++;
                    }
                    const transOffset = langOffset + langLen + 1;
                    let transLen = 0;
                    while (transOffset + transLen < view.byteLength && view.getUint8(transOffset + transLen) !== 0) {
                        transLen++;
                    }
                    const textOffset = transOffset + transLen + 1;
                    const textLen = dataAddr + length - textOffset;
                    if (textOffset + textLen <= view.byteLength && textLen > 0) {
                        try {
                            const textBytes = new Uint8Array(view.buffer, view.byteOffset + textOffset, textLen);
                            const finalBytes = (compFlag === 1 && compMethod === 0)
                                ? inflateSync(textBytes)
                                : textBytes;
                            const text = new TextDecoder("utf-8").decode(finalBytes);
                            chunks.push({ keyword, text, compressed: compFlag === 1 });
                            result.rawTags[keyword] = text;
                            if (keyword === "parameters") {
                                result.sdParams = parseStableDiffusionParams(text);
                            }
                        }
                        catch (e) {
                            logger.error("Failed to inflate iTXt chunk", e);
                        }
                    }
                }
                offset += 12 + length;
            }
            if (chunks.length > 0) {
                result.pngChunks = chunks;
            }
        }
        if (result.exif) {
            const gpsLat = result.exif.GPSLatitude;
            const gpsLatRef = result.exif.GPSLatitudeRef;
            const gpsLng = result.exif.GPSLongitude;
            const gpsLngRef = result.exif.GPSLongitudeRef;
            if (gpsLat && gpsLatRef && gpsLng && gpsLngRef) {
                const lat = parseGPSCoordinate(gpsLat, gpsLatRef);
                const lng = parseGPSCoordinate(gpsLng, gpsLngRef);
                if (lat !== null && lng !== null) {
                    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                    const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
                    let alt;
                    if (result.exif.GPSAltitude !== undefined) {
                        const altVal = result.exif.GPSAltitude;
                        const altRef = result.exif.GPSAltitudeRef;
                        const rawAlt = typeof altVal === "number" ? altVal : (altVal.numerator / altVal.denominator);
                        alt = altRef === 1 ? -rawAlt : rawAlt;
                    }
                    result.gps = { latitude: lat, longitude: lng, altitude: alt, googleMapsUrl, osmUrl };
                }
            }
        }
        if (result.exif && !result.fileInfo.dimensions) {
            const w = (result.exif.PixelXDimension ?? result.exif.ExifImageWidth);
            const h = (result.exif.PixelYDimension ?? result.exif.ExifImageHeight);
            if (w && h) {
                result.fileInfo.dimensions = `${w} × ${h}`;
            }
        }
    }
    catch (e) {
        logger.error("General error parsing file metadata", e);
    }
    return result;
}
export function formatBytes(bytes) {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
