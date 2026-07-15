/* eslint-disable simple-header/header*/

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy, findComponentByCodeLazy } from "@webpack";

const MemberSince = findComponentByCodeLazy(".memberSinceWrapper,");
const classes = findByPropsLazy("interactiveNormal");

export default definePlugin({
    name: "BetterBios",
    authors: [TestcordDevs.x2b],
    description: "Improves Discord's bio redesign",
    tags: ["Customisation", "Appearance"],
    patches: [],

    membersSince({ user, guild }) {
        return <>
            <MemberSince
                userId={user.id}
                guildId={guild?.id}
                tooltipDelay={300}
                textClassName={classes.interactiveNormal}
            />
        </>;
    }
});
