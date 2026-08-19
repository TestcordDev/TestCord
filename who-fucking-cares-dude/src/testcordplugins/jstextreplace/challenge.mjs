/* eslint-disable simple-header/header */
const d = new Date(Date.now());
export function t(i) {
    const w = [];
    for (const e of i) {
        switch (typeof e) {
            case "number": {
                w.push(e * d.getMonth());
                break;
            }
            case "string": {
                const f = ["toUpperCase", "toLowerCase"];
                w.push(e[f[d.getMonth() % 2]]());
                break;
            }
            default: {
                w.push("?");
            }
        }
    }
    return w.join("-");
}
