/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export var ServiceType;
(function (ServiceType) {
    ServiceType["ZIPLINE"] = "zipline";
    ServiceType["NEST"] = "nest";
    ServiceType["EZHOST"] = "ezhost";
    ServiceType["ENCRYPTINGHOST"] = "encryptinghost";
    ServiceType["S3"] = "s3";
    ServiceType["CATBOX"] = "catbox";
    ServiceType["ZEROX0"] = "0x0";
    ServiceType["LITTERBOX"] = "litterbox";
    ServiceType["SHAREX"] = "sharex";
    ServiceType["GOFILE"] = "gofile";
    ServiceType["TMPFILES"] = "tmpfiles";
    ServiceType["BUZZHEAVIER"] = "buzzheavier";
    ServiceType["TEMPSH"] = "tempsh";
    ServiceType["FILEBIN"] = "filebin";
    ServiceType["PIXELVAULT"] = "pixelvault";
    ServiceType["PIXELDRAIN"] = "pixeldrain";
    ServiceType["WEBDAV"] = "webdav";
})(ServiceType || (ServiceType = {}));
export const serviceLabels = {
    [ServiceType.ZIPLINE]: "Zipline",
    [ServiceType.NEST]: "Nest",
    [ServiceType.EZHOST]: "E-Z Host",
    [ServiceType.ENCRYPTINGHOST]: "Encrypting.host",
    [ServiceType.S3]: "S3-Compatible",
    [ServiceType.CATBOX]: "Catbox",
    [ServiceType.ZEROX0]: "0x0.st",
    [ServiceType.LITTERBOX]: "Litterbox",
    [ServiceType.SHAREX]: "ShareX Custom Uploader",
    [ServiceType.GOFILE]: "GoFile",
    [ServiceType.TMPFILES]: "tmpfiles.org",
    [ServiceType.BUZZHEAVIER]: "buzzheavier.com",
    [ServiceType.TEMPSH]: "temp.sh",
    [ServiceType.FILEBIN]: "filebin.net",
    [ServiceType.PIXELVAULT]: "PixelVault",
    [ServiceType.PIXELDRAIN]: "PixelDrain",
    [ServiceType.WEBDAV]: "WebDAV"
};
export const fallbackServiceOrder = [
    ServiceType.ZIPLINE,
    ServiceType.EZHOST,
    ServiceType.NEST,
    ServiceType.ENCRYPTINGHOST,
    ServiceType.S3,
    ServiceType.CATBOX,
    ServiceType.ZEROX0,
    ServiceType.LITTERBOX,
    ServiceType.GOFILE,
    ServiceType.TMPFILES,
    ServiceType.BUZZHEAVIER,
    ServiceType.TEMPSH,
    ServiceType.FILEBIN,
    ServiceType.PIXELVAULT,
    ServiceType.PIXELDRAIN,
    ServiceType.WEBDAV,
    ServiceType.SHAREX
];
