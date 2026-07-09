/**
 * Main-thread bridge to the Kokoro Web Worker.
 * Keeps WASM inference off the UI thread so the page stays responsive.
 */
(function () {
    const KOKORO_MODEL_ID = 'Kokoro-82M-v1.0-ONNX';

    let worker = null;
    let readyPromise = null;
    let requestSeq = 0;
    const pending = new Map(); // requestId -> { resolve, reject, onProgress, onChunk, onDone }

    function modelBaseUrl() {
        return new URL(`models/${KOKORO_MODEL_ID}/`, window.location.href).href;
    }

    function getWorker() {
        if (worker) return worker;
        worker = new Worker(new URL('kokoro-worker.js', window.location.href), { type: 'module' });
        worker.onmessage = (event) => {
            const msg = event.data || {};
            const entry = pending.get(msg.requestId);

            if (msg.type === 'progress' && entry?.onProgress) {
                entry.onProgress(msg.progress);
                return;
            }
            if (msg.type === 'ready' && entry) {
                pending.delete(msg.requestId);
                entry.resolve();
                return;
            }
            if (msg.type === 'chunk' && entry?.onChunk) {
                entry.onChunk(msg.samples, msg.sampleRate, msg.generationId);
                return;
            }
            if (msg.type === 'done' && entry) {
                pending.delete(msg.requestId);
                if (entry.onDone) entry.onDone(msg.generationId);
                entry.resolve();
                return;
            }
            if (msg.type === 'error') {
                if (entry) {
                    pending.delete(msg.requestId);
                    entry.reject(new Error(msg.error || 'Kokoro worker error'));
                }
                return;
            }
        };
        worker.onerror = (err) => {
            console.error('Kokoro worker error:', err);
            for (const [, entry] of pending) {
                entry.reject(new Error(err.message || 'Kokoro worker failed'));
            }
            pending.clear();
            readyPromise = null;
            worker = null;
        };
        return worker;
    }

    function nextRequestId() {
        requestSeq += 1;
        return requestSeq;
    }

    window.loadKokoroTTS = function loadKokoroTTS(progressCallback) {
        if (readyPromise) return readyPromise;

        readyPromise = new Promise((resolve, reject) => {
            const requestId = nextRequestId();
            pending.set(requestId, {
                resolve: () => resolve(window.__kokoroWorkerApi),
                reject: (err) => {
                    readyPromise = null;
                    reject(err);
                },
                onProgress: progressCallback || null,
            });
            getWorker().postMessage({
                type: 'init',
                modelBase: modelBaseUrl(),
                requestId,
            });
        });

        return readyPromise;
    };

    window.__kokoroWorkerApi = {
        synthesize(text, { voice, speed, generationId, onChunk } = {}) {
            return new Promise((resolve, reject) => {
                const requestId = nextRequestId();
                pending.set(requestId, {
                    resolve,
                    reject,
                    onChunk: onChunk || null,
                    onDone: () => {},
                });
                getWorker().postMessage({
                    type: 'synthesize',
                    text,
                    voice: voice || 'af_heart',
                    speed: speed || 1,
                    generationId,
                    requestId,
                });
            });
        },
        cancel(generationId) {
            if (!worker) return;
            // Reject in-flight synthesize promises for this generation
            for (const [id, entry] of pending) {
                if (entry.onChunk) {
                    pending.delete(id);
                    entry.resolve(); // cancelled cleanly — caller checks generationId
                }
            }
            worker.postMessage({ type: 'cancel', generationId });
        },
    };
})();
