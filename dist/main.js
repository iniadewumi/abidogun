//main.js


// Helper Functions
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

async function clearStoredTokens() {
    localStorage.removeItem('gcp_access_token');
    localStorage.removeItem('gcp_token_expiry');
}

function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

function showMessage(message, color, duration = 5000) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = message;
    messageBox.classList.remove('hidden');
    messageBox.classList.add(color);

    // Hide the message after a duration
    setTimeout(() => {
        messageBox.classList.add('hidden');
    }, duration);
}


// TTS Implementation
let audioContext = null;
let audioElement = null;
let audioData = null;
let isInitialized = false;
let isSpeaking = false;
let isPaused = false;
let initializationAttempted = false;

//Clear token
let hasRetried = false; // Tracks if retry has occurred


async function initializeAudioContext() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioContext) {
            audioContext = new AudioContext();
        }
        
        // Mobile browsers often require user interaction to start audio context
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        return audioContext;
    } catch (error) {
        console.error('Audio Context initialization failed:', error);
        showMessage('Audio initialization failed. Please check if audio is enabled on your device.', 'red');
        throw error;
    }
}

async function signWithPrivateKey(input, privateKey) {
    if (!window.crypto || !window.crypto.subtle) {
        console.warn('Web Crypto API is not available. Falling back to node-forge.');
        return signWithPrivateKeyFallback(input, privateKey); // Use a fallback library
    }

    try {
        const pemHeader = "-----BEGIN PRIVATE KEY-----";
        const pemFooter = "-----END PRIVATE KEY-----";
        const pemContents = privateKey.substring(
            privateKey.indexOf(pemHeader) + pemHeader.length,
            privateKey.indexOf(pemFooter)
        ).replace(/\s/g, '');
        
        const binaryDer = window.atob(pemContents);
        const derBuffer = str2ab(binaryDer);
        
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            derBuffer,
            {
                name: 'RSASSA-PKCS1-v1_5',
                hash: { name: 'SHA-256' },
            },
            false,
            ['sign']
        );
        
        const textEncoder = new TextEncoder();
        const inputBuffer = textEncoder.encode(input);
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            inputBuffer
        );
        
        const signatureArray = new Uint8Array(signature);
        const signatureBase64 = btoa(String.fromCharCode.apply(null, signatureArray));
        return signatureBase64;
    } catch (error) {
        console.error('Error signing JWT:', error);
        throw error;
    }
}


// Fallback using node-forge
function signWithPrivateKeyFallback(input, privateKey) {
    const privateKeyObj = forge.pki.privateKeyFromPem(privateKey);
    const md = forge.md.sha256.create();
    md.update(input, 'utf8');
    const signature = privateKeyObj.sign(md);
    return forge.util.encode64(signature);
}
// Generate JWT for GCP authentication
async function generateJWT() {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600;

    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };

    const payload = {
        iss: window.ENV.GCP_CLIENT_EMAIL,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: exp,
        iat: now
    };

    const encodedHeader = btoa(JSON.stringify(header));
    const encodedPayload = btoa(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    const signature = await signWithPrivateKey(signatureInput, window.ENV.GCP_PRIVATE_KEY);
    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

async function validateStoredToken() {
    const storedToken = localStorage.getItem('gcp_access_token');
    const tokenExpiry = localStorage.getItem('gcp_token_expiry');
    
    // Clear tokens if they don't exist or are expired
    if (!storedToken || !tokenExpiry || Date.now() > parseInt(tokenExpiry)) {
        await clearStoredTokens();
        return false;
    }
    
    // Test if the token is still valid with a lightweight API call
    try {
        const response = await fetch('https://texttospeech.googleapis.com/v1/voices', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${storedToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            console.warn('Stored token is invalid. Clearing and regenerating...');
            await clearStoredTokens();
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Error validating token:', error);
        await clearStoredTokens();
        return false;
    }
}




async function initializeSynthesizer() {
    if (isInitialized) return;
    
    try {
        // Initialize audio context first
        await initializeAudioContext();
        
        // Check if we have a valid stored token
        const isTokenValid = await validateStoredToken();
        
        if (!isTokenValid) {
            const jwt = await generateJWT();
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                    assertion: jwt
                })
            });

            if (!response.ok) {
                throw new Error('Token fetch failed: ' + response.statusText);
            }

            const data = await response.json();
            localStorage.setItem('gcp_access_token', data.access_token);
            localStorage.setItem('gcp_token_expiry', Date.now() + (data.expires_in * 1000));
        }
        
        isInitialized = true;
    } catch (error) {
        console.error('TTS Init Error:', error);
        if (!hasRetried) {
            console.warn('Retrying initialization...');
            hasRetried = true; // Mark the retry as done
            await clearStoredTokens(); // Clear tokens and retry
            await initializeSynthesizer();
        } else {
            console.error('Retry failed. Initialization aborted.');
            showMessage(`Failed to initialize audio: ${error.message}`, "red");
        }
    } finally {
        initializationAttempted = true;
        updateButtonStates(false);
    }
}

async function playAudio(text) {
    showLoading();

    try {
        if (!audioContext || audioContext.state === 'suspended') {
            showMessage('Please tap anywhere on the page to enable audio playback', 'blue', 3000);
            hideLoading();
            return;
        }
        if (!isInitialized) {
            await initializeSynthesizer();
        }

        if (isSpeaking && !isPaused) {
            hideLoading();
            return;
        }

        if (audioElement && isPaused) {
            try {
                showLoading(); // Added this line
                await audioElement.play();
                isSpeaking = true;
                isPaused = false;
                updateAudioControls();
                showMessage('Audio playing...', 'green');
            } catch (playError) {
                console.error('Playback failed:', playError);
                showMessage(`Playback failed: ${playError.message}`, 'red');
                throw playError;
            } finally {}
        } else {
            await synthesizeAudio(text);
        }
    } catch (error) {
        console.error("Error in playAudio:", error);
        showMessage(`Failed to play audio: ${error.message}`, "red");
        isSpeaking = false;
        isPaused = false;
        updateButtonStates(false);
    } finally {
        hideLoading();
    }
}


async function synthesizeAudio(text) {
    if (!isInitialized) {
        await initializeSynthesizer();
    }
    updateButtonStates(true);

    try {
        const response = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('gcp_access_token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                input: {
                    text: text
                },
                voice: {
                    languageCode: 'en-US',
                    name: 'en-US-Neural2-F'
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    pitch: 0,
                    speakingRate: 0.85
                }
            })
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                // Clear tokens and reinitialize
                await clearStoredTokens();
                isInitialized = false;
                await initializeSynthesizer();
                return synthesizeAudio(text); // Retry the synthesis
            }
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error?.message || 'Unknown error'}`);
        }

        const result = await response.json();
        if (!result.audioContent) {
            throw new Error('No audio content received from server');
        }

        const audioContent = result.audioContent;
        const binaryString = window.atob(audioContent);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);

        if (audioElement) {
            audioElement.pause();
            audioElement.remove();
        }

        audioElement = new Audio(url);
        setupAudioEventListeners();
        
        try {
            await audioElement.play();
            isSpeaking = true;
            isPaused = false;
            updateAudioControls();
            showMessage('Audio playing...', 'green');
        } catch (playError) {
            console.error('Playback failed:', playError);
            showMessage(`Playback failed: ${playError.message}`, 'red');
            throw playError;
        }
        
        audioData = bytes;
    } catch (error) {
        console.error('Error synthesizing speech:', error);
        showMessage(`Speech synthesis failed: ${error.message}`, 'red');
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
        throw error;
    }
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

        // Fix common ligature breaks while preserving spaces
        lineText = lineText
            .replace(/\bf\s?i\b/g, 'fi') // Preserve preceding spaces
            .replace(/\bf\s?l\b/g, 'fl')
            .replace(/\bf\s?f\b/g, 'ff')
            .replace(/\bt\s?t\b/g, 'tt')
            .replace(/\bf\s?t\b/g, 'ft')
            .replace(/\s+/g, ' ') // Replace multiple spaces with a single space
            .trim();

        return lineText;
    }).join('\n');

    return processedText;
}


function setupAudioEventListeners() {
    if (!audioElement) return;

    const errorHandler = (error) => {
        console.error('Audio playback error:', error);
        showMessage(`Audio playback error: ${error.message}`, 'red');
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
    };

    audioElement.addEventListener('ended', () => {
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
        URL.revokeObjectURL(audioElement.src);
    });


    audioElement.addEventListener('playing', () => {
        isSpeaking = true;
        isPaused = false;
        updateAudioControls();
        hideLoading();
    });

    audioElement.addEventListener('pause', () => {
        if (!audioElement.ended) {
            isSpeaking = false;
            isPaused = true;
            updateAudioControls();
        }
    });

    audioElement.addEventListener('error', (e) => {
        hideLoading(); // Added this line
        errorHandler(e);
    });
    audioElement.addEventListener('stalled', () => {
        hideLoading(); // Added this line
        errorHandler(new Error('Audio playback stalled'));
    });
    audioElement.addEventListener('abort', () => {
        hideLoading(); // Added this line
        errorHandler(new Error('Audio playback aborted'));
    });

    audioElement.addEventListener('waiting', () => {
        showMessage('Buffering audio...', 'blue');
    });

    audioElement.addEventListener('canplaythrough', () => {
        hideLoading();
    });
}
function pauseAudio() {
    if (audioElement && isSpeaking && !isPaused) {
        audioElement.pause();
        isSpeaking = false;
        isPaused = true;
        updateAudioControls();
    }
}

function stopAudio() {
    if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
    }
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
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInput = document.getElementById('current-page');
    const totalPagesElement = document.getElementById('total-pages');

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    // New code
    setupTTSButtons();
    await loadPDF('Abidogun.pdf');

    // Add a one-time click handler to initialize audio
    const initAudioHandler = async () => {
        try {
            showLoading();
            await initializeAudioContext();
            await initializeSynthesizer();
            document.removeEventListener('click', initAudioHandler);
            hideLoading();
        } catch (error) {
            console.error('Error initializing audio:', error);
            showMessage('Failed to initialize audio system. Please refresh and try again.', 'red');
        }
    };

    // Listen for the first user interaction
    document.addEventListener('click', initAudioHandler);

    function setupTTSButtons() {
        const playButton = document.getElementById('play-audio');
        const pauseButton = document.getElementById('pause-audio');
        const stopButton = document.getElementById('stop-audio');

        if (playButton) {
            // New code
            playButton.addEventListener('click', async () => {
                if (!audioContext) {
                    try {
                        await initializeAudioContext();
                        await initializeSynthesizer();
                    } catch (error) {
                        console.error('Failed to initialize audio:', error);
                        showMessage('Failed to initialize audio. Please try again.', 'red');
                        return;
                    }
                }
                
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

            await renderPage(currentPage);
        } catch (error) {
            console.error('Error loading PDF:', error);
            pdfContainer.innerHTML = '<p>Error loading PDF. Please try again later.</p>';
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

    function queueRenderPage(num) {
        if (pageRendering) {
            pageNumPending = num;
        } else {
            renderPage(num);
        }
    }

    function changePage(offset) {
        const newPage = currentPage + offset;
        if (newPage >= 1 && newPage <= totalPages) {
            if (window.TTS) {
                window.TTS.stopAudio();
            }
            queueRenderPage(newPage);
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
            queueRenderPage(pageNum);
        }
    });

    // Initialize the application
    async function init() {
        try {
            showLoading();
            setupTTSButtons(); // Set up buttons first
            await loadPDF('Abidogun.pdf'); // Load PDF immediately
            
            // Add click handler for audio initialization
            const initAudioHandler = async () => {
                try {
                    await initializeAudioContext();
                    await initializeSynthesizer();
                    document.removeEventListener('click', initAudioHandler);
                } catch (error) {
                    console.error('Error initializing audio:', error);
                    showMessage('Failed to initialize audio system. Please refresh and try again.', 'red');
                }
            };
            
            // Listen for first user interaction
            document.addEventListener('click', initAudioHandler);
            
            hideLoading();
        } catch (error) {
            console.error('Error initializing application:', error);
            hideLoading();
            showMessage('Failed to initialize application. Please refresh and try again.', 'red');
        }
    }

    // Start the application
    init();
});

// Expose TTS functions
window.TTS = {
    initializeSynthesizer,
    playAudio,
    pauseAudio,
    stopAudio,
    updateAudioControls
};