/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { definePluginSettings } from "@api/Settings";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, Toasts, UserStore } from "@webpack/common";
const languageKeywords = {
    es: [
        "hola", "gracias", "adios", "adiós", "como", "cómo", "que", "qué",
        "estoy", "buenos dias", "buenos días", "buenas noches", "por favor",
        "chau", "boludo", "che", "vos", "argentina", "tambien", "también",
        "despues", "después", "esta", "está", "siempre", "nunca", "ahora",
        "nosotros", "ustedes", "vosotros", "ellos", "ellas", "pero", "porque",
        "cuando", "donde", "dónde", "cuándo", "quiero", "puedo", "tengo",
        "hacer", "decir", "saber", "poder", "tener", "llegar", "pasar",
        "mucho", "poco", "todo", "nada", "algo", "alguien", "nadie",
        "bueno", "malo", "grande", "pequeño", "nuevo", "viejo", "primero"
    ],
    en: [
        "hello", "hi there", "good morning", "good night", "good evening",
        "please", "thank you", "thanks", "you're", "i'm", "i am", "what is",
        "how are", "nice to meet", "what are", "where is", "when is",
        "because", "however", "although", "therefore", "meanwhile",
        "everyone", "someone", "anyone", "nothing", "something", "everything",
        "always", "never", "sometimes", "usually", "often", "already",
        "really", "actually", "basically", "literally", "probably"
    ],
    tr: [
        "merhaba", "selam", "günaydın", "iyi geceler", "iyi akşamlar",
        "teşekkürler", "teşekkür ederim", "lütfen", "evet", "hayır",
        "nasılsın", "nasıl", "nerede", "nereye", "neden", "niçin",
        "tamam", "tabii", "elbette", "belki", "bazen", "her zaman",
        "hiçbir zaman", "şimdi", "sonra", "önce", "bugün", "yarın",
        "dün", "buraya", "oraya", "burası", "orası", "bence", "sence",
        "bilmiyorum", "biliyorum", "istiyorum", "istemiyorum", "yapıyorum",
        "yapıyorsun", "gidiyorum", "geliyorum", "görüşürüz", "hoşçakal",
        "arkadaş", "kardeş", "abi", "abla", "hocam", "yani", "falan",
        "filan", "aslında", "zaten", "hep", "hiç", "çok", "az", "daha",
        "çünkü", "ama", "fakat", "lakin", "ancak", "oysa", "halbuki",
        "değil", "gibi", "kadar", "için", "ile", "den", "dan", "ten",
        "nasılsınız", "güzel", "iyi", "kötü", "büyük", "küçük", "yeni",
        "eski", "hızlı", "yavaş", "kolay", "zor", "seni", "beni", "biz",
        "siz", "onlar", "ben", "sen", "türkiye", "türk"
    ],
    pt: [
        "olá", "ola", "obrigado", "obrigada", "bom dia", "boa noite",
        "boa tarde", "por favor", "você", "voce", "tudo bem", "tchau",
        "até logo", "ate logo", "como vai", "onde está", "quando",
        "porque", "também", "tambem", "sempre", "nunca", "agora",
        "depois", "antes", "hoje", "amanhã", "amanha", "ontem",
        "aqui", "ali", "muito", "pouco", "tudo", "nada",
        "alguém", "alguem", "ninguém", "ninguem", "bom", "mau", "grande",
        "pequeno", "novo", "velho", "quero", "posso", "tenho", "fazer",
        "saber", "poder", "ter", "brasil", "português"
    ],
    fr: [
        "bonjour", "bonsoir", "merci", "au revoir", "s'il vous plaît",
        "s'il te plaît", "comment", "enchanté", "enchante", "excusez",
        "pardon", "désolé", "desole", "oui", "non", "peut-être",
        "toujours", "jamais", "maintenant", "après", "avant", "aujourd'hui",
        "demain", "hier", "ici", "beaucoup", "peu", "tout", "rien",
        "quelqu'un", "personne", "bon", "mauvais", "grand", "petit",
        "nouveau", "vieux", "vouloir", "pouvoir", "savoir", "faire",
        "france", "français", "française"
    ],
    de: [
        "hallo", "guten tag", "guten morgen", "gute nacht", "guten abend",
        "danke", "bitte", "auf wiedersehen", "tschüss", "tschuss",
        "wie geht", "wo ist", "wann", "warum", "weil", "obwohl",
        "immer", "niemals", "manchmal", "jetzt", "nachher", "vorher",
        "heute", "morgen", "gestern", "hier", "dort", "sehr", "wenig",
        "alles", "nichts", "jemand", "niemand", "gut", "schlecht",
        "groß", "gross", "klein", "neu", "alt", "wollen", "können",
        "wissen", "machen", "deutschland", "deutsch", "österreich"
    ],
    it: [
        "ciao", "buongiorno", "buonasera", "buonanotte", "grazie",
        "prego", "per favore", "arrivederci", "come stai", "salve",
        "dove", "quando", "perché", "perche", "sempre", "mai",
        "adesso", "dopo", "prima", "oggi", "domani", "ieri",
        "qui", "molto", "poco", "tutto", "niente",
        "qualcuno", "nessuno", "buono", "cattivo", "grande", "piccolo",
        "nuovo", "vecchio", "volere", "potere", "sapere", "fare",
        "italia", "italiano", "italiana"
    ],
    ru: [
        "привет", "здравствуйте", "спасибо", "пожалуйста", "доброе утро",
        "добрый вечер", "добрый день", "как дела", "пока", "до свидания",
        "где", "когда", "почему", "потому что", "всегда", "никогда",
        "сейчас", "потом", "раньше", "сегодня", "завтра", "вчера",
        "здесь", "там", "очень", "мало", "всё", "ничего", "кто-то",
        "никто", "хорошо", "плохо", "большой", "маленький", "новый",
        "старый", "хотеть", "мочь", "знать", "делать", "россия", "русский"
    ],
    ja: [
        "こんにちは", "おはよう", "おはようございます", "こんばんは",
        "ありがとう", "ありがとうございます", "すみません", "ごめんなさい",
        "はい", "いいえ", "どこ", "いつ", "なぜ", "どうして",
        "いつも", "ぜったい", "いま", "あとで", "まえに", "きょう",
        "あした", "きのう", "ここ", "そこ", "あそこ", "とても",
        "すこし", "ぜんぶ", "なにも", "だれか", "だれも", "いい",
        "わるい", "おおきい", "ちいさい", "あたらしい", "ふるい",
        "さようなら", "またね", "よろしく", "どうぞ", "はじめまして",
        "日本", "日本語"
    ],
    zh: [
        "你好", "早上好", "晚上好", "下午好", "谢谢", "不客气",
        "请", "对不起", "没关系", "是", "不是", "在哪里", "什么时候",
        "为什么", "因为", "总是", "从不", "现在", "以后", "之前",
        "今天", "明天", "昨天", "这里", "那里", "很", "一点",
        "一切", "没有", "有人", "没人", "好", "不好", "大", "小",
        "新", "旧", "想要", "可以", "知道", "做", "再见", "拜拜",
        "中国", "中文", "普通话"
    ],
    ko: [
        "안녕하세요", "안녕", "좋은 아침", "좋은 저녁", "감사합니다",
        "고마워", "천만에요", "부탁합니다", "미안해요", "괜찮아요",
        "네", "아니요", "어디", "언제", "왜", "항상", "절대",
        "지금", "나중에", "전에", "오늘", "내일", "어제", "여기",
        "거기", "매우", "조금", "모든", "없음", "누군가", "아무도",
        "좋아", "나쁘다", "크다", "작다", "새로운", "오래된",
        "안녕히 가세요", "또 만나요", "처음 뵙겠습니다", "한국", "한국어"
    ],
    ar: [
        "مرحبا", "صباح الخير", "مساء الخير", "شكرا", "عفوا",
        "من فضلك", "آسف", "نعم", "لا", "أين", "متى", "لماذا",
        "دائما", "أبدا", "الآن", "بعد", "قبل", "اليوم", "غدا",
        "أمس", "هنا", "هناك", "جدا", "قليل", "كل شيء", "لا شيء",
        "شخص ما", "لا أحد", "جيد", "سيئ", "كبير", "صغير",
        "جديد", "قديم", "مع السلامة", "إلى اللقاء", "أهلا وسهلا",
        "العربية", "عربي"
    ],
    hi: [
        "नमस्ते", "नमस्कार", "सुप्रभात", "शुभ रात्रि", "धन्यवाद",
        "कृपया", "माफ करना", "हाँ", "नहीं", "कहाँ", "कब", "क्यों",
        "हमेशा", "कभी नहीं", "अभी", "बाद में", "पहले", "आज",
        "कल", "यहाँ", "वहाँ", "बहुत", "थोड़ा", "सब कुछ", "कुछ नहीं",
        "कोई", "अच्छा", "बुरा", "बड़ा", "छोटा", "नया", "पुराना",
        "अलविदा", "फिर मिलेंगे", "भारत", "हिंदी"
    ],
    pl: [
        "cześć", "dzień dobry", "dobry wieczór", "dobranoc", "dziękuję",
        "proszę", "przepraszam", "tak", "nie", "gdzie", "kiedy", "dlaczego",
        "zawsze", "nigdy", "teraz", "później", "wcześniej", "dzisiaj",
        "jutro", "wczoraj", "tutaj", "tam", "bardzo", "trochę", "wszystko",
        "nic", "ktoś", "nikt", "dobry", "zły", "duży", "mały", "nowy",
        "stary", "chcieć", "móc", "wiedzieć", "robić", "do widzenia",
        "polska", "polski"
    ],
    nl: [
        "hallo", "goedemorgen", "goedenavond", "goedenacht", "dank je",
        "dank u", "alsjeblieft", "sorry", "ja", "nee", "waar", "wanneer",
        "waarom", "altijd", "nooit", "nu", "later", "eerder", "vandaag",
        "morgen", "gisteren", "hier", "daar", "heel", "weinig", "alles",
        "niets", "iemand", "niemand", "goed", "slecht", "groot", "klein",
        "nieuw", "oud", "willen", "kunnen", "weten", "doen", "tot ziens",
        "nederland", "nederlands", "belgië"
    ],
};
const settings = definePluginSettings({
    enabled: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Enable or disable automatic blocking",
        default: true,
    },
    bannedLanguage: {
        type: 4 /* OptionType.SELECT */,
        description: "Language to automatically block",
        options: [
            { label: "Spanish", value: "es" },
            { label: "English", value: "en" },
            { label: "Turkish", value: "tr" },
            { label: "Portuguese", value: "pt" },
            { label: "French", value: "fr" },
            { label: "German", value: "de" },
            { label: "Italian", value: "it" },
            { label: "Russian", value: "ru" },
            { label: "Japanese", value: "ja" },
            { label: "Chinese", value: "zh" },
            { label: "Korean", value: "ko" },
            { label: "Arabic", value: "ar" },
            { label: "Hindi", value: "hi" },
            { label: "Polish", value: "pl" },
            { label: "Dutch", value: "nl" },
        ],
        default: "tr",
    },
    minMatches: {
        type: 1 /* OptionType.NUMBER */,
        description: "Minimum keyword matches required to trigger a block (recommended: 2-3)",
        default: 2,
    },
    blockBots: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Also block bots that write in the selected language (not recommended)",
        default: false,
    },
    logToConsole: {
        type: 3 /* OptionType.BOOLEAN */,
        description: "Log detection info to the browser console (useful for debugging)",
        default: false,
    },
});
const RelationshipActions = findByPropsLazy("addRelationship", "removeRelationship");
function detectLanguage(content, lang, minMatches) {
    const keywords = languageKeywords[lang];
    if (!keywords || keywords.length === 0)
        return false;
    const normalized = content.toLowerCase().trim();
    let matches = 0;
    for (const keyword of keywords) {
        if (normalized.includes(keyword)) {
            matches++;
            if (matches >= minMatches)
                return true;
        }
    }
    return false;
}
const handleMessage = (payload) => {
    if (!settings.store.enabled)
        return;
    const { message } = payload;
    if (!message?.content || !message?.author)
        return;
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || message.author.id === currentUser.id)
        return;
    if (message.author.bot && !settings.store.blockBots)
        return;
    if (message.content.trim().length < 3)
        return;
    const { bannedLanguage, minMatches, logToConsole } = settings.store;
    const detected = detectLanguage(message.content, bannedLanguage ?? "", minMatches);
    if (logToConsole) {
        console.log(`[AutoLanguageBlock] Message from ${message.author.username}: "${message.content}" → Detected: ${detected}`);
    }
    if (!detected)
        return;
    if (RelationshipActions?.addRelationship) {
        try {
            RelationshipActions.addRelationship({ userId: message.author.id, type: 2 });
            const displayName = message.author.globalName ?? message.author.username;
            Toasts.show({
                message: `🚫 Blocked: ${displayName} (detected language: ${(bannedLanguage ?? "").toUpperCase()})`,
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
        }
        catch (err) {
            console.error("[AutoLanguageBlock] Failed to block user:", err);
            Toasts.show({
                message: "❌ An error occurred while trying to block the user",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId(),
            });
        }
    }
    else {
        Toasts.show({
            message: "❌ RelationshipActions API not available",
            type: Toasts.Type.FAILURE,
            id: Toasts.genId(),
        });
    }
};
function AboutComponent() {
    return (<div style={{ marginBottom: "8px" }}>
            <p style={{ color: "var(--header-primary)", fontWeight: 500, marginBottom: "12px" }}>
                Automatically blocks users based on the language they type using keyword detection.
            </p>
            <div style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            cursor: "pointer",
            color: "var(--text-link)",
            fontWeight: 600,
        }} onClick={() => window.open("https://github.com/Mixiruri", "_blank")}>
                <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="GitHub" style={{ width: 20, height: 20, borderRadius: "50%" }}/>
                Mixiruri on GitHub
            </div>
        </div>);
}
export default definePlugin({
    name: "AutoLanguageBlock",
    description: "Automatically blocks users who write in the configured language by detecting keywords in their messages.",
    tags: ["Servers", "Utility"],
    authors: [{ name: "nnenaza", id: 1485706082080002140n }],
    settings,
    settingsAboutComponent: AboutComponent,
    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessage);
    },
    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessage);
    },
});
