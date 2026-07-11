//main.js


function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function showAudioLoading() {
    const el = document.getElementById('audio-loading-progress');
    if (el) {
        el.classList.remove('hidden');
        el.setAttribute('aria-hidden', 'false');
    }
}

function hideAudioLoading() {
    const el = document.getElementById('audio-loading-progress');
    if (el) {
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
    }
}

let messageHideTimeoutId = null;
const MESSAGE_DEBOUNCE_MS = 2500;
let lastMessageText = '';
let lastMessageColor = '';
let lastMessageTime = 0;
const MESSAGE_COLOR_CLASSES = ['red', 'green', 'blue'];

function showMessage(message, color, duration = 5000) {
    const now = Date.now();
    if (message === lastMessageText && color === lastMessageColor && (now - lastMessageTime) < MESSAGE_DEBOUNCE_MS) {
        return;
    }
    lastMessageText = message;
    lastMessageColor = color;
    lastMessageTime = now;

    const messageBox = document.getElementById('message-box');
    if (!messageBox) return;
    if (messageHideTimeoutId) {
        clearTimeout(messageHideTimeoutId);
        messageHideTimeoutId = null;
    }
    messageBox.textContent = message;
    messageBox.classList.remove('hidden', ...MESSAGE_COLOR_CLASSES);
    messageBox.classList.add(color);
    messageBox.style.display = '';

    // Hide the message after a duration; re-query element and force hide so it always runs
    messageHideTimeoutId = setTimeout(() => {
        try {
            const el = document.getElementById('message-box');
            if (el) {
                el.classList.add('hidden');
                el.style.display = 'none';
            }
        } finally {
            messageHideTimeoutId = null;
        }
    }, duration);
}
// Sections (level 0): font _f2, y 680–710, height 13–19.
// Chapters/subsections (level 1): retry logic — y 680–710, height 13–19, length > 2, no font check.
async function detectPageTitles(page, pageNum) {
    const textContent = await page.getTextContent();
    const entries = [];
    for (let i = 0; i < textContent.items.length; i++) {
        const item = textContent.items[i];
        const y = item.transform[5];
        const h = item.height;
        const trimmed = item.str.trim();
        if (trimmed.length <= 2) continue;
        // Section: current implementation (font _f2 required)
        if (item.fontName && item.fontName.endsWith("_f2") && y > 680 && y < 710 && h > 13.0000005 && h < 19) {
            entries.push({ pageNum, title: trimmed, level: 0 });
        } else if (y > 680 && y < 710 && h > 13.0000005 && h < 19) {
            // Chapter/subsection: retry logic (position + size only, no font)
            entries.push({ pageNum, title: trimmed, level: 1 });
        }
    }
    return entries;
}

// Track chapters as we find them (flat list: level 0 = section, 1 = subsection).
let detectedChapters = [];

async function findChapters(pdfDocument) {
    console.log("Starting chapter detection (sections + subsections)...");
    detectedChapters = [];
    const numPages = pdfDocument.numPages;

    const results = await Promise.all(
        Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            return pdfDocument.getPage(pageNum)
                .then(page => detectPageTitles(page, pageNum))
                .catch(error => {
                    console.error(`Error processing page ${pageNum}:`, error);
                    return [];
                });
        })
    );

    const flat = results.flat();
    flat.sort((a, b) => a.pageNum - b.pageNum || a.level - b.level);
    detectedChapters = flat;

    console.log("Chapter detection complete, found " + detectedChapters.length + " entries:");
    console.table(detectedChapters);
    return detectedChapters;
}

// Navigate to chapter by index. Relies on window.scheduleRenderPage (set after init).
function navigateToChapter(chapterIndex) {
    if (detectedChapters.length === 0) {
        console.warn("No chapters detected yet");
        return false;
    }
    if (chapterIndex < 0 || chapterIndex >= detectedChapters.length) {
        console.warn(`Invalid chapter index: ${chapterIndex}`);
        return false;
    }
    const { pageNum, title } = detectedChapters[chapterIndex];
    const schedule = typeof window.scheduleRenderPage === 'function' ? window.scheduleRenderPage : null;
    if (!schedule) {
        console.warn("Page navigation not ready yet");
        return false;
    }
    console.log(`Navigating to chapter "${title}" on page ${pageNum}`);
    schedule(pageNum);
    return true;
}

// TTS Implementation — Browser Web Speech API + optional Kokoro neural voice
const TTS_ENGINE_BROWSER = 'browser';
const TTS_ENGINE_KOKORO = 'kokoro';
const KOKORO_VOICE = 'af_heart';

let isSpeaking = false;
let isPaused = false;
let speakingRate = 1;
let selectedVoice = null;
let ttsEngine = localStorage.getItem('ttsEngine') || TTS_ENGINE_BROWSER;
// Chrome GC's unreferenced utterances mid-queue, killing their event handlers
let activeUtterances = [];

// Kokoro state
let kokoroTTS = null;
let kokoroLoadPromise = null;
let kokoroAudio = null;
let kokoroObjectUrl = null;
let kokoroGenerationId = 0;
let kokoroContinuePlayback = null;

function createEnginePicker() {
    const audioControls = document.getElementById('audio-controls');
    if (!audioControls || document.getElementById('engine-control')) return;

    const options = [
        { value: TTS_ENGINE_BROWSER, label: 'Browser' },
        { value: TTS_ENGINE_KOKORO, label: 'Kokoro (HQ)' },
    ];
    const current = options.find((o) => o.value === ttsEngine) || options[0];

    const engineControl = document.createElement('div');
    engineControl.id = 'engine-control';
    engineControl.className = 'engine-control';

    const label = document.createElement('span');
    label.className = 'engine-label';
    label.textContent = 'Voice:';

    const dropdown = document.createElement('div');
    dropdown.className = 'engine-dropdown';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = 'tts-engine';
    trigger.className = 'engine-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', 'Text-to-speech voice engine');

    const triggerText = document.createElement('span');
    triggerText.className = 'engine-trigger-text';
    triggerText.textContent = current.label;

    const triggerCaret = document.createElement('span');
    triggerCaret.className = 'engine-trigger-caret';
    triggerCaret.setAttribute('aria-hidden', 'true');
    triggerCaret.innerHTML = '<i class="fas fa-chevron-down"></i>';

    trigger.appendChild(triggerText);
    trigger.appendChild(triggerCaret);

    const menu = document.createElement('ul');
    menu.className = 'engine-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    function setOpen(open) {
        menu.hidden = !open;
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        dropdown.classList.toggle('open', open);
    }

    function selectEngine(next, nextLabel) {
        if (next === ttsEngine) {
            setOpen(false);
            return;
        }
        stopAudio();
        ttsEngine = next;
        localStorage.setItem('ttsEngine', ttsEngine);
        triggerText.textContent = nextLabel;
        menu.querySelectorAll('.engine-option').forEach((btn) => {
            const selected = btn.dataset.value === next;
            btn.classList.toggle('selected', selected);
            btn.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        setOpen(false);
        if (ttsEngine === TTS_ENGINE_KOKORO) {
            showMessage('High-quality voice selected. First play loads the model from this site (~90MB, then cached).', 'blue', 4000);
        } else {
            showMessage('Browser voice selected.', 'blue', 2000);
        }
    }

    options.forEach((opt) => {
        const item = document.createElement('li');
        item.setAttribute('role', 'presentation');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'engine-option' + (opt.value === current.value ? ' selected' : '');
        btn.dataset.value = opt.value;
        btn.setAttribute('role', 'option');
        btn.setAttribute('aria-selected', opt.value === current.value ? 'true' : 'false');
        btn.textContent = opt.label;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectEngine(opt.value, opt.label);
        });

        item.appendChild(btn);
        menu.appendChild(item);
    });

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(menu.hidden);
    });

    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') setOpen(false);
    });

    dropdown.appendChild(trigger);
    dropdown.appendChild(menu);
    engineControl.appendChild(label);
    engineControl.appendChild(dropdown);
    audioControls.appendChild(engineControl);
}

function createSpeedSlider() {
    const audioControls = document.getElementById('audio-controls');
    if (!audioControls || document.getElementById('speed-control')) return;

    const speedControl = document.createElement('div');
    speedControl.id = 'speed-control';
    speedControl.className = 'speed-control';

    const label = document.createElement('label');
    label.htmlFor = 'speed-slider';
    label.textContent = 'Speed:';

    const speedValue = document.createElement('span');
    speedValue.id = 'speed-value';
    speedValue.textContent = '1x';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'speed-slider';
    slider.min = '0.5';
    slider.max = '2';
    slider.step = '0.1';
    slider.value = '0.85';

    slider.addEventListener('input', function() {
        const newRate = parseFloat(this.value);
        speakingRate = newRate;
        const displayValue = Math.round(newRate * 10) / 10;
        speedValue.textContent = displayValue + 'x';
        localStorage.setItem('narrationSpeed', newRate);
    });

    speedControl.appendChild(label);
    speedControl.appendChild(slider);
    speedControl.appendChild(speedValue);
    audioControls.appendChild(speedControl);

    const savedSpeed = localStorage.getItem('narrationSpeed');
    if (savedSpeed) {
        slider.value = savedSpeed;
        speakingRate = parseFloat(savedSpeed);
        const displayValue = Math.round(speakingRate * 10) / 10;
        speedValue.textContent = displayValue + 'x';
    } else {
        speakingRate = parseFloat(slider.value);
        speedValue.textContent = speakingRate + 'x';
    }
}

function ttsSupported() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function anyTtsAvailable() {
    return ttsSupported() || typeof window.loadKokoroTTS === 'function';
}

function pickVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return voices.find(v => v.lang.startsWith('en') && v.localService)
        || voices.find(v => v.lang.startsWith('en'))
        || voices[0];
}

// Split text into sentence-sized utterances. Long single utterances get cut off
// in Chrome (~15s limit on remote voices); a queue of short ones avoids that.
function splitIntoChunks(text, maxLen = 200) {
    const sentences = text.replace(/\n+/g, ' ').match(/[^.!?]+[.!?]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    for (const sentence of sentences) {
        if (current && (current + sentence).length > maxLen) {
            chunks.push(current.trim());
            current = sentence;
        } else {
            current += sentence;
        }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

function revokeKokoroObjectUrl() {
    if (kokoroObjectUrl) {
        URL.revokeObjectURL(kokoroObjectUrl);
        kokoroObjectUrl = null;
    }
}

function stopKokoroAudio() {
    kokoroGenerationId += 1;
    kokoroContinuePlayback = null;
    if (window.__kokoroWorkerApi) {
        window.__kokoroWorkerApi.cancel(kokoroGenerationId);
    }
    if (kokoroAudio) {
        kokoroAudio.onended = null;
        kokoroAudio.onerror = null;
        kokoroAudio.pause();
        kokoroAudio.removeAttribute('src');
        kokoroAudio.load();
        kokoroAudio = null;
    }
    revokeKokoroObjectUrl();
    if (Array.isArray(window.__kokoroQueuedUrls)) {
        window.__kokoroQueuedUrls.forEach((url) => {
            try { URL.revokeObjectURL(url); } catch (_) {}
        });
        window.__kokoroQueuedUrls = [];
    }
}

async function ensureKokoroReady() {
    if (kokoroTTS) return kokoroTTS;
    if (kokoroLoadPromise) return kokoroLoadPromise;

    if (typeof window.loadKokoroTTS !== 'function') {
        throw new Error('Kokoro loader is not available');
    }

    showMessage('Loading high-quality voice model from this site…', 'blue', 8000);
    kokoroLoadPromise = window.loadKokoroTTS((progress) => {
        if (!progress || typeof progress.progress !== 'number') return;
        if (progress.status === 'progress' && progress.progress < 100) {
            const pct = Math.round(progress.progress);
            showMessage(`Downloading voice model… ${pct}%`, 'blue', 3000);
        }
    }).then((api) => {
        kokoroTTS = api;
        showMessage('High-quality voice ready.', 'green', 2500);
        return api;
    }).catch((err) => {
        kokoroLoadPromise = null;
        throw err;
    });

    return kokoroLoadPromise;
}

function playBrowserAudio(text) {
    if (!ttsSupported()) {
        showMessage('Browser text-to-speech is not supported here.', 'red');
        return;
    }

    if (isSpeaking && !isPaused) return;

    if (isPaused) {
        window.speechSynthesis.resume();
        isSpeaking = true;
        isPaused = false;
        updateAudioControls();
        showMessage('Audio playing...', 'green');
        return;
    }

    if (!text) return;

    showAudioLoading();
    window.speechSynthesis.cancel();
    activeUtterances = [];
    if (!selectedVoice) selectedVoice = pickVoice();

    const chunks = splitIntoChunks(text);
    chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        activeUtterances.push(utterance);
        utterance.rate = speakingRate;
        if (selectedVoice) utterance.voice = selectedVoice;

        if (index === 0) {
            utterance.onstart = hideAudioLoading;
        }
        if (index === chunks.length - 1) {
            utterance.onend = () => {
                activeUtterances = [];
                isSpeaking = false;
                isPaused = false;
                updateAudioControls();
            };
        }
        utterance.onerror = (event) => {
            // cancel()/page-change interruptions fire onerror too — not real failures
            if (event.error === 'canceled' || event.error === 'interrupted') return;
            console.error('Speech synthesis error:', event.error);
            hideAudioLoading();
            showMessage('Unable to play audio right now. Please try again.', 'red', 2000);
            isSpeaking = false;
            isPaused = false;
            updateAudioControls();
        };

        window.speechSynthesis.speak(utterance);
    });

    // speak() begins playback right away; onstart is unreliable (GC/engine quirks),
    // so reflect the playing state immediately rather than waiting for it
    setTimeout(hideAudioLoading, 2000);
    isSpeaking = true;
    isPaused = false;
    updateAudioControls();
    showMessage('Audio playing...', 'green');
}

function sanitizeForKokoro(text) {
    if (!text) return '';
    return text
        // Drop control chars / private-use PDF junk that can confuse the phonemizer
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
        .replace(/[\uE000-\uF8FF]/g, ' ')
        // Normalize fancy punctuation to ASCII-ish forms Kokoro handles well
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/\u2026/g, '...')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

/** Split page text into ~4 quarters at paragraph boundaries for pipelined synthesis. */
function splitPageIntoQuarters(rawText) {
    const paragraphs = String(rawText || '')
        .split(/\n+/)
        .map((p) => sanitizeForKokoro(p))
        .filter(Boolean);

    if (!paragraphs.length) return [];
    if (paragraphs.length === 1) return paragraphs;

    const totalLen = paragraphs.reduce((sum, p) => sum + p.length, 0);
    const target = Math.max(1, Math.ceil(totalLen / 4));
    const quarters = [];
    let bucket = [];
    let bucketLen = 0;

    for (const paragraph of paragraphs) {
        // Fill up to 3 quarters by target length; leftover becomes the last
        if (bucket.length && bucketLen + paragraph.length > target && quarters.length < 3) {
            quarters.push(bucket.join(' '));
            bucket = [paragraph];
            bucketLen = paragraph.length;
        } else {
            bucket.push(paragraph);
            bucketLen += paragraph.length;
        }
    }
    if (bucket.length) quarters.push(bucket.join(' '));
    return quarters;
}

function concatFloat32(chunks) {
    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function makeSilenceSamples(durationMs, sampleRate = 24000) {
    return new Float32Array(Math.max(1, Math.floor((sampleRate * durationMs) / 1000)));
}

async function playKokoroAudio(text) {
    if (isSpeaking && !isPaused) return;

    if (isPaused) {
        try {
            isPaused = false;
            if (kokoroAudio && !kokoroAudio.ended) {
                await kokoroAudio.play();
            } else if (typeof kokoroContinuePlayback === 'function') {
                kokoroContinuePlayback();
            }
            isSpeaking = true;
            updateAudioControls();
            showMessage('Audio playing...', 'green');
        } catch (err) {
            console.error('Kokoro resume failed:', err);
            isPaused = true;
            showMessage('Unable to resume audio. Please try again.', 'red', 2000);
        }
        return;
    }

    if (!text) return;
    const quarters = splitPageIntoQuarters(text);
    if (!quarters.length) {
        showMessage('No readable text on this page.', 'red', 2000);
        return;
    }

    const generationId = ++kokoroGenerationId;
    showAudioLoading();
    const playButton = document.getElementById('play-audio');
    const pauseButton = document.getElementById('pause-audio');
    const stopButton = document.getElementById('stop-audio');
    if (playButton) playButton.disabled = true;
    if (pauseButton) pauseButton.disabled = true;
    if (stopButton) stopButton.disabled = false;

    const queuedUrls = [];
    window.__kokoroQueuedUrls = queuedUrls;
    const audioQueue = [];
    let generating = true;
    let startedPlayback = false;
    const SECTION_PAUSE_MS = 280;

    const finishIfIdle = () => {
        if (generationId !== kokoroGenerationId) return;
        if (!generating && audioQueue.length === 0 && (!kokoroAudio || kokoroAudio.paused)) {
            isSpeaking = false;
            isPaused = false;
            hideAudioLoading();
            updateAudioControls();
        }
    };

    const playNextChunk = async () => {
        if (generationId !== kokoroGenerationId) return;
        if (isPaused) return;
        if (kokoroAudio && !kokoroAudio.paused && !kokoroAudio.ended) return;
        if (!audioQueue.length) {
            finishIfIdle();
            return;
        }

        const url = audioQueue.shift();
        revokeKokoroObjectUrl();
        kokoroObjectUrl = url;

        kokoroAudio = new Audio(url);
        kokoroAudio.onended = () => {
            if (generationId !== kokoroGenerationId) return;
            playNextChunk();
        };
        kokoroAudio.onerror = () => {
            if (generationId !== kokoroGenerationId) return;
            console.error('Kokoro chunk playback error');
            playNextChunk();
        };

        try {
            await kokoroAudio.play();
            if (!startedPlayback) {
                startedPlayback = true;
                hideAudioLoading();
                isSpeaking = true;
                isPaused = false;
                updateAudioControls();
                showMessage('Audio playing...', 'green');
            }
        } catch (err) {
            if (generationId !== kokoroGenerationId) return;
            console.error('Kokoro play failed:', err);
            hideAudioLoading();
            isSpeaking = false;
            isPaused = false;
            updateAudioControls();
            showMessage('Unable to play audio right now. Please try again.', 'red', 2000);
        }
    };
    kokoroContinuePlayback = playNextChunk;

    const enqueueMerged = (samples, sampleRate) => {
        const wavBuffer = float32ToWav(samples, sampleRate || 24000);
        const url = URL.createObjectURL(new Blob([wavBuffer], { type: 'audio/wav' }));
        queuedUrls.push(url);
        audioQueue.push(url);
        if (!startedPlayback || (kokoroAudio && kokoroAudio.paused && !isPaused)) {
            playNextChunk();
        }
    };

    try {
        const api = await ensureKokoroReady();
        if (generationId !== kokoroGenerationId) return;

        showMessage('Generating narration…', 'blue', 8000);

        // One continuous Audio clip per quarter (no mid-section gaps).
        // While quarter N plays, we generate quarter N+1.
        for (let i = 0; i < quarters.length; i++) {
            if (generationId !== kokoroGenerationId) return;

            const parts = [];
            let sampleRate = 24000;
            await api.synthesize(quarters[i], {
                voice: KOKORO_VOICE,
                speed: speakingRate,
                generationId,
                onChunk: (samples, rate, chunkGenerationId) => {
                    if (chunkGenerationId !== kokoroGenerationId) return;
                    if (!samples || !samples.length) return;
                    parts.push(samples instanceof Float32Array ? samples : Float32Array.from(samples));
                    if (rate) sampleRate = rate;
                },
            });
            if (generationId !== kokoroGenerationId) return;
            if (!parts.length) continue;

            let samples = concatFloat32(parts);
            if (i > 0) {
                samples = concatFloat32([
                    makeSilenceSamples(SECTION_PAUSE_MS, sampleRate),
                    samples,
                ]);
            }
            enqueueMerged(samples, sampleRate);
        }

        generating = false;
        if (generationId !== kokoroGenerationId) return;
        if (!startedPlayback && audioQueue.length === 0) {
            throw new Error('No audio generated');
        }
        finishIfIdle();
    } catch (err) {
        if (generationId !== kokoroGenerationId) return;
        console.error('Kokoro TTS error:', err);
        generating = false;
        hideAudioLoading();
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
        showMessage('High-quality voice failed to load. Try Browser voice, or retry.', 'red', 4000);
    }
}

function float32ToWav(samples, sampleRate) {
    // PCM 16-bit WAV — IEEE float WAVs are poorly supported and often play as noise/gibberish
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);       // PCM fmt chunk size
    view.setUint16(20, 1, true);        // PCM format
    view.setUint16(22, 1, true);        // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);        // block align
    view.setUint16(34, 16, true);       // bits per sample
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }
    return buffer;
}

function playAudio(text) {
    if (ttsEngine === TTS_ENGINE_KOKORO) {
        playKokoroAudio(text);
        return;
    }
    playBrowserAudio(text);
}

async function processPageText(page) {
    const textContent = await page.getTextContent();

    // First combine all text items into a single string with their positions
    let items = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],  // x position
        y: item.transform[5],  // y position
        width: item.width,
        height: item.height
    }));

    // Sort items by y position (top to bottom) and then x position (left to right)
    items.sort((a, b) => {
        // Use a small threshold for y-position comparison to handle slight misalignments
        const yDiff = Math.abs(b.y - a.y);
        if (yDiff < 1) {
            return a.x - b.x;
        }
        return b.y - a.y;
    });

    // Combine text on the same line and fix common ligature issues
    let lines = [];
    let currentLine = [];
    let currentY = items[0]?.y;

    items.forEach(item => {
        if (Math.abs(item.y - currentY) > 1) {
            // New line detected
            if (currentLine.length > 0) {
                lines.push(currentLine);
                currentLine = [];
            }
            currentY = item.y;
        }
        currentLine.push(item);
    });
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    // Process each line to combine words and fix ligatures
    const processedText = lines.map(line => {
        let lineText = line.map(item => item.text).join('');

        // Fix common ligature breaks (no word boundaries — mid-word ligatures e.g. "office")
        lineText = lineText
            .replace(/f\s?i/g, 'fi')
            .replace(/f\s?l/g, 'fl')
            .replace(/f\s?f/g, 'ff')
            .replace(/t\s?t/g, 'tt')
            .replace(/f\s?t/g, 'ft')
            .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
            .trim();

        return lineText;
    }).join('\n');

    return processedText;
}


function pauseAudio() {
    if (ttsEngine === TTS_ENGINE_KOKORO) {
        if (kokoroAudio && isSpeaking && !isPaused) {
            kokoroAudio.pause();
            isSpeaking = false;
            isPaused = true;
            updateAudioControls();
        }
        return;
    }

    if (ttsSupported() && isSpeaking && !isPaused) {
        window.speechSynthesis.pause();
        isSpeaking = false;
        isPaused = true;
        updateAudioControls();
    }
}

function stopAudio() {
    stopKokoroAudio();
    if (ttsSupported()) {
        window.speechSynthesis.cancel();
        activeUtterances = [];
    }
    isSpeaking = false;
    isPaused = false;
    hideAudioLoading();
    updateAudioControls();
}

function updateAudioControls() {
    updateButtonStates(false);
}


function updateButtonStates(disabled) {
    const playButton = document.getElementById('play-audio');
    const pauseButton = document.getElementById('pause-audio');
    const stopButton = document.getElementById('stop-audio');

    if (playButton) {
        playButton.disabled = disabled || (isSpeaking && !isPaused);
    }
    if (pauseButton) {
        pauseButton.disabled = disabled || !isSpeaking || isPaused;
    }
    if (stopButton) {
        stopButton.disabled = disabled || (!isSpeaking && !isPaused);
    }
}



document.addEventListener("DOMContentLoaded", async function() {
    let currentPage = 1;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = 1;
    let pdfDoc = null;
    let totalPages = 0;
    let currentPageText = '';
    
    const pdfContainer = document.getElementById('pdf-container');
    const controlsWrapper = document.getElementById('controls-wrapper');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInput = document.getElementById('current-page');
    const totalPagesElement = document.getElementById('total-pages');

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    function syncViewportHeight() {
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        document.documentElement.style.setProperty(
            '--app-height',
            `${Math.round(viewportHeight)}px`
        );
    }

    function setupViewportHeightSync() {
        syncViewportHeight();
        window.addEventListener('resize', syncViewportHeight);
        window.addEventListener('orientationchange', syncViewportHeight);
        window.visualViewport?.addEventListener('resize', syncViewportHeight);
        window.visualViewport?.addEventListener('scroll', syncViewportHeight);
    }

    function syncControlsHeight() {
        if (!controlsWrapper) return;
        document.documentElement.style.setProperty(
            '--controls-height',
            `${controlsWrapper.offsetHeight}px`
        );
    }

    function setupControlsHeightSync() {
        syncControlsHeight();
        window.addEventListener('resize', syncControlsHeight);
        if (typeof ResizeObserver !== 'undefined' && controlsWrapper) {
            const observer = new ResizeObserver(syncControlsHeight);
            observer.observe(controlsWrapper);
        }
    }

    function setupTTSButtons() {
        const playButton = document.getElementById('play-audio');
        const pauseButton = document.getElementById('pause-audio');
        const stopButton = document.getElementById('stop-audio');
        createEnginePicker();
        createSpeedSlider();

        if (playButton) {
            playButton.addEventListener('click', () => {
                if (currentPageText) {
                    playAudio(currentPageText);
                }
            });
        }

        if (pauseButton) {
            pauseButton.addEventListener('click', pauseAudio);
        }

        if (stopButton) {
            stopButton.addEventListener('click', stopAudio);
        }
    }


    function disableTTSButtons() {
        ['play-audio', 'pause-audio', 'stop-audio'].forEach(id => {
            const button = document.getElementById(id);
            if (button) {
                button.disabled = true;
                button.title = 'Text-to-speech is not available';
            }
        });
    }

    // PDF rendering functions
    async function loadPDF(url) {
        try {
            const pdf = await pdfjsLib.getDocument(url).promise;
            pdfDoc = pdf;
            totalPages = pdf.numPages;
            totalPagesElement.textContent = totalPages;
    
            currentPage = parseInt(localStorage.getItem('currentPage')) || 1;
            currentPage = Math.min(Math.max(currentPage, 1), totalPages);
            currentPageInput.value = currentPage;
    
            // Render the first page immediately
            await renderPage(currentPage);
            
            // Use the improved setTimeout approach from your paste.txt
            console.log("PDF loaded, waiting before chapter detection...");
            setTimeout(async () => {
                console.log("Starting delayed chapter detection...");
                try {
                    const chapters = await findChapters(pdf);
                    window.pdfChapters = chapters;
                    console.log(`Found ${chapters.length} chapters`);
                    console.table(chapters);
                } catch (err) {
                    console.error("Error in delayed chapter detection:", err);
                }
            }, 500); // delay
            
            return pdf;
        } catch (error) {
            console.error('Error loading PDF:', error);
            pdfContainer.innerHTML = '<p>Error loading PDF. Please try again later.</p>';
            throw error;
        }
    }
    
    async function renderPage(num) {
        pageRendering = true;
        try {
            const page = await pdfDoc.getPage(num);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const pixelRatio = window.devicePixelRatio || 1;

            canvas.height = viewport.height * pixelRatio;
            canvas.width = viewport.width * pixelRatio;
            canvas.style.height = viewport.height + "px";
            canvas.style.width = viewport.width + "px";

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
            };

            await page.render(renderContext).promise;
            
            currentPageText = await processPageText(page);

            pdfContainer.innerHTML = '';
            pdfContainer.appendChild(canvas);

            currentPage = num;
            currentPageInput.value = num;
            localStorage.setItem('currentPage', num);
            
            updateUI();
        } catch (error) {
            console.error('Error rendering page:', error);
        } finally {
            pageRendering = false;
            if (pageNumPending !== null) {
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        }
    }

    // Single-slot buffer: only one pending page; rapid nav drops intermediate requests.
    function scheduleRenderPage(num) {
        if (pageRendering) {
            pageNumPending = num;
        } else {
            renderPage(num);
        }
    }
    window.scheduleRenderPage = scheduleRenderPage;

    function changePage(offset) {
        const newPage = currentPage + offset;
        if (newPage >= 1 && newPage <= totalPages) {
            if (window.TTS) {
                window.TTS.stopAudio();
            }
            scheduleRenderPage(newPage);
        }
    }
    function updateUI() {
        if (prevPageBtn) prevPageBtn.disabled = (currentPage <= 1);
        if (nextPageBtn) nextPageBtn.disabled = (currentPage >= totalPages);
    }

    // Event Listeners
    prevPageBtn?.addEventListener('click', () => changePage(-1));
    nextPageBtn?.addEventListener('click', () => changePage(1));
    
    currentPageInput?.addEventListener('change', () => {
        const pageNum = parseInt(currentPageInput.value);
        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage) {
            if (window.TTS) {
                window.TTS.stopAudio();
            }
            scheduleRenderPage(pageNum);
        }
    });

    // Initialize the application
    async function init() {
        try {
            showLoading();

            // Leftover credentials from the retired cloud TTS
            localStorage.removeItem('gcp_access_token');
            localStorage.removeItem('gcp_token_expiry');

            if (anyTtsAvailable()) {
                if (ttsSupported()) {
                    // Voice list loads asynchronously in some browsers
                    selectedVoice = pickVoice();
                    window.speechSynthesis.onvoiceschanged = () => {
                        selectedVoice = pickVoice();
                    };
                }
                setupTTSButtons();
                setupControlsHeightSync();
            } else {
                disableTTSButtons();
                setupControlsHeightSync();
            }

            await loadPDF('Abidogun.pdf');
            hideLoading();
        } catch (error) {
            console.error('Error initializing application:', error);
            hideLoading();
            showMessage('Failed to initialize application. Please refresh and try again.', 'red');
        }
    }

    // Start the application
    setupViewportHeightSync();
    init();
});


// Expose TTS playback/control for chapter-sidebar and page navigation
window.TTS = {
    playAudio,
    pauseAudio,
    stopAudio,
    updateAudioControls
};