// Chapter sidebar implementation

// Store detected chapters globally
window.pdfChapters = [];
let currentActiveChapter = -1;

// Create and append the chapter sidebar elements
function createChapterSidebar() {
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.id = 'sidebar-toggle';
    toggleButton.className = 'sidebar-toggle';
    toggleButton.setAttribute('aria-label', 'Toggle chapters sidebar');
    toggleButton.innerHTML = '<i class="fas fa-book"></i>';
    
    // Create sidebar container
    const sidebar = document.createElement('div');
    sidebar.id = 'chapter-sidebar';
    sidebar.className = 'chapter-sidebar';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'sidebar-header';
    
    const title = document.createElement('h2');
    title.textContent = 'Chapters';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'sidebar-close';
    closeButton.setAttribute('aria-label', 'Close sidebar');
    closeButton.innerHTML = '<i class="fas fa-times"></i>';
    
    header.appendChild(title);
    header.appendChild(closeButton);
    
    // Create chapters container
    const chaptersContainer = document.createElement('div');
    chaptersContainer.id = 'chapters-container';
    chaptersContainer.className = 'chapters-container';
    
    // Assemble sidebar
    sidebar.appendChild(header);
    sidebar.appendChild(chaptersContainer);
    
    // Create overlay for mobile
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    
    // Add event listeners
    toggleButton.addEventListener('click', function() {
        toggleSidebar();
    });
    
    closeButton.addEventListener('click', function() {
        toggleSidebar(false);
    });
    
    overlay.addEventListener('click', function() {
        toggleSidebar(false);
    });
    
    // Add elements to the DOM
    document.body.appendChild(toggleButton);
    document.body.appendChild(sidebar);
    document.body.appendChild(overlay);
}

// Toggle the sidebar open/closed
function toggleSidebar(forcedState) {
    const sidebar = document.getElementById('chapter-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    const isOpen = forcedState !== undefined ? forcedState : !sidebar.classList.contains('open');
    
    if (isOpen) {
        sidebar.classList.add('open');
        overlay.classList.add('visible');
        document.body.classList.add('sidebar-open');
    } else {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
        document.body.classList.remove('sidebar-open');
    }
}

// Update the sidebar with detected chapters
function updateChapterSidebar(chapters) {
    window.pdfChapters = chapters;
    const container = document.getElementById('chapters-container');
    if (!container) return;
    
    // Clear existing chapters
    container.innerHTML = '';
    
    if (!chapters || chapters.length === 0) {
        const noChapters = document.createElement('p');
        noChapters.className = 'no-chapters';
        noChapters.textContent = 'No chapters detected';
        container.appendChild(noChapters);
        return;
    }
    
    // Create chapter list
    const chapterList = document.createElement('ul');
    chapterList.className = 'chapter-list';
    
    chapters.forEach(function(chapter, index) {
        const chapterItem = document.createElement('li');
        
        const chapterButton = document.createElement('button');
        chapterButton.className = 'chapter-item';
        chapterButton.setAttribute('data-page', chapter.pageNum);
        chapterButton.setAttribute('data-index', index);
        chapterButton.textContent = chapter.title;
        
        chapterButton.addEventListener('click', function() {
            // Navigate to chapter page
            if (window.TTS) {
                window.TTS.stopAudio();
            }
            
            // Use currentPage instead of queueRenderPage
            const pageNum = chapter.pageNum;
            const currentPageInput = document.getElementById('current-page');
            if (currentPageInput) {
                currentPageInput.value = pageNum;
                // Trigger the change event to navigate to the page
                const event = new Event('change');
                currentPageInput.dispatchEvent(event);
            }
            
            showMessage('Navigating to: ' + chapter.title, 'green', 2000);
            
            // Update active state
            setActiveChapter(index);
            
            // Close sidebar on mobile
            if (window.innerWidth < 768) {
                toggleSidebar(false);
            }
        });
        
        chapterItem.appendChild(chapterButton);
        chapterList.appendChild(chapterItem);
    });
    
    container.appendChild(chapterList);
}

// Set the active chapter in the sidebar
function setActiveChapter(index) {
    if (currentActiveChapter === index) return;
    
    currentActiveChapter = index;
    const chapterButtons = document.querySelectorAll('.chapter-item');
    
    chapterButtons.forEach(function(button) {
        button.classList.remove('active');
        if (parseInt(button.getAttribute('data-index')) === index) {
            button.classList.add('active');
        }
    });
}

// Update active chapter based on current page
function updateActiveChapterFromPage(currentPage) {
    if (!window.pdfChapters || window.pdfChapters.length === 0) return;
    
    // Find the chapter that corresponds to the current page
    let foundChapter = -1;
    
    for (let i = window.pdfChapters.length - 1; i >= 0; i--) {
        if (window.pdfChapters[i].pageNum <= currentPage) {
            foundChapter = i;
            break;
        }
    }
    
    if (foundChapter !== -1 && foundChapter !== currentActiveChapter) {
        setActiveChapter(foundChapter);
    }
}

// Hook into the renderPage function to update the active chapter
function hookIntoPageRendering() {
    // Get the current renderPage function
    if (window.renderPage) {
        // Save reference to the original function
        const originalRenderPage = window.renderPage;
        
        // Override with our enhanced version
        window.renderPage = function(num) {
            // Call original function
            const result = originalRenderPage(num);
            
            // Update the active chapter
            setTimeout(function() {
                updateActiveChapterFromPage(num);
            }, 100);
            
            return result;
        };
    }
}

// Wait for document to be ready
document.addEventListener('DOMContentLoaded', function() {
    // Wait a moment for all page scripts to initialize
    setTimeout(function() {
        // Create the chapter sidebar
        createChapterSidebar();
        
        // When findChapters is called, capture the chapters
        const originalFindChapters = window.findChapters;
        window.findChapters = function(pdfDocument) {
            return originalFindChapters(pdfDocument).then(function(chapters) {
                updateChapterSidebar(chapters);
                return chapters;
            });
        };
        
        // Hook into page rendering
        hookIntoPageRendering();
    }, 500); // Wait 500ms to ensure main.js has initialized
});