/**
 * Kokoro TTS Web Worker — keeps WASM inference off the UI thread.
 *
 * Messages in:
 *   { type: 'init', modelBase, requestId }
 *   { type: 'synthesize', text, voice, speed, generationId, requestId }
 *   { type: 'cancel', generationId }
 *
 * Messages out:
 *   { type: 'progress', progress, requestId }
 *   { type: 'ready', requestId }
 *   { type: 'chunk', samples, sampleRate, generationId, requestId }
 *   { type: 'done', generationId, requestId }
 *   { type: 'error', error, requestId, generationId? }
 */
import { KokoroTTS } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';

const KOKORO_MODEL_ID = 'Kokoro-82M-v1.0-ONNX';
const HF_HOST_MARKERS = [
    `huggingface.co/onnx-community/${KOKORO_MODEL_ID}/resolve/main/`,
    `huggingface.co/onnx-community/${KOKORO_MODEL_ID}/resolve/refs%2Fheads%2Fmain/`,
];

// Prefer larger pieces so speech is continuous; only split when near Kokoro's token limit
const MAX_CHUNK_CHARS = 520;

let modelBase = '';
let tts = null;
let activeGenerationId = 0;
let fetchPatched = false;

function rewriteHuggingFaceUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string' || !modelBase) return null;
    const bare = rawUrl.split('#')[0].split('?')[0];
    for (const marker of HF_HOST_MARKERS) {
        const idx = bare.indexOf(marker);
        if (idx !== -1) {
            return modelBase + bare.slice(idx + marker.length);
        }
    }
    return null;
}

function installModelFetchRewrite() {
    if (fetchPatched) return;
    fetchPatched = true;
    const originalFetch = self.fetch.bind(self);
    self.fetch = function kokoroAwareFetch(input, init) {
        try {
            const raw = typeof input === 'string'
                ? input
                : (input && typeof input.url === 'string' ? input.url : '');
            const rewritten = rewriteHuggingFaceUrl(raw);
            if (rewritten) {
                if (typeof input === 'string') return originalFetch(rewritten, init);
                return originalFetch(new Request(rewritten, input), init);
            }
        } catch (_) {
            // fall through
        }
        return originalFetch(input, init);
    };
}

/** Split only when a quarter is too long for one generate() call. */
function splitForSynthesis(text, maxLen = MAX_CHUNK_CHARS) {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    if (trimmed.length <= maxLen) return [trimmed];

    const sentences = trimmed.match(/[^.!?]+[.!?]*\s*/g) || [trimmed];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        const piece = sentence.trim();
        if (!piece) continue;
        if (current && (current + ' ' + piece).length > maxLen) {
            chunks.push(current);
            current = piece;
        } else {
            current = current ? `${current} ${piece}` : piece;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

async function ensureModel(requestId) {
    if (tts) return tts;
    installModelFetchRewrite();
    tts = await KokoroTTS.from_pretrained(`onnx-community/${KOKORO_MODEL_ID}`, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (progress) => {
            self.postMessage({ type: 'progress', progress, requestId });
        },
    });
    return tts;
}

self.onmessage = async (event) => {
    const msg = event.data || {};
    const { type, requestId } = msg;

    try {
        if (type === 'init') {
            modelBase = msg.modelBase || '';
            if (!modelBase.endsWith('/')) modelBase += '/';
            await ensureModel(requestId);
            self.postMessage({ type: 'ready', requestId });
            return;
        }

        if (type === 'cancel') {
            activeGenerationId = msg.generationId || (activeGenerationId + 1);
            return;
        }

        if (type === 'synthesize') {
            const { text, voice, speed, generationId } = msg;
            activeGenerationId = generationId;
            const model = await ensureModel(requestId);
            if (generationId !== activeGenerationId) return;

            const chunks = splitForSynthesis(text);
            for (const chunk of chunks) {
                if (generationId !== activeGenerationId) return;

                const audio = await model.generate(chunk, {
                    voice: voice || 'af_heart',
                    speed: speed || 1,
                });
                if (generationId !== activeGenerationId) return;

                const samples = audio?.audio || audio;
                if (!samples || !samples.length) continue;
                const sampleRate = audio?.sampling_rate || 24000;
                const copy = samples instanceof Float32Array
                    ? samples.slice()
                    : Float32Array.from(samples);

                self.postMessage(
                    {
                        type: 'chunk',
                        samples: copy,
                        sampleRate,
                        generationId,
                        requestId,
                    },
                    [copy.buffer]
                );
            }

            if (generationId === activeGenerationId) {
                self.postMessage({ type: 'done', generationId, requestId });
            }
            return;
        }
    } catch (err) {
        self.postMessage({
            type: 'error',
            error: err?.message || String(err),
            requestId,
            generationId: msg.generationId,
        });
    }
};
