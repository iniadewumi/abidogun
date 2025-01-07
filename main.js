// Generate a unique device fingerprint
function generateDeviceFingerprint() {
    const components = [
        navigator.userAgent,
        navigator.language,
        new Date().getTimezoneOffset(),
        screen.colorDepth,
        screen.width + 'x' + screen.height,
        navigator.hardwareConcurrency,
        navigator.deviceMemory,
        !!navigator.bluetooth,
        !!navigator.credentials,
        !!navigator.geolocation,
        !!navigator.mediaDevices,
        !!navigator.serviceWorker
    ];

    // Create a string from components and hash it
    const fingerprint = components.join('###');
    let hash = 0;
    
    for (let i = 0; i < fingerprint.length; i++) {
        const char = fingerprint.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Convert to positive hex string and store it
    const deviceId = Math.abs(hash).toString(16);
    localStorage.setItem('deviceId', deviceId);
    
    return deviceId;
}

// Mobile viewport height fix
function setVH() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setVH();
window.addEventListener('resize', setVH);
window.addEventListener('orientationchange', setVH);

// Enhanced analytics tracking with additional metrics
function trackReading(page, action = 'read') {
    const now = Date.now();
    if (now - lastTrackingUpdate < TRACKING_INTERVAL && action === 'read') {
        return;
    }
    
    lastTrackingUpdate = now;
    const deviceId = localStorage.getItem('deviceId') || generateDeviceFingerprint();

    // Calculate reading velocity (pages per hour)
    const readingStartStr = localStorage.getItem('readingStart');
    const readingStart = readingStartStr ? new Date(readingStartStr) : new Date();
    if (!readingStartStr) {
        localStorage.setItem('readingStart', readingStart.toISOString());
    }
    const hoursSpent = (now - readingStart.getTime()) / (1000 * 60 * 60);
    const pagesPerHour = hoursSpent > 0 ? (page / hoursSpent).toFixed(2) : 0;

    // Get reading history
    const readingHistory = JSON.parse(localStorage.getItem('readingHistory') || '[]');
    readingHistory.push({
        timestamp: now,
        page: page,
        action: action
    });
    localStorage.setItem('readingHistory', JSON.stringify(readingHistory.slice(-100)));

    // Calculate reading patterns
    const readingPatterns = analyzeReadingPatterns(readingHistory);

    if (typeof gtag !== 'undefined') {
        gtag('event', action, {
            'event_category': 'PDF Reading',
            'event_label': url,
            // Basic metrics
            'value': page,
            'session_id': sessionId,
            'device_id': deviceId,
            'total_pages': totalPages,
            'progress_percentage': Math.round((page / totalPages) * 100),
            
            // Enhanced metrics
            'reading_velocity': parseFloat(pagesPerHour),
            'time_on_current_page': calculateTimeOnPage(readingHistory),
            'reading_session_count': parseInt(localStorage.getItem('readingSessionCount') || '1'),
            'reading_completion': calculateReadingCompletion(),
            'pages_read_in_session': calculatePagesInSession(readingHistory),
            
            // Reading patterns
            'reading_pattern': readingPatterns.pattern,
            'back_tracking_count': readingPatterns.backTrackCount,
            'sequential_reading_score': readingPatterns.sequentialScore,
            
            // Audio engagement
            'audio_enabled': !!audioElement,
            'audio_playback_count': parseInt(localStorage.getItem('audioPlaybackCount') || '0'),
            
            // Device context
            'device_type': /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
            'screen_resolution': `${screen.width}x${screen.height}`,
            'browser_language': navigator.language,
            'viewport_height': window.innerHeight,
            'viewport_width': window.innerWidth,
            'device_pixel_ratio': window.devicePixelRatio || 1,
            
            // User engagement
            'zoom_level': scale,
            'interaction_count': parseInt(localStorage.getItem('interactionCount') || '0'),
            'time_of_day': new Date().getHours()
        });
    }
}

// Calculate reading completion
function calculateReadingCompletion() {
    const readPages = new Set(JSON.parse(localStorage.getItem('readingHistory') || '[]')
        .map(entry => entry.page));
    return {
        unique_pages_read: readPages.size,
        completion_percentage: ((readPages.size / totalPages) * 100).toFixed(2)
    };
}

// Analyze reading patterns
function analyzeReadingPatterns(history) {
    if (history.length < 2) {
        return {
            pattern: 'starting',
            backTrackCount: 0,
            sequentialScore: 1
        };
    }

    let backTrackCount = 0;
    let sequentialMoves = 0;
    let pattern = 'sequential';

    for (let i = 1; i < history.length; i++) {
        const pageDiff = history[i].page - history[i-1].page;
        
        if (pageDiff < 0) {
            backTrackCount++;
            pattern = backTrackCount > 3 ? 'research' : 'review';
        } else if (pageDiff === 1) {
            sequentialMoves++;
        } else if (pageDiff > 1) {
            pattern = 'scanning';
        }
    }

    const sequentialScore = sequentialMoves / (history.length - 1);

    return {
        pattern,
        backTrackCount,
        sequentialScore
    };
}

// Calculate time spent on current page
function calculateTimeOnPage(history) {
    if (history.length < 2) return 0;
    const lastEntry = history[history.length - 1];
    const previousEntry = history[history.length - 2];
    return Math.round((lastEntry.timestamp - previousEntry.timestamp) / 1000);
}

// Calculate pages read in current session
function calculatePagesInSession(history) {
    const sessionStart = new Date();
    sessionStart.setHours(sessionStart.getHours() - 1);
    
    const sessionHistory = history.filter(entry => 
        entry.timestamp > sessionStart.getTime()
    );
    
    return new Set(sessionHistory.map(entry => entry.page)).size;
}

// Track user interactions
function trackInteraction(interactionType) {
    const count = parseInt(localStorage.getItem('interactionCount') || '0');
    localStorage.setItem('interactionCount', count + 1);
    
    if (typeof gtag !== 'undefined') {
        gtag('event', 'user_interaction', {
            'event_category': 'PDF Reading',
            'event_label': interactionType,
            'session_id': sessionId
        });
    }
}

// Enhanced reading time tracking
function trackReadingTime() {
    if (typeof gtag !== 'undefined') {
        const timeSpent = Math.round((Date.now() - readingStartTime) / 1000);
        const deviceId = localStorage.getItem('deviceId');
        const readingSessions = parseInt(localStorage.getItem('readingSessionCount') || '1');
        
        gtag('event', 'reading_time', {
            'event_category': 'PDF Reading',
            'event_label': url,
            'value': timeSpent,
            'session_id': sessionId,
            'device_id': deviceId,
            'average_session_duration': timeSpent / readingSessions,
            'total_sessions': readingSessions,
            'reading_streak': calculateReadingStreak()
        });
    }
}

// Calculate reading streak
function calculateReadingStreak() {
    const streakData = JSON.parse(localStorage.getItem('readingStreak') || '{"lastDate":"","count":0}');
    const today = new Date().toDateString();
    
    if (streakData.lastDate === today) {
        return streakData.count;
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (streakData.lastDate === yesterday.toDateString()) {
        streakData.count++;
    } else {
        streakData.count = 1;
    }
    
    streakData.lastDate = today;
    localStorage.setItem('readingStreak', JSON.stringify(streakData));
    return streakData.count;
}

// Global variables for tracking
let lastTrackingUpdate = 0;
let sessionId;
let totalPages = 0;
let url;
let readingStartTime;
let scale = 1;
let audioElement = null;
const TRACKING_INTERVAL = 30000; // 30 seconds

document.addEventListener("DOMContentLoaded", function() {
    url = 'Abidogun.pdf';
    const pdfContainer = document.getElementById('pdf-container');
    const prevPageBtn = document.getElementById('prev-page');
    const nextPageBtn = document.getElementById('next-page');
    const currentPageInput = document.getElementById('current-page');
    const totalPagesElement = document.getElementById('total-pages');
    const playButton = document.getElementById('play-audio');
    const pauseButton = document.getElementById('pause-audio');
    const stopButton = document.getElementById('stop-audio');

    // Generate a session ID if not exists
    const sessionId = localStorage.getItem('sessionId') || 
                     'session_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('sessionId', sessionId);

    // PDF variables
    let pdfDoc = null;
    let currentPage = 1;
    let pageRendering = false;
    let pageNumPending = null;
    let currentPageText = '';

    // Audio variables
    let audioElement = null;
    let audioData = null;
    let isInitialized = false;
    let isSpeaking = false;
    let isPaused = false;

    // Initialize synthesizer function
    function initializeSynthesizer() {
        isInitialized = true;
    }

    // PDF.js initialization
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    function loadPDF() {
        pdfjsLib.getDocument(url).promise.then(pdf => {
            pdfDoc = pdf;
            totalPages = pdf.numPages;
            totalPagesElement.textContent = totalPages;

            // Get last read page
            currentPage = parseInt(localStorage.getItem('currentPage')) || 1;
            currentPage = Math.min(Math.max(currentPage, 1), totalPages);
            currentPageInput.value = currentPage;

            // Track session start
            trackReading(currentPage, 'start_reading');
            readingStartTime = Date.now();

            renderPage(currentPage);
        }).catch(error => {
            console.error('Error loading PDF:', error);
            pdfContainer.innerHTML = '<p>Error loading PDF. Please try again later.</p>';
        });
    }

    function renderPage(num) {
        pageRendering = true;
        pdfDoc.getPage(num).then(page => {
            const pixelRatio = window.devicePixelRatio || 1;
            const viewport = page.getViewport({ scale: scale });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            canvas.height = viewport.height * pixelRatio;
            canvas.width = viewport.width * pixelRatio;
            canvas.style.height = viewport.height + "px";
            canvas.style.width = viewport.width + "px";

            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                transform: [pixelRatio, 0, 0, pixelRatio, 0, 0]
            };

            const renderTask = page.render(renderContext);

            renderTask.promise.then(() => {
                pageRendering = false;
                if (pageNumPending !== null) {
                    renderPage(pageNumPending);
                    pageNumPending = null;
                }
            });

            pdfContainer.innerHTML = '';
            pdfContainer.appendChild(canvas);

            page.getTextContent().then(textContent => {
                const texts = textContent.items.map(item => item.str);
                currentPageText = texts.join(' ');
                audioData = null;
                audioElement = null;
            });

            currentPage = num;
            currentPageInput.value = num;
            localStorage.setItem('currentPage', num);
            
            // Track page change
            trackReading(num, 'page_change');
            
            updateUI();
        });
    }

    function queueRenderPage(num) {
        if (pageRendering) {
            pageNumPending = num;
        } else {
            renderPage(num);
        }
    }

    // Audio control functions
    function playAudio(text) {
        if (isSpeaking && !isPaused) {
            return;
        }
        if (audioElement && isPaused) {
            audioElement.play();
            isSpeaking = true;
            isPaused = false;
            updateAudioControls();
        } else if (audioElement) {
            audioElement.play();
            isSpeaking = true;
            isPaused = false;
            updateAudioControls();
        } else {
            synthesizeAudio(text);
        }
    }

    function synthesizeAudio(text) {
        if (!isInitialized) {
            initializeSynthesizer();
        }

        playButton.disabled = true;
        pauseButton.disabled = true;
        stopButton.disabled = true;

        const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
            window.ENV.AZURE_SUBSCRIPTION_KEY,
            window.ENV.AZURE_REGION
        );
        speechConfig.speechSynthesisVoiceName = 'en-NG-EzinneNeural';

        const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, null);

        synthesizer.speakTextAsync(
            text,
            result => {
                if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                    const audioBuffer = result.audioData;
                    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
                    const url = URL.createObjectURL(blob);

                    audioElement = new Audio(url);

                    audioElement.addEventListener('ended', () => {
                        isSpeaking = false;
                        isPaused = false;
                        updateAudioControls();
                        URL.revokeObjectURL(url);
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

                    audioElement.play();
                    isSpeaking = true;
                    isPaused = false;
                    updateAudioControls();

                    audioData = audioBuffer;
                } else if (result.reason === SpeechSDK.ResultReason.Canceled) {
                    const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
                    console.error('Speech synthesis canceled:', cancellation.errorDetails);
                    isSpeaking = false;
                    isPaused = false;
                    updateAudioControls();
                }
                synthesizer.close();
            },
            error => {
                console.error('Error synthesizing speech:', error);
                isSpeaking = false;
                isPaused = false;
                updateAudioControls();
                synthesizer.close();
            }
        );
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
        if (playButton) playButton.disabled = isSpeaking && !isPaused;
        if (pauseButton) pauseButton.disabled = !isSpeaking || isPaused;
        if (stopButton) stopButton.disabled = !isSpeaking && !isPaused && (!audioElement || audioElement.currentTime === 0);
    }

    function changePage(offset) {
        const newPage = currentPage + offset;
        if (newPage >= 1 && newPage <= totalPages) {
            stopAudio();
            queueRenderPage(newPage);
        }
    }

    function updateUI() {
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    // Event listeners
    if (playButton) {
        playButton.addEventListener('click', () => {
            console.log(currentPageText);
            playAudio(currentPageText);
        });
    } else {
        console.error("Play button not found in the DOM");
    }

    if (pauseButton) {
        pauseButton.addEventListener('click', pauseAudio);
    } else {
        console.error("Pause button not found in the DOM");
    }

    if (stopButton) {
        stopButton.addEventListener('click', stopAudio);
    } else {
        console.error("Stop button not found in the DOM");
    }

    prevPageBtn.addEventListener('click', () => changePage(-1));
    nextPageBtn.addEventListener('click', () => changePage(1));

    currentPageInput.addEventListener('change', () => {
        const pageNum = parseInt(currentPageInput.value);
        if (pageNum >= 1 && pageNum <= totalPages && pageNum !== currentPage) {
            stopAudio();
            queueRenderPage(pageNum);
        }
    });

    // Touch events for mobile
    let touchStartX = 0;
    let touchStartY = 0;

    pdfContainer.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    });

    pdfContainer.addEventListener('touchend', e => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
            if (deltaX > 0) {
                changePage(-1);
            } else {
                changePage(1);
            }
        }
    });

    function handleZoom(event) {
        event.preventDefault();
        scale += event.deltaY * -0.001;
        scale = Math.min(Math.max(0.5, scale), 3);
        renderPage(currentPage);
    }

    pdfContainer.addEventListener('wheel', handleZoom);

    window.addEventListener('resize', () => {
        if (pdfDoc) {
            renderPage(currentPage);
        }
    });

    // Enhanced tracking events
    window.addEventListener('beforeunload', () => {
        trackReadingTime();
        trackReading(currentPage, 'end_reading');
        if (audioElement) {
            audioElement.pause();
            audioElement = null;
        }
    });

    // Track visibility changes
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            trackReadingTime();
            trackReading(currentPage, 'pause_reading');
        } else {
            readingStartTime = Date.now();
            trackReading(currentPage, 'resume_reading');
        }
    });

    // Initialize
    loadPDF();
    updateAudioControls();
});