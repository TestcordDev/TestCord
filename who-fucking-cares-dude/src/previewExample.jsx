/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import React from "react";
const UserCard = ({ user }) => {
    return (<div className="user-card">
            <h2>{user.name}</h2>
            <p>{user.email}</p>
            <button onClick={() => alert(`Hello ${user.name}!`)}>
                Say Hello
            </button>
        </div>);
};
export default UserCard;
