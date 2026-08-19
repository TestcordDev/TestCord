/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
export var BeatmapStatuses;
(function (BeatmapStatuses) {
    BeatmapStatuses[BeatmapStatuses["Unknown"] = 0] = "Unknown";
    BeatmapStatuses[BeatmapStatuses["NotSubmitted"] = 1] = "NotSubmitted";
    BeatmapStatuses[BeatmapStatuses["Pending"] = 2] = "Pending";
    BeatmapStatuses[BeatmapStatuses["Ranked"] = 4] = "Ranked";
    BeatmapStatuses[BeatmapStatuses["Approved"] = 5] = "Approved";
    BeatmapStatuses[BeatmapStatuses["Qualified"] = 6] = "Qualified";
    BeatmapStatuses[BeatmapStatuses["Loved"] = 7] = "Loved";
})(BeatmapStatuses || (BeatmapStatuses = {}));
export var Modes;
(function (Modes) {
    Modes[Modes["Osu"] = 0] = "Osu";
    Modes[Modes["Taiko"] = 1] = "Taiko";
    Modes[Modes["Fruits"] = 2] = "Fruits";
    Modes[Modes["Mania"] = 3] = "Mania";
})(Modes || (Modes = {}));
export var BanchoStatusEnum;
(function (BanchoStatusEnum) {
    BanchoStatusEnum[BanchoStatusEnum["Idle"] = 0] = "Idle";
    BanchoStatusEnum[BanchoStatusEnum["Afk"] = 1] = "Afk";
    BanchoStatusEnum[BanchoStatusEnum["Playing"] = 2] = "Playing";
    BanchoStatusEnum[BanchoStatusEnum["Editing"] = 3] = "Editing";
    BanchoStatusEnum[BanchoStatusEnum["Modding"] = 4] = "Modding";
    BanchoStatusEnum[BanchoStatusEnum["Multiplayer"] = 5] = "Multiplayer";
    BanchoStatusEnum[BanchoStatusEnum["Watching"] = 6] = "Watching";
    BanchoStatusEnum[BanchoStatusEnum["Unknown"] = 7] = "Unknown";
    BanchoStatusEnum[BanchoStatusEnum["Testing"] = 8] = "Testing";
    BanchoStatusEnum[BanchoStatusEnum["Submitting"] = 9] = "Submitting";
    BanchoStatusEnum[BanchoStatusEnum["Paused"] = 10] = "Paused";
    BanchoStatusEnum[BanchoStatusEnum["Lobby"] = 11] = "Lobby";
    BanchoStatusEnum[BanchoStatusEnum["Multiplaying"] = 12] = "Multiplaying";
    BanchoStatusEnum[BanchoStatusEnum["OsuDirect"] = 13] = "OsuDirect";
})(BanchoStatusEnum || (BanchoStatusEnum = {}));
export var UserLoginStatus;
(function (UserLoginStatus) {
    UserLoginStatus[UserLoginStatus["Reconnecting"] = 0] = "Reconnecting";
    UserLoginStatus[UserLoginStatus["Guest"] = 256] = "Guest";
    UserLoginStatus[UserLoginStatus["Recieving_data"] = 257] = "Recieving_data";
    UserLoginStatus[UserLoginStatus["Disconnected"] = 65537] = "Disconnected";
    UserLoginStatus[UserLoginStatus["Connected"] = 65793] = "Connected";
})(UserLoginStatus || (UserLoginStatus = {}));
export var ReleaseStream;
(function (ReleaseStream) {
    ReleaseStream[ReleaseStream["CuttingEdge"] = 0] = "CuttingEdge";
    ReleaseStream[ReleaseStream["Stable"] = 1] = "Stable";
    ReleaseStream[ReleaseStream["Beta"] = 2] = "Beta";
    ReleaseStream[ReleaseStream["Fallback"] = 3] = "Fallback";
})(ReleaseStream || (ReleaseStream = {}));
export var ScoreMeterType;
(function (ScoreMeterType) {
    ScoreMeterType[ScoreMeterType["None"] = 0] = "None";
    ScoreMeterType[ScoreMeterType["Colour"] = 1] = "Colour";
    ScoreMeterType[ScoreMeterType["Error"] = 2] = "Error";
})(ScoreMeterType || (ScoreMeterType = {}));
export var LeaderboardType;
(function (LeaderboardType) {
    LeaderboardType[LeaderboardType["Local"] = 0] = "Local";
    LeaderboardType[LeaderboardType["Global"] = 1] = "Global";
    LeaderboardType[LeaderboardType["Selectedmods"] = 2] = "Selectedmods";
    LeaderboardType[LeaderboardType["Friends"] = 3] = "Friends";
    LeaderboardType[LeaderboardType["Country"] = 4] = "Country";
})(LeaderboardType || (LeaderboardType = {}));
export var GroupType;
(function (GroupType) {
    GroupType[GroupType["None"] = 0] = "None";
    GroupType[GroupType["Artist"] = 1] = "Artist";
    GroupType[GroupType["BPM"] = 2] = "BPM";
    GroupType[GroupType["Creator"] = 3] = "Creator";
    GroupType[GroupType["Date"] = 4] = "Date";
    GroupType[GroupType["Difficulty"] = 5] = "Difficulty";
    GroupType[GroupType["Length"] = 6] = "Length";
    GroupType[GroupType["Rank"] = 7] = "Rank";
    GroupType[GroupType["MyMaps"] = 8] = "MyMaps";
    GroupType[GroupType["Search"] = 12] = "Search";
    GroupType[GroupType["Show_All"] = 12] = "Show_All";
    GroupType[GroupType["Title"] = 13] = "Title";
    GroupType[GroupType["LastPlayed"] = 14] = "LastPlayed";
    GroupType[GroupType["OnlineFavourites"] = 15] = "OnlineFavourites";
    GroupType[GroupType["ManiaKeys"] = 16] = "ManiaKeys";
    GroupType[GroupType["Mode"] = 17] = "Mode";
    GroupType[GroupType["Collection"] = 18] = "Collection";
    GroupType[GroupType["RankedStatus"] = 19] = "RankedStatus";
})(GroupType || (GroupType = {}));
export var SortType;
(function (SortType) {
    SortType[SortType["Artist"] = 0] = "Artist";
    SortType[SortType["BPM"] = 1] = "BPM";
    SortType[SortType["Creator"] = 2] = "Creator";
    SortType[SortType["Date"] = 3] = "Date";
    SortType[SortType["Difficulty"] = 4] = "Difficulty";
    SortType[SortType["Length"] = 5] = "Length";
    SortType[SortType["Rank"] = 6] = "Rank";
    SortType[SortType["Title"] = 7] = "Title";
})(SortType || (SortType = {}));
export var ChatStatus;
(function (ChatStatus) {
    ChatStatus[ChatStatus["Hidden"] = 0] = "Hidden";
    ChatStatus[ChatStatus["Visible"] = 1] = "Visible";
    ChatStatus[ChatStatus["VisibleWithFriendsList"] = 2] = "VisibleWithFriendsList";
})(ChatStatus || (ChatStatus = {}));
export var ProgressBarType;
(function (ProgressBarType) {
    ProgressBarType[ProgressBarType["Off"] = 0] = "Off";
    ProgressBarType[ProgressBarType["Pie"] = 1] = "Pie";
    ProgressBarType[ProgressBarType["TopRight"] = 2] = "TopRight";
    ProgressBarType[ProgressBarType["BottomRight"] = 3] = "BottomRight";
    ProgressBarType[ProgressBarType["Bottom"] = 4] = "Bottom";
})(ProgressBarType || (ProgressBarType = {}));
export var GameState;
(function (GameState) {
    GameState[GameState["Menu"] = 0] = "Menu";
    GameState[GameState["Edit"] = 1] = "Edit";
    GameState[GameState["Play"] = 2] = "Play";
    GameState[GameState["Exit"] = 3] = "Exit";
    GameState[GameState["SelectEdit"] = 4] = "SelectEdit";
    GameState[GameState["SelectPlay"] = 5] = "SelectPlay";
    GameState[GameState["SelectDrawings"] = 6] = "SelectDrawings";
    GameState[GameState["ResultScreen"] = 7] = "ResultScreen";
    GameState[GameState["Update"] = 8] = "Update";
    GameState[GameState["Busy"] = 9] = "Busy";
    GameState[GameState["Unknown"] = 10] = "Unknown";
    GameState[GameState["Lobby"] = 11] = "Lobby";
    GameState[GameState["MatchSetup"] = 12] = "MatchSetup";
    GameState[GameState["SelectMulti"] = 13] = "SelectMulti";
    GameState[GameState["RankingVs"] = 14] = "RankingVs";
    GameState[GameState["OnlineSelection"] = 15] = "OnlineSelection";
    GameState[GameState["OptionsOffsetWizard"] = 16] = "OptionsOffsetWizard";
    GameState[GameState["RankingTagCoop"] = 17] = "RankingTagCoop";
    GameState[GameState["RankingTeam"] = 18] = "RankingTeam";
    GameState[GameState["BeatmapImport"] = 19] = "BeatmapImport";
    GameState[GameState["PackageUpdater"] = 20] = "PackageUpdater";
    GameState[GameState["Benchmark"] = 21] = "Benchmark";
    GameState[GameState["Tourney"] = 22] = "Tourney";
    GameState[GameState["Charts"] = 23] = "Charts";
})(GameState || (GameState = {}));
