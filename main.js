// Helper Functions
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

async function signWithPrivateKey(input, privateKey) {
    try {
        // Convert PEM private key to crypto key format
        const pemHeader = "-----BEGIN PRIVATE KEY-----";
        const pemFooter = "-----END PRIVATE KEY-----";
        const pemContents = privateKey.substring(
            privateKey.indexOf(pemHeader) + pemHeader.length,
            privateKey.indexOf(pemFooter)
        ).replace(/\s/g, '');
        
        // Create binary DER
        const binaryDer = window.atob(pemContents);
        const derBuffer = str2ab(binaryDer);
        
        // Import the private key
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
        
        // Sign the input
        const textEncoder = new TextEncoder();
        const inputBuffer = textEncoder.encode(input);
        const signature = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            inputBuffer
        );
        
        // Convert the signature to base64
        const signatureArray = new Uint8Array(signature);
        const signatureBase64 = btoa(String.fromCharCode.apply(null, signatureArray));
        return signatureBase64;
    } catch (error) {
        console.error('Error signing JWT:', error);
        throw error;
    }
}

// Generate JWT for GCP authentication
async function generateJWT() {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 3600; // Token expires in 1 hour

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

// TTS Implementation
let audioElement = null;
let audioData = null;
let isInitialized = false;
let isSpeaking = false;
let isPaused = false;
let initializationAttempted = false;


async function initializeSynthesizer() {
    if (initializationAttempted) return;
    
    try {
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
            throw new Error('Token fetch failed');
        }

        const data = await response.json();
        localStorage.setItem('gcp_access_token', data.access_token);
        localStorage.setItem('gcp_token_expiry', Date.now() + (data.expires_in * 1000));
        isInitialized = true;
    } catch (error) {
        console.error('TTS Init Error:', error);
    } finally {
        initializationAttempted = true;
        updateButtonStates(false);
    }
}

// Audio control functions
async function playAudio(text) {
    if (!isInitialized) {
        await initializeSynthesizer();
    }

    if (isSpeaking && !isPaused) {
        return;
    }

    if (audioElement && isPaused) {
        audioElement.play();
        isSpeaking = true;
        isPaused = false;
        updateButtonStates(false);
    } else {
        await synthesizeAudio(text);
    }
}

async function synthesizeAudio(text) {
    if (!isInitialized) {
        await initializeSynthesizer();
    }

    // Check token expiry
    const tokenExpiry = localStorage.getItem('gcp_token_expiry');
    if (!tokenExpiry || Date.now() > parseInt(tokenExpiry)) {
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
                    audioEncoding: 'LINEAR16',
                    pitch: 0,
                    speakingRate: 0.85
                }
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const audioContent = result.audioContent;
        
        // Convert base64 to audio buffer
        const binaryString = window.atob(audioContent);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const blob = new Blob([bytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        if (audioElement) {
            audioElement.pause();
            audioElement.remove();
        }

        audioElement = new Audio(url);
        setupAudioEventListeners();
        
        audioElement.play();
        isSpeaking = true;
        isPaused = false;
        updateAudioControls();
        
        audioData = bytes;
    } catch (error) {
        console.error('Error synthesizing speech:', error);
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
    }
}async function processPageText(page) {
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
    });

    audioElement.addEventListener('pause', () => {
        if (!audioElement.ended) {
            isSpeaking = false;
            isPaused = true;
            updateAudioControls();
        }
    });

    audioElement.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        isSpeaking = false;
        isPaused = false;
        updateAudioControls();
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
        // Enable play button if we're not speaking or if we're paused
        playButton.disabled = disabled || (isSpeaking && !isPaused);
    }
    if (pauseButton) {
        pauseButton.disabled = disabled || !isSpeaking || isPaused;
    }
    if (stopButton) {
        stopButton.disabled = disabled || (!isSpeaking && !isPaused);
    }
}

// Expose TTS functions
window.TTS = {
    initializeSynthesizer,
    playAudio,
    pauseAudio,
    stopAudio,
    updateAudioControls
};

// PDF viewer implementation starts here...
document.addEventListener("DOMContentLoaded", async function() {
    // Initialize variables
    let currentPage = 1;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = 1;
    let pdfDoc = null;
    let totalPages = 0;
    let currentPageText = '';
    let readingStartTime = Date.now();
    
    // Get DOM elements
    const pdfContainer = document.getElementById('pdf-container');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInput = document.getElementById('current-page');
    const totalPagesElement = document.getElementById('total-pages');

    // Initialize PDF.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    // Initialize TTS controls
    async function initializeTTSControls() {
        try {
            await window.TTS.initializeSynthesizer();
            setupTTSButtons();
            window.TTS.updateAudioControls();
        } catch (error) {
            console.error('Error initializing TTS:', error);
            disableTTSButtons();
        }
    }

    function setupTTSButtons() {
        const playButton = document.getElementById('play-audio');
        const pauseButton = document.getElementById('pause-audio');
        const stopButton = document.getElementById('stop-audio');

        if (playButton) {
            playButton.addEventListener('click', () => {
                if (window.TTS && currentPageText) {
                    window.TTS.playAudio(currentPageText);
                }
            });
        }

        if (pauseButton) {
            pauseButton.addEventListener('click', () => {
                if (window.TTS) {
                    window.TTS.pauseAudio();
                }
            });
        }

        if (stopButton) {
            stopButton.addEventListener('click', () => {
                if (window.TTS) {
                    window.TTS.stopAudio();
                }
            });
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
            await initializeTTSControls();
            await loadPDF('Abidogun.pdf'); // Replace with your PDF URL
        } catch (error) {
            console.error('Error initializing application:', error);
        }
    }

    // Start the application
    init();
});