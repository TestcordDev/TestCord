/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { BaseText } from "@components/BaseText";
import { Button, TextButton } from "@components/Button";
import { images } from "@equicordplugins/loginWithQR/images";
import { getIntlMessage } from "@utils/discord";
import { findByPropsLazy } from "@webpack";
import { Modal, openModal, RestAPI, useEffect, useRef, useState } from "@webpack/common";
import { cl } from "..";
const { Controller } = findByPropsLazy("Controller");
var VerifyState;
(function (VerifyState) {
    VerifyState[VerifyState["Verifying"] = 0] = "Verifying";
    VerifyState[VerifyState["LoggedIn"] = 1] = "LoggedIn";
    VerifyState[VerifyState["NotFound"] = 2] = "NotFound";
})(VerifyState || (VerifyState = {}));
function VerifyModal({ token, onAbort, ...props }) {
    const [state, setState] = useState(!token ? VerifyState.NotFound : VerifyState.Verifying);
    useEffect(() => () => void (state !== VerifyState.LoggedIn && onAbort()), []);
    const [inProgress, setInProgress] = useState(false);
    const buttonRef = useRef(null);
    const controllerRef = useRef(new Controller({ progress: "0%" })).current;
    const holdDuration = 1000;
    let timeout;
    const startInput = () => {
        if (!buttonRef.current)
            return;
        controllerRef.start({
            progress: "100%",
            config: {
                duration: holdDuration,
                // https://easings.net/#easeInOutSine
                easing: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
            },
        });
        timeout = setTimeout(() => {
            if (state !== VerifyState.Verifying)
                return;
            setInProgress(true);
            RestAPI.post({
                url: "/users/@me/remote-auth/finish",
                body: {
                    handshake_token: token,
                },
            })
                .then(() => {
                setState(VerifyState.LoggedIn);
            })
                .catch(() => setState(VerifyState.NotFound))
                .finally(() => setInProgress(false));
        }, holdDuration + 250);
    };
    const endInput = () => {
        if (!buttonRef.current)
            return;
        controllerRef.start({
            progress: "0%",
            config: {
                duration: 696,
                // https://easings.net/#easeOutCubic
                easing: (t) => 1 - Math.pow(1 - t, 3),
            },
        });
        clearTimeout(timeout);
    };
    useEffect(() => {
        let frame;
        const update = () => {
            buttonRef.current?.style.setProperty("--progress", controllerRef.get().progress);
            frame = requestAnimationFrame(update);
        };
        if (state === VerifyState.Verifying)
            requestAnimationFrame(update);
        return () => cancelAnimationFrame(frame);
    }, [state]);
    return (<Modal size="sm" {...props} title="Verify Login">
            <div className={cl("device-content")}>
                {state === VerifyState.LoggedIn ? (<>
                        <img className={cl("device-image")} src={images.deviceImage.success} key="img-success" draggable={false}/>
                        <BaseText size="xl" weight="bold" color="text-strong" tag="h1" className={cl("device-header")}>
                            {getIntlMessage("QR_CODE_LOGIN_SUCCESS")}
                        </BaseText>
                        <BaseText size="md" weight="semibold" color="text-default" style={{ width: "30rem", textAlign: "center" }}>
                            {getIntlMessage("QR_CODE_LOGIN_SUCCESS_FLAVOR")}
                        </BaseText>
                    </>) : state === VerifyState.NotFound ? (<>
                        <img className={cl("device-image")} src={images.deviceImage.notFound} key="img-not_found" draggable={false}/>
                        <BaseText size="xl" weight="bold" color="text-strong" tag="h1" className={cl("device-header")}>
                            {getIntlMessage("QR_CODE_NOT_FOUND")}
                        </BaseText>
                        <BaseText size="md" weight="semibold" color="text-default" style={{ width: "30rem" }}>
                            {getIntlMessage("QR_CODE_NOT_FOUND_DESCRIPTION")}
                        </BaseText>
                    </>) : (<>
                        <img className={cl("device-image")} src={images.deviceImage.loading} key="img-loaded" draggable={false}/>
                        <BaseText size="xl" weight="bold" color="text-strong" tag="h1" className={cl("device-header")}>
                            {getIntlMessage("QR_CODE_LOGIN_CONFIRM")}
                        </BaseText>
                        <BaseText size="md" weight="semibold" color="text-danger">
                            Never scan a login QR code from another user or application.
                        </BaseText>
                        <Button size="medium" variant="dangerPrimary" className={cl("device-confirm")} style={{
                ["--progress"]: `${holdDuration}ms`,
            }} onPointerDown={startInput} onPointerUp={endInput} ref={buttonRef} disabled={inProgress}>
                            Hold to confirm login
                        </Button>
                    </>)}
            </div>
            <div className={cl("device-footer")} style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                {state === VerifyState.LoggedIn ? (<Button onClick={props.onClose}>
                        {getIntlMessage("QR_CODE_LOGIN_FINISH_BUTTON")}
                    </Button>) : (<TextButton variant="link" onClick={props.onClose}>
                        {state === VerifyState.NotFound
                ? getIntlMessage("CLOSE")
                : getIntlMessage("CANCEL")}
                    </TextButton>)}
            </div>
        </Modal>);
}
export default function openVerifyModal(token, onAbort) {
    return openModal(props => (<VerifyModal {...props} token={token} onAbort={onAbort}/>));
}
