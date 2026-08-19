/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { showNotification } from "@api/Notifications/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { FluxDispatcher, Toasts } from "@webpack/common";
const Flogger = new Logger("RobloxFilter", "#00ff88");
const settings = definePluginSettings({
    filterEnabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable filtering (censor/replace/block). When off, messages pass through freely.",
        default: true,
    },
    actionOnViolation: {
        type: 4 /* OptionType.SELECT */,
        description: "What to do when a violation is detected",
        options: [
            { label: "Block Message", value: "block", default: true },
            { label: "Censor with *****", value: "censor" },
            { label: "SFW Word Replace", value: "replace" },
        ],
        default: "block",
    },
    showWarningToast: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a toast when a violation is detected",
        default: true,
    },
    showWarningNotification: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Show a system notification when a violation is detected",
        default: true,
    },
    logBlockedMessages: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Log violations to console",
        default: true,
    },
    strictMode: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable stricter detection (may catch more false positives)",
        default: false,
    },
    allowOverride: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Hold Shift to override and send anyway",
        default: true,
    },
});
const VIOLATION_PATTERNS = [
    {
        regex: /\b(?:cp|c\.s\.a\.m|child\s*porn|kiddie\s*porn|pedo\s*file|child\s*lover|young\s*lover|jailbait|hebephil|ephebophil|pedophil|pedophili)\b/i,
        category: "Child Exploitation",
        reason: "References to child exploitation or CSAM — violates Discord ToS and criminal law worldwide.",
        replacements: [
            { word: /\bcp\b/i, sfw: "computer" },
            { word: /child\s*porn/i, sfw: "innocent content" },
            { word: /kiddie\s*porn/i, sfw: "family content" },
            { word: /\bpedo\s*file/i, sfw: "archive" },
            { word: /child\s*lover/i, sfw: "caring person" },
            { word: /\bjailbait\b/i, sfw: "young-looking" },
        ],
    },
    {
        regex: /\b(?:naked\s*kid|nude\s*child|child\s*nude|kid\s*naked|kid\s*nude|naked\s*minor|nude\s*minor|child\s*sex|kid\s*sex|minor\s*sex|underage\s*sex|teen\s*sex(?:ual)?|lolita|loli\s*sex|shota\s*sex|shotacon|lolicon)\b/i,
        category: "Child Exploitation",
        reason: "Sexualization of minors — illegal and violates Discord ToS.",
        replacements: [
            { word: /naked\s*kid/i, sfw: "young person" },
            { word: /nude\s*child/i, sfw: "young person" },
            { word: /child\s*sex/i, sfw: "minor topic" },
            { word: /minor\s*sex/i, sfw: "age-inappropriate topic" },
            { word: /underage\s*sex/i, sfw: "age-inappropriate topic" },
            { word: /teen\s*sexual?/i, sfw: "teen topic" },
            { word: /\blolita\b/i, sfw: "classic novel" },
            { word: /lolicon/i, sfw: "inappropriate interest" },
            { word: /shotacon/i, sfw: "inappropriate interest" },
        ],
    },
    {
        regex: /\b(?:12\s*yo|13\s*yo|14\s*yo|under\s*age|underage|minor|under.?age|under\s*18|under\s*16|under\s*14|under\s*13|under\s*12)\s*(?:sexy|hot|nude|naked|sexual|sex|porn|hentai)\b/i,
        category: "Child Exploitation",
        reason: "Sexual content involving minors — violates Discord ToS and criminal law.",
    },
    {
        regex: /\b(?:im\s*1[0-4]\b|i'?m\s*1[0-4]\b|i\s*am\s*1[0-4]\b|age\s*1[0-4]\b|1[0-4]\s*years?\s*old)\b/i,
        category: "Age Disclosure (Minor)",
        reason: "Announcing you're a young minor (under 15) — can be dangerous in risky contexts.",
    },
    {
        regex: /\b(?:isis|al[\s-]*qaeda|boko\s*haram|taliban|al[\s-]*shabaab|hamas|hezbollah|jemaah\s*islamiyah|abu\s*sayyaf|ansar\s*bayt\s*al[\s-]*maqdis)\b/i,
        category: "Terrorism",
        reason: "References to designated terrorist organizations — promoting or supporting them violates Discord ToS.",
        replacements: [
            { word: /\bisis\b/i, sfw: "the group" },
            { word: /al[\s-]*qaeda/i, sfw: "the organization" },
            { word: /boko\s*haram/i, sfw: "the group" },
            { word: /\btaliban\b/i, sfw: "the group" },
            { word: /\bhamas\b/i, sfw: "the organization" },
            { word: /\bhezbollah\b/i, sfw: "the organization" },
        ],
    },
    {
        regex: /\b(?:jihad|caliphate|khilafah|sharia\s*state|islamic\s*state|isil|daesh)\b(?:\s*(?:support|join|fight|victory|praise|allahu|akbar|state|flag|soldier|recruit))?\b/i,
        category: "Terrorism / Violent Extremism",
        reason: "References to terrorist organizations or violent extremism — violates Discord ToS.",
        replacements: [
            { word: /\bjihad\b/i, sfw: "struggle" },
            { word: /\bcaliphate\b/i, sfw: "historical state" },
            { word: /\bkhilafah\b/i, sfw: "historical state" },
            { word: /sharia\s*state/i, sfw: "the region" },
            { word: /islamic\s*state/i, sfw: "the group" },
            { word: /\bisil\b/i, sfw: "the group" },
            { word: /\bdaesh\b/i, sfw: "the group" },
        ],
    },
    {
        regex: /\b(?:mass\s*shooting|school\s*shooting|active\s*shooter|shooting\s*rampage|go\s*on\s*a\s*rampage|kill\s*them\s*all|murder\s*everyone|bomb\s*threat|bomb\s*plot|terrorist?\s*attack)\b/i,
        category: "Violent Threats / Terrorism",
        reason: "Threats of mass violence or terrorism — violates Discord ToS and may be illegal.",
        replacements: [
            { word: /mass\s*shooting/i, sfw: "tragic event" },
            { word: /school\s*shooting/i, sfw: "tragic event" },
            { word: /active\s*shooter/i, sfw: "emergency situation" },
            { word: /shooting\s*rampage/i, sfw: "tragic event" },
            { word: /kill\s*them\s*all/i, sfw: "deal with them all" },
            { word: /murder\s*everyone/i, sfw: "annoy everyone" },
            { word: /bomb\s*threat/i, sfw: "security threat" },
            { word: /bomb\s*plot/i, sfw: "security plot" },
            { word: /terrorist?\s*attack/i, sfw: "attack" },
        ],
    },
    {
        regex: /\b(?:i'?ll\s*(?:kill|murder|slaughter|beat|stab|shoot|rape|hurt|harm|destroy)\s*(?:you|him|her|them|ur|ya)|gonna\s*(?:kill|murder|slaughter|rape)|going\s*to\s*(?:kill|murder|rape))\b/i,
        category: "Real-Life Threats",
        reason: "Direct threats of violence against someone — violates Discord ToS and may be criminal.",
        replacements: [
            { word: /i'?ll\s*kill\s*you/i, sfw: "I'll argue with you" },
            { word: /i'?ll\s*murder\s*you/i, sfw: "I'll strongly disagree with you" },
            { word: /i'?ll\s*slaughter\s*you/i, sfw: "I'll debate you" },
            { word: /i'?ll\s*beat\s*you/i, sfw: "I'll outdo you" },
            { word: /i'?ll\s*stab\s*you/i, sfw: "I'll criticize you" },
            { word: /i'?ll\s*shoot\s*you/i, sfw: "I'll message you" },
            { word: /i'?ll\s*hurt\s*you/i, sfw: "I'll upset you" },
            { word: /i'?ll\s*destroy\s*you/i, sfw: "I'll outplay you" },
            { word: /gonna\s*kill/i, sfw: "going to debate" },
            { word: /gonna\s*murder/i, sfw: "going to argue" },
            { word: /going\s*to\s*kill/i, sfw: "going to argue with" },
            { word: /going\s*to\s*murder/i, sfw: "going to argue with" },
        ],
    },
    {
        regex: /\b(?:dox|doxx|drop\s*dox|drop\s*ip|swat|swatt|leak\s*(?:your|their|his|her)\s*(?:address|ip|location|phone|real\s*name|where\s*(?:you|they|he|she)\s*live))\b/i,
        category: "Doxxing / Privacy Violations",
        reason: "Threatening to share someone's private information — violates Discord ToS.",
        replacements: [
            { word: /\bdox(?:x)?\b/i, sfw: "share public info" },
            { word: /drop\s*dox/i, sfw: "share info" },
            { word: /drop\s*ip/i, sfw: "share info" },
            { word: /\bswat(?:t)?\b/i, sfw: "prank call" },
            { word: /leak\s*(?:your|their|his|her)\s*(?:address|ip|location|phone|real\s*name)/i, sfw: "share info about them" },
        ],
    },
    {
        regex: /\b(?:dox|doxx)\b(?:ing|ed)?\s*(?:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{3}[\s-]?\d{3}[\s-]?\d{4})/i,
        category: "Doxxing",
        reason: "Sharing personal information (IP, email, phone) — violates Discord ToS.",
    },
    {
        regex: /\b(?:kill\s*myself|kms|kys|end\s*(?:my|your|their)\s*life|end\s*it\s*all|commit\s*suicide|kill\s*(?:me|yourself|myself)|want\s*to\s*die|gonna\s*die|going\s*to\s*die|i'?ll\s*die|i\s*want\s*to\s*die)\b/i,
        category: "Self-Harm / Suicide",
        reason: "References to self-harm or suicide — Discord takes this seriously. Please seek help if you're struggling.",
        replacements: [
            { word: /kill\s*myself/i, sfw: "take care of myself" },
            { word: /\bkms\b/i, sfw: "I'm okay" },
            { word: /\bkys\b/i, sfw: "be kind" },
            { word: /end\s*(?:my|your|their)\s*life/i, sfw: "change my situation" },
            { word: /end\s*it\s*all/i, sfw: "start fresh" },
            { word: /commit\s*suicide/i, sfw: "hurt myself" },
            { word: /kill\s*(?:me|yourself|myself)/i, sfw: "be gentle with myself" },
            { word: /want\s*to\s*die/i, sfw: "need help" },
            { word: /gonna\s*die/i, sfw: "going to be okay" },
            { word: /going\s*to\s*die/i, sfw: "going to be okay" },
            { word: /i'?ll\s*die/i, sfw: "I'll manage" },
            { word: /i\s*want\s*to\s*die/i, sfw: "I need support" },
        ],
    },
    {
        regex: /\b(?:how\s*to\s*(?:kill\s*myself|commit\s*suicide|end\s*my\s*life)|suicide\s*(?:methods|ways|how|help|tips|guide))\b/i,
        category: "Self-Harm Methods",
        reason: "Seeking information about self-harm — Discord may intervene with safety resources.",
    },
    {
        regex: /\b(?:how\s*to\s*(?:make|buy|create|synthesize|cook)\s*(?:meth|methamphetamine|fentanyl|heroin|cocaine|crack|lsd|mdma|ecstasy|bath\s*salt|synthetic?\s*cannabis|fent))\b/i,
        category: "Illegal Drug Manufacturing",
        reason: "Instructions for manufacturing illegal controlled substances — violates Discord ToS and criminal law.",
        replacements: [
            { word: /\bmeth(?:amphetamine)?\b/i, sfw: "chemistry" },
            { word: /\bfentanyl\b/i, sfw: "medication" },
            { word: /\bheroin\b/i, sfw: "substance" },
            { word: /\bcocaine\b/i, sfw: "substance" },
            { word: /\bcrack\b/i, sfw: "substance" },
            { word: /\blsd\b/i, sfw: "substance" },
            { word: /\bmdma\b/i, sfw: "substance" },
            { word: /\becstasy\b/i, sfw: "substance" },
        ],
    },
    {
        regex: /\b(?:buy|purchase|get|order|source)\s*(?:(?:il)?legal|black\s*market|dark\s*web|darknet)\s*(?:gun|firearm|weapon|bomb|explosive|drug|heroin|meth|fentanyl|cocaine|crack|ak[\s-]?47|ar[\s-]?15|handgun|silencer)\b/i,
        category: "Illegal Weapons / Drugs",
        reason: "Attempting to purchase illegal weapons or drugs — violates Discord ToS and may violate criminal law.",
    },
    {
        regex: /\b(?:hack|steal|crack|bypass)\s*(?:some)?one'?s?\s*(?:account|password|bank|credit\s*card|social\s*security|ssn|id|identity|wallet|crypto)\b/i,
        category: "Account Theft / Identity Crime",
        reason: "Discussing stealing or hacking into someone's account — violates Discord ToS.",
        replacements: [
            { word: /\bhack\b/i, sfw: "access" },
            { word: /\bsteal\b/i, sfw: "borrow" },
            { word: /\bcrack\b/i, sfw: "bypass" },
            { word: /\bbypass\b/i, sfw: "work around" },
        ],
    },
    {
        regex: /\b(?:revenge\s*porn|leaked\s*(?:nude|naked|sexy|explicit|porn|tape|video|photo|pic)|leak\s*(?:her|his|their|your|my)\s*(?:nude|naked|sexy|explicit|porn|tape|video|photo|pic)|without\s*(?:her|his|their|your|my)\s*(?:consent|permission|knowledge))\b/i,
        category: "Non-Consensual Intimate Imagery",
        reason: "Sharing intimate content without consent — violates Discord ToS and is illegal in many places.",
        replacements: [
            { word: /revenge\s*porn/i, sfw: "private content" },
            { word: /leaked\s*(?:nude|naked|sexy|explicit|porn)/i, sfw: "shared content" },
            { word: /without\s*(?:her|his|their|your|my)\s*consent/i, sfw: "without permission" },
        ],
    },
    {
        regex: /\b(?:nigga|nig(?:g|g)?er|fag(?:got)?|tranny|chink|spic|gook|kike|wetback|cracker|redskin|paki|coon|towel\s*head|camel\s*jockey|raghead|gypsy|retard|retarded|mongoloid|dumb\s*retard)\b/i,
        category: "Hate Speech / Slurs",
        reason: "Use of racial/ethnic slurs or hate speech — violates Discord Community Guidelines.",
        replacements: [
            { word: /\bnigga\b/i, sfw: "dark skinned mate" },
            { word: /\bnig(?:g|g)?er\b/i, sfw: "dark skinned person" },
            { word: /\bfag(?:got)?\b/i, sfw: "person" },
            { word: /\btranny\b/i, sfw: "trans person" },
            { word: /\bchink\b/i, sfw: "person" },
            { word: /\bspic\b/i, sfw: "person" },
            { word: /\bgook\b/i, sfw: "person" },
            { word: /\bkike\b/i, sfw: "person" },
            { word: /\bwetback\b/i, sfw: "person" },
            { word: /\bcracker\b/i, sfw: "person" },
            { word: /\bredskin\b/i, sfw: "person" },
            { word: /\bpaki\b/i, sfw: "person" },
            { word: /\bcoon\b/i, sfw: "person" },
            { word: /towel\s*head/i, sfw: "person" },
            { word: /camel\s*jockey/i, sfw: "person" },
            { word: /\braghead\b/i, sfw: "person" },
            { word: /\bgypsy\b/i, sfw: "traveler" },
            { word: /\bretard(?:ed)?\b/i, sfw: "silly" },
            { word: /dumb\s*retard/i, sfw: "silly" },
            { word: /\bmongoloid\b/i, sfw: "person" },
        ],
    },
    {
        regex: /\b(?:white\s*power|white\s*genocide|heil\s*hitler|nazi|reich|kkk|klan|aryan\s*suprem|black\s*power|israel\s*(?:must|should|will)\s*(?:die|be\s*destroyed)|kill\s*(?:all\s*)?(?:jews|blacks|whites|arabs|muslims|christians|hindus))\b/i,
        category: "Hate Speech / Extremism",
        reason: "Promoting hate speech or extremist ideologies — violates Discord ToS.",
        replacements: [
            { word: /white\s*power/i, sfw: "solidarity" },
            { word: /white\s*genocide/i, sfw: "demographic change" },
            { word: /heil\s*hitler/i, sfw: "historical reference" },
            { word: /\bnazi\b/i, sfw: "historical group" },
            { word: /\breich\b/i, sfw: "historical state" },
            { word: /\bkkk\b/i, sfw: "historical group" },
            { word: /\bklan\b/i, sfw: "historical group" },
            { word: /black\s*power/i, sfw: "solidarity" },
        ],
    },
    {
        regex: /\b(?:grabify|ip\s*log|ip\s*grab|token\s*grab|token\s*log|steal\s*tokens|steal\s*passwords|phishing?\s*link|fake\s*login|fake\s*discord|fake\s*nitro|nitro\s*scam|nitro\s*generator|free\s*nitro\s*(?:here|link|click|giveaway|generator))\b/i,
        category: "Malware / Phishing / Scams",
        reason: "Sharing tools or links designed to steal accounts — violates Discord ToS.",
        replacements: [
            { word: /\bgrabify\b/i, sfw: "link tracker" },
            { word: /ip\s*log/i, sfw: "ip checker" },
            { word: /ip\s*grab/i, sfw: "ip checker" },
            { word: /token\s*grab/i, sfw: "account access" },
            { word: /phishing?\s*link/i, sfw: "suspicious link" },
            { word: /fake\s*nitro/i, sfw: "not real nitro" },
            { word: /nitro\s*scam/i, sfw: "not real nitro" },
            { word: /nitro\s*generator/i, sfw: "fake nitro tool" },
            { word: /free\s*nitro/i, sfw: "not real nitro" },
        ],
    },
    {
        regex: /\b(?:malware|virus|trojan|keylog|ransomware|cryptolocker|rootkit|backdoor|remote\s*access\s*trojan|rat\s*(?:virus|malware|download))\b/i,
        category: "Malware Distribution",
        reason: "Discussing or distributing malware — violates Discord ToS and may be criminal.",
        replacements: [
            { word: /\bmalware\b/i, sfw: "harmful software" },
            { word: /\bvirus\b/i, sfw: "harmful code" },
            { word: /\btrojan\b/i, sfw: "hidden malware" },
            { word: /\bkeylog(?:ger)?\b/i, sfw: "input monitor" },
            { word: /\bransomware\b/i, sfw: "encryption malware" },
            { word: /\brootkit\b/i, sfw: "hidden software" },
            { word: /\bbackdoor\b/i, sfw: "hidden access" },
        ],
    },
    {
        regex: /\b(?:gore|decapitat|beheading|live\s*leak|(?:live)?leak\s*(?:video|gore|death)|crackhead|suicide\s*(?:video|note|footage)|snuff|execution\s*(?:video|footage)|torture\s*(?:video|gore|porn))\b/i,
        category: "Gore / Extreme Violence",
        reason: "Sharing or requesting gore, execution, or torture content — violates Discord ToS.",
        replacements: [
            { word: /\bgore\b/i, sfw: "graphic content" },
            { word: /decapitat/i, sfw: "historical event" },
            { word: /beheading/i, sfw: "historical event" },
            { word: /live\s*leak/i, sfw: "archived video" },
            { word: /leak\s*video/i, sfw: "shared video" },
            { word: /\bcrackhead\b/i, sfw: "struggling person" },
            { word: /suicide\s*(?:video|note|footage)/i, sfw: "tragic content" },
            { word: /\bsnuff\b/i, sfw: "extreme content" },
            { word: /execution\s*video/i, sfw: "historical footage" },
            { word: /torture\s*video/i, sfw: "disturbing content" },
        ],
    },
    {
        regex: /\b(?:rape|rapist|sexual\s*assault|forced\s*sex|non[- ]consensual|consent(?:ual)?\s*(?:sex|rape|abuse))\b/i,
        category: "Sexual Violence",
        reason: "References to sexual violence — violates Discord ToS and is criminal behavior.",
        replacements: [
            { word: /\brape\b/i, sfw: "assault" },
            { word: /\brapist\b/i, sfw: "assailant" },
            { word: /sexual\s*assault/i, sfw: "assault" },
            { word: /forced\s*sex/i, sfw: "non-consensual act" },
        ],
    },
    {
        regex: /\b(?:animal\s*(?:abuse|torture|kill|rape|crush|bestiality|zoophilia)|pet\s*(?:abuse|torture|kill))\b/i,
        category: "Animal Abuse",
        reason: "Content depicting or promoting animal abuse — violates Discord ToS.",
        replacements: [
            { word: /animal\s*abuse/i, sfw: "animal mistreatment" },
            { word: /animal\s*torture/i, sfw: "animal mistreatment" },
            { word: /pet\s*abuse/i, sfw: "pet mistreatment" },
            { word: /\bbestiality\b/i, sfw: "inappropriate behavior" },
        ],
    },
    {
        regex: /\b(?:raid|nuke|spam)\s*(?:server|guild|channel|group)\b/i,
        category: "Platform Abuse",
        reason: "Organizing raids, server nuking, or spam attacks — violates Discord ToS.",
        replacements: [
            { word: /raid\s*(?:server|guild|channel|group)/i, sfw: "visit the community" },
            { word: /nuke\s*(?:server|guild|channel|group)/i, sfw: "clean the server" },
            { word: /spam\s*(?:server|guild|channel|group)/i, sfw: "flood the server" },
        ],
    },
];
// Strict mode patterns
const STRICT_PATTERNS = [
    {
        regex: /\b(?:die|death|dead|kill|murder|destroy|annihilate|eliminate)\b.{0,20}\b(?:you|him|her|them|ur|ya)\b/i,
        category: "Violent Language",
        reason: "Violent language directed at someone — may violate Discord Community Guidelines.",
        replacements: [
            { word: /die\b.{0,20}(?:you|him|her|them)/i, sfw: "disagree with you" },
            { word: /kill\b.{0,20}(?:you|him|her|them)/i, sfw: "argue with you" },
            { word: /murder\b.{0,20}(?:you|him|her|them)/i, sfw: "strongly disagree with you" },
        ],
    },
    {
        regex: /\b(?:fuck\s*(?:you|off|up|yourself)|shit|bitch|ass(?:hole)?|damn|hell)\b.{0,10}\b(?:you|him|her|them)\b/i,
        category: "Abusive Language",
        reason: "Abusive or harassing language directed at someone.",
        replacements: [
            { word: /fuck\s*you/i, sfw: "fudge you" },
            { word: /fuck\s*off/i, sfw: "go away" },
            { word: /fuck\s*up/i, sfw: "mess up" },
            { word: /fuck\s*yourself/i, sfw: "be kind to yourself" },
            { word: /\bshit\b/i, sfw: "stuff" },
            { word: /\bbitch\b/i, sfw: "person" },
            { word: /\bass(?:hole)?\b/i, sfw: "jerk" },
            { word: /\bdamn\b/i, sfw: "darn" },
            { word: /\bhell\b/i, sfw: "heck" },
        ],
    },
];
function checkMessageForViolations(content) {
    const violations = [];
    const patterns = [
        ...VIOLATION_PATTERNS,
        ...(settings.store.strictMode ? STRICT_PATTERNS : []),
    ];
    for (const pattern of patterns) {
        if (pattern.regex.test(content)) {
            violations.push(pattern);
        }
    }
    return violations;
}
function toAsterisks(str) {
    return str.replace(/[^\s]/g, "*");
}
function censorContent(content, violations) {
    const action = settings.store.actionOnViolation;
    let modified = content;
    for (const violation of violations) {
        if (violation.replacements && violation.replacements.length > 0) {
            // Has specific word-level replacements
            for (const rep of violation.replacements) {
                if (rep.word.test(modified)) {
                    if (action === "censor") {
                        // Replace each match with asterisks, preserving spaces
                        modified = modified.replace(rep.word, match => toAsterisks(match));
                    }
                    else if (action === "replace") {
                        modified = modified.replace(rep.word, rep.sfw);
                    }
                }
            }
        }
        else {
            // No specific replacements — censor the whole match
            const match = modified.match(violation.regex);
            if (match) {
                if (action === "censor") {
                    modified = modified.replace(violation.regex, m => toAsterisks(m));
                }
                else if (action === "replace") {
                    modified = modified.replace(violation.regex, "[content removed by RobloxFilter]");
                }
            }
        }
    }
    return { newContent: modified, censored: modified !== content };
}
async function onBeforeMessageSend(channelId, messageObj) {
    const { content } = messageObj;
    if (!content || content.trim().length === 0)
        return;
    if (!settings.store.filterEnabled)
        return;
    if (settings.store.allowOverride) {
        const modifierKeys = FluxDispatcher._subscriptions?.MODIFIER_KEY_EVENT?.[0]?.();
        if (modifierKeys?.shiftKey) {
            Flogger.warn("Shift override detected — allowing message through");
            return;
        }
    }
    const violations = checkMessageForViolations(content);
    if (violations.length === 0)
        return;
    const categories = [...new Set(violations.map(v => v.category))];
    const action = settings.store.actionOnViolation;
    if (action === "block") {
        // BLOCK: Cancel the send entirely
        if (settings.store.logBlockedMessages) {
            Flogger.error("BLOCKED MESSAGE — Violations:", categories.join(", "));
            Flogger.error("Content preview:", content.substring(0, 100) + (content.length > 100 ? "..." : ""));
        }
        if (settings.store.showWarningToast) {
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
                message: `🛡️ Message blocked: ${categories.join(", ")}`,
            });
        }
        if (settings.store.showWarningNotification) {
            showNotification({
                title: "🛡️ RobloxFilter — Message Blocked",
                body: `Blocked for: ${categories.join(", ")}`,
                color: "#ff0000",
            });
        }
        return { cancel: true };
    }
    const { newContent, censored } = censorContent(content, violations);
    if (censored) {
        messageObj.content = newContent;
        if (settings.store.logBlockedMessages) {
            Flogger.warn(`${action.toUpperCase()} APPLIED — Violations:`, categories.join(", "));
            Flogger.warn("Original:", content.substring(0, 100));
            Flogger.warn("Modified:", newContent.substring(0, 100));
        }
        if (settings.store.showWarningToast) {
            const actionLabel = action === "censor" ? "censored" : "replaced";
            Toasts.show({
                id: Toasts.genId(),
                type: Toasts.Type.MESSAGE,
                message: `🛡️ Message ${actionLabel}: ${categories.join(", ")}`,
            });
        }
        if (settings.store.showWarningNotification) {
            const actionLabel = action === "censor" ? "Censored" : "Replaced";
            showNotification({
                title: `🛡️ RobloxFilter — Message ${actionLabel}`,
                body: `${actionLabel} for: ${categories.join(", ")}`,
                color: "#ffaa00",
            });
        }
    }
    return { cancel: false };
}
export default definePlugin({
    name: "RobloxFilter",
    description: "Protects your main account by filtering messages that violate Discord's ToS. Block, censor with asterisks, or SFW-replace offensive content. Named RobloxFilter because it sounds funny.",
    tags: ["Fun", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,
    onBeforeMessageSend,
});
