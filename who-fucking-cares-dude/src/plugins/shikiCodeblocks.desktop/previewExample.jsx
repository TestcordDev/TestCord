/* eslint-disable simple-header/header */
import React from "react";
const handleClick = async () => console.log((await import("@utils/clipboard")).copyToClipboard("\u200b"));
export const Example = ({ real, shigged }) => <>
    <p>{`Shigg${real ? `ies${shigged === 0x1B ? "t" : ""}` : "y"}`}</p>
    <button onClick={handleClick}>Click Me</button>
</>;
