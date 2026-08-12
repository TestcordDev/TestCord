/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { Divider } from "@components/Divider";
import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
export function t(arabic: string, english = arabic) { return english; }
import { closeModal, ModalCloseButton as ModalCloseButtonRaw, ModalContent as ModalContentRaw, ModalFooter as ModalFooterRaw, ModalHeader as ModalHeaderRaw, ModalRoot as ModalRootRaw, ModalSize, openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { RenderModalProps } from "@vencord/discord-types";
import { ApplicationStreamingStore, Button, Forms, React, showToast, Text, Toasts, useEffect, UserStore,useState, useStateFromStores } from "@webpack/common";

import { StreamCreateEvent, StreamDeleteEvent } from "./types";
import { getSavedPreview, getStreamingState, imageFileToStreamPreview, isSendingPreview, parseStreamKey, savePreview, startSendingPreview, stopSendingPreview } from "./utilities";

// The low-level Modal* components in @utils/modal are deprecated and typed `never`
// to push migration; at runtime they still resolve to the real components. Re-type
// them as renderable components so this modal compiles without changing behavior.
const ModalRoot = ModalRootRaw as unknown as React.ComponentType<any>;
const ModalHeader = ModalHeaderRaw as unknown as React.ComponentType<any>;
const ModalContent = ModalContentRaw as unknown as React.ComponentType<any>;
const ModalFooter = ModalFooterRaw as unknown as React.ComponentType<any>;
const ModalCloseButton = ModalCloseButtonRaw as unknown as React.ComponentType<any>;

const FILE_INPUT_ID = "custom-stream-preview-upload";

function PreviewIcon({ className }: { className?: string; }) {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
            <path
                d="M22.0187 16.8203L18.8887 9.50027C18.3187 8.16027 17.4687 7.40027 16.4987 7.35027C15.5387 7.30027 14.6087 7.97027 13.8987 9.25027L11.9987 12.6603C11.5987 13.3803 11.0287 13.8103 10.4087 13.8603C9.77867 13.9203 9.14867 13.5903 8.63867 12.9403L8.41867 12.6603C7.70867 11.7703 6.82867 11.3403 5.92867 11.4303C5.02867 11.5203 4.25867 12.1403 3.74867 13.1503L2.01867 16.6003C1.39867 17.8503 1.45867 19.3003 2.18867 20.4803C2.91867 21.6603 4.18867 22.3703 5.57867 22.3703H18.3387C19.6787 22.3703 20.9287 21.7003 21.6687 20.5803C22.4287 19.4603 22.5487 18.0503 22.0187 16.8203Z"
                fill="currentColor"
            />
            <path
                d="M6.96984 8.38109C8.83657 8.38109 10.3498 6.86782 10.3498 5.00109C10.3498 3.13437 8.83657 1.62109 6.96984 1.62109C5.10312 1.62109 3.58984 3.13437 3.58984 5.00109C3.58984 6.86782 5.10312 8.38109 6.96984 8.38109Z"
                fill="currentColor"
            />
        </svg>
    );
}

function PreviewModal({ modalProps, close }: { modalProps: RenderModalProps; close: () => void; }) {
    const [preview, setPreview] = useState<string | null>(null);
    const [sending, setSending] = useState(isSendingPreview());

    useEffect(() => {
        getSavedPreview().then(setPreview);
    }, []);

    const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const base64 = await imageFileToStreamPreview(file);
            setPreview(base64);
            await savePreview(base64);

            if (getStreamingState()) {
                startSendingPreview(base64);
                setSending(true);
                showToast(t("تم حفظ المعاينة وإرسالها.", "Preview saved and sent."), Toasts.Type.SUCCESS);
            } else {
                showToast(t("تم حفظ المعاينة. ستُرسَل عند بدء البث.", "Preview saved. It will be sent when you start streaming."), Toasts.Type.SUCCESS);
            }
        } catch {
            showToast(t("فشل تحويل الصورة.", "Failed to process image."), Toasts.Type.FAILURE);
        }
    };

    const openFilePicker = () => {
        (document.getElementById(FILE_INPUT_ID) as HTMLInputElement | null)?.click();
    };

    const onStop = () => {
        stopSendingPreview();
        setSending(false);
        showToast(t("تم إيقاف إرسال المعاينة.", "Stopped sending preview."), Toasts.Type.SUCCESS);
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.SMALL}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>{t("معاينة البث المخصصة", "Custom Stream Preview")}</Text>
                <ModalCloseButton onClick={close} />
            </ModalHeader>

            <ModalContent>
                <Forms.FormText>
                    {t("اختر صورة من جهازك لاستخدامها كمعاينة لبثّك.", "Choose an image from your device to use as your stream preview.")}
                </Forms.FormText>
                <br />
                <Forms.FormText>
                    {t(
                        "ملاحظة: تُحدَّث المعاينة مرة واحدة كل 60 ثانية كحد أقصى (قيد Discord)، وتُعاد كل 5 دقائق أثناء البث.",
                        "Note: the preview updates at most once every 60s (Discord limit) and is resent every 5 minutes while streaming."
                    )}
                </Forms.FormText>

                <Button style={{ marginTop: "1rem" }} onClick={openFilePicker}>
                    {t("اختيار صورة", "Choose Image")}
                </Button>
                <input
                    id={FILE_INPUT_ID}
                    style={{ display: "none" }}
                    type="file"
                    accept="image/*"
                    onChange={onPickFile}
                />

                {preview && (
                    <>
                        <Divider style={{ marginTop: "1rem", marginBottom: "1rem" }} />
                        <img
                            src={preview}
                            alt={t("معاينة", "Preview")}
                            style={{ maxWidth: "100%", borderRadius: "8px", display: "block" }}
                        />
                    </>
                )}
            </ModalContent>

            <ModalFooter>
                <Flex style={{ width: "100%", justifyContent: "space-between" }}>
                    {sending && (
                        <Button color={Button.Colors.RED} onClick={onStop}>
                            {t("إيقاف الإرسال", "Stop Sending")}
                        </Button>
                    )}
                    <Button style={{ marginLeft: "auto" }} onClick={close}>
                        {t("إغلاق", "Close")}
                    </Button>
                </Flex>
            </ModalFooter>
        </ModalRoot>
    );
}

function PreviewButton(props: UserAreaRenderProps) {
    // Only show the button while the current user is actively streaming;
    // it disappears as soon as the stream ends (the store re-renders this).
    const isStreaming = useStateFromStores([ApplicationStreamingStore], () => Boolean(ApplicationStreamingStore.getCurrentUserActiveStream()));
    if (!isStreaming) return null;

    const openPreviewModal = () => {
        const key = openModal(modalProps => (
            <PreviewModal modalProps={modalProps} close={() => closeModal(key)} />
        ));
    };

    return (
        <ErrorBoundary noop>
            <UserAreaButton
                tooltipText={props.hideTooltips ? void 0 : t("معاينة البث المخصصة", "Custom Stream Preview")}
                icon={<PreviewIcon className={props.iconForeground} />}
                onClick={openPreviewModal}
            />
        </ErrorBoundary>
    );
}

export default definePlugin({
    name: "CustomStreamPreview",
    description: "Set a custom image as your Discord stream preview.",
    tags: ["Voice", "Utility"],
    authors: [{ name: "Testcord", id: 0n }],
    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: PreviewIcon,
        render: PreviewButton
    },

    flux: {
        async STREAM_CREATE({ streamKey }: StreamCreateEvent) {
            const parsed = parseStreamKey(streamKey);
            if (!parsed || parsed.userId !== UserStore.getCurrentUser().id) return;

            const image = await getSavedPreview();
            if (image) startSendingPreview(image);
        },
        STREAM_DELETE({ streamKey }: StreamDeleteEvent) {
            const parsed = parseStreamKey(streamKey);
            if (!parsed || parsed.userId !== UserStore.getCurrentUser().id) return;

            stopSendingPreview();
        }
    },

    stop() {
        stopSendingPreview();
    }
});
