// text-to-speech.js

export class TextToSpeechManager {
    constructor(options = {}) {
        // Core audio state
        this.audioElement = null;
        this.audioData = null;
        this.isInitialized = false;
        this.isSpeaking = false;
        this.isPaused = false;
        
        // Callbacks
        this.onStateChange = null;
        this.onError = options.onError || console.error;
        this.onTrackInteraction = options.onTrackInteraction || (() => {});
        
        // Session tracking
        this.sessionId = options.sessionId || this.generateSessionId();
        this.playbackCount = parseInt(localStorage.getItem('audioPlaybackCount') || '0');
        
        // Device info
        this.pixelRatio = window.devicePixelRatio || 1;
        this.deviceType = /Mobile|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
    }

    generateSessionId() {
        return 'tts_' + Math.random().toString(36).substr(2, 9);
    }

    initialize() {
        if (this.isInitialized) return;

        if (!window.SpeechSDK) {
            this.onError('Speech SDK not loaded');
            return false;
        }

        if (!window.ENV?.AZURE_SUBSCRIPTION_KEY || !window.ENV?.AZURE_REGION) {
            this.onError('Azure credentials not configured');
            return false;
        }

        this.isInitialized = true;
        return true;
    }

    createSpeechConfig() {
        const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
            window.ENV.AZURE_SUBSCRIPTION_KEY,
            window.ENV.AZURE_REGION
        );
        speechConfig.speechSynthesisVoiceName = 'en-NG-EzinneNeural';
        return speechConfig;
    }

    synthesizeAudio(text) {
        if (!this.initialize()) return;

        // Track interaction
        this.trackAudioInteraction('synthesis_start');

        const speechConfig = this.createSpeechConfig();
        const audioConfig = SpeechSDK.AudioConfig.fromDefaultSpeakerOutput();
        const synthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);

        try {
            synthesizer.speakTextAsync(
                text,
                result => this.handleSynthesisResult(result, synthesizer),
                error => this.handleSynthesisError(error, synthesizer)
            );
        } catch (error) {
            this.handleSynthesisError(error, synthesizer);
        }
    }

    handleSynthesisResult(result, synthesizer) {
        try {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                this.handleSuccessfulSynthesis(result.audioData);
                this.trackAudioInteraction('synthesis_complete');
            } else if (result.reason === SpeechSDK.ResultReason.Canceled) {
                const cancellation = SpeechSDK.CancellationDetails.fromResult(result);
                this.onError('Speech synthesis canceled:', cancellation.errorDetails);
                this.updateState(false, false);
                this.trackAudioInteraction('synthesis_canceled');
            }
        } finally {
            synthesizer.close();
        }
    }

    handleSynthesisError(error, synthesizer) {
        this.onError('Error synthesizing speech:', error);
        this.updateState(false, false);
        this.trackAudioInteraction('synthesis_error');
        synthesizer.close();
    }

    handleSuccessfulSynthesis(audioBuffer) {
        const blob = new Blob([audioBuffer], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement = null;
        }

        this.audioElement = new Audio(url);
        this.setupAudioEventListeners(url);
        
        this.audioElement.play()
            .catch(error => this.onError('Audio playback error:', error));
            
        this.updateState(true, false);
        this.audioData = audioBuffer;
        
        // Update playback count
        this.playbackCount++;
        localStorage.setItem('audioPlaybackCount', this.playbackCount);
    }

    setupAudioEventListeners(url) {
        const events = {
            'ended': () => {
                this.updateState(false, false);
                URL.revokeObjectURL(url);
                this.trackAudioInteraction('playback_complete');
            },
            'playing': () => {
                this.updateState(true, false);
                this.trackAudioInteraction('playback_start');
            },
            'pause': () => {
                if (!this.audioElement.ended) {
                    this.updateState(false, true);
                    this.trackAudioInteraction('playback_pause');
                }
            },
            'error': (e) => {
                this.onError('Audio playback error:', e);
                this.updateState(false, false);
                this.trackAudioInteraction('playback_error');
            }
        };

        Object.entries(events).forEach(([event, handler]) => {
            this.audioElement.addEventListener(event, handler);
        });
    }

    playAudio(text) {
        if (this.isSpeaking && !this.isPaused) return;

        try {
            if (this.audioElement && this.isPaused) {
                this.audioElement.play()
                    .catch(error => this.onError('Audio playback error:', error));
                this.updateState(true, false);
                this.trackAudioInteraction('playback_resume');
            } else if (this.audioElement) {
                this.audioElement.play()
                    .catch(error => this.onError('Audio playback error:', error));
                this.updateState(true, false);
                this.trackAudioInteraction('playback_start');
            } else {
                this.synthesizeAudio(text);
            }
        } catch (error) {
            this.onError('Error in playAudio:', error);
            this.updateState(false, false);
        }
    }

    pauseAudio() {
        if (this.audioElement && this.isSpeaking && !this.isPaused) {
            this.audioElement.pause();
            this.updateState(false, true);
            this.trackAudioInteraction('playback_pause');
        }
    }

    stopAudio() {
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
            this.updateState(false, false);
            this.trackAudioInteraction('playback_stop');
        }
    }

    updateState(speaking, paused) {
        this.isSpeaking = speaking;
        this.isPaused = paused;
        if (this.onStateChange) {
            this.onStateChange(speaking, paused);
        }
    }

    trackAudioInteraction(action) {
        this.onTrackInteraction({
            action,
            sessionId: this.sessionId,
            deviceType: this.deviceType,
            playbackCount: this.playbackCount,
            timestamp: Date.now()
        });
    }

    getPlaybackStats() {
        return {
            playbackCount: this.playbackCount,
            sessionId: this.sessionId,
            deviceType: this.deviceType,
            pixelRatio: this.pixelRatio,
            isInitialized: this.isInitialized,
            isSpeaking: this.isSpeaking,
            isPaused: this.isPaused
        };
    }

    cleanup() {
        try {
            if (this.audioElement) {
                this.audioElement.pause();
                this.audioElement = null;
            }
            this.audioData = null;
            this.updateState(false, false);
            this.trackAudioInteraction('cleanup');
        } catch (error) {
            this.onError('Error during cleanup:', error);
        }
    }
}