import { ftch, LunaUnload, Tracer } from "@luna/core";
import { redux } from "@luna/lib";
import { languages, settings, Settings } from "./Settings";

export const { trace } = Tracer("[Translate]");
export const unloads = new Set<LunaUnload>();
export { Settings };
// thanks to meowarex
const createTranslateButton = () => {
    if (settings.alwaysTranslate) return;
    const reqFS = document.querySelector('[data-test="request-fullscreen"]');
    const parent = reqFS?.parentElement;
    if (!parent) {
        setTimeout(() => createTranslateButton(), 1000);
        return;
    }
    if (parent.querySelector(".translate-button")) return;
    const button = document.createElement("button");
    button.className = reqFS.classList.toString() + " translate-button";
    const text = "Translate Lyrics";
    button.innerText = text;
    button.setAttribute('aria-label', text);
    button.setAttribute('title', text);
    button.addEventListener('click', handleTranslate);
    parent.insertBefore(button, reqFS.nextSibling);
}

createTranslateButton();


interface GoogleData {
    src: string;
    sentences: {
        trans: string;
        orig: string;
        src_translit?: string;
    }[];
}

async function translate(text: string, targetLang: string = 'en', romanize = false): Promise<GoogleData> {
    const params = new URLSearchParams({
        client: 'gtx',
        sl: 'auto',
        tl: targetLang,
        dt: romanize ? 'rm' : 't',
        dj: '1',
        q: text
    });
    return ftch.json<GoogleData>(`https://translate.googleapis.com/translate_a/single?${params.toString()}`)
}

let currentLyrics: redux.Lyrics | null = null;

redux.intercept('content/LOAD_ITEM_LYRICS_SUCCESS', unloads, (payload) => {
    currentLyrics = payload;
    if (settings.alwaysTranslate) {
        handleTranslate();
        return true;
    } else {
        createTranslateButton();
    }
})

redux.intercept('content/LOAD_ITEM_LYRICS_FAIL', unloads, () => {
    currentLyrics = null;
})

async function processLyrics(
    lyrics: redux.Lyrics,
    targetLang: string,
): Promise<redux.Lyrics | null> {
    if (!lyrics) return null;

    try {
        const translatedLyricsData = await translate(lyrics.lyrics, targetLang, settings.romanize);
        const translatedLyrics = translatedLyricsData.sentences
            .map(sentence => sentence.trans)
            .join('');

        const originalLines = lyrics.lyrics.split('\n');
        const translatedLines = translatedLyrics.split('\n');
        const translationMap = new Map<string, string>();

        for (let i = 0; i < Math.min(originalLines.length, translatedLines.length); i++) {
            const original = originalLines[i].trim();
            const translated = translatedLines[i].trim();
            if (original) {
                translationMap.set(original, translated);
            }
        }

        const translatedSubtitlesText = lyrics.subtitles?.split("\n").map(subtitle => {
            const timestampMatch = subtitle.match(/^\[[\d:.]+\]\s*/);
            if (timestampMatch) {
                const timestamp = timestampMatch[0];
                const text = subtitle.substring(timestamp.length).trim();

                if (text) {
                    const translatedText = translationMap.get(text) || text;
                    return timestamp + translatedText;
                }
            }
            return subtitle;
        }).join("\n");
        return {
            ...lyrics,
            lyrics: translatedLyrics,
            subtitles: translatedSubtitlesText,
            isRightToLeft: settings.targetLanguage ? languages.find(lang => lang.value === settings.targetLanguage)?.rightToLeft ?? false : false,
        };
    } catch (error) {
        trace.msg.err('Error translating lyrics:', error);
        return null;
    }
}



async function handleTranslate() {
    if (!currentLyrics) {
        // 1. Lo registramos como un error en la consola en lugar de un log normal
        trace.msg.err('No lyrics available to translate');

        // 2. Mostramos una alerta emergente en la pantalla
        alert('Error: No hay letras disponibles para traducir en este momento.');

        // 3. (Opcional pero recomendado) Cambiamos el texto del botón visualmente por 2 segundos
        const btn = document.querySelector('.translate-button') as HTMLButtonElement;
        if (btn) {
            const originalText = btn.innerText;
            btn.innerText = "❌ No lyrics found";
            btn.style.backgroundColor = "#ff4c4c"; // Cambiamos el fondo a un tono rojo (opcional)
            
            setTimeout(() => { 
                btn.innerText = originalText; 
                btn.style.backgroundColor = ""; // Restauramos el color original
            }, 2000);
        }
        
        return;
    }

    try {
        const translatedLyrics = await processLyrics(currentLyrics, settings.targetLanguage ?? 'en');
        if (translatedLyrics) {
            // force refresh
            await redux.actions["content/LOAD_ITEM_LYRICS_FAIL"]({
                itemId: currentLyrics.trackId,
            });
            await redux.actions["content/LOAD_ITEM_LYRICS_SUCCESS"](translatedLyrics);
            trace.msg.log('Lyrics translated successfully');
        } else {
            trace.msg.err('Failed to translate lyrics');
        }
    } catch (error) {
        trace.msg.err('Failed to translate:', error);
    }
}