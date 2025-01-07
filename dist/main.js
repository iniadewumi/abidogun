// Mobile viewport height fix
function setVH() {
    let vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
}

setVH();
window.addEventListener('resize', setVH);
window.addEventListener('orientationchange', setVH);

document.addEventListener("DOMContentLoaded", function() {
    const url = 'Abidogun.pdf';
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
    let totalPages = 0;
    let pageRendering = false;
    let pageNumPending = null;
    let scale = 1;
    let currentPageText = '';
    let lastTrackingUpdate = 0;
    const TRACKING_INTERVAL = 30000; // 30 seconds

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

    // Analytics tracking function using Google Analytics
    function trackReading(page, action = 'read') {
        const now = Date.now();
        if (now - lastTrackingUpdate < TRACKING_INTERVAL && action === 'read') {
            return;
        }
        
        lastTrackingUpdate = now;

        // Send event to Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', action, {
                'event_category': 'PDF Reading',
                'event_label': url,
                'value': page,
                'session_id': sessionId,
                'total_pages': totalPages,
                'progress_percentage': Math.round((page / totalPages) * 100)
            });
        }
    }

    // Track reading time
    let readingStartTime = Date.now();
    function trackReadingTime() {
        if (typeof gtag !== 'undefined') {
            const timeSpent = Math.round((Date.now() - readingStartTime) / 1000);
            gtag('event', 'reading_time', {
                'event_category': 'PDF Reading',
                'event_label': url,
                'value': timeSpent,
                'session_id': sessionId
            });
        }
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