/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export var WebSocketOpCode;
(function (WebSocketOpCode) {
    /**
     * The initial message sent by obs-websocket to newly connected clients.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["Hello"] = 0] = "Hello";
    /**
     * The message sent by a newly connected client to obs-websocket in response to a `Hello`.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["Identify"] = 1] = "Identify";
    /**
     * The response sent by obs-websocket to a client after it has successfully identified with obs-websocket.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["Identified"] = 2] = "Identified";
    /**
     * The message sent by an already-identified client to update identification parameters.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["Reidentify"] = 3] = "Reidentify";
    /**
     * The message sent by obs-websocket containing an event payload.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["Event"] = 5] = "Event";
    /**
     * The message sent by a client to obs-websocket to perform a request.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["Request"] = 6] = "Request";
    /**
     * The message sent by obs-websocket in response to a particular request from a client.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["RequestResponse"] = 7] = "RequestResponse";
    /**
     * The message sent by a client to obs-websocket to perform a batch of requests.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["RequestBatch"] = 8] = "RequestBatch";
    /**
     * The message sent by obs-websocket in response to a particular batch of requests from a client.
     *
     * Initial OBS Version: 5.0.0
     */
    WebSocketOpCode[WebSocketOpCode["RequestBatchResponse"] = 9] = "RequestBatchResponse";
})(WebSocketOpCode || (WebSocketOpCode = {}));
export var EventSubscription;
(function (EventSubscription) {
    /**
     * Subcription value used to disable all events.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["None"] = 0] = "None";
    /**
     * Subscription value to receive events in the `General` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["General"] = 1] = "General";
    /**
     * Subscription value to receive events in the `Config` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Config"] = 2] = "Config";
    /**
     * Subscription value to receive events in the `Scenes` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Scenes"] = 4] = "Scenes";
    /**
     * Subscription value to receive events in the `Inputs` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Inputs"] = 8] = "Inputs";
    /**
     * Subscription value to receive events in the `Transitions` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Transitions"] = 16] = "Transitions";
    /**
     * Subscription value to receive events in the `Filters` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Filters"] = 32] = "Filters";
    /**
     * Subscription value to receive events in the `Outputs` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Outputs"] = 64] = "Outputs";
    /**
     * Subscription value to receive events in the `SceneItems` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["SceneItems"] = 128] = "SceneItems";
    /**
     * Subscription value to receive events in the `MediaInputs` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["MediaInputs"] = 256] = "MediaInputs";
    /**
     * Subscription value to receive the `VendorEvent` event.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Vendors"] = 512] = "Vendors";
    /**
     * Subscription value to receive events in the `Ui` category.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["Ui"] = 1024] = "Ui";
    /**
     * Helper to receive all non-high-volume events.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["All"] = 2047] = "All";
    /**
     * Subscription value to receive the `InputVolumeMeters` high-volume event.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["InputVolumeMeters"] = 65536] = "InputVolumeMeters";
    /**
     * Subscription value to receive the `InputActiveStateChanged` high-volume event.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["InputActiveStateChanged"] = 131072] = "InputActiveStateChanged";
    /**
     * Subscription value to receive the `InputShowStateChanged` high-volume event.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["InputShowStateChanged"] = 262144] = "InputShowStateChanged";
    /**
     * Subscription value to receive the `SceneItemTransformChanged` high-volume event.
     *
     * Initial OBS Version: 5.0.0
     */
    EventSubscription[EventSubscription["SceneItemTransformChanged"] = 524288] = "SceneItemTransformChanged";
})(EventSubscription || (EventSubscription = {}));
export var RequestBatchExecutionType;
(function (RequestBatchExecutionType) {
    /**
     * Not a request batch.
     *
     * Initial OBS Version: 5.0.0
     */
    RequestBatchExecutionType[RequestBatchExecutionType["None"] = -1] = "None";
    /**
     * A request batch which processes all requests serially, as fast as possible.
     *
     * Note: To introduce artificial delay, use the `Sleep` request and the `sleepMillis` request field.
     *
     * Initial OBS Version: 5.0.0
     */
    RequestBatchExecutionType[RequestBatchExecutionType["SerialRealtime"] = 0] = "SerialRealtime";
    /**
     * A request batch type which processes all requests serially, in sync with the graphics thread. Designed to provide high accuracy for animations.
     *
     * Note: To introduce artificial delay, use the `Sleep` request and the `sleepFrames` request field.
     *
     * Initial OBS Version: 5.0.0
     */
    RequestBatchExecutionType[RequestBatchExecutionType["SerialFrame"] = 1] = "SerialFrame";
    /**
     * A request batch type which processes all requests using all available threads in the thread pool.
     *
     * Note: This is mainly experimental, and only really shows its colors during requests which require lots of
     * active processing, like `GetSourceScreenshot`.
     *
     * Initial OBS Version: 5.0.0
     */
    RequestBatchExecutionType[RequestBatchExecutionType["Parallel"] = 2] = "Parallel";
})(RequestBatchExecutionType || (RequestBatchExecutionType = {}));
